import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runOperationalTick, CAB_LEAD_MINUTES } from "@/lib/engine";
import { getConfig } from "@/lib/money";
import { nairobiDayRange } from "@/lib/nairobi-time";
import { getEligibleDriverIds } from "@/lib/driver/availability";
import { DriverError } from "@/lib/driver/errors";
import { expireUnpaidBookingReservations } from "@/lib/unpaid-booking-expiry";
import { describeCancellationCutoff } from "@/lib/cancellation-policy";

/** Bookable departures for a date + direction. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // YYYY-MM-DD
  const direction = searchParams.get("direction") || "FROM_TERMINUS";
  const routeId = searchParams.get("routeId");
  const trainId = searchParams.get("trainId");
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  if (!["FROM_TERMINUS", "TO_TERMINUS"].includes(direction)) return NextResponse.json({ error: "Invalid direction" }, { status: 400 });
  if (!trainId || trainId.length > 64) return NextResponse.json({ error: "Choose a train" }, { status: 400 });
  if (routeId !== null && (routeId.length === 0 || routeId.length > 64)) {
    return NextResponse.json({ error: "Invalid route" }, { status: 400 });
  }
  let dayStart: Date;
  let dayEnd: Date;
  try { ({ start: dayStart, end: dayEnd } = nairobiDayRange(date)); }
  catch { return NextResponse.json({ error: "Invalid travel date" }, { status: 400 }); }
  try {
    await expireUnpaidBookingReservations();
    // Check supply before running the scheduler. With no active, approved
    // drivers there can be no customer-facing trips, and the scheduler would
    // otherwise perform config, route, document, and trip queries on every
    // availability request just to return an empty list.
    const eligibleDriverIds = await getEligibleDriverIds();

    if (eligibleDriverIds.length === 0) {
      return NextResponse.json({ hasEligibleDrivers: false, trips: [] });
    }

    await runOperationalTick();
    const cfg = await getConfig();
    const now = new Date();
    const trips = await db.trip.findMany({
      where: {
        ...(routeId ? { routeId } : {}),
        trainId,
        direction,
        driverId: { in: eligibleDriverIds },
        departureAt: { gte: dayStart, lt: dayEnd },
        status: { in: ["scheduled", "locked", "departed"] },
        route: {
          is: {
            active: true,
            stages: {
              some: {
                order: { gt: 0 },
                fare: { gt: 0 },
                homeSurcharge: { gte: 0 },
              },
            },
          },
        },
        train: { is: { active: true } },
      },
      orderBy: { departureAt: "asc" },
      select: {
        id: true,
        routeId: true,
        direction: true,
        departureAt: true,
        status: true,
        capacity: true,
        route: {
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            charterPrice: true,
          },
        },
        train: {
          select: { id: true, name: true, direction: true, originTime: true, destTime: true },
        },
        bookings: {
          where: { status: { in: ["awaiting_payment", "confirmed", "boarded", "completed"] } },
          select: { seats: true },
        },
      },
    });

  return NextResponse.json({
    hasEligibleDrivers: true,
    // The database query requires at least one valid customer stop without
    // materializing the entire route-stage list for every departure.
    trips: trips.map((t) => {
      const relevantBooked = t.bookings.reduce((s, b) => s + b.seats, 0);
      const seatsLeft = Math.max(t.capacity - relevantBooked, 0);
      const isFromTerminus = t.direction === "FROM_TERMINUS";
      const train = t.train
        ? {
            id: t.train.id,
            name: t.train.name,
            // MTM event time: the departure we race for, or the arrival we meet
            mtmTime: t.train.direction === "MBA_TO_NBO" ? t.train.originTime : t.train.destTime,
            ntmTime: t.train.direction === "MBA_TO_NBO" ? t.train.destTime : t.train.originTime,
            eventKind: t.train.direction === "MBA_TO_NBO" ? "departs_mtm" : "arrives_mtm",
          }
        : null;
      return {
        id: t.id,
        routeId: t.route.id,
        routeName: t.route.name,
        durationMinutes: t.route.durationMinutes,
        charterPrice: t.route.charterPrice,
        platformFeeAmount: cfg.bookingFeeAmount,
        cancellationCutoffMinutes: cfg.fullRefundCutoffMinutes,
        direction: t.direction,
        departureAt: t.departureAt,
        // TO_TERMINUS: when the cab is scheduled to reach the terminus —
        // cabs leave stages CAB_LEAD_MINUTES before the train (the pickup
        // rule), so the train departs at departureAt + lead; the cab targets
        // arriving terminusArrivalBufferMinutes before that.
        // FROM_TERMINUS: departureAt itself is the terminus departure.
        terminusAt: isFromTerminus
          ? t.departureAt
          : t.train && t.train.direction === "MBA_TO_NBO"
            ? new Date(
                t.departureAt.getTime() +
                  (CAB_LEAD_MINUTES - cfg.terminusArrivalBufferMinutes) * 60 * 1000,
              )
            : new Date(t.departureAt.getTime() + t.route.durationMinutes * 60 * 1000),
        train,
        status: t.status,
        capacity: t.capacity,
        seatsLeft,
        bookable: ["scheduled", "locked"].includes(t.status) && seatsLeft > 0 && t.departureAt > now,
        lockNote: t.status === "locked"
          ? `Cancellation notice at least ${describeCancellationCutoff(cfg.fullRefundCutoffMinutes)} before pickup gets a full refund. Later notice gets 75% travel credit for 30 days; 25% is forfeited.`
          : null,
        // The customer-selected stop comes from the bounded /api/stages search;
        // do not repeat route-stop details for each departure card.
        pointsLabel: isFromTerminus ? "drop-off" : "pickup",
      };
      }),
  });
  } catch (error) {
    if (error instanceof DriverError && error.code === "PLATFORM_NOT_CONFIGURED") {
      return NextResponse.json(
        { error: "Ride schedules are not set up yet.", code: error.code },
        { status: error.status },
      );
    }
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
    // ORM/provider exceptions can contain connection details; keep diagnostics
    // useful without copying those details into persistent application logs.
    console.error("trip availability failed", { code });
    return NextResponse.json(
      { error: "Cab availability is temporarily unavailable." },
      { status: 503 },
    );
  }
}
