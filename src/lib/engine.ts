import { db } from "@/lib/db";
import {evaluateDriverApplication} from "@/lib/driver/onboarding";
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

  for (let dayOffset = 0; dayOffset <= cfg.tripHorizonDays; dayOffset++) {
    for (const train of trains) {
      if (train.direction === "MBA_TO_NBO") {
        // Departure event at MTM → every stage's cab pulls out exactly 2h
        // before the train leaves, regardless of route length.
        const trainDep = dayAt(now, dayOffset, train.originTime);
        const dep = new Date(trainDep.getTime() - CAB_LEAD_MINUTES * 60 * 1000);
        for (const route of routes) {
          if (dep.getTime() < now.getTime() - 30 * 60 * 1000) continue; // skip stale slots
          const exists = await db.trip.findFirst({
            where: { routeId: route.id, direction: "TO_TERMINUS", trainId: train.id, departureAt: dep },
          });
          if (exists) continue;
          const driver = drivers[rr % drivers.length];
          rr++;
          await db.trip.create({
            data: {
              routeId: route.id,
              driverId: driver.id,
              direction: "TO_TERMINUS",
              departureAt: dep,
              capacity: driver.capacity,
              source: "schedule",
              trainId: train.id,
            },
          });
          created++;
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
          let driver: (typeof drivers)[number] | null = null;
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
              driver = drivers.find((d) => d.id === outbound.driverId) || null;
            }
          }
          if (!driver) {
            driver = drivers[rr % drivers.length];
            rr++;
          }
          await db.trip.create({
            data: {
              routeId: route.id,
              driverId: driver.id,
              direction: "FROM_TERMINUS",
              departureAt: dep,
              capacity: driver.capacity,
              source: "schedule",
              trainId: train.id,
            },
          });
          created++;
        }
      }
    }
  }
  return created;
}

/** Auto-allocate a booking to the best trip: same route + direction, same
 *  calendar day, seats available, departs at least bookingWindowMinutes out,
 *  not yet departed. Falls back to creating an unscheduled trip with a free
 *  driver. Returns null when nothing is possible (admin sees it as an alert). */
export async function allocateBooking(params: {
  bookingId: string;
  routeId: string;
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
      routeId: params.routeId,
      direction: params.direction,
      departureAt: { gte: from, lt: dayEnd },
      status: { in: ["scheduled", "locked"] },
    },
    orderBy: { departureAt: "asc" },
    include: {
      bookings: { select: { seats: true } },
      driver: { include: { application: { include: { documents: { where: { state: { not: "replaced" } } } } } } },
    },
  });

  for (const t of candidates) {
    if (!t.driver || !(isLocalDemoEnabled() || evaluateDriverApplication(t.driver.application, t.driver.status).eligible)) continue;
    if (params.charter) {
      // Charter = the whole cab: only a completely empty trip qualifies
      if (t.bookedSeats === 0) {
        await db.trip.update({
          where: { id: t.id },
          data: { bookedSeats: t.capacity },
        });
        await db.booking.update({
          where: { id: params.bookingId },
          data: { tripId: t.id, allocationNote: `Charter — whole cab allocated (${t.direction === "FROM_TERMINUS" ? "from-terminus" : "to-terminus"})` },
        });
        return { tripId: t.id, note: "Charter allocated — entire cab reserved for you" };
      }
      continue;
    }
    if (t.bookedSeats + params.seats <= t.capacity) {
      await db.trip.update({
        where: { id: t.id },
        data: { bookedSeats: { increment: params.seats } },
      });
      await db.booking.update({
        where: { id: params.bookingId },
        data: { tripId: t.id, allocationNote: `Auto-allocated to ${t.direction === "FROM_TERMINUS" ? "from-terminus" : "to-terminus"} trip` },
      });
      return { tripId: t.id, note: `Auto-allocated — ${t.capacity - t.bookedSeats - params.seats} seats left on that departure` };
    }
  }

  // No scheduled capacity — try to spin up an extra trip with a free driver
  const busy = await db.trip.findMany({
    where: {
      departureAt: { gte: from, lt: dayEnd },
      status: { in: ["scheduled", "locked", "departed"] },
    },
    select: { driverId: true },
  });
  const busyIds = new Set(busy.map((b) => b.driverId));
  const freeCandidates=await db.driver.findMany({
    where:{status:"active",id:{notIn:[...busyIds].filter(Boolean) as string[]}},
    orderBy:{createdAt:"asc"},
    include:{application:{include:{documents:{where:{state:{not:"replaced"}}}}}}
  });
  const freeDriver=freeCandidates.find(d=>isLocalDemoEnabled() || evaluateDriverApplication(d.application,d.status).eligible);
  if (freeDriver && params.seats <= freeDriver.capacity) {
    // Depart 2 hours out on the travel day
    const dep = new Date(Math.max(now.getTime() + 2 * 60 * 60 * 1000, dayStart.getTime()));
    if (dep.getTime() < dayStart.getTime() + 2 * 60 * 60 * 1000) {
      dep.setTime(dayStart.getTime() + 2 * 60 * 60 * 1000);
    }
    dep.setMinutes(0, 0, 0);
    const t = await db.trip.create({
      data: {
        routeId: params.routeId,
        driverId: freeDriver.id,
        direction: params.direction,
        departureAt: dep,
        capacity: freeDriver.capacity,
        bookedSeats: params.charter ? freeDriver.capacity : params.seats,
        source: "auto",
      },
    });
    await db.booking.update({
      where: { id: params.bookingId },
      data: {
        tripId: t.id,
        allocationNote: `Auto-created extra departure with ${freeDriver.name} (${freeDriver.plate})${params.charter ? " — charter" : ""}`,
      },
    });
    return { tripId: t.id, note: `Extra departure created with ${freeDriver.name}${params.charter ? " — charter" : ""}` };
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

