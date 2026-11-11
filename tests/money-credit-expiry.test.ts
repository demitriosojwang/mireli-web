import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  creditUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { credit: { updateMany: mocks.creditUpdateMany }, $queryRaw: vi.fn(), $transaction: vi.fn() },
}));
vi.mock("@prisma/client", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/daraja", () => ({}));
vi.mock("@/lib/payout-settlement", () => ({ calculateSettlement: vi.fn(), sendPayout: vi.fn(), settleCallback: vi.fn() }));
vi.mock("@/lib/driver/errors", () => ({ DriverError: class DriverError extends Error {} }));
vi.mock("@/lib/booking-ticket-email", () => ({ attemptBookingTicketEmail: vi.fn() }));
vi.mock("@/lib/runtime-mode", () => ({ isLocalDemoEnabled: vi.fn(() => false) }));
vi.mock("@/lib/refund-settlement", () => ({ submitRefund: vi.fn() }));

import { expireStaleCredits } from "@/lib/money";

/**
 * The terms promise: a late-cancellation credit is held in the passenger's
 * account for 30 days, then forfeited if unused. expireStaleCredits is the
 * enforcement point: any active credit whose expiresAt has passed must be
 * marked expired, and only those.
 */
describe("credit expiry (30-day forfeit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.creditUpdateMany.mockResolvedValue({ count: 3 });
  });

  it("expires only active credits whose validity window has passed", async () => {
    const count = await expireStaleCredits();

    expect(count).toBe(3);
    expect(mocks.creditUpdateMany).toHaveBeenCalledTimes(1);
    const call = mocks.creditUpdateMany.mock.calls[0][0];
    // Only active credits...
    expect(call.where.status).toBe("active");
    // ...whose expiresAt is at or before the moment of the sweep.
    const cutoff = call.where.expiresAt.lte as Date;
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now());
    // ...and they become expired, never deleted or cashed out.
    expect(call.data.status).toBe("expired");
  });

  it("never touches credits that are still inside their 30-day window", async () => {
    // Simulate the sweep running with a mocked clock where credits were
    // issued 29 days ago with a 30-day validity: expiresAt is in the future.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));
    mocks.creditUpdateMany.mockClear().mockResolvedValue({ count: 0 });

    const count = await expireStaleCredits();

    expect(count).toBe(0);
    const call = mocks.creditUpdateMany.mock.calls[0][0];
    const cutoff = call.where.expiresAt.lte as Date;
    // A credit issued 2026-10-12 with 30-day validity expires 2026-11-11T12:00,
    // so the cutoff must be exactly "now" — anything later would expire early.
    expect(cutoff.toISOString()).toBe("2026-11-11T12:00:00.000Z");
    vi.useRealTimers();
  });

  it("expires a credit the day after its 30-day window closes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
    mocks.creditUpdateMany.mockClear().mockResolvedValue({ count: 1 });

    const count = await expireStaleCredits();

    expect(count).toBe(1);
    const call = mocks.creditUpdateMany.mock.calls[0][0];
    const cutoff = call.where.expiresAt.lte as Date;
    expect(cutoff.toISOString()).toBe("2026-11-12T12:00:00.000Z");
    vi.useRealTimers();
  });
});
