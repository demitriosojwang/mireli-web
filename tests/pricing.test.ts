import { describe, expect, it } from "vitest";
import {
  calculateBookingFeeAmount,
  calculateOffstageSurcharge,
  calculateSharedOffstageFare,
  calculateSharedFare,
  calculateSharedSeatFare,
} from "@/lib/pricing";

describe("shared ride fare and Mireli fee", () => {
  it("uses the listed fare for every shared cab size", () => {
    expect(calculateSharedSeatFare(400, 4)).toBe(400);
    expect(calculateSharedSeatFare(400, 7)).toBe(400);
    expect(calculateSharedSeatFare(400, 10)).toBe(400);
    expect(calculateSharedSeatFare(400, 11)).toBe(400);
    expect(calculateSharedFare(400, 10, 3)).toBe(1200);
  });

  it("charges Mireli KSh 50 per shared seat and only one recorded fee inside a charter share", () => {
    expect(calculateBookingFeeAmount(50, 3)).toBe(150);
    expect(calculateBookingFeeAmount(50, 4, true)).toBe(50);
  });

  it("rejects invalid capacities, fares, and seat counts", () => {
    expect(() => calculateSharedSeatFare(0, 10)).toThrow();
    expect(() => calculateSharedSeatFare(50, 0)).toThrow();
    expect(() => calculateSharedFare(400, 7, 0)).toThrow();
    expect(() => calculateBookingFeeAmount(50, 0)).toThrow();
  });
});

describe("shared off-stage surcharge", () => {
  it("charges half the road distance at KSh 50 and rounds to the nearest shilling", () => {
    expect(calculateOffstageSurcharge(6_000)).toBe(150);
    expect(calculateOffstageSurcharge(5_100)).toBe(128);
  });

  it("splits an off-stage shared fare between the driver and Mireli per seat", () => {
    expect(calculateSharedOffstageFare(400, 6_000, 1)).toEqual({
      surchargePerSeat: 150,
      totalSurcharge: 150,
      platformFeeAmount: 50,
      driverPayoutAmount: 550,
      totalAmount: 600,
    });
    expect(calculateSharedOffstageFare(400, 6_000, 3)).toMatchObject({
      totalSurcharge: 450,
      platformFeeAmount: 150,
      driverPayoutAmount: 1_650,
      totalAmount: 1_800,
    });
  });

  it("rejects invalid route distances", () => {
    expect(() => calculateOffstageSurcharge(-1)).toThrow();
    expect(() => calculateOffstageSurcharge(1.5)).toThrow();
    expect(() => calculateSharedOffstageFare(400, 6_000, 0)).toThrow();
  });
});
