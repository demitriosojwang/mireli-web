import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refundFindUnique: vi.fn(),
  refundUpdate: vi.fn(),
  refundUpdateMany: vi.fn(),
  refundAggregate: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptFindUnique: vi.fn(),
  attemptCreate: vi.fn(),
  attemptUpdate: vi.fn(),
  attemptUpdateMany: vi.fn(),
  ledgerUpdate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  resolveDaraja: vi.fn(),
  callbackUrls: vi.fn(),
  b2c: vi.fn(),
  reversal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    refundRecord: { findUnique: mocks.refundFindUnique, update: mocks.refundUpdate, updateMany: mocks.refundUpdateMany, aggregate: mocks.refundAggregate },
    refundAttempt: { findFirst: mocks.attemptFindFirst, findUnique: mocks.attemptFindUnique,
      create: mocks.attemptCreate, update: mocks.attemptUpdate, updateMany: mocks.attemptUpdateMany },
    ledgerEntry: { update: mocks.ledgerUpdate },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/daraja", () => ({
  RESULT_CODES: { SUCCESS: "0", TIMEOUT: "1007" },
  resolveDaraja: mocks.resolveDaraja,
  callbackUrls: mocks.callbackUrls,
  b2c: mocks.b2c,
  reversal: mocks.reversal,
}));

import { settleRefundCallback, submitRefund } from "@/lib/refund-settlement";

const refund = {
  id: "refund-1", refundId: "refund-1", status: "pending", method: "b2c", amount: 1000,
  booking: { passengerPhone: "254712345678", passenger: { phone: "254712345678" } },
  ledgerEntry: { id: "ledger-1", mpesaReceipt: "QWE1234567", cashAmount: 1000 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MIRELI_DEMO_MODE", "false");
  vi.stubEnv("MIRELI_ALLOW_UNSAFE_DEMO", "");
  vi.stubEnv("MPESA_LIVE_REFUNDS_ENABLED", "true");
  mocks.resolveDaraja.mockResolvedValue({ mode: "live", callbackBaseUrl: "https://mireli.example" });
  mocks.callbackUrls.mockReturnValue({ b2cResult: "https://mireli.example/api/pay/mpesa/b2c/result?mireli_token=token" });
  mocks.refundFindUnique.mockResolvedValue(refund);
  mocks.attemptFindFirst.mockResolvedValue(null);
  mocks.attemptCreate.mockResolvedValue({ id: "attempt-1", refundId: "refund-1", amount: 1000, receiverPhone: "254712345678", originatorId: "MR-originator", state: "submitting" });
  mocks.refundUpdate.mockResolvedValue({});
  mocks.refundUpdateMany.mockResolvedValue({ count: 1 });
  mocks.refundAggregate.mockResolvedValue({ _sum: { amount: 0 } });
  mocks.attemptUpdate.mockResolvedValue({});
  mocks.attemptUpdateMany.mockResolvedValue({ count: 1 });
  mocks.ledgerUpdate.mockResolvedValue({});
  mocks.audit.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    refundAttempt: {
      findUnique: mocks.attemptFindUnique,
      update: mocks.attemptUpdate,
      updateMany: mocks.attemptUpdateMany,
    },
    refundRecord: { update: mocks.refundUpdate, updateMany: mocks.refundUpdateMany, aggregate: mocks.refundAggregate },
    ledgerEntry: { update: mocks.ledgerUpdate },
  }));
});

afterEach(() => vi.unstubAllEnvs());

describe("Daraja refund settlement", () => {
  it("leaves an accepted live B2C request pending and sends a private callback capability", async () => {
    mocks.b2c.mockResolvedValue({ resultCode: "ACCEPTED", resultDesc: "Accepted", conversationId: "AG-conversation", originatorId: "MR-originator" });
    mocks.attemptFindUnique.mockResolvedValue({ id: "attempt-1", state: "submitting", originatorId: "MR-originator" });
    mocks.refundFindUnique.mockResolvedValueOnce(refund).mockResolvedValueOnce({ status: "pending" });

    const status = await submitRefund("refund-1");
    const payload = mocks.b2c.mock.calls[0][0] as { resultUrl: string; timeoutUrl: string; originatorId: string };
    const resultUrl = new URL(payload.resultUrl);

    expect(status).toBe("pending");
    expect(payload.originatorId).toMatch(/^MR-[a-f0-9]{16}$/);
    expect(resultUrl.pathname).toMatch(/^\/api\/pay\/mpesa\/refund-result\/[a-f0-9]{64}$/);
    expect(resultUrl.searchParams.get("mireli_token")).toBe("token");
    expect(payload.timeoutUrl).toContain("timeout=1");
    expect(mocks.refundUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failureReason: "Accepted" }) }));
    expect(mocks.ledgerUpdate).not.toHaveBeenCalled();
  });

  it("marks the ledger fully refunded only after a matched result covers earlier partial refunds", async () => {
    mocks.refundAggregate.mockResolvedValue({ _sum: { amount: 500 } });
    const attempt = { id: "attempt-1", refundId: "refund-1", method: "b2c", amount: 1000,
      receiverPhone: "254712345678", originatorId: "MR-originator", conversationId: "AG-conversation",
      state: "processing", refund: { id: "refund-1", amount: 1000, ledgerEntry: { id: "ledger-1", cashAmount: 1500 } } };
    mocks.attemptFindUnique.mockImplementation(async () => attempt);
    const result = await settleRefundCallback("a".repeat(64), {
      ResultCode: 0, ResultType: 0, OriginatorConversationID: "MR-originator", ConversationID: "AG-conversation",
      TransactionID: "ABC1234567", ResultParameters: { ResultParameter: [
        { Key: "TransactionAmount", Value: 1000 },
        { Key: "TransactionReceipt", Value: "ABC1234567" },
        { Key: "ReceiverPartyPublicName", Value: "254712345678 - Passenger" },
      ] },
    });

    expect(result.state).toBe("completed");
    expect(mocks.refundUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed", mpesaResultCode: "0" }) }));
    expect(mocks.ledgerUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ledger-1" }, data: expect.objectContaining({ status: "refunded" }) }));
    expect(mocks.refundAggregate).toHaveBeenCalledWith(expect.objectContaining({ _sum: { amount: true } }));
  });

  it("rejects a callback when its provider conversation does not match the attempt", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ id: "attempt-1", refundId: "refund-1", method: "b2c", amount: 1000,
      receiverPhone: "254712345678", originatorId: "MR-originator", conversationId: "AG-expected", state: "processing" });

    await expect(settleRefundCallback("b".repeat(64), {
      ResultCode: 0, OriginatorConversationID: "MR-originator", ConversationID: "AG-other", TransactionID: "ABC1234567",
    })).rejects.toMatchObject({ code: "RESULT_MISMATCH" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not convert a Daraja queue timeout into a failed refund", async () => {
    mocks.attemptFindUnique.mockResolvedValue({ id: "attempt-1", refundId: "refund-1", state: "processing" });
    await settleRefundCallback("c".repeat(64), {}, true);

    expect(mocks.refundUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ failureReason: "Daraja callback timed out; reconciliation is required." }),
    }));
    expect(mocks.ledgerUpdate).not.toHaveBeenCalled();
  });
});
