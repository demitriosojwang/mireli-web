import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), findFirst: vi.fn(), findDriver: vi.fn(), findPassenger: vi.fn(),
  findUnique: vi.fn(), updateMany: vi.fn(), transaction: vi.fn(), count: vi.fn(),
  create: vi.fn(), query: vi.fn(), eligibleIds: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: mocks.transaction, $queryRaw: mocks.query,
  driver: { findUniqueOrThrow: mocks.findDriver, findFirst: mocks.findDriver },
  passenger: { findUnique: mocks.findPassenger },
  airportTransfer: {
    findMany: mocks.findMany, findFirst: mocks.findFirst, findUnique: mocks.findUnique,
    updateMany: mocks.updateMany, count: mocks.count, create: mocks.create,
  },
} }));
vi.mock("@/lib/driver/availability", () => ({ getEligibleDriverIds: mocks.eligibleIds }));
vi.mock("@/lib/driver/eligibility", () => ({ evaluateDriverApplication: () => ({ eligible: true }) }));

import { db } from "@/lib/db";
import {
  createAirportTransfer, driverAirportTransfers, passengerAirportTransfers, reportAirportTransferPosition, updateDriverAirportTransfer,
} from "@/lib/airport-transfers";

const now = new Date("2026-11-24T11:00:00Z");
const pickupAt = new Date("2026-11-24T11:10:00Z");
const addressPin = { lat: -4.04, lng: 39.71 };
const airportPin = { lat: -4.036, lng: 39.598 };
const ride = {
  id: "airport-ride", airport: "mba", direction: "to", address: "Public test landmark", pickupAt,
  status: "confirmed", addressLat: addressPin.lat, addressLng: addressPin.lng,
  airportLat: airportPin.lat, airportLng: airportPin.lng, pickupNote: "Meet at the gate", arrivedAt: null,
  driverLat: -4.033, driverLng: 39.68, driverSeenAt: new Date("2026-11-24T10:59:50Z"), etaSeconds: 180,
  driver: { name: "Test", phone: null, plate: "TEST" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.findDriver.mockResolvedValue({ id: "driver", rideService: "both", status: "active", capacity: 4 });
  mocks.findPassenger.mockResolvedValue({ phone: "+254712000000" });
  mocks.transaction.mockImplementation((transaction) => transaction(db));
  mocks.findUnique.mockResolvedValue(null);
  mocks.count.mockResolvedValue(0);
  mocks.eligibleIds.mockResolvedValue(["driver"]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.useRealTimers());

describe("airport trip guidance", () => {
  it("keeps the passenger's exact pins and screens out unrelated airport coordinates", async () => {
    const body = {
      airport: "mba", direction: "to", address: ride.address, addressPin, airportPin,
      pickupNote: ride.pickupNote, contactPhone: "+254712000000", requestKey: "guidance-request-01",
      date: "2026-11-24", time: "14:10", passengers: 2,
    };
    await expect(createAirportTransfer("passenger", { ...body, airportPin: addressPin })).rejects.toMatchObject({ code: "AIRPORT_PIN_OUTSIDE_AREA" });
    expect(mocks.create).not.toHaveBeenCalled();
    await createAirportTransfer("passenger", body);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      addressLat: addressPin.lat, addressLng: addressPin.lng, airportLat: airportPin.lat, airportLng: airportPin.lng, pickupNote: ride.pickupNote,
    });
  });

  it("returns correct legs only on assignments and keeps existing address-only transfers usable", async () => {
    mocks.findMany.mockResolvedValueOnce([ride, { ...ride, id: "legacy", direction: "from", addressLat: null, addressLng: null }]).mockResolvedValueOnce([]);
    const result = await driverAirportTransfers("driver");
    expect(result.assigned[0].navigation.pickup).toMatchObject(addressPin);
    expect(result.assigned[0].navigation.dropoff).toMatchObject(airportPin);
    expect(result.assigned[1].navigation.dropoff).toMatchObject({ lat: null, lng: null, name: ride.address });
    expect(mocks.findMany.mock.calls[1][0].select).not.toHaveProperty("addressLat");
    expect(mocks.findMany.mock.calls[1][0].select).not.toHaveProperty("pickupNote");
  });

  it("exposes a fresh driver position and remaining ETA only to the owner of the active transfer", async () => {
    mocks.findMany.mockResolvedValue([ride, { ...ride, status: "completed" }, { ...ride, driverSeenAt: new Date(0) }]);
    const rows = await passengerAirportTransfers("passenger");
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ passengerId: "passenger" });
    expect(rows[0].position).toMatchObject({ lat: ride.driverLat, lng: ride.driverLng, etaSeconds: 170 });
    expect(rows[1]).toMatchObject({ position: null, driver: null });
    expect(rows[2].position).toBeNull();
  });

  it("rejects other drivers and persists only fresh samples on the assigned leg", async () => {
    const sample = { ...addressPin, leg: "pickup", recordedAt: now.toISOString(), etaSeconds: 80 };
    mocks.findFirst.mockResolvedValueOnce(null);
    await expect(reportAirportTransferPosition("other", ride.id, sample)).rejects.toMatchObject({ code: "TRANSFER_CHANGED" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    mocks.findFirst.mockResolvedValue({ pickupAt });
    await reportAirportTransferPosition("driver", ride.id, sample);
    const write = mocks.updateMany.mock.calls[0][0];
    expect(write.where).toMatchObject({ id: ride.id, driverId: "driver", status: "confirmed" });
    expect(write.where.OR).toContainEqual({ driverSeenAt: { lte: new Date(now.getTime() - 3000) } });
    expect(write.data).toMatchObject({ driverLat: sample.lat, driverLng: sample.lng, etaSeconds: 80 });
    await expect(reportAirportTransferPosition("driver", ride.id, { ...sample, recordedAt: new Date(0).toISOString() })).rejects.toMatchObject({ code: "INVALID_POSITION" });
  });

  it("records arrival once and resets the pickup ETA when the driver starts the ride", async () => {
    mocks.findFirst.mockResolvedValueOnce(ride).mockResolvedValueOnce({ ...ride, arrivedAt: now });
    mocks.findMany.mockResolvedValue([]);
    await updateDriverAirportTransfer("driver", ride.id, "arrive");
    await updateDriverAirportTransfer("driver", ride.id, "start");
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ arrivedAt: now, etaSeconds: null });
    expect(mocks.updateMany.mock.calls[1][0].data).toMatchObject({ status: "in_progress", driverSeenAt: null, etaSeconds: null });
  });
});
