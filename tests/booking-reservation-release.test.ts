import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  bookingDeleteMany: vi.fn(),
  bookingFindMany: vi.fn(),
  tripFindUnique: vi.fn(),
  tripUpdate: vi.fn(),
  events: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/money", () => ({
  getConfig: vi.fn(),
  onTripCompleted: vi.fn(),
  runReconciliationSweep: vi.fn(),
  isPayoutBatchDue: vi.fn(),
  runPayoutBatch: vi.fn(),
}));

import { releaseUnpaidBookingReservation } from "@/lib/engine";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  const tx = {
    $queryRaw: mocks.queryRaw,
    booking: { deleteMany: mocks.bookingDeleteMany, findMany: mocks.bookingFindMany },
    trip: { findUnique: mocks.tripFindUnique, update: mocks.tripUpdate },
  };
  mocks.transaction.mockImplementation(async (work: (transactionClient: unknown) => unknown) => work(tx));
  mocks.queryRaw.mockImplementation(async () => {
    mocks.events.push("lock-trip");
    return [];
  });
  mocks.bookingDeleteMany.mockImplementation(async () => {
    mocks.events.push("delete-draft");
    return { count: 1 };
  });
  mocks.tripFindUnique.mockResolvedValue({ capacity: 4 });
  mocks.bookingFindMany.mockResolvedValue([
    { seats: 1, isCharter: false },
    { seats: 2, isCharter: false },
  ]);
  mocks.tripUpdate.mockImplementation(async () => {
    mocks.events.push("recount");
    return {};
  });
});

describe("unpaid booking reservation cleanup", () => {
  it("locks the trip, deletes only the unpaid draft, and recounts occupied seats", async () => {
    const released = await releaseUnpaidBookingReservation("booking-1", "trip-1");

    expect(released).toBe(true);
    expect(mocks.events).toEqual(["lock-trip", "delete-draft", "recount"]);
    expect(mocks.bookingDeleteMany).toHaveBeenCalledWith({
      where: { id: "booking-1", tripId: "trip-1", status: "awaiting_payment" },
    });
    expect(mocks.tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip-1" },
      data: { bookedSeats: 3 },
    });
  });

  it("keeps the full capacity reserved when another active charter remains", async () => {
    mocks.bookingFindMany.mockResolvedValue([{ seats: 1, isCharter: true }]);

    await releaseUnpaidBookingReservation("booking-1", "trip-1");

    expect(mocks.tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip-1" },
      data: { bookedSeats: 4 },
    });
  });

  it("reports if the draft was no longer removable", async () => {
    mocks.bookingDeleteMany.mockResolvedValue({ count: 0 });

    await expect(releaseUnpaidBookingReservation("booking-1", "trip-1")).resolves.toBe(false);
    expect(mocks.tripUpdate).toHaveBeenCalledOnce();
  });
});
