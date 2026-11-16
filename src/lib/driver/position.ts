import { db } from "@/lib/db";
import { DriverError, text } from "./errors";

/** Phases in which the driver app may stream GPS: accepted → pickup → on the road. */
const BROADCAST_PHASES = new Set(["accepted", "at_pickup", "in_progress"]);
const MIN_WRITE_INTERVAL_MS = 3_000;

function coordinate(value: unknown, name: "lat" | "lng"): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DriverError(400, "INVALID_POSITION", "The reported position is invalid.");
  }
  if (name === "lat" && (value < -90 || value > 90)) {
    throw new DriverError(400, "INVALID_POSITION", "The reported latitude is out of range.");
  }
  if (name === "lng" && (value < -180 || value > 180)) {
    throw new DriverError(400, "INVALID_POSITION", "The reported longitude is out of range.");
  }
  return value;
}

function optionalMeasurement(value: unknown, name: string, max: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new DriverError(400, "INVALID_POSITION", `The reported ${name} is invalid.`);
  }
  return value;
}

function recordedAt(value: unknown): Date {
  if (typeof value !== "string") {
    throw new DriverError(400, "INVALID_POSITION", "The reported time is invalid.");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 5 * 60_000) {
    throw new DriverError(400, "INVALID_POSITION", "The reported time is invalid.");
  }
  return date;
}

/**
 * Store the newest GPS fix for an active trip so passengers can watch their
 * cab approach. Client contract: POST /api/v1/driver/position with the trip
 * the fix belongs to; only the assigned driver may write, and the passenger
 * map only ever reads fixes a few minutes old, so out-of-order or duplicate
 * writes are accepted silently and ignored.
 */
export async function reportDriverPosition(driverId: string, body: Record<string, unknown>) {
  const tripId = text(body.tripId, "Trip", 1, 80);
  text(body.idempotencyKey, "Idempotency key", 1, 128);
  const lat = coordinate(body.lat, "lat");
  const lng = coordinate(body.lng, "lng");
  if (lat === 0 && lng === 0) {
    throw new DriverError(400, "INVALID_POSITION", "The reported position is invalid.");
  }
  const when = recordedAt(body.recordedAt);
  const accuracyM = optionalMeasurement(body.accuracyM, "accuracy", 1_000);
  const bearingDeg = optionalMeasurement(body.bearingDeg, "bearing", 360);
  const speedMps = optionalMeasurement(body.speedMps, "speed", 500);

  const trip = await db.trip.findFirst({
    where: { id: tripId, driverId },
    select: {
      id: true,
      status: true,
      driverProgress: { where: { driverId }, select: { phase: true } },
    },
  });
  if (!trip) {
    throw new DriverError(404, "ASSIGNMENT_NOT_FOUND", "This trip is not assigned to your account.");
  }

  const phase = trip.status === "departed" ? "in_progress" : (trip.driverProgress[0]?.phase ?? "assigned");
  if (!BROADCAST_PHASES.has(phase)) {
    throw new DriverError(409, "TRIP_NOT_ACTIVE", "This trip is not active yet.");
  }

  const existing = await db.driverPosition.findUnique({
    where: { tripId },
    select: { recordedAt: true },
  });
  if (existing) {
    const last = existing.recordedAt.getTime();
    // Out-of-order fixes never move the visible cab backwards, and the
    // contract serves at most one write per trip per three seconds.
    if (when.getTime() <= last || when.getTime() - last < MIN_WRITE_INTERVAL_MS) return { ok: true };
  }

  await db.driverPosition.upsert({
    where: { tripId },
    create: { tripId, driverId, lat, lng, accuracyM, bearingDeg, speedMps, recordedAt: when },
    update: { driverId, lat, lng, accuracyM, bearingDeg, speedMps, recordedAt: when },
  });
  return { ok: true };
}
