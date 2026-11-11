import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { runFullSweep, runOperationalTick } from "@/lib/engine";
import { casUpdateMany, TRIP_MACHINE } from "@/lib/state-machines";

/** All trips with manifests + allocation state. */
export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await runOperationalTick();
  const { searchParams } = new URL(req.url);
  const day = searchParams.get("day"); // -1, 0, 1, 2 relative or "all"
  const now = new Date();

  const trips = await db.trip.findMany({
    orderBy: { departureAt: "desc" },
    take: 120,
    include: {
      route: true,
      driver: true,
      train: true,
      bookings: {
        include: { passenger: true, ledgerEntry: true },
        orderBy: { createdAt: "asc" },
      },
      reservedBookings: {
        include: { passenger: true, ledgerEntry: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const filtered = trips.filter((t) => {
    if (!day || day === "all") return true;
    const offset = parseInt(day, 10);
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    const start = new Date(d); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return t.departureAt >= start && t.departureAt < end;
  });

  return NextResponse.json({
    trips: filtered.map((t) => ({
      id: t.id,
      routeName: t.route.name,
      direction: t.direction,
      departureAt: t.departureAt,
      status: t.status,
      capacity: t.capacity,
      bookedSeats: t.bookedSeats,
      lockReason: t.lockReason,
      lockedAt: t.lockedAt,
      departedAt: t.departedAt,
      completedAt: t.completedAt,
      source: t.source,
      train: t.train
        ? {
            name: t.train.name,
            mtmTime: t.train.direction === "MBA_TO_NBO" ? t.train.originTime : t.train.destTime,
            ntmTime: t.train.direction === "MBA_TO_NBO" ? t.train.destTime : t.train.originTime,
            eventKind: t.train.direction === "MBA_TO_NBO" ? "departs_mtm" : "arrives_mtm",
          }
        : null,
      driver: t.driver
        ? { id: t.driver.id, name: t.driver.name, plate: t.driver.plate, phone: t.driver.phone, mpesaNumber: t.driver.mpesaNumber }
        : null,
      manifest: [...t.bookings, ...t.reservedBookings]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((b) => ({
        id: b.id,
        code: b.code,
        passenger: b.passenger.name,
        phone: b.passenger.phone,
        stageName: b.stageName,
        seats: b.seats,
        isCharter: b.isCharter,
        status: b.status,
        assignmentStatus: b.reservationTripId === t.id ? "held_for_payment" : "assigned",
        fare: b.fareAmount,
        homeSurcharge: b.homeSurcharge,
        ledgerStatus: b.ledgerEntry?.status || null,
      })),
    })),
  });
}

/** Ops controls: advance the simulation now, or run the full nightly-style sweep. */
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const actor = { id: session.id, name: session.name, role: "admin" as const };

  if (body.action === "tick") {
    const result = await runOperationalTick();
    return NextResponse.json({ ok: true, ...result });
  }
  if (body.action === "full_sweep") {
    const result = await runFullSweep(actor);
    return NextResponse.json({ ok: true, ...result });
  }
  if (body.action === "cancel_trip") {
    const trip = await db.trip.findUnique({
      where: { id: body.tripId },
      include: {
        bookings: { include: { ledgerEntry: true } },
        reservedBookings: { include: { ledgerEntry: true } },
      },
    });
    if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    if (["completed", "cancelled"].includes(trip.status)) {
      return NextResponse.json({ error: `Trip already ${trip.status}` }, { status: 400 });
    }
    const { executeCancellation } = await import("@/lib/money");

    // §8 edge case: trip cancelled after some passengers already boarded —
    // only refund unboarded; boarded passengers' fares proceed to payout.
    let refunded = 0;
    let proceeded = 0;
    for (const b of [...trip.bookings, ...trip.reservedBookings]) {
      if (["cancelled", "no_show"].includes(b.status)) continue;
      if (b.status === "boarded") {
        proceeded++;
        continue;
      }
      await executeCancellation({
        bookingId: b.id,
        actor,
        trigger: "trip_cancel_unboarded",
      });
      refunded++;
    }
    if (proceeded > 0) {
      // Shortened trip: boarded passengers delivered — run completion path
      const { onTripCompleted } = await import("@/lib/money");
      await onTripCompleted(trip.id);
    } else {
      // CAS: only a pre-departure trip can be cancelled — a trip that departed
      // between the seat scan and now is left alone (it completes normally).
      const cancelled = await casUpdateMany(
        "trip",
        { id: trip.id },
        TRIP_MACHINE,
        ["scheduled", "filling", "locked"],
        "cancelled",
      );
      if (cancelled === 0) {
        return NextResponse.json({ error: "Trip already departed — it completed instead of cancelling." }, { status: 409 });
      }
    }
    await audit({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: "admin",
      action: "trip.platform_cancel",
      entity: "trip",
      entityId: trip.id,
      metadata: { refunded, proceeded },
    });
    return NextResponse.json({
      ok: true,
      refundedUnboarded: refunded,
      proceededBoarded: proceeded,
      message:
        proceeded > 0
          ? `${refunded} unboarded bookings refunded in full; ${proceeded} boarded passengers' fares proceed to payout.`
          : `${refunded} bookings refunded in full. Trip cancelled.`,
    });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
