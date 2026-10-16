import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platformConfigFindUnique: vi.fn(),
  platformConfigUpdate: vi.fn(),
  mpesaTransactionFindMany: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  refundRecordFindMany: vi.fn(),
  refundRecordUpdate: vi.fn(),
  ledgerEntryFindUnique: vi.fn(),
  ledgerEntryCreate: vi.fn(),
  ledgerEntryUpdate: vi.fn(),
  creditUpdateMany: vi.fn(),
  audit: vi.fn(),
  attemptTicketEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    platformConfig: {
      findUnique: mocks.platformConfigFindUnique,
      update: mocks.platformConfigUpdate,
    },
    mpesaTransaction: { findMany: mocks.mpesaTransactionFindMany },
    booking: { findUnique: mocks.bookingFindUnique, update: mocks.bookingUpdate },
    refundRecord: {
      findMany: mocks.refundRecordFindMany,
      update: mocks.refundRecordUpdate,
    },
    ledgerEntry: {
      findUnique: mocks.ledgerEntryFindUnique,
      create: mocks.ledgerEntryCreate,
      update: mocks.ledgerEntryUpdate,
    },
    credit: { updateMany: mocks.creditUpdateMany },
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/booking-ticket-email", () => ({ attemptBookingTicketEmail: mocks.attemptTicketEmail }));
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
  mocks.bookingFindUnique.mockResolvedValue({
    id: "booking-1",
    passengerId: "passenger-1",
    code: "MR-LATE01",
    status: "cancelled",
    tripId: "trip-1",
    fareAmount: 500,
    cashDue: 500,
    creditApplied: 0,
    homeSurcharge: 0,
    platformFeeAmount: 50,
    ledgerEntry: null,
  });
  mocks.bookingUpdate.mockResolvedValue({});
  mocks.refundRecordFindMany.mockResolvedValue([pendingRefund]);
  mocks.refundRecordUpdate.mockResolvedValue({});
  mocks.ledgerEntryFindUnique.mockResolvedValue(null);
  mocks.ledgerEntryCreate.mockResolvedValue({ id: "ledger-new" });
  mocks.ledgerEntryUpdate.mockResolvedValue({});
  mocks.creditUpdateMany.mockResolvedValue({ count: 0 });
  mocks.platformConfigUpdate.mockResolvedValue({});
  mocks.attemptTicketEmail.mockResolvedValue(undefined);
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

  it("repairs a confirmed capture whose ledger write failed without reopening a cancelled booking", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");
    vi.stubEnv("MIRELI_ALLOW_UNSAFE_DEMO", "");
    mocks.mpesaTransactionFindMany.mockImplementation(async (args: { where: { status: unknown } }) =>
      args.where.status === "confirmed"
        ? [{ bookingId: "booking-1", checkoutRequestId: "ws_CO_123", mpesaReceipt: "QWE1234567" }]
        : [],
    );

    const summary = await runReconciliationSweep({ id: "system", name: "Sweep", role: "system" });

    expect(summary.recoveredPayments).toBe(1);
    expect(mocks.ledgerEntryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ bookingId: "booking-1", mpesaReceipt: "QWE1234567", status: "held" }),
    }));
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.attemptTicketEmail).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "payment.capture_after_closed_booking",
      entityId: "booking-1",
    }));
  });
});
