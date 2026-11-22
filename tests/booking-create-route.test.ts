import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getPassengerSession: vi.fn(),
  routeFindUnique: vi.fn(),
  passengerFindUnique: vi.fn(),
  passengerUpdate: vi.fn(),
  creditFindMany: vi.fn(),
  bookingCount: vi.fn(),
  bookingCreate: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  bookingDelete: vi.fn(),
  tripFindUnique: vi.fn(),
  getConfig: vi.fn(),
  applyCredits: vi.fn(),
  releaseUnpaidBookingReservation: vi.fn(),
  getPublicPayOptions: vi.fn(),
  allocateBooking: vi.fn(),
  audit: vi.fn(),
  expireUnpaidBookingReservations: vi.fn(),
  isOffstageQuoteRouteEnabled: vi.fn(),
  quoteOffstageAddress: vi.fn(),
  driverRateLimitUpsert: vi.fn(),
  driverRateLimitDeleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    route: { findUnique: mocks.routeFindUnique },
    passenger: {
      findUnique: mocks.passengerFindUnique,
      update: mocks.passengerUpdate,
    },
    credit: { findMany: mocks.creditFindMany },
    booking: {
      count: mocks.bookingCount,
      create: mocks.bookingCreate,
      findUnique: mocks.bookingFindUnique,
      update: mocks.bookingUpdate,
      delete: mocks.bookingDelete,
    },
    trip: { findUnique: mocks.tripFindUnique },
    driverRateLimit: {
      upsert: mocks.driverRateLimitUpsert,
      deleteMany: mocks.driverRateLimitDeleteMany,
    },
  },
}));
vi.mock("@/lib/session", () => ({ getPassengerSession: mocks.getPassengerSession }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/money", () => ({ getConfig: mocks.getConfig, applyCredits: mocks.applyCredits }));
vi.mock("@/lib/engine", () => ({
  allocateBooking: mocks.allocateBooking,
  releaseUnpaidBookingReservation: mocks.releaseUnpaidBookingReservation,
}));
vi.mock("@/lib/daraja", () => ({
  generateBookingCode: () => "MR-ABC123",
  getPublicPayOptions: mocks.getPublicPayOptions,
  toMpesaMsISDN: () => "+254712345678",
}));
vi.mock("@/lib/unpaid-booking-expiry", () => ({
  expireUnpaidBookingReservations: mocks.expireUnpaidBookingReservations,
}));
vi.mock("@/lib/offstage-quote", () => {
  class OffstageQuoteError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return {
    isOffstageQuoteRouteEnabled: mocks.isOffstageQuoteRouteEnabled,
    quoteOffstageAddress: mocks.quoteOffstageAddress,
    OffstageQuoteError,
  };
});
vi.mock("@/lib/nairobi-time", () => ({
  nairobiDate: (date: Date) => date,
  nairobiDayRange: () => ({
    start: new Date("2026-10-16T00:00:00.000Z"),
    end: new Date("2026-10-17T00:00:00.000Z"),
  }),
}));

import { POST } from "@/app/api/bookings/route";
import { decryptPassengerIdNumber, isEncryptedPassengerIdNumber } from "@/lib/passenger-pii";

const request = (body: unknown) => new NextRequest("https://mireli.test/api/bookings", {
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

const validBookingBody = (overrides: Record<string, unknown> = {}) => ({
  routeId: "route-1",
  tripId: "trip-1",
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
  mocks.expireUnpaidBookingReservations.mockResolvedValue({ expired: 0, restoredCredit: 0 });
  mocks.applyCredits.mockResolvedValue(0);
  mocks.releaseUnpaidBookingReservation.mockResolvedValue(true);
  mocks.routeFindUnique.mockResolvedValue({
    id: "route-1",
    active: true,
    charterPrice: 4200,
    stages: [{ id: "stage-1", name: "Nyali", order: 1, fare: 500, homeSurcharge: 150 }],
  });
  mocks.passengerFindUnique.mockResolvedValue({ id: "guest-1", phone: "guest-local-1" });
  mocks.creditFindMany.mockResolvedValue([]);
  mocks.getPublicPayOptions.mockResolvedValue({ paybill: null, methods: ["mpesa_stk"] });
  mocks.bookingCount.mockResolvedValue(0);
  mocks.bookingCreate.mockResolvedValue({ id: "booking-1", code: "MR-ABC123" });
  mocks.bookingFindUnique.mockResolvedValue(null);
  mocks.bookingUpdate.mockResolvedValue({ id: "booking-1" });
  mocks.bookingDelete.mockResolvedValue({ id: "booking-1" });
  mocks.tripFindUnique.mockResolvedValue({ capacity: 4, routeId: "route-1", direction: "FROM_TERMINUS" });
  mocks.allocateBooking.mockResolvedValue({ tripId: null, note: "No eligible drivers." });
  mocks.isOffstageQuoteRouteEnabled.mockReturnValue(false);
  mocks.quoteOffstageAddress.mockResolvedValue({
    nearestStage: { id: "stage-nearest", name: "Nyali Centre", order: 1, fare: 400, homeSurcharge: 0, lat: -4.02, lng: 39.71 },
    distanceMeters: 6000,
  });
  mocks.driverRateLimitUpsert.mockResolvedValue({ count: 1 });
  mocks.driverRateLimitDeleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("booking creation with no driver supply", () => {
  it("rejects malformed ride-option flags before loading booking configuration", async () => {
    const response = await POST(request(validBookingBody({ homePickup: "true" })));

    expect(response.status).toBe(400);
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.routeFindUnique).not.toHaveBeenCalled();
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("requires the exact cab selected by the passenger", async () => {
    const response = await POST(request(validBookingBody({ tripId: null })));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("available cab");
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("rejects more than six pooled seats instead of silently changing the booking", async () => {
    const response = await POST(request(validBookingBody({ seats: 7 })));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("1 and 6 seats");
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("creates the held booking when M-Pesa is unavailable instead of refusing before allocation", async () => {
    mocks.getPublicPayOptions.mockRejectedValue(new Error("private credential detail"));

    const response = await POST(request(validBookingBody()));

    // The fixture has no assignable driver, so the held draft is released by
    // the allocation gate — but the booking is attempted end to end and
    // payment availability is never consulted.
    expect(response.status).toBe(409);
    expect(mocks.bookingCreate).toHaveBeenCalledOnce();
    expect(mocks.allocateBooking).toHaveBeenCalledOnce();
    expect(mocks.bookingDelete).toHaveBeenCalledWith({ where: { id: "booking-1" } });
    expect(mocks.getPublicPayOptions).not.toHaveBeenCalled();
  });

  it("fails closed before writing identity data when production encryption is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");
    vi.stubEnv("PASSENGER_PII_ENCRYPTION_KEY", "");

    const response = await POST(request(validBookingBody()));

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("PASSENGER_ID_PROTECTION_UNAVAILABLE");
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.passengerUpdate).not.toHaveBeenCalled();
  });

  it("allows a pooled booking fully covered by available credit without M-Pesa", async () => {
    mocks.creditFindMany.mockResolvedValue([{ amount: 550 }]);
    mocks.getPublicPayOptions.mockRejectedValue(new Error("M-Pesa unavailable"));

    const response = await POST(request(validBookingBody({ applyCredit: true })));

    // No eligible cab is configured in this test; the request reaches the
    // allocation gate rather than being rejected for unavailable M-Pesa.
    expect(response.status).toBe(409);
    expect(mocks.bookingCreate).toHaveBeenCalledOnce();
    expect(mocks.allocateBooking).toHaveBeenCalledOnce();
    expect(mocks.getPublicPayOptions).not.toHaveBeenCalled();
  });

  it("keeps the held booking with the residual cash due when a concurrent checkout spent credit", async () => {
    mocks.creditFindMany.mockResolvedValue([{ amount: 550 }]);
    mocks.allocateBooking.mockResolvedValue({ tripId: "trip-1", note: "Allocated" });
    mocks.applyCredits.mockResolvedValue(0); // strict redemption sees the smaller, locked balance
    mocks.getPublicPayOptions.mockRejectedValue(new Error("M-Pesa unavailable"));
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      code: "MR-ABC123",
      status: "awaiting_payment",
      fareAmount: 550,
      platformFeeAmount: 50,
      homeSurcharge: 0,
      creditApplied: 0,
      cashDue: 550,
      stageName: "Nyali",
      seats: 1,
      isCharter: false,
      passengerName: "Amina Wanjiru",
      passengerPhone: "+254712345678",
      allocationNote: "Allocated",
      trip: null,
      reservationTrip: {
        id: "trip-1",
        departureAt: new Date("2026-10-16T09:00:00.000Z"),
        status: "scheduled",
        route: { name: "Route 1" },
        driver: { name: "Hidden Driver", plate: "KAA 123A", phone: "+254712345678" },
      },
      ledgerEntry: null,
    });

    const response = await POST(request(validBookingBody({ applyCredit: true })));

    expect(response.status).toBe(200);
    expect(mocks.applyCredits).toHaveBeenCalledWith("guest-1", "booking-1", 550, { requireFull: true });
    expect(mocks.applyCredits).toHaveBeenCalledWith("guest-1", "booking-1", 550);
    expect(mocks.releaseUnpaidBookingReservation).not.toHaveBeenCalled();
    expect(mocks.bookingDelete).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("rejects an inactive route before creating a booking", async () => {
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1",
      active: false,
      stages: [{ id: "stage-1", name: "Nyali", order: 1, fare: 500, homeSurcharge: 150 }],
    });

    const response = await POST(request({
      routeId: "route-1",
      tripId: "trip-1",
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

  it("requires address-quote consent before any external location lookup", async () => {
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1",
      active: true,
      // Legacy fixed surcharges must not be mistaken for a distance quote.
      stages: [{ id: "stage-1", name: "Nyali", order: 1, fare: 500, homeSurcharge: 150 }],
    });

    const response = await POST(request(validBookingBody({
      homePickup: true,
      homeAddress: "12 Green Street, Nyali",
    })));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Agree to the one-time location quote");
    expect(mocks.quoteOffstageAddress).not.toHaveBeenCalled();
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.allocateBooking).not.toHaveBeenCalled();
  });

  it("keeps off-stage quotes disabled until the route is allowlisted", async () => {
    const response = await POST(request(validBookingBody({
      homePickup: true,
      homeAddress: "12 Green Street, Nyali",
      locationQuoteConsent: true,
    })));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("not enabled for this route yet");
    expect(mocks.quoteOffstageAddress).not.toHaveBeenCalled();
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("rate-limits external off-stage quote calls before sending an address to AWS", async () => {
    mocks.isOffstageQuoteRouteEnabled.mockReturnValue(true);
    mocks.driverRateLimitUpsert.mockResolvedValue({ count: 4 });

    const response = await POST(request(validBookingBody({
      homePickup: true,
      homeAddress: "12 Green Street, Nyali",
      locationQuoteConsent: true,
    })));

    expect(response.status).toBe(429);
    expect(mocks.quoteOffstageAddress).not.toHaveBeenCalled();
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("checks M-Pesa before paid off-stage location lookups when no credit is requested", async () => {
    mocks.isOffstageQuoteRouteEnabled.mockReturnValue(true);
    mocks.getPublicPayOptions.mockRejectedValue(new Error("private payment configuration"));

    const response = await POST(request(validBookingBody({
      homePickup: true,
      homeAddress: "12 Green Street, Nyali",
      locationQuoteConsent: true,
    })));

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("PAYMENT_OPTIONS_UNAVAILABLE");
    expect(mocks.quoteOffstageAddress).not.toHaveBeenCalled();
    expect(mocks.driverRateLimitUpsert).not.toHaveBeenCalled();
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("uses the nearest stage and passes the full distance surcharge to the driver", async () => {
    mocks.isOffstageQuoteRouteEnabled.mockReturnValue(true);
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1",
      active: true,
      stages: [
        { id: "stage-selected", name: "Mtwapa", order: 1, fare: 400, homeSurcharge: 0 },
        { id: "stage-nearest", name: "Nyali Centre", order: 2, fare: 400, homeSurcharge: 0, lat: -4.02, lng: 39.71 },
      ],
    });

    const response = await POST(request(validBookingBody({
      stageId: "stage-selected",
      homePickup: true,
      homeAddress: "12 Green Street, Nyali",
      locationQuoteConsent: true,
    })));

    expect(response.status).toBe(409); // No driver is assigned in this test fixture.
    expect((await response.json()).error).toContain("no longer available");
    expect(mocks.isOffstageQuoteRouteEnabled).toHaveBeenCalledWith("route-1");
    expect(mocks.quoteOffstageAddress).toHaveBeenCalledWith(
      "route-1",
      "12 Green Street, Nyali",
      expect.any(Array),
      "FROM_TERMINUS",
    );
    expect(mocks.bookingCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        stageId: "stage-nearest",
        stageName: "Home drop-off · Nyali Centre area",
        fareAmount: 600,
        platformFeeAmount: 50,
        homeSurcharge: 150,
        seats: 1,
      }),
    }));
  });

  it("rejects the terminus row because it is not a customer-selectable stop", async () => {
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1",
      active: true,
      stages: [{ id: "terminus", name: "Mombasa Terminus", order: 0, fare: 0, homeSurcharge: 0 }],
    });

    const response = await POST(request({
      routeId: "route-1",
      tripId: "trip-1",
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
      tripId: "trip-1",
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
    expect(mocks.allocateBooking).toHaveBeenCalledWith(expect.objectContaining({ selectedTripId: "trip-1" }));
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
      fareAmount: 2320,
      vatAmount: 320,
      platformFeeAmount: 50,
      homeSurcharge: 0,
      creditApplied: 0,
      cashDue: 2320,
      stageName: "Nyali",
      seats: 1,
      isCharter: true,
      passengerName: "Amina Wanjiru",
      passengerPhone: "+254712345678",
      allocationNote: "Charter allocated",
      trip: { id: "trip-1", departureAt: new Date("2026-10-16T09:00:00.000Z"), status: "scheduled", route: { name: "Route 1" }, driver: { name: "Hidden Driver", plate: "KAA 123A", phone: "+254712345678" } },
    });

    const response = await POST(request({
      routeId: "route-1",
      tripId: "trip-1",
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
    // Charter fare 2000 + 16% VAT (320) charged on top to the client.
    expect(payload.booking.fareAmount).toBe(2320);
    expect(payload.booking.vatAmount).toBe(320);
    expect(payload.booking.baseFareAmount).toBe(2000);
    expect(payload.booking.platformFeeAmount).toBe(50);
    expect(payload.booking.cashDue).toBe(2320);
    expect(payload.booking.trip.driver).toBeNull();
    expect(mocks.bookingCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        fareAmount: 2320,
        vatAmount: 320,
        cashDue: 2320,
        passengerIdNumber: expect.stringMatching(/^mireli-pii:v1:/),
      }),
    }));
    const storedId = mocks.bookingCreate.mock.calls[0][0].data.passengerIdNumber;
    expect(isEncryptedPassengerIdNumber(storedId)).toBe(true);
    expect(decryptPassengerIdNumber(storedId)).toBe("12345678");
    expect(mocks.tripFindUnique).toHaveBeenCalledWith({
      where: { id: "trip-1" },
      select: { capacity: true, routeId: true, direction: true },
    });
    expect(mocks.tripFindUnique.mock.invocationCallOrder[0]).toBeLessThan(mocks.bookingCreate.mock.invocationCallOrder[0]);
    expect(mocks.bookingCreate.mock.invocationCallOrder[0]).toBeLessThan(mocks.allocateBooking.mock.invocationCallOrder[0]);
  });

  it("applies the approved stage fare and KSh 50 fee per shared seat for a large cab", async () => {
    mocks.passengerFindUnique.mockResolvedValue({ id: "passenger-1", phone: "+254712345678" });
    mocks.tripFindUnique.mockResolvedValue({ capacity: 10, routeId: "route-1", direction: "FROM_TERMINUS" });
    mocks.routeFindUnique.mockResolvedValue({
      id: "route-1",
      active: true,
      charterPrice: 4200,
      stages: [{ id: "stage-1", name: "Mtwapa", order: 1, fare: 900, homeSurcharge: 150 }],
    });

    const response = await POST(request(validBookingBody({ seats: 2 })));

    expect(response.status).toBe(409); // The fixture has no assignable driver.
    expect(mocks.bookingCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        fareAmount: 900, // approved KSh 400 × 2 + KSh 50 × 2
        platformFeeAmount: 100,
        homeSurcharge: 0,
        seats: 2,
      }),
    }));
  });

  it("creates the held charter booking when M-Pesa is unavailable", async () => {
    mocks.passengerFindUnique.mockResolvedValue({ id: "passenger-1", phone: "+254712345678" });
    mocks.getPublicPayOptions.mockRejectedValue(new Error("private payment configuration"));

    const response = await POST(request(validBookingBody({ isCharter: true })));

    // The fixture has no assignable driver, so the held draft is released by
    // the allocation gate after creation is attempted.
    expect(response.status).toBe(409);
    expect(mocks.tripFindUnique).toHaveBeenCalledOnce();
    expect(mocks.bookingCreate).toHaveBeenCalledOnce();
    expect(mocks.allocateBooking).toHaveBeenCalledOnce();
    expect(mocks.bookingDelete).toHaveBeenCalledWith({ where: { id: "booking-1" } });
    expect(mocks.getPublicPayOptions).not.toHaveBeenCalled();
  });

  it("allows private charter addresses without a distance surcharge", async () => {
    mocks.passengerFindUnique.mockResolvedValue({ id: "passenger-1", phone: "+254712345678" });
    await POST(request(validBookingBody({
      isCharter: true,
      homePickup: true,
      homeAddress: "12 Green Street, Nyali",
    })));

    expect(mocks.bookingCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stageName: "Home drop-off · Nyali area", homeSurcharge: 0 }),
    }));

    mocks.bookingCreate.mockClear();
    mocks.tripFindUnique.mockResolvedValue({ capacity: 4, routeId: "route-1", direction: "TO_TERMINUS" });
    await POST(request(validBookingBody({
      direction: "TO_TERMINUS",
      isCharter: true,
      homePickup: true,
      homeAddress: "12 Green Street, Nyali",
    })));

    expect(mocks.bookingCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stageName: "Home pickup · Nyali area", homeSurcharge: 0 }),
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
