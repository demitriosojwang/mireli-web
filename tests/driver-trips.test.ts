import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applicationFindUnique: vi.fn(),
  tripFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    driverApplication: { findUnique: mocks.applicationFindUnique },
    trip: { findMany: mocks.tripFindMany },
  },
}));
vi.mock("@/lib/driver/eligibility", () => ({
  evaluateDriverApplication: () => ({ eligible: true }),
}));
vi.mock("@/lib/money", () => ({ settleCompletedTrip: vi.fn() }));

import { driverTrips } from "@/lib/driver/trips";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.applicationFindUnique.mockResolvedValue({ driver: { status: "active" }, documents: [] });
  mocks.tripFindMany.mockResolvedValue([{
    id: "trip-1",
    status: "scheduled",
    departureAt: new Date("2026-11-01T08:00:00Z"),
    capacity: 4,
    direction: "TO_TERMINUS",
    route: { name: "North Coast", stages: [] },
    driverProgress: [],
    bookings: [
      {
        id: "unpaid-booking",
        status: "awaiting_payment",
        isCharter: false,
        seats: 1,
        boardedSeats: 0,
        noShowSeats: 0,
        passenger: { name: "Unpaid Passenger" },
      },
      {
        id: "paid-booking",
        status: "confirmed",
        isCharter: false,
        seats: 1,
        boardedSeats: 0,
        noShowSeats: 0,
        passengerName: "Paid Passenger",
        passenger: { name: "Paid Passenger" },
      },
    ],
  }]);
});

afterEach(() => vi.restoreAllMocks());

describe("driver passenger manifest visibility", () => {
  it("shows only payment-confirmed bookings and queries those statuses explicitly", async () => {
    const result = await driverTrips("driver-1");

    expect(mocks.tripFindMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        bookings: expect.objectContaining({
          where: { status: { in: ["confirmed", "boarded", "completed", "no_show"] } },
        }),
      }),
    }));
    expect(result.trips[0].passengers.map((passenger) => passenger.id)).toEqual(["paid-booking"]);
    expect(JSON.stringify(result.trips)).not.toContain("Unpaid Passenger");
  });
});
