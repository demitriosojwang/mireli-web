import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tripFindFirst: vi.fn(),
  positionFindUnique: vi.fn(),
  positionUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    trip: { findFirst: mocks.tripFindFirst },
    driverPosition: { findUnique: mocks.positionFindUnique, upsert: mocks.positionUpsert },
  },
}));

import { reportDriverPosition } from "@/lib/driver/position";
import { DriverError } from "@/lib/driver/errors";

const DRIVER = "driver-1";
const NOW = new Date(Date.now() - 5_000);

const body = (overrides: Record<string, unknown> = {}) => ({
  tripId: "trip-1",
  lat: -4.05,
  lng: 39.66,
  accuracyM: 12,
  bearingDeg: 90,
  speedMps: 8.5,
  recordedAt: NOW.toISOString(),
  idempotencyKey: "fix-1",
  ...overrides,
});

const tripWithPhase = (phase: string | null, status = "locked") => ({
  id: "trip-1",
  status,
  driverProgress: phase ? [{ phase }] : [],
});

beforeEach(() => {
  mocks.tripFindFirst.mockResolvedValue(tripWithPhase("accepted"));
  mocks.positionFindUnique.mockResolvedValue(null);
  mocks.positionUpsert.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("driver position reports", () => {
  it("stores the newest fix for an accepted trip", async () => {
    await expect(reportDriverPosition(DRIVER, body())).resolves.toEqual({ ok: true });

    expect(mocks.positionUpsert).toHaveBeenCalledTimes(1);
    const call = mocks.positionUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ tripId: "trip-1" });
    expect(call.create).toMatchObject({
      tripId: "trip-1",
      driverId: DRIVER,
      lat: -4.05,
      lng: 39.66,
      accuracyM: 12,
      bearingDeg: 90,
      speedMps: 8.5,
      recordedAt: NOW,
    });
  });

  it("accepts a departed trip even without stored progress", async () => {
    mocks.tripFindFirst.mockResolvedValue(tripWithPhase(null, "departed"));

    await expect(reportDriverPosition(DRIVER, body())).resolves.toEqual({ ok: true });
    expect(mocks.positionUpsert).toHaveBeenCalledTimes(1);
  });

  it("refuses a trip that is not assigned to the driver", async () => {
    mocks.tripFindFirst.mockResolvedValue(null);

    await expect(reportDriverPosition(DRIVER, body())).rejects.toMatchObject({
      status: 404,
      code: "ASSIGNMENT_NOT_FOUND",
    });
    expect(mocks.positionUpsert).not.toHaveBeenCalled();
  });

  it("refuses a trip that has not been accepted yet", async () => {
    mocks.tripFindFirst.mockResolvedValue(tripWithPhase("assigned"));

    await expect(reportDriverPosition(DRIVER, body())).rejects.toMatchObject({
      status: 409,
      code: "TRIP_NOT_ACTIVE",
    });
    expect(mocks.positionUpsert).not.toHaveBeenCalled();
  });

  it("drops an out-of-order fix without writing", async () => {
    mocks.positionFindUnique.mockResolvedValue({ recordedAt: new Date(NOW.getTime() + 60_000) });

    await expect(reportDriverPosition(DRIVER, body())).resolves.toEqual({ ok: true });
    expect(mocks.positionUpsert).not.toHaveBeenCalled();
  });

  it("keeps at most one write per trip per three seconds", async () => {
    mocks.positionFindUnique.mockResolvedValue({ recordedAt: new Date(NOW.getTime() - 2_000) });

    await expect(reportDriverPosition(DRIVER, body())).resolves.toEqual({ ok: true });
    expect(mocks.positionUpsert).not.toHaveBeenCalled();
  });

  it("rejects invalid coordinates", async () => {
    await expect(reportDriverPosition(DRIVER, body({ lat: 0, lng: 0 }))).rejects.toMatchObject({
      status: 400,
      code: "INVALID_POSITION",
    });
    await expect(reportDriverPosition(DRIVER, body({ lat: 91 }))).rejects.toBeInstanceOf(DriverError);
    await expect(reportDriverPosition(DRIVER, body({ lng: -181 }))).rejects.toBeInstanceOf(DriverError);
    await expect(reportDriverPosition(DRIVER, body({ lat: Number.NaN }))).rejects.toBeInstanceOf(DriverError);
    await expect(reportDriverPosition(DRIVER, body({ recordedAt: "not-a-date" }))).rejects.toMatchObject({
      status: 400,
      code: "INVALID_POSITION",
    });
  });
});
