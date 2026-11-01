import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  mpesaTransactionFindUnique: vi.fn(),
  mpesaTransactionCreate: vi.fn(),
  dbTransaction: vi.fn(),
  transactionQuery: vi.fn(),
  confirmBookingPayment: vi.fn(),
  audit: vi.fn(),
  resolveDaraja: vi.fn(),
  verifyCallbackToken: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mocks.bookingFindUnique },
    mpesaTransaction: {
      findUnique: mocks.mpesaTransactionFindUnique,
    },
    $transaction: mocks.dbTransaction,
  },
}));
vi.mock("@/lib/money", () => ({ confirmBookingPayment: mocks.confirmBookingPayment }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/daraja", () => ({
  resolveDaraja: mocks.resolveDaraja,
  verifyCallbackToken: mocks.verifyCallbackToken,
  RESULT_CODES: { SUCCESS: "0" },
  generateMpesaReceipt: vi.fn(() => "QWE1234567"),
}));

import { POST } from "@/app/api/pay/mpesa/c2b/route";

const booking = {
  id: "booking-1",
  code: "MR-ABC123",
  cashDue: 500,
  status: "awaiting_payment",
  ledgerEntry: null,
};

function request(amount: string, token = "test-token") {
  return new NextRequest(`https://mireli.test/api/pay/mpesa/c2b?mireli_token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      TransID: "TX-123",
      TransTime: "20261016120000",
      TransAmount: amount,
      BusinessShortCode: "123456",
      BillRefNumber: "MR-ABC123",
      MSISDN: "254712345678",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bookingFindUnique.mockResolvedValue(booking);
  mocks.mpesaTransactionFindUnique.mockResolvedValue(null);
  mocks.mpesaTransactionCreate.mockResolvedValue({});
  mocks.transactionQuery.mockResolvedValue([]);
  mocks.dbTransaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({
    $queryRaw: mocks.transactionQuery,
    booking: { findUnique: mocks.bookingFindUnique },
    mpesaTransaction: {
      findUnique: mocks.mpesaTransactionFindUnique,
      create: mocks.mpesaTransactionCreate,
    },
  }));
  mocks.confirmBookingPayment.mockResolvedValue(true);
  mocks.audit.mockResolvedValue(undefined);
  mocks.resolveDaraja.mockResolvedValue({ shortcode: "123456" });
  mocks.verifyCallbackToken.mockImplementation((scope: string, token: string | null) => scope === "c2b" && token === "test-token");
});

describe("C2B Paybill amount matching", () => {
  it("confirms and ledgers an exact payment", async () => {
    const response = await POST(request("500"));

    expect(response.status).toBe(200);
    expect(mocks.mpesaTransactionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 500, status: "confirmed" }),
    }));
    expect(mocks.confirmBookingPayment).toHaveBeenCalledWith("booking-1", expect.objectContaining({ receipt: "TX-123" }));
  });

  it("does not treat an overpayment as a confirmed booking", async () => {
    const response = await POST(request("600"));

    expect(response.status).toBe(200);
    expect(mocks.mpesaTransactionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 600, status: "failed", resultDesc: expect.stringContaining("exactly KSh 500") }),
    }));
    expect(mocks.confirmBookingPayment).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "payment.c2b_mismatch" }));
  });

  it("does not treat an underpayment as a confirmed booking", async () => {
    await POST(request("400"));

    expect(mocks.mpesaTransactionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 400, status: "failed" }),
    }));
    expect(mocks.confirmBookingPayment).not.toHaveBeenCalled();
  });

  it("keeps a successful receipt as a review exception if checkout expired before callback", async () => {
    mocks.bookingFindUnique
      .mockResolvedValueOnce({ id: booking.id })
      .mockResolvedValueOnce({ ...booking, status: "cancelled" });

    await POST(request("500"));

    expect(mocks.mpesaTransactionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        resultDesc: "C2B payment received but booking is cancelled",
      }),
    }));
    expect(mocks.confirmBookingPayment).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callbacks before booking or payment writes", async () => {
    const response = await POST(request("500", "forged-token"));

    expect(response.status).toBe(401);
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled();
    expect(mocks.mpesaTransactionCreate).not.toHaveBeenCalled();
    expect(mocks.confirmBookingPayment).not.toHaveBeenCalled();
  });
});
