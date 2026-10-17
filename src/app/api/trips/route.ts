import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runOperationalTick, CAB_LEAD_MINUTES } from "@/lib/engine";
import { getConfig } from "@/lib/money";
import { nairobiDayRange } from "@/lib/nairobi-time";
import { evaluateDriverApplication } from "@/lib/driver/onboarding";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";
import { DriverError } from "@/lib/driver/errors";

/** Bookable departures for a date + direction. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // YYYY-MM-DD
  const direction = searchParams.get("direction") || "FROM_TERMINUS";
  const routeId = searchParams.get("routeId");
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  if (!["FROM_TERMINUS", "TO_TERMINUS"].includes(direction)) return NextResponse.json({ error: "Invalid direction" }, { status: 400 });
  if (routeId !== null && (routeId.length === 0 || routeId.length > 64)) {
    return NextResponse.json({ error: "Invalid route" }, { status: 400 });
  }
  let dayStart: Date;
  let dayEnd: Date;
  try { ({ start: dayStart, end: dayEnd } = nairobiDayRange(date)); }
  catch { return NextResponse.json({ error: "Invalid travel date" }, { status: 400 }); }
  try {
    // Check supply before running the scheduler. With no active, approved
    // drivers there can be no customer-facing trips, and the scheduler would
    // otherwise perform config, route, document, and trip queries on every
    // availability request just to return an empty list.
    const activeDrivers = await db.driver.findMany({
      where: { status: "active" },
      select: {
        id: true,
        status: true,
        application: {
          select: {
            status: true,
            policyVersion: true,
            ownsVehicle: true,
            documents: {
              where: { state: { not: "replaced" } },
              select: { type: true, state: true, scanState: true, expiresAt: true },
            },
          },
        },
      },
    });
    const eligibleDriverIds = activeDrivers
      .filter((driver) => isLocalDemoEnabled() || evaluateDriverApplication(driver.application, driver.status).eligible)
      .map((driver) => driver.id);

    if (eligibleDriverIds.length === 0) {
      return NextResponse.json({ hasEligibleDrivers: false, trips: [] });
    }

    await runOperationalTick();
    const cfg = await getConfig();
    const now = new Date();
    const trips = await db.trip.findMany({
      where: {
        ...(routeId ? { routeId } : {}),
        direction,
        driverId: { in: eligibleDriverIds },
        departureAt: { gte: dayStart, lt: dayEnd },
        status: { in: ["scheduled", "locked", "departed"] },
        route: { is: { active: true } },
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
            stages: {
              orderBy: { order: "asc" },
              select: { order: true, fare: true, homeSurcharge: true },
            },
          },
        },
        driver: { select: { name: true, plate: true, cabType: true, rating: true } },
        train: {
          select: { name: true, direction: true, originTime: true, destTime: true },
        },
        bookings: {
          where: { status: { in: ["awaiting_payment", "confirmed", "boarded", "completed"] } },
          select: { seats: true },
        },
      },
    });

  return NextResponse.json({
    hasEligibleDrivers: true,
    // A stale trip row or an active route without any customer-selectable
    // point cannot be booked. Do not present either as available supply.
    trips: trips
      .filter((t) => !!t.driver && t.route.stages.some((stage) =>
        stage.order > 0 && stage.fare > 0 && stage.homeSurcharge >= 0,
      ))
      .map((t) => {
      const relevantBooked = t.bookings.reduce((s, b) => s + b.seats, 0);
      const seatsLeft = Math.max(t.capacity - relevantBooked, 0);
      const nonTerminusStages = t.route.stages.filter((s) =>
        s.order > 0 && s.fare > 0 && s.homeSurcharge >= 0,
      );
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
        // Stage details are loaded once from /api/routes, not repeated for
        // every cab. The current policy lets every active driver serve every
        // active route, so filtering by routeId is sufficient.
        pointsLabel: isFromTerminus ? "drop-off" : "pickup",
        minFare: nonTerminusStages.length ? Math.min(...nonTerminusStages.map((s) => s.fare)) : 0,
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
    console.error("trip availability failed", error);
    return NextResponse.json(
      { error: "Cab availability is temporarily unavailable." },
      { status: 503 },
    );
  }
}
