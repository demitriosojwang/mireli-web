import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  bookingFindMany: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdateMany: vi.fn(),
  activeBookingFindMany: vi.fn(),
  tripFindUnique: vi.fn(),
  tripUpdate: vi.fn(),
  creditCreate: vi.fn(),
  auditCreate: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    platformConfig: { findUnique: mocks.configFindUnique },
    booking: { findMany: mocks.bookingFindMany },
    $transaction: mocks.transaction,
  },
}));

import { expireUnpaidBookingReservations } from "@/lib/unpaid-booking-expiry";

const now = new Date("2026-10-18T12:00:00.000Z");
const oldBooking = {
  id: "booking-1",
  code: "MR-ABC123",
  passengerId: "passenger-1",
  tripId: "trip-1",
  createdAt: new Date(now.getTime() - 16 * 60_000),
  status: "awaiting_payment",
  creditApplied: 150,
  ledgerEntry: null,
  mpesaTransactions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configFindUnique.mockResolvedValue({ unpaidBookingHoldMinutes: 15, creditValidityDays: 30 });
  mocks.bookingFindMany.mockResolvedValue([{ id: "booking-1", tripId: "trip-1" }]);
  mocks.bookingFindUnique.mockResolvedValue(oldBooking);
  mocks.bookingUpdateMany.mockResolvedValue({ count: 1 });
  mocks.activeBookingFindMany.mockResolvedValue([{ seats: 2, isCharter: false }]);
  mocks.tripFindUnique.mockResolvedValue({ capacity: 4 });
  mocks.tripUpdate.mockResolvedValue({});
  mocks.creditCreate.mockResolvedValue({ id: "credit-1" });
  mocks.auditCreate.mockResolvedValue({});
  mocks.queryRaw.mockResolvedValue([]);
  const tx = {
    $queryRaw: mocks.queryRaw,
    booking: {
      findUnique: mocks.bookingFindUnique,
      updateMany: mocks.bookingUpdateMany,
      findMany: mocks.activeBookingFindMany,
    },
    trip: { findUnique: mocks.tripFindUnique, update: mocks.tripUpdate },
    credit: { create: mocks.creditCreate },
    auditLog: { create: mocks.auditCreate },
  };
  mocks.transaction.mockImplementation((callback: (client: unknown) => unknown) => callback(tx));
});

describe("unpaid booking reservation expiry", () => {
  it("cancels a safe abandoned draft, restores its credit, and recounts seats", async () => {
    const result = await expireUnpaidBookingReservations(now);

    expect(result).toEqual({ expired: 1, restoredCredit: 150 });
    expect(mocks.bookingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "awaiting_payment",
        createdAt: { lte: new Date(now.getTime() - 15 * 60_000) },
      }),
      take: 100,
    }));
    expect(mocks.bookingUpdateMany).toHaveBeenCalledWith({
      where: { id: "booking-1", status: "awaiting_payment" },
      data: { status: "cancelled", cancelledAt: now, cancelTier: "early" },
    });
    expect(mocks.creditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      passengerId: "passenger-1",
      sourceBookingId: "booking-1",
      amount: 150,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    }) });
    expect(mocks.tripUpdate).toHaveBeenCalledWith({ where: { id: "trip-1" }, data: { bookedSeats: 2 } });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "booking.expire_unpaid", entityId: "booking-1" }),
    }));
  });

  it.each([
    ["pending STK", [{ status: "pending", merchantRequestId: "intent-1" }]],
    ["ambiguous STK", [{ status: "ambiguous", merchantRequestId: "intent-1" }]],
    ["failed Paybill receipt", [{ status: "failed", merchantRequestId: "c2b-20261018120000" }]],
  ])("keeps an old booking with %s for payment review", async (_label, mpesaTransactions) => {
    mocks.bookingFindUnique.mockResolvedValue({ ...oldBooking, mpesaTransactions });

    const result = await expireUnpaidBookingReservations(now);

    expect(result).toEqual({ expired: 0, restoredCredit: 0 });
    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.creditCreate).not.toHaveBeenCalled();
    expect(mocks.tripUpdate).not.toHaveBeenCalled();
  });

  it("does not expire if the booking was paid or changed while the candidate query ran", async () => {
    mocks.bookingFindUnique.mockResolvedValue({ ...oldBooking, status: "confirmed" });

    await expect(expireUnpaidBookingReservations(now)).resolves.toEqual({ expired: 0, restoredCredit: 0 });
    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
  });

  it("does not expire when the configured hold has not elapsed", async () => {
    mocks.bookingFindMany.mockResolvedValue([]);

    await expect(expireUnpaidBookingReservations(now)).resolves.toEqual({ expired: 0, restoredCredit: 0 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
