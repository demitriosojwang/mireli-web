import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getPassengerSession: vi.fn(),
  routeFindUnique: vi.fn(),
  passengerFindUnique: vi.fn(),
  passengerUpdate: vi.fn(),
  bookingCount: vi.fn(),
  bookingCreate: vi.fn(),
  bookingDelete: vi.fn(),
  getConfig: vi.fn(),
  allocateBooking: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    route: { findUnique: mocks.routeFindUnique },
    passenger: {
      findUnique: mocks.passengerFindUnique,
      update: mocks.passengerUpdate,
    },
    booking: {
      count: mocks.bookingCount,
      create: mocks.bookingCreate,
      delete: mocks.bookingDelete,
    },
  },
}));
vi.mock("@/lib/session", () => ({ getPassengerSession: mocks.getPassengerSession }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/money", () => ({ getConfig: mocks.getConfig }));
vi.mock("@/lib/engine", () => ({ allocateBooking: mocks.allocateBooking }));
vi.mock("@/lib/daraja", () => ({
  generateBookingCode: () => "MR-ABC123",
  toMpesaMsISDN: () => "+254712345678",
}));
vi.mock("@/lib/nairobi-time", () => ({
  nairobiDate: (date: Date) => date,
  nairobiDayRange: () => ({
    start: new Date("2026-10-16T00:00:00.000Z"),
    end: new Date("2026-10-17T00:00:00.000Z"),
  }),
}));

import { POST } from "@/app/api/bookings/route";

const request = (body: unknown) => new NextRequest("https://mireli.test/api/bookings", {
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPassengerSession.mockResolvedValue({ id: "guest-1", name: "Amina Wanjiru" });
  mocks.getConfig.mockResolvedValue({ bookingFeeAmount: 50 });
  mocks.routeFindUnique.mockResolvedValue({
    id: "route-1",
    charterPrice: 4200,
    stages: [{ id: "stage-1", name: "Nyali", fare: 500, homeSurcharge: 150 }],
  });
  mocks.passengerFindUnique.mockResolvedValue({ id: "guest-1", phone: "guest-local-1" });
  mocks.bookingCount.mockResolvedValue(0);
  mocks.bookingCreate.mockResolvedValue({ id: "booking-1", code: "MR-ABC123" });
  mocks.bookingDelete.mockResolvedValue({ id: "booking-1" });
  mocks.allocateBooking.mockResolvedValue({ tripId: null, note: "No eligible drivers." });
});

afterEach(() => vi.restoreAllMocks());

describe("booking creation with no driver supply", () => {
  it("removes the unpaid draft and tells the passenger no payment was taken", async () => {
    const response = await POST(request({
      routeId: "route-1",
      stageId: "stage-1",
      direction: "FROM_TERMINUS",
      travelDate: "2026-10-16",
      passengerName: "Amina Wanjiru",
      passengerPhone: "0712345678",
      passengerEmail: "amina@example.com",
      passengerIdType: "id",
      passengerIdNumber: "12345678",
      passengerNationality: "Kenyan",
      passengerGender: "female",
      seats: 1,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("No payment was taken");
    expect(mocks.bookingCreate).toHaveBeenCalledOnce();
    expect(mocks.allocateBooking).toHaveBeenCalledOnce();
    expect(mocks.bookingDelete).toHaveBeenCalledWith({ where: { id: "booking-1" } });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("never creates a booking when the passenger has no session", async () => {
    mocks.getPassengerSession.mockResolvedValue(null);

    const response = await POST(request({}));

    expect(response.status).toBe(401);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.allocateBooking).not.toHaveBeenCalled();
  });
});
