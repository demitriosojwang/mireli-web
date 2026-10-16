import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  driverFindMany: vi.fn(),
  tripFindMany: vi.fn(),
  runOperationalTick: vi.fn(),
  getConfig: vi.fn(),
  evaluateDriverApplication: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { driver: { findMany: mocks.driverFindMany }, trip: { findMany: mocks.tripFindMany } },
}));
vi.mock("@/lib/engine", () => ({
  CAB_LEAD_MINUTES: 120,
  runOperationalTick: mocks.runOperationalTick,
}));
vi.mock("@/lib/money", () => ({ getConfig: mocks.getConfig }));
vi.mock("@/lib/nairobi-time", () => ({
  nairobiDayRange: () => ({ start: new Date("2026-10-11T00:00:00.000Z"), end: new Date("2026-10-12T00:00:00.000Z") }),
}));
vi.mock("@/lib/driver/onboarding", () => ({ evaluateDriverApplication: mocks.evaluateDriverApplication }));
vi.mock("@/lib/runtime-mode", () => ({ isLocalDemoEnabled: () => false }));

import { GET } from "@/app/api/trips/route";
import { DriverError } from "@/lib/driver/errors";

const request = (query = "date=2026-10-11") =>
  new NextRequest(`https://mireli.test/api/trips?${query}`);

const eligibleDriver = {
  id: "driver-1",
  status: "active",
  application: { status: "approved", policyVersion: "v1", ownsVehicle: false, documents: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.driverFindMany.mockResolvedValue([]);
  mocks.tripFindMany.mockResolvedValue([]);
  mocks.runOperationalTick.mockResolvedValue({});
  mocks.getConfig.mockResolvedValue({ bookingFeeAmount: 50, terminusArrivalBufferMinutes: 60 });
  mocks.evaluateDriverApplication.mockReturnValue({ eligible: true, reasons: [] });
});

afterEach(() => vi.restoreAllMocks());

describe("customer trip availability", () => {
  it("returns a fast, honest empty result without running the scheduler when there are no drivers", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasEligibleDrivers: false, trips: [] });
    expect(mocks.runOperationalTick).not.toHaveBeenCalled();
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.tripFindMany).not.toHaveBeenCalled();
  });

  it("limits driver and trip reads to the fields and eligible supply the booking UI needs", async () => {
    mocks.driverFindMany.mockResolvedValue([eligibleDriver]);
    mocks.tripFindMany.mockResolvedValue([{
      id: "trip-1",
      routeId: "route-1",
      driverId: eligibleDriver.id,
      direction: "FROM_TERMINUS",
      departureAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "scheduled",
      capacity: 4,
      route: {
        id: "route-1",
        name: "Mombasa Terminus ↔ North Coast",
        durationMinutes: 90,
        charterPrice: 4000,
        stages: [
          { id: "stage-0", name: "Mombasa Terminus", order: 0, fare: 0, homeSurcharge: 0 },
          { id: "stage-1", name: "Mtwapa", order: 1, fare: 700, homeSurcharge: 200 },
        ],
      },
      driver: { name: "Approved Driver", plate: "KAA 123A", cabType: "Van", rating: 4.8 },
      train: { name: "Night Train", direction: "NBO_TO_MBA", originTime: "22:00", destTime: "03:55" },
      bookings: [{ seats: 1 }],
    }]);

    const response = await GET(request());
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.hasEligibleDrivers).toBe(true);
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0]).toMatchObject({ minFare: 700, seatsLeft: 3, platformFeeAmount: 50 });
    expect(result.trips[0]).not.toHaveProperty("stages");
    expect(result.trips[0]).not.toHaveProperty("points");
    expect(result.trips[0].driver).not.toHaveProperty("phone");
    expect(mocks.tripFindMany.mock.calls[0][0].where.driverId.in).toEqual([eligibleDriver.id]);
    expect(mocks.driverFindMany.mock.calls[0][0].select.application.select.documents.select)
      .toEqual({ type: true, state: true, scanState: true, expiresAt: true });
    expect(mocks.tripFindMany.mock.calls[0][0].select.route.select.stages.select)
      .toEqual({ order: true, fare: true, homeSurcharge: true });
  });

  it("hides active-driver trips that have no customer-bookable fare point", async () => {
    mocks.driverFindMany.mockResolvedValue([eligibleDriver]);
    mocks.tripFindMany.mockResolvedValue([{
      id: "trip-invalid-stage",
      routeId: "route-1",
      driverId: eligibleDriver.id,
      direction: "FROM_TERMINUS",
      departureAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "scheduled",
      capacity: 4,
      route: {
        id: "route-1",
        name: "Mombasa Terminus ↔ North Coast",
        durationMinutes: 90,
        charterPrice: 4000,
        stages: [
          { id: "stage-0", name: "Mombasa Terminus", order: 0, fare: 0, homeSurcharge: 0 },
          { id: "stage-1", name: "Unpriced stop", order: 1, fare: 0, homeSurcharge: 0 },
        ],
      },
      driver: { name: "Approved Driver", plate: "KAA 123A", cabType: "Van", rating: 4.8 },
      train: null,
      bookings: [],
    }]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasEligibleDrivers: true, trips: [] });
  });

  it("returns a clear setup response instead of an unhandled error when booking settings are absent", async () => {
    mocks.driverFindMany.mockResolvedValue([eligibleDriver]);
    mocks.getConfig.mockRejectedValue(new DriverError(503, "PLATFORM_NOT_CONFIGURED", "private setup detail"));

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Ride schedules are not set up yet.",
      code: "PLATFORM_NOT_CONFIGURED",
    });
  });

  it("rejects a missing date before querying the database", async () => {
    const response = await GET(request("direction=FROM_TERMINUS"));

    expect(response.status).toBe(400);
    expect(mocks.driverFindMany).not.toHaveBeenCalled();
  });
});
