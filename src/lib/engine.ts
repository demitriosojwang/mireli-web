import { db } from "@/lib/db";
import {evaluateDriverApplication} from "@/lib/driver/eligibility";
import { getConfig, onTripCompleted, runReconciliationSweep, isPayoutBatchDue, runPayoutBatch } from "@/lib/money";
import { audit } from "@/lib/audit";
import { nairobiDate, nairobiDayRange, nairobiEventAt, nairobiTrainArrivalAt } from "@/lib/nairobi-time";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";

/**
 * The ops engine — everything here runs automatically so the admin's role
 * stays oversight-only (config, disputes, reconciliation spot-checks).
 *
 * `runOperationalTick()` is idempotent and lazily invoked at the start of
 * API reads/writes, so the platform keeps operating even with no traffic.
 */

// ─── Train-synced scheduling ─────────────────────────────────────────────────
// Every feeder cab is anchored to a Madaraka Express event at Mombasa
// Terminus (MTM), per the official timetable (MTM/NTM times):
//   · Trains DEPARTING MTM (Inter-County 08:00 · Express 15:00 · Night 22:00)
//     → TO_TERMINUS shuttles leave their stages exactly CAB_LEAD_MINUTES
//       before train departure (e.g. the 08:00 train is caught by cabs that
//       pull out of every stage at 06:00). Passengers must be at the stage by
//       then; the cab waits at most STAGE_GRACE_MINUTES for someone who has
//       not arrived and has not notified the driver.
//   · Trains ARRIVING MTM (Inter-County 14:00 · Express 20:30 · Night 03:55)
//     → FROM_TERMINUS shuttles leave MTM `trainMeetBufferMinutes` after
//       arrival, dropping passengers at their chosen drop-off points.

/** User rule: every pickup-stage cab departs exactly 2h before its train. */
export const CAB_LEAD_MINUTES = 120;

/** User rule: max minutes a cab waits past departure for a passenger who has
 *  neither arrived at the stage nor notified the driver. After that the cab
 *  leaves and the booking lands in the no-show tier. */
export const STAGE_GRACE_MINUTES = 15;

function dayAt(base: Date, dayOffset: number, hhmm: string): Date {
  return nairobiEventAt(base, dayOffset, hhmm);
}

/** Assign a scheduled departure only when the driver is still approved and
 * has no trip whose configured duration overlaps this slot. The advisory lock
 * makes concurrent scheduler ticks idempotent for the same route/train slot;
 * the driver row lock serializes assignments across different routes. */
async function createScheduledTrip(params: {
  routeId: string;
  direction: string;
  trainId: string;
  departureAt: Date;
  routeDurationMinutes: number;
  driverIds: string[];
}): Promise<boolean> {
  const slotKey = `${params.routeId}:${params.direction}:${params.trainId}:${params.departureAt.toISOString()}`;
  const departureEnd = new Date(params.departureAt.getTime() + params.routeDurationMinutes * 60 * 1000);

  for (const driverId of params.driverIds) {
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${slotKey}))`;
      const existingSlot = await tx.trip.findFirst({
        where: {
          routeId: params.routeId,
          direction: params.direction,
          trainId: params.trainId,
          departureAt: params.departureAt,
        },
        select: { id: true },
      });
      if (existingSlot) return "exists" as const;

      await tx.$queryRaw`SELECT "id" FROM "Driver" WHERE "id" = ${driverId} FOR UPDATE`;
      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        include: { application: { include: { documents: { where: { state: { not: "replaced" } } } } } },
      });
      if (!driver || !(isLocalDemoEnabled() || evaluateDriverApplication(driver.application, driver.status).eligible)) {
        return "unavailable" as const;
      }

      const assignedTrips = await tx.trip.findMany({
        where: {
          driverId,
          departureAt: { lt: departureEnd },
          status: { in: ["scheduled", "locked", "departed"] },
        },
        select: { departureAt: true, route: { select: { durationMinutes: true } } },
      });
      const overlaps = assignedTrips.some((trip) =>
        trip.departureAt.getTime() + trip.route.durationMinutes * 60 * 1000 > params.departureAt.getTime(),
      );
      if (overlaps) return "busy" as const;

      await tx.trip.create({
        data: {
          routeId: params.routeId,
          driverId,
          direction: params.direction,
          departureAt: params.departureAt,
          capacity: driver.capacity,
          source: "schedule",
          trainId: params.trainId,
        },
      });
      return "created" as const;
    });

    if (result === "exists") return false;
    if (result === "created") return true;
  }

  return false;
}

/** Creates scheduled trips for the next `tripHorizonDays`, anchored to the
 *  train timetable, and assigns available drivers. Return shuttles reuse the
 *  outbound driver of the same route + train when feasible. Lazily
 *  self-extending; idempotent. */
export async function ensureTrips(): Promise<number> {
  const cfg = await getConfig();
  const routes = await db.route.findMany({ where: { active: true } });
  const candidates = await db.driver.findMany({ where: { status: "active" }, orderBy: { createdAt: "asc" },include:{application:{include:{documents:{where:{state:{not:"replaced"}}}}}} });
  const drivers=candidates.filter(d=>isLocalDemoEnabled() || evaluateDriverApplication(d.application,d.status).eligible);
  if (!drivers.length || !routes.length) return 0;

  // Departure-anchored (MBA_TO_NBO) trains first, so outbound cabs exist
  // before arrival-anchored return cabs try to pair with their drivers.
  const trains = await db.train.findMany({
    where: { active: true },
    orderBy: [{ direction: "asc" }, { originTime: "asc" }],
  });
  if (!trains.length) return 0;

  const now = new Date();
  let created = 0;
  let rr = (await db.trip.count()) % Math.max(drivers.length, 1); // round-robin offset

  const orderedDriverIds = (preferredDriverId?: string | null) => {
    const rotated = [...drivers.slice(rr), ...drivers.slice(0, rr)].map((driver) => driver.id);
    return preferredDriverId
      ? [preferredDriverId, ...rotated.filter((id) => id !== preferredDriverId)]
      : rotated;
  };

  for (let dayOffset = 0; dayOffset <= cfg.tripHorizonDays; dayOffset++) {
    for (const train of trains) {
      if (train.direction === "MBA_TO_NBO") {
        // Departure event at MTM → every stage's cab pulls out exactly 2h
        // before the train leaves, regardless of route length.
        const trainDep = dayAt(now, dayOffset, train.originTime);
        const dep = new Date(trainDep.getTime() - CAB_LEAD_MINUTES * 60 * 1000);
        for (const route of routes) {
          if (dep.getTime() < now.getTime() - 30 * 60 * 1000) continue; // skip stale slots
          const wasCreated = await createScheduledTrip({
            routeId: route.id,
            direction: "TO_TERMINUS",
            trainId: train.id,
            departureAt: dep,
            routeDurationMinutes: route.durationMinutes,
            driverIds: orderedDriverIds(),
          });
          if (wasCreated) {
            created++;
            rr = (rr + 1) % drivers.length;
          }
        }
      } else {
        // Arrival event at MTM → meet-and-drop shuttles leave after the buffer.
        // Anchored on the arrival calendar day (night train's 03:55 arrival
        // belongs to the train that left NTM 22:00 the previous evening).
        const trainArr = nairobiTrainArrivalAt(now, dayOffset, train.destDayOffset, train.destTime);
        const dep = new Date(trainArr.getTime() + cfg.trainMeetBufferMinutes * 60 * 1000);
        for (const route of routes) {
          if (dep.getTime() < now.getTime() - 30 * 60 * 1000) continue;
          const exists = await db.trip.findFirst({
            where: { routeId: route.id, direction: "FROM_TERMINUS", trainId: train.id, departureAt: dep },
          });
          if (exists) continue;
          // Pair the return cab with the driver who ran the outbound for the
          // same-named train within the last 24h (e.g. 08:00 departure ↔ 14:00 arrival).
          const pairedDepTrain = trains.find((t) => t.direction === "MBA_TO_NBO" && t.name === train.name);
          let preferredDriverId: string | null = null;
          if (pairedDepTrain) {
            const outbound = await db.trip.findFirst({
              where: {
                routeId: route.id,
                direction: "TO_TERMINUS",
                trainId: pairedDepTrain.id,
                departureAt: {
                  gte: new Date(dep.getTime() - 24 * 60 * 60 * 1000),
                  lte: dep,
                },
              },
              orderBy: { departureAt: "desc" },
            });
            if (outbound?.driverId) {
              preferredDriverId = drivers.find((d) => d.id === outbound.driverId)?.id || null;
            }
          }
          const wasCreated = await createScheduledTrip({
            routeId: route.id,
            direction: "FROM_TERMINUS",
            trainId: train.id,
            departureAt: dep,
            routeDurationMinutes: route.durationMinutes,
            driverIds: orderedDriverIds(preferredDriverId),
          });
          if (wasCreated) {
            created++;
            rr = (rr + 1) % drivers.length;
          }
        }
      }
    }
  }
  return created;
}

/** Allocate to a feasible trip on the requested route + direction and
 *  calendar day. Customer bookings can pin the selected trip so a stale or
 *  full cab never silently becomes a different departure. Only unpinned
 *  internal callers may fall back to an extra departure. */
export async function allocateBooking(params: {
  bookingId: string;
  routeId: string;
  selectedTripId?: string;
  direction: string;
  seats: number;
  travelDate: Date;
  charter?: boolean;
}): Promise<{ tripId: string | null; note: string }> {
  const cfg = await getConfig();
  await ensureTrips();

  const { start: dayStart, end: dayEnd } = nairobiDayRange(nairobiDate(params.travelDate));

  const now = new Date();
  const minDeparture = new Date(now.getTime() + cfg.bookingWindowMinutes * 60 * 1000);
  const from = minDeparture > dayStart ? minDeparture : dayStart;

  // Prefer the earliest feasible departure that fits everyone
  const candidates = await db.trip.findMany({
    where: {
      ...(params.selectedTripId ? { id: params.selectedTripId } : {}),
      routeId: params.routeId,
      direction: params.direction,
      departureAt: { gte: from, lt: dayEnd },
      status: { in: ["scheduled", "locked"] },
    },
    orderBy: { departureAt: "asc" },
    include: {
      driver: { include: { application: { include: { documents: { where: { state: { not: "replaced" } } } } } } },
    },
  });

  for (const t of candidates) {
    if (!t.driver || !(isLocalDemoEnabled() || evaluateDriverApplication(t.driver.application, t.driver.status).eligible)) continue;
    // Lock the trip row before checking its manifest so concurrent bookings
    // cannot both observe the same free seats. Recount active bookings here
    // instead of trusting bookedSeats: older cancellations did not decrement
    // that cached counter.
    const reservation = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${t.id} FOR UPDATE`;
      const current = await tx.trip.findUnique({
        where: { id: t.id },
        include: {
          bookings: {
            where: { status: { in: ["awaiting_payment", "confirmed", "boarded"] } },
            select: { seats: true, isCharter: true },
          },
        },
      });
      if (!current || !["scheduled", "locked"].includes(current.status)) return null;

      const hasCharter = current.bookings.some((booking) => booking.isCharter);
      const occupiedSeats = hasCharter ? current.capacity : current.bookings.reduce((sum, booking) => sum + booking.seats, 0);
      if (params.charter ? current.bookings.length > 0 : hasCharter || occupiedSeats + params.seats > current.capacity) return null;

      const nextOccupiedSeats = params.charter ? current.capacity : occupiedSeats + params.seats;
      const note = params.charter
        ? `Charter — whole cab allocated (${current.direction === "FROM_TERMINUS" ? "from-terminus" : "to-terminus"})`
        : `Auto-allocated to ${current.direction === "FROM_TERMINUS" ? "from-terminus" : "to-terminus"} trip`;
      await tx.trip.update({ where: { id: current.id }, data: { bookedSeats: nextOccupiedSeats } });
      await tx.booking.update({ where: { id: params.bookingId }, data: { tripId: current.id, allocationNote: note } });
      return { tripId: current.id, seatsLeft: current.capacity - nextOccupiedSeats };
    });
    if (reservation) {
      return {
        tripId: reservation.tripId,
        note: params.charter
          ? "Charter allocated — entire cab reserved for you"
          : `Auto-allocated — ${reservation.seatsLeft} seats left on that departure`,
      };
    }
  }

  if (params.selectedTripId) {
    await db.booking.update({
      where: { id: params.bookingId },
      data: { allocationNote: "Selected cab is no longer available — passenger must choose again" },
    });
    return { tripId: null, note: "Selected cab is no longer available — choose another cab" };
  }

  // No scheduled capacity — try to spin up an extra trip with a free driver.
  // Lock each candidate driver while checking the day manifest so concurrent
  // requests cannot assign one driver to two extra departures.
  const freeCandidates=await db.driver.findMany({
    where:{status:"active"},
    orderBy:{createdAt:"asc"},
    include:{application:{include:{documents:{where:{state:{not:"replaced"}}}}}}
  });
  const earliestExtraDeparture = Math.max(now.getTime() + 2 * 60 * 60 * 1000, dayStart.getTime() + 2 * 60 * 60 * 1000);
  const dep = new Date(Math.ceil(earliestExtraDeparture / (60 * 60 * 1000)) * 60 * 60 * 1000);
  if (dep < dayEnd) {
    for (const driver of freeCandidates) {
      if (!(isLocalDemoEnabled() || evaluateDriverApplication(driver.application, driver.status).eligible)) continue;
      if (!params.charter && params.seats > driver.capacity) continue;
      const extraTripId = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Driver" WHERE "id" = ${driver.id} FOR UPDATE`;
        const alreadyAssigned = await tx.trip.findFirst({
          where: {
            driverId: driver.id,
            departureAt: { gte: dayStart, lt: dayEnd },
            status: { in: ["scheduled", "locked", "departed"] },
          },
          select: { id: true },
        });
        if (alreadyAssigned) return null;
        const trip = await tx.trip.create({
          data: {
            routeId: params.routeId,
            driverId: driver.id,
            direction: params.direction,
            departureAt: dep,
            capacity: driver.capacity,
            bookedSeats: params.charter ? driver.capacity : params.seats,
            source: "auto",
          },
        });
        await tx.booking.update({
          where: { id: params.bookingId },
          data: {
            tripId: trip.id,
            allocationNote: `Auto-created extra departure with ${driver.name} (${driver.plate})${params.charter ? " — charter" : ""}`,
          },
        });
        return trip.id;
      });
      if (extraTripId) {
        return { tripId: extraTripId, note: `Extra departure created with ${driver.name}${params.charter ? " — charter" : ""}` };
      }
    }
  }

  await db.booking.update({
    where: { id: params.bookingId },
    data: { allocationNote: "No capacity — flagged for admin attention" },
  });
  return { tripId: null, note: "No capacity available — flagged for admin" };
}

/** Trips lock when the seat-fill threshold is reached or the refund cutoff
 *  hits — the lock boundary is what separates "early" from "late" refunds. */
async function lockTrips(): Promise<number> {
  const cfg = await getConfig();
  const now = new Date();
  const cutoff = new Date(now.getTime() + cfg.fullRefundCutoffMinutes * 60 * 1000);

  const toLock = await db.trip.findMany({
    where: {
      status: "scheduled",
      departureAt: { lte: cutoff },
    },
    include: { bookings: true },
  });

  let locked = 0;
  for (const t of toLock) {
    const fillPct = t.capacity > 0 ? Math.round((t.bookedSeats / t.capacity) * 100) : 0;
    if (fillPct >= cfg.seatFillThresholdPercent || t.departureAt <= cutoff) {
      await db.trip.update({
        where: { id: t.id },
        data: {
          status: "locked",
          lockedAt: now,
          lockReason: fillPct >= cfg.seatFillThresholdPercent ? "seat_threshold" : "cutoff",
        },
      });
      locked++;
    }
  }
  return locked;
}

/** Departures: the trip is on the road. Unchecked-in paid passengers are on
 *  collision course with the no-show tier at completion. */
async function departTrips(): Promise<number> {
  const now = new Date();
  const toDepart = await db.trip.findMany({
    where: { status: "locked", departureAt: { lte: now } },
    include: { bookings: { include: { ledgerEntry: true } } },
  });
  let departed = 0;
  for (const t of toDepart) {
    await db.trip.update({
      where: { id: t.id },
      data: { status: "departed", departedAt: now },
    });
    departed++;
  }
  return departed;
}

/** Completions: service delivered → payout records are born. */
async function completeTrips(): Promise<number> {
  const now = new Date();
  const routes = await db.route.findMany();
  const durations = new Map(routes.map((r) => [r.id, r.durationMinutes]));
  const toComplete = await db.trip.findMany({
    where: { status: "departed" },
    include: { bookings: { include: { ledgerEntry: true } } },
  });
  let completed = 0;
  for (const t of toComplete) {
    const dur = durations.get(t.routeId) || 75;
    if (t.departedAt && t.departedAt.getTime() + dur * 60 * 1000 <= now.getTime()) {
      // Confirmed-but-never-checked-in passengers forfeit (no-show)
      for (const b of t.bookings) {
        if (b.status === "confirmed" && !b.checkedInAt && b.ledgerEntry) {
          const { executeCancellation } = await import("@/lib/money");
          await executeCancellation({
            bookingId: b.id,
            actor: { id: "system", name: "Ops Engine", role: "system" },
            trigger: "no_show_resolution",
          });
        }
      }
      await onTripCompleted(t.id);
      completed++;
    }
  }
  return completed;
}

/** The master tick — safe to call on every relevant request. */
export async function runOperationalTick(): Promise<{
  tripsCreated: number;
  locked: number;
  departed: number;
  completed: number;
}> {
  const tripsCreated = await ensureTrips();
  const locked = await lockTrips();
  // Elapsed time is not evidence that a driver departed or delivered a ride.
  // Live transitions require the future authorized driver command API.
  const departed = isLocalDemoEnabled() ? await departTrips() : 0;
  const completed = isLocalDemoEnabled() ? await completeTrips() : 0;
  return { tripsCreated, locked, departed, completed };
}

/** Full operational sweep — everything the nightly jobs do, on demand. */
export async function runFullSweep(actor: { id: string; name: string; role: "passenger" | "admin" | "system" }) {
  const tick = await runOperationalTick();
  const recon = await runReconciliationSweep(actor);
  const batchDue = await isPayoutBatchDue();
  let batch: { drivers: number; completed: number; failed: number } | null = null;
  if (batchDue.due) {
    batch = await runPayoutBatch(actor);
  }
  return { tick, recon, batchDue, batch };
}

