import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runOperationalTick, CAB_LEAD_MINUTES } from "@/lib/engine";
import { getConfig } from "@/lib/money";
import { nairobiDayRange } from "@/lib/nairobi-time";
import { evaluateDriverApplication } from "@/lib/driver/onboarding";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";

/** Bookable departures for a date + direction. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // YYYY-MM-DD
  const direction = searchParams.get("direction") || "FROM_TERMINUS";
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  if (!["FROM_TERMINUS", "TO_TERMINUS"].includes(direction)) return NextResponse.json({ error: "Invalid direction" }, { status: 400 });
  let dayStart: Date;
  let dayEnd: Date;
  try { ({ start: dayStart, end: dayEnd } = nairobiDayRange(date)); }
  catch { return NextResponse.json({ error: "Invalid travel date" }, { status: 400 }); }
  await runOperationalTick();
  const now = new Date();
  const cfg = await getConfig();
  const activeDrivers = await db.driver.findMany({
    where: { status: "active" },
    select: {
      id: true,
      status: true,
      application: {
        include: { documents: { where: { state: { not: "replaced" } } } },
      },
    },
  });
  const eligibleDriverIds = new Set(
    activeDrivers
      .filter((driver) => isLocalDemoEnabled() || evaluateDriverApplication(driver.application, driver.status).eligible)
      .map((driver) => driver.id),
  );

  const trips = await db.trip.findMany({
    where: {
      direction,
      departureAt: { gte: dayStart, lt: dayEnd },
      status: { in: ["scheduled", "locked", "departed"] },
    },
    orderBy: { departureAt: "asc" },
    include: {
      route: { include: { stages: { orderBy: { order: "asc" } } } },
      driver: true,
      train: true,
      bookings: { where: { status: { in: ["awaiting_payment", "confirmed", "boarded", "completed"] } }, select: { seats: true } },
    },
  });
  const availableTrips = trips.filter((trip) => !!trip.driverId && eligibleDriverIds.has(trip.driverId));

  return NextResponse.json({
    hasEligibleDrivers: eligibleDriverIds.size > 0,
    trips: availableTrips.map((t) => {
      const relevantBooked = t.bookings.reduce((s, b) => s + b.seats, 0);
      const seatsLeft = Math.max(t.capacity - relevantBooked, 0);
      const stages = t.route.stages.map((s) => ({
        id: s.id,
        name: s.name,
        order: s.order,
        fare: s.fare,
        homeSurcharge: s.homeSurcharge,
      }));
      const nonTerminusStages = stages.filter((s) => s.order > 0);
      const isFromTerminus = t.direction === "FROM_TERMINUS";
      const train = t.train
        ? {
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
        lockNote: t.status === "locked" ? "Bookings locked — late cancellation converts fare to credit" : null,
        // Driver identity is public; the phone number is only revealed after
        // payment (see /api/bookings) to protect drivers from spam calls.
        driver: t.driver
          ? {
              name: t.driver.name,
              plate: t.driver.plate,
              cabType: t.driver.cabType,
              rating: t.driver.rating,
            }
          : null,
        stages,
        // FROM_TERMINUS exposes drop-off points; TO_TERMINUS exposes pickup points
        pointsLabel: isFromTerminus ? "drop-off" : "pickup",
        points: nonTerminusStages,
        minFare: Math.min(...nonTerminusStages.map((s) => s.fare)),
      };
    }),
  });
}
