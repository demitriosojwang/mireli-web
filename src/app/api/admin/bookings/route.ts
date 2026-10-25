import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { executeCancellation } from "@/lib/money";
import { runOperationalTick } from "@/lib/engine";
import { sendBookingTicketEmail } from "@/lib/booking-ticket-email";

/** All bookings — oversight view with allocation + money state. */
export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await runOperationalTick();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const q = searchParams.get("q");

  const bookings = await db.booking.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      passenger: true,
      trip: { include: { driver: true, route: true } },
      ledgerEntry: true,
      ticketEmailDelivery: true,
    },
  });

  const filtered = q
    ? bookings.filter(
        (b) =>
          b.code.toLowerCase().includes(q.toLowerCase()) ||
          b.passenger.name?.toLowerCase().includes(q.toLowerCase()) ||
          b.passenger.phone.includes(q)
      )
    : bookings;

  return NextResponse.json({
    bookings: filtered.map((b) => ({
      id: b.id,
      code: b.code,
      passenger: { name: b.passenger.name, phone: b.passenger.phone },
      guest: b.passengerName ? { name: b.passengerName, phone: b.passengerPhone } : null,
      routeName: b.trip?.route.name || null,
      direction: b.direction,
      stageName: b.stageName,
      homePickup: b.homePickup,
      seats: b.seats,
      isCharter: b.isCharter,
      fareAmount: b.fareAmount,
      homeSurcharge: b.homeSurcharge,
      creditApplied: b.creditApplied,
      cashDue: b.cashDue,
      status: b.status,
      cancelTier: b.cancelTier,
      cancellationRequestedAt: b.cancellationRequestedAt?.toISOString() || null,
      createdAt: b.createdAt,
      departureAt: b.trip?.departureAt || null,
      tripStatus: b.trip?.status || null,
      driver: b.trip?.driver ? { name: b.trip.driver.name, plate: b.trip.driver.plate } : null,
      allocationNote: b.allocationNote,
      ticketEmail: b.ticketEmailDelivery
        ? {
            status: b.ticketEmailDelivery.status,
            attempts: b.ticketEmailDelivery.attempts,
            sentAt: b.ticketEmailDelivery.sentAt,
            lastErrorCode: b.ticketEmailDelivery.lastErrorCode,
          }
        : null,
      ledger: b.ledgerEntry
        ? {
            status: b.ledgerEntry.status,
            cash: b.ledgerEntry.cashAmount,
            credit: b.ledgerEntry.creditApplied,
            homeSurcharge: b.ledgerEntry.homeSurchargeAmount,
            receipt: b.ledgerEntry.mpesaReceipt,
          }
        : null,
    })),
  });
}

/** Booking-level admin actions: platform cancel (disputes) — full refund always. */
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { bookingId, action } = body;
  const actor = { id: session.id, name: session.name, role: "admin" as const };

  if (action === "retry_ticket_email") {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { ledgerEntry: true, ticketEmailDelivery: true },
    });
    if (!booking || !booking.ledgerEntry || !["confirmed", "boarded", "completed"].includes(booking.status)) {
      return NextResponse.json({ error: "Only paid, confirmed bookings have a ticket to send" }, { status: 409 });
    }
    if (booking.ticketEmailDelivery?.status === "uncertain") {
      return NextResponse.json({
        error: "Delivery is uncertain. Check the Brevo transactional log before retrying to avoid sending a duplicate ticket.",
      }, { status: 409 });
    }
    const delivery = await sendBookingTicketEmail(booking.id);
    await audit({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: "booking.ticket_email_retry",
      entity: "booking",
      entityId: booking.id,
      metadata: { status: delivery.status, errorCode: delivery.lastErrorCode || null },
    });
    return NextResponse.json({ ok: delivery.status === "sent", ticketEmail: delivery });
  }

  if (action === "platform_cancel") {
    const booking = await db.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (["cancelled", "completed", "no_show"].includes(booking.status)) {
      return NextResponse.json({ error: `Booking already ${booking.status}` }, { status: 400 });
    }
    // Platform-initiated cancellation → full cash refund, any timing
    const result = await executeCancellation({
      bookingId,
      actor,
      trigger: "platform_cancel",
    });
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "process_passenger_cancel") {
    const booking = await db.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (!booking.cancellationRequestedAt) {
      return NextResponse.json({ error: "The passenger has not submitted a cancellation request" }, { status: 409 });
    }
    if (["cancelled", "completed", "no_show"].includes(booking.status)) {
      return NextResponse.json({ error: `Booking already ${booking.status}` }, { status: 409 });
    }
    const result = await executeCancellation({
      bookingId,
      actor,
      trigger: "passenger_cancel",
    });
    await audit({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: "booking.passenger_cancellation_processed",
      entity: "booking",
      entityId: booking.id,
      metadata: { code: booking.code, outcome: result.outcome, tier: result.tier },
    });
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "override_refund") {
    const booking = await db.booking.findUnique({ where: { id: bookingId }, include: { ledgerEntry: true } });
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (!booking.ledgerEntry) {
      return NextResponse.json({ error: "No payment collected on this booking" }, { status: 400 });
    }
    const priorRefunds = await db.refundRecord.aggregate({
      where: { ledgerEntryId: booking.ledgerEntry.id, status: { in: ["pending", "completed"] } },
      _sum: { amount: true },
    });
    const remainingCash = Math.max(0, booking.ledgerEntry.cashAmount - (priorRefunds._sum.amount || 0));
    const amount = Math.max(0, Math.min(parseInt(body.amount, 10) || 0, remainingCash));
    if (amount <= 0) return NextResponse.json({ error: remainingCash <= 0 ? "No refundable cash remains on this booking" : "Refund amount must be positive" }, { status: 400 });
    const result = await executeCancellation({
      bookingId,
      actor,
      trigger: "admin_override",
      overrideAmount: amount,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
