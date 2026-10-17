import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getPassengerSession: vi.fn(),
  bookingFindUnique: vi.fn(),
  mpesaTransactionFindFirst: vi.fn(),
  mpesaTransactionFindUnique: vi.fn(),
  mpesaTransactionCreate: vi.fn(),
  mpesaTransactionUpdateMany: vi.fn(),
  dbTransaction: vi.fn(),
  transactionQuery: vi.fn(),
  stkPush: vi.fn(),
  resolveDaraja: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mocks.bookingFindUnique },
    mpesaTransaction: {
      findFirst: mocks.mpesaTransactionFindFirst,
      findUnique: mocks.mpesaTransactionFindUnique,
      create: mocks.mpesaTransactionCreate,
      updateMany: mocks.mpesaTransactionUpdateMany,
    },
    $transaction: mocks.dbTransaction,
  },
}));
vi.mock("@/lib/session", () => ({
  getPassengerSession: mocks.getPassengerSession,
  normalizePhone: () => "+254712345678",
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/money", () => ({
  confirmBookingPayment: vi.fn(),
  executeCancellation: vi.fn(),
  resolveRefundTier: vi.fn(),
}));
vi.mock("@/lib/daraja", () => ({
  stkPush: mocks.stkPush,
  resolveDaraja: mocks.resolveDaraja,
  PAYMENT_INTENT_PREFIX: "mireli-intent:",
  isPaymentIntentId: (value: string) => value.startsWith("mireli-intent:"),
  RESULT_CODES: { TIMEOUT: "1007" },
}));

import { POST } from "@/app/api/bookings/[id]/route";

const bookingWithAssignment = {
  id: "booking-1",
  passengerId: "passenger-1",
  code: "MR-ABC123",
  status: "awaiting_payment",
  cashDue: 500,
  trip: {
    driverId: "driver-1",
    status: "scheduled",
    departureAt: new Date(Date.now() + 60 * 60 * 1000),
    driver: { status: "active", name: "Approved Driver", plate: "KAA 123A", phone: "+254712345678" },
  },
};

const post = (body: unknown) => new NextRequest("https://mireli.test/api/bookings/booking-1", {
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

const callPost = (body: unknown) => POST(post(body), { params: Promise.resolve({ id: "booking-1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPassengerSession.mockResolvedValue({ id: "passenger-1", name: "Amina Wanjiru" });
  mocks.bookingFindUnique.mockResolvedValue(bookingWithAssignment);
  mocks.mpesaTransactionFindFirst.mockResolvedValue(null);
  mocks.mpesaTransactionFindUnique.mockResolvedValue(null);
  mocks.mpesaTransactionCreate.mockResolvedValue({ id: "tx-1", checkoutRequestId: "mireli-intent:pending" });
  mocks.mpesaTransactionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transactionQuery.mockResolvedValue([]);
  mocks.dbTransaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({
    $queryRaw: mocks.transactionQuery,
    mpesaTransaction: {
      findFirst: mocks.mpesaTransactionFindFirst,
      create: mocks.mpesaTransactionCreate,
    },
  }));
  mocks.stkPush.mockResolvedValue({ ok: true, checkoutRequestId: "checkout-1", merchantRequestId: "merchant-1" });
  mocks.resolveDaraja.mockResolvedValue({ mode: "live" });
});

afterEach(() => vi.restoreAllMocks());

describe("booking payment route assignment guard", () => {
  it("does not send an STK prompt or create a transaction for an unassigned booking", async () => {
    mocks.bookingFindUnique.mockResolvedValue({ ...bookingWithAssignment, trip: null });

    const response = await callPost({ action: "pay", phone: "0712345678" });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("No payment request was sent");
    expect(mocks.stkPush).not.toHaveBeenCalled();
    expect(mocks.mpesaTransactionFindFirst).not.toHaveBeenCalled();
    expect(mocks.mpesaTransactionCreate).not.toHaveBeenCalled();
  });

  it("does not simulate Paybill confirmation for an unassigned booking", async () => {
    mocks.bookingFindUnique.mockResolvedValue({ ...bookingWithAssignment, trip: null });

    const response = await callPost({ action: "verify" });

    expect(response.status).toBe(409);
    expect(mocks.mpesaTransactionFindFirst).not.toHaveBeenCalled();
  });

  it("still starts payment when an active driver and future trip are assigned", async () => {
    const response = await callPost({ action: "pay", phone: "0712345678" });

    expect(response.status).toBe(200);
    expect(mocks.stkPush).toHaveBeenCalledWith("+254712345678", 500, "MR-ABC123", "tx-1");
    expect(mocks.mpesaTransactionCreate).toHaveBeenCalledOnce();
    expect(mocks.mpesaTransactionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "tx-1", status: "pending" }),
      data: expect.objectContaining({ checkoutRequestId: "checkout-1", status: "stk_push_sent" }),
    }));
    expect(mocks.mpesaTransactionCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stkPush.mock.invocationCallOrder[0],
    );
  });

  it("persists a timed-out request as ambiguous and prevents a duplicate STK push", async () => {
    mocks.stkPush.mockResolvedValue({
      ok: false,
      checkoutRequestId: "",
      merchantRequestId: "",
      responseCode: "1007",
      responseDescription: "Could not reach Daraja",
    });

    const firstResponse = await callPost({ action: "pay", phone: "0712345678" });

    expect(firstResponse.status).toBe(200);
    expect((await firstResponse.json()).paymentPending).toBe(true);
    expect(mocks.mpesaTransactionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ambiguous" }),
    }));

    mocks.mpesaTransactionFindFirst.mockResolvedValue({
      id: "tx-1",
      checkoutRequestId: "mireli-intent:pending",
      amount: 500,
      phone: "+254712345678",
      status: "ambiguous",
    });
    const retryResponse = await callPost({ action: "pay", phone: "0712345678" });

    expect(retryResponse.status).toBe(200);
    expect((await retryResponse.json()).paymentPending).toBe(true);
    expect(mocks.stkPush).toHaveBeenCalledOnce();
  });

  it("tells the passenger not to pay again when Paybill reports an amount mismatch", async () => {
    mocks.mpesaTransactionFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ amount: 600, merchantRequestId: "c2b-20261016120000" });

    const response = await callPost({ action: "verify" });

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.paymentNeedsReview).toBe(true);
    expect(payload.error).toContain("received a Paybill payment of KSh 600");
    expect(payload.error).toContain("before paying again");
    expect(mocks.resolveDaraja).not.toHaveBeenCalled();
  });
});
