import { describe, expect, it } from "vitest";
import {
  calculateBookingFeeAmount,
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
