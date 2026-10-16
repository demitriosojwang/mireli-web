import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platformConfigFindUnique: vi.fn(),
  platformConfigUpdate: vi.fn(),
  mpesaTransactionFindMany: vi.fn(),
  refundRecordFindMany: vi.fn(),
  refundRecordUpdate: vi.fn(),
  ledgerEntryUpdate: vi.fn(),
  creditUpdateMany: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    platformConfig: {
      findUnique: mocks.platformConfigFindUnique,
      update: mocks.platformConfigUpdate,
    },
    mpesaTransaction: { findMany: mocks.mpesaTransactionFindMany },
    refundRecord: {
      findMany: mocks.refundRecordFindMany,
      update: mocks.refundRecordUpdate,
    },
    ledgerEntry: { update: mocks.ledgerEntryUpdate },
    credit: { updateMany: mocks.creditUpdateMany },
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/daraja", () => ({
  RESULT_CODES: { SUCCESS: "0", CANCELLED: "1" },
  transactionStatus: vi.fn(),
}));

import { runReconciliationSweep } from "@/lib/money";

const pendingRefund = {
  id: "refund-1",
  ledgerEntryId: "ledger-1",
  initiatedAt: new Date(Date.now() - 30 * 60 * 1000),
  stuckFlaggedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platformConfigFindUnique.mockResolvedValue({
    id: "main",
    sweepPendingMinutes: 5,
    stuckRefundHours: 4,
    creditValidityDays: 30,
  });
  mocks.mpesaTransactionFindMany.mockResolvedValue([]);
  mocks.refundRecordFindMany.mockResolvedValue([pendingRefund]);
  mocks.refundRecordUpdate.mockResolvedValue({});
  mocks.ledgerEntryUpdate.mockResolvedValue({});
  mocks.creditUpdateMany.mockResolvedValue({ count: 0 });
  mocks.platformConfigUpdate.mockResolvedValue({});
});

afterEach(() => vi.unstubAllEnvs());

describe("refund reconciliation simulation boundary", () => {
  it("does not mark a pending live refund completed without provider confirmation", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");
    vi.stubEnv("MIRELI_ALLOW_UNSAFE_DEMO", "");

    const summary = await runReconciliationSweep({ id: "system", name: "Sweep", role: "system" });

    expect(summary.completedRefunds).toBe(0);
    expect(mocks.refundRecordFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.refundRecordUpdate).not.toHaveBeenCalled();
    expect(mocks.ledgerEntryUpdate).not.toHaveBeenCalled();
  });

  it("keeps the simulated refund callback available in explicit local demo mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("MIRELI_DEMO_MODE", "true");

    const summary = await runReconciliationSweep({ id: "system", name: "Sweep", role: "system" });

    expect(summary.completedRefunds).toBe(1);
    expect(mocks.refundRecordUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "refund-1" },
      data: expect.objectContaining({ status: "completed", mpesaResultCode: "0" }),
    }));
    expect(mocks.ledgerEntryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ledger-1" },
      data: expect.objectContaining({ status: "refunded" }),
    }));
  });
});
