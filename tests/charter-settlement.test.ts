import { describe, expect, it } from "vitest";
import { calculateCharterFare, calculateCharterPlatformShare, CHARTER_PER_SEAT_AMOUNT } from "@/lib/charter-pricing";
import { calculateSettlement } from "@/lib/payout-settlement";

/**
 * End-to-end charter money math, per the Mireli terms:
 * a charter prices every seat at (nearest stage fare + KSh 100), and Mireli
 * retains 10% of the charter total while the driver earns the stage fares.
 * These tests pin the exact arithmetic the ledger records.
 */
describe("charter fare to settlement, end to end", () => {
  const TEN_PERCENT_BPS = 1000;

  it("matches the terms example: 4-seater, stage fare 400 -> passenger pays 2,000", () => {
    expect(calculateCharterFare(4, 400)).toBe(2000);
  });

  it("adds exactly KSh 100 per seat on top of the stage fare", () => {
    for (const capacity of [1, 2, 3, 4, 6, 7, 8, 14]) {
      const fare = calculateCharterFare(capacity, 400);
      expect(fare).toBe(capacity * 400 + capacity * CHARTER_PER_SEAT_AMOUNT);
      expect(fare - capacity * 400).toBe(capacity * CHARTER_PER_SEAT_AMOUNT);
    }
  });

  it("keeps the driver's stage-fare earnings whole after the 10% platform share", () => {
    // 4-seater chartered at stage fare 400: total 2000, platform share 200.
    const total = calculateCharterFare(4, 400);
    const share = calculateCharterPlatformShare(total, TEN_PERCENT_BPS);
    expect(share).toBe(200);
    // Settlement: the embedded KSh 50 fee line is recorded separately and
    // deducted from the share, so the passenger is never charged it twice.
    const settlement = calculateSettlement(total, 0, 50, TEN_PERCENT_BPS, true);
    expect(settlement.gross).toBe(2000);
    expect(settlement.commission).toBe(150); // 200 share - 50 embedded fee
    expect(settlement.platformFee).toBe(50);
    expect(settlement.net).toBe(1800); // driver receives stage fares: 4 x 400 + 200 charter uplift - fee
    expect(settlement.commission + settlement.platformFee + settlement.net).toBe(settlement.gross);
  });

  it("splits a 7-seater charter without losing a shilling", () => {
    const total = calculateCharterFare(7, 500); // 7 x 600 = 4200
    const settlement = calculateSettlement(total, 0, 50, TEN_PERCENT_BPS, true);
    expect(settlement.gross).toBe(4200);
    expect(settlement.commission).toBe(370); // 420 - 50
    expect(settlement.net).toBe(3780);
    expect(settlement.commission + settlement.platformFee + settlement.net).toBe(settlement.gross);
  });

  it("never lets the commission go negative on a minimum fare", () => {
    // Stage fare 0: total 400 (4 seats x 100 uplift). Share 40 < fee 50 -> rejected upstream.
    const total = calculateCharterFare(4, 0);
    expect(() => calculateSettlement(total, 0, 50, TEN_PERCENT_BPS, true)).toThrow();
  });

  it("rejects a charter fare too low to carry the embedded fee", () => {
    // 1 seat, stage fare 0: total 100, share 10 < fee 50.
    expect(() => calculateSettlement(calculateCharterFare(1, 0), 0, 50, TEN_PERCENT_BPS, true)).toThrow();
  });

  it("does not apply charter share logic to hailed bookings", () => {
    // Hailed: 900 total (2 seats x (400 + 50 fee)), no commission, driver gets the rest.
    const settlement = calculateSettlement(900, 0, 100, TEN_PERCENT_BPS, false);
    expect(settlement.commission).toBe(0);
    expect(settlement.net).toBe(800);
  });
});
