import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getPassengerSession: vi.fn(),
  routeFindUnique: vi.fn(),
  passengerFindUnique: vi.fn(),
  passengerUpdate: vi.fn(),
  bookingCount: vi.fn(),
  bookingCreate: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  bookingDelete: vi.fn(),
  tripFindUnique: vi.fn(),
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
      findUnique: mocks.bookingFindUnique,
      update: mocks.bookingUpdate,
      delete: mocks.bookingDelete,
    },
    trip: { findUnique: mocks.tripFindUnique },
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

const validBookingBody = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPassengerSession.mockResolvedValue({ id: "guest-1", name: "Amina Wanjiru" });
  mocks.getConfig.mockResolvedValue({ bookingFeeAmount: 50, commissionRate: 0.1 });
  mocks.routeFindUnique.mockResolvedValue({
    id: "route-1",
    active: true,
    charterPrice: 4200,
    stages: [{ id: "stage-1", name: "Nyali", order: 1, fare: 500, homeSurcharge: 150 }],
  });
  mocks.passengerFindUnique.mockResolvedValue({ id: "guest-1", phone: "guest-local-1" });
  mocks.bookingCount.mockResolvedValue(0);
  mocks.bookingCreate.mockResolvedValue({ id: "booking-1", code: "MR-ABC123" });
  mocks.bookingFindUnique.mockResolvedValue(null);
  mocks.bookingUpdate.mockResolvedValue({ id: "booking-1" });
  mocks.bookingDelete.mockResolvedValue({ id: "booking-1" });
  mocks.tripFindUnique.mockResolvedValue({ capacity: 4 });
  mocks.allocateBooking.mockResolvedValue({ tripId: null, note: "No eligible drivers." });
});

afterEach(() => vi.restoreAllMocks());

describe("booking creation with no driver supply", () => {
  it("rejects malformed ride-option flags before loading booking configuration", async () => {
    const response = await POST(request(validBookingBody({ homePickup: "true" })));

    expect(response.status).toBe(400);
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.routeFindUnique).not.toHaveBeenCalled();
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("rejects an inactive route before creating a booking", async () => {
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1",
      active: false,
      stages: [{ id: "stage-1", name: "Nyali", order: 1, fare: 500, homeSurcharge: 150 }],
    });

    const response = await POST(request({
      routeId: "route-1",
      stageId: "stage-1",
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
    expect((await response.json()).error).toContain("not currently open");
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.allocateBooking).not.toHaveBeenCalled();
  });

  it("rejects a published stop with invalid fare data before creating a booking", async () => {
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1",
      active: true,
      stages: [{ id: "stage-1", name: "Nyali", order: 1, fare: 0, homeSurcharge: 150 }],
    });

    const response = await POST(request(validBookingBody()));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("fare is not configured");
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.allocateBooking).not.toHaveBeenCalled();
  });

  it("rejects the terminus row because it is not a customer-selectable stop", async () => {
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1",
      active: true,
      stages: [{ id: "terminus", name: "Mombasa Terminus", order: 0, fare: 0, homeSurcharge: 0 }],
    });

    const response = await POST(request({
      routeId: "route-1",
      stageId: "terminus",
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
    expect((await response.json()).error).toContain("published pickup or drop-off");
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.allocateBooking).not.toHaveBeenCalled();
  });

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

  it("prices a charter using the assigned vehicle capacity with the fee inside the total", async () => {
    mocks.passengerFindUnique.mockResolvedValue({ id: "passenger-1", phone: "+254712345678" });
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1",
      active: true,
      charterPrice: 4200,
      stages: [{ id: "stage-1", name: "Nyali", order: 1, fare: 400, homeSurcharge: 150 }],
    });
    mocks.allocateBooking.mockResolvedValue({ tripId: "trip-1", note: "Charter allocated" });
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      code: "MR-ABC123",
      status: "awaiting_payment",
      fareAmount: 2000,
      platformFeeAmount: 50,
      homeSurcharge: 0,
      creditApplied: 0,
      cashDue: 2000,
      stageName: "Nyali",
      seats: 1,
      isCharter: true,
      passengerName: "Amina Wanjiru",
      passengerPhone: "+254712345678",
      allocationNote: "Charter allocated",
      trip: { id: "trip-1", departureAt: new Date("2026-10-16T09:00:00.000Z"), status: "scheduled", route: { name: "Route 1" }, driver: null },
    });

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
      isCharter: true,
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.booking.fareAmount).toBe(2000);
    expect(payload.booking.platformFeeAmount).toBe(50);
    expect(payload.booking.cashDue).toBe(2000);
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { fareAmount: 2000, cashDue: 2000, homeSurcharge: 0, platformFeeAmount: 50 },
    });
    expect(mocks.tripFindUnique).toHaveBeenCalledWith({
      where: { id: "trip-1" },
      select: { capacity: true },
    });
  });

  it("labels door service according to the journey direction", async () => {
    await POST(request(validBookingBody({
      homePickup: true,
      homeAddress: "12 Green Street, Nyali",
    })));

    expect(mocks.bookingCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stageName: "Home drop-off · Nyali area" }),
    }));

    mocks.bookingCreate.mockClear();
    await POST(request(validBookingBody({
      direction: "TO_TERMINUS",
      homePickup: true,
      homeAddress: "12 Green Street, Nyali",
    })));

    expect(mocks.bookingCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stageName: "Home pickup · Nyali area" }),
    }));
  });

  it("never creates a booking when the passenger has no session", async () => {
    mocks.getPassengerSession.mockResolvedValue(null);

    const response = await POST(request({}));

    expect(response.status).toBe(401);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.allocateBooking).not.toHaveBeenCalled();
  });
});
