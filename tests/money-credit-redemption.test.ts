import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  events: [] as string[],
  creditRows: [] as { id: string; amount: number }[],
}));

vi.mock("@/lib/db", () => ({
  db: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/daraja", () => ({}));
vi.mock("@/lib/payout-settlement", () => ({ calculateSettlement: vi.fn() }));
vi.mock("@/lib/driver/errors", () => ({ DriverError: class DriverError extends Error {} }));
vi.mock("@/lib/booking-ticket-email", () => ({ attemptBookingTicketEmail: vi.fn() }));
vi.mock("@/lib/runtime-mode", () => ({ isLocalDemoEnabled: vi.fn(() => false) }));
vi.mock("@/lib/refund-settlement", () => ({ submitRefund: vi.fn() }));

import { applyCredits } from "@/lib/money";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  const tx = {
    $queryRaw: mocks.queryRaw,
    credit: { findMany: mocks.findMany, update: mocks.update },
  };
  mocks.transaction.mockImplementation(async (work: (transactionClient: unknown) => unknown) => work(tx));
  mocks.queryRaw.mockImplementation(async () => {
    mocks.events.push("lock");
    return [];
  });
  mocks.creditRows = [];
  mocks.findMany.mockImplementation(async () => {
    mocks.events.push("read");
    return mocks.creditRows;
  });
  mocks.update.mockImplementation(async ({ where }: { where: { id: string } }) => {
    mocks.events.push(`update:${where.id}`);
    return {};
  });
});

describe("credit redemption", () => {
  it("locks the passenger's rows before reading and redeems credits FIFO", async () => {
    mocks.creditRows = [
      { id: "credit-soon", amount: 300 },
      { id: "credit-later", amount: 400 },
    ];

    const applied = await applyCredits("passenger-1", "booking-1", 500);

    expect(applied).toBe(500);
    expect(mocks.events).toEqual(["lock", "read", "update:credit-soon", "update:credit-later"]);
    expect(mocks.queryRaw.mock.calls[0][0].join("")).toContain("FOR UPDATE");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ passengerId: "passenger-1", status: "active" }),
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    }));
    expect(mocks.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "credit-soon" },
      data: expect.objectContaining({ amount: 0, status: "redeemed", redeemedBookingId: "booking-1" }),
    }));
    expect(mocks.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "credit-later" },
      data: expect.objectContaining({ amount: 200, status: "active", redeemedBookingId: "booking-1" }),
    }));
  });

  it("does not partially redeem when full coverage is required but the locked balance is short", async () => {
    mocks.creditRows = [{ id: "credit-1", amount: 400 }];

    const applied = await applyCredits("passenger-1", "booking-1", 500, { requireFull: true });

    expect(applied).toBe(0);
    expect(mocks.events).toEqual(["lock", "read"]);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
