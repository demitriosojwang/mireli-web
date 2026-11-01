import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initialBookingFindUnique: vi.fn(),
  transaction: vi.fn(),
  transactionBookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  tripFindUnique: vi.fn(),
  tripUpdate: vi.fn(),
  ledgerCreate: vi.fn(),
  queryRaw: vi.fn(),
  audit: vi.fn(),
  email: vi.fn(),
  events: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mocks.initialBookingFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/booking-ticket-email", () => ({ attemptBookingTicketEmail: mocks.email }));
vi.mock("@/lib/daraja", () => ({}));
vi.mock("@/lib/payout-settlement", () => ({ calculateSettlement: vi.fn() }));
vi.mock("@/lib/driver/errors", () => ({ DriverError: class DriverError extends Error {} }));
vi.mock("@/lib/runtime-mode", () => ({ isLocalDemoEnabled: () => false }));
vi.mock("@/lib/refund-settlement", () => ({ submitRefund: vi.fn() }));

import { confirmBookingPayment } from "@/lib/money";

const unpaidBooking = {
  id: "booking-1",
  code: "MR-ABC123",
  passengerId: "passenger-1",
  status: "awaiting_payment",
  tripId: null,
  reservationTripId: "trip-1",
  fareAmount: 450,
  cashDue: 450,
  creditApplied: 0,
  homeSurcharge: 0,
  platformFeeAmount: 50,
  ledgerEntry: null,
};

const ledgerEntry = { id: "ledger-1", bookingId: "booking-1", tripId: "trip-1", status: "held" };

function configureTransaction({ activeDriver = true } = {}) {
  const tx = {
    $queryRaw: mocks.queryRaw,
    booking: {
      findUnique: mocks.transactionBookingFindUnique,
      update: mocks.bookingUpdate,
    },
    trip: { findUnique: mocks.tripFindUnique, update: mocks.tripUpdate },
    ledgerEntry: { create: mocks.ledgerCreate },
  };
  mocks.initialBookingFindUnique.mockResolvedValue({ reservationTripId: "trip-1", tripId: null });
  mocks.transactionBookingFindUnique.mockResolvedValue(unpaidBooking);
  mocks.tripFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) => {
    if ("driverId" in select) {
      return {
        id: "trip-1",
        status: "scheduled",
        departureAt: new Date(Date.now() + 2 * 60 * 60_000),
        driverId: activeDriver ? "driver-1" : null,
        driver: { status: activeDriver ? "active" : "suspended" },
      };
    }
    return { capacity: 4, bookings: [], reservedBookings: [] };
  });
  mocks.bookingUpdate.mockImplementation(async ({ data }) => ({
    ...unpaidBooking,
    ...data,
  }));
  mocks.ledgerCreate.mockResolvedValue(ledgerEntry);
  mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    mocks.events.push(strings.join("").includes('"Trip"') ? "lock-trip" : "lock-booking");
    return [];
  });
  mocks.transaction.mockImplementation(async (work: (client: unknown) => unknown) => work(tx));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  mocks.audit.mockResolvedValue(undefined);
  mocks.email.mockResolvedValue(undefined);
});

describe("assign passenger to driver after payment", () => {
  it("promotes a private seat hold and creates the ledger against the assigned trip", async () => {
    configureTransaction();

    await expect(confirmBookingPayment("booking-1", {
      receipt: "QWE123",
      checkoutRequestId: "checkout-1",
    })).resolves.toBe(true);

    expect(mocks.events).toEqual(["lock-trip", "lock-booking"]);
    expect(mocks.bookingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "booking-1" },
      data: { tripId: "trip-1", reservationTripId: null, status: "confirmed" },
    }));
    expect(mocks.ledgerCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      bookingId: "booking-1",
      tripId: "trip-1",
      mpesaReceipt: "QWE123",
    }) });
    expect(mocks.email).toHaveBeenCalledWith("booking-1");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "payment.confirm" }));
  });

  it("records a captured payment for review without confirming an inactive driver's hold", async () => {
    configureTransaction({ activeDriver: false });
    mocks.ledgerCreate.mockResolvedValue({ ...ledgerEntry, tripId: null });

    await expect(confirmBookingPayment("booking-1", {
      receipt: "QWE123",
      checkoutRequestId: "checkout-1",
    })).resolves.toBe(true);

    expect(mocks.bookingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tripId: null, reservationTripId: null }),
    }));
    expect(mocks.tripUpdate).toHaveBeenCalledWith({ where: { id: "trip-1" }, data: { bookedSeats: 0 } });
    expect(mocks.ledgerCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tripId: null }) });
    expect(mocks.email).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "payment.confirm_assignment_review",
      metadata: expect.objectContaining({ assignmentReviewRequired: true }),
    }));
  });
});
