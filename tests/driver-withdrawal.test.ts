import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, b2c } = vi.hoisted(() => {
  const db = {
    payoutRecord: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    platformConfig: { findUnique: vi.fn() },
    ledgerEntry: { findFirst: vi.fn(), updateMany: vi.fn() },
    driverPayoutDestination: { findUnique: vi.fn() },
    driver: { findUniqueOrThrow: vi.fn() },
    payoutAttempt: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, b2c: vi.fn() };
});

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/daraja", () => ({
  resolveDaraja: async () => ({ mode: "live", callbackBaseUrl: "https://mireli.example" }),
  driverPayoutProviderReady: () => true,
  b2c,
}));

import { sendPayout, settleCallback } from "@/lib/payout-settlement";

const request = { driverId: "driver-1", destinationVersion: 3 };
const payout = { id: "payout-1", status: "queued", driverId: request.driverId, ledgerEntryId: "ledger-1", netPayoutAmount: 500 };
const phone = "+254712345678";

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MPESA_LIVE_PAYOUTS_ENABLED", "true");
  db.$transaction.mockImplementation(async (operation) => operation(db));
  db.platformConfig.findUnique.mockResolvedValue({ payoutMode: "driver_self_service" });
  db.ledgerEntry.findFirst.mockResolvedValue({ id: payout.ledgerEntryId });
  db.driverPayoutDestination.findUnique.mockResolvedValue({ phone, version: 3, status: "approved" });
  db.driver.findUniqueOrThrow.mockResolvedValue({ name: "Driver", mpesaNumber: phone });
  db.payoutRecord.findFirst.mockResolvedValue(payout);
  db.payoutRecord.updateMany.mockResolvedValue({ count: 1 });
  db.payoutRecord.findUnique.mockResolvedValue({ settlementVerified: false });
  db.payoutAttempt.create.mockResolvedValue({ id: "attempt-1", originatorId: null, receiverPhone: phone, amount: 500 });
  db.payoutAttempt.updateMany.mockResolvedValue({ count: 1 });
  b2c.mockResolvedValue({ resultCode: "ACCEPTED", conversationId: "conversation-1", originatorId: "originator-1" });
});

describe("driver withdrawals", () => {
  it("scopes lookups to the authenticated driver", async () => {
    db.payoutRecord.findFirst.mockResolvedValue(null);
    await expect(sendPayout(payout.id, request)).rejects.toMatchObject({ code: "PAYOUT_NOT_FOUND" });
    expect(db.payoutRecord.findFirst).toHaveBeenCalledWith({ where: { id: payout.id, driverId: request.driverId } });
    expect(b2c).not.toHaveBeenCalled();
  });

  it("leaves queued payouts for drivers and rejects a stale beneficiary", async () => {
    await sendPayout(payout.id);
    await expect(sendPayout(payout.id, { ...request, destinationVersion: 2 })).rejects.toMatchObject({ code: "DESTINATION_CHANGED" });
    expect(db.payoutAttempt.create).not.toHaveBeenCalled();
    expect(b2c).not.toHaveBeenCalled();
  });

  it("lets only the winning claim submit the stored amount and beneficiary", async () => {
    db.payoutRecord.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await Promise.all([sendPayout(payout.id, request), sendPayout(payout.id, request)]);
    expect(b2c).toHaveBeenCalledTimes(1);
    expect(b2c).toHaveBeenCalledWith(expect.objectContaining({ apiVersion: "v1", amount: 500, receiverPhone: phone }));
    expect(db.payoutAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "processing", originatorId: "originator-1", conversationId: "conversation-1" }),
    }));
    expect(db.payoutRecord.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ settlementVerified: false }) }));
  });

  it("requires the provider IDs, amount, and receiver before marking a v1 transfer paid", async () => {
    const attempt = { id: "attempt-1", payoutId: payout.id, payout, state: "processing", originatorId: "originator-1", conversationId: "conversation-1", receiverPhone: phone, amount: 500 };
    db.payoutAttempt.findUnique.mockResolvedValue(attempt);
    const result = {
      ResultCode: 0, OriginatorConversationID: "originator-1", ConversationID: "conversation-1", TransactionID: "TESTAB1234",
      ResultParameters: { ResultParameter: [{ Key: "TransactionAmount", Value: 500 }, { Key: "ReceiverPartyPublicName", Value: "254712345678 - Driver" }] },
    };
    const capability = "a".repeat(64);
    await expect(settleCallback(capability, { ...result, ConversationID: "wrong" })).rejects.toMatchObject({ code: "RESULT_MISMATCH" });
    await expect(settleCallback(capability, { ...result, ResultParameters: undefined })).rejects.toMatchObject({ code: "RESULT_MISMATCH" });
    expect(db.payoutRecord.update).not.toHaveBeenCalled();
    await settleCallback(capability, result);
    expect(db.payoutRecord.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed", settlementVerified: true }) }));
  });
});
