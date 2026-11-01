import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  mpesaTransactionFindUnique: vi.fn(),
  mpesaTransactionUpdateMany: vi.fn(),
  mpesaTransactionUpdate: vi.fn(),
  confirmBookingPayment: vi.fn(),
  audit: vi.fn(),
  verifyCallbackToken: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    mpesaTransaction: {
      findUnique: mocks.mpesaTransactionFindUnique,
      updateMany: mocks.mpesaTransactionUpdateMany,
      update: mocks.mpesaTransactionUpdate,
    },
  },
}));
vi.mock("@/lib/money", () => ({ confirmBookingPayment: mocks.confirmBookingPayment }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/daraja", () => ({
  isPaymentIntentId: (value: string) => value.startsWith("mireli-intent:"),
  RESULT_CODES: { SUCCESS: "0" },
  verifyCallbackToken: mocks.verifyCallbackToken,
}));

import { POST } from "@/app/api/pay/mpesa/callback/route";

const callbackRequest = () => new NextRequest(
  "https://mireli.test/api/pay/mpesa/callback?mireli_token=valid-token&intent=tx-1",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      Body: {
        stkCallback: {
          MerchantRequestID: "merchant-1",
          CheckoutRequestID: "ws_CO_123",
          ResultCode: 0,
          CallbackMetadata: { Item: [{ Name: "MpesaReceiptNumber", Value: "QWE1234567" }] },
        },
      },
    }),
  },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyCallbackToken.mockReturnValue(true);
  mocks.mpesaTransactionFindUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: "tx-1", checkoutRequestId: "mireli-intent:random", status: "pending", bookingId: "booking-1", merchantRequestId: "intent-token" })
    .mockResolvedValueOnce({ id: "tx-1", checkoutRequestId: "ws_CO_123", status: "pending", bookingId: "booking-1", merchantRequestId: "merchant-1", amount: 500 });
  mocks.mpesaTransactionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.mpesaTransactionUpdate.mockResolvedValue({});
  mocks.confirmBookingPayment.mockResolvedValue(true);
  mocks.audit.mockResolvedValue(undefined);
});

describe("STK callback correlation", () => {
  it("correlates to the pre-saved payment intent and confirms the provider result", async () => {
    const response = await POST(callbackRequest());

    expect(response.status).toBe(200);
    expect(mocks.verifyCallbackToken).toHaveBeenCalledWith("stk", "valid-token");
    expect(mocks.mpesaTransactionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "tx-1", status: { in: ["pending", "ambiguous"] } }),
      data: expect.objectContaining({ checkoutRequestId: "ws_CO_123", merchantRequestId: "merchant-1" }),
    }));
    expect(mocks.mpesaTransactionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "tx-1" },
      data: expect.objectContaining({ status: "confirmed", mpesaReceipt: "QWE1234567" }),
    }));
    expect(mocks.confirmBookingPayment).toHaveBeenCalledWith("booking-1", expect.objectContaining({ receipt: "QWE1234567" }));
  });

  it("rejects an unsigned callback before looking up a transaction", async () => {
    mocks.verifyCallbackToken.mockReturnValue(false);

    const response = await POST(callbackRequest());

    expect(response.status).toBe(401);
    expect(mocks.mpesaTransactionFindUnique).not.toHaveBeenCalled();
    expect(mocks.mpesaTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.confirmBookingPayment).not.toHaveBeenCalled();
  });
});
