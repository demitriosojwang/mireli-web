import { describe, expect, it } from "vitest";
import {
  calculateBookingFeeAmount,
  calculateSharedFare,
  calculateSharedSeatFare,
} from "@/lib/pricing";

describe("shared ride fare and Mireli fee", () => {
  it("keeps the listed fare for 4/7-seat cabs and discounts 10/11-seat cabs by KSh 50 per seat", () => {
    expect(calculateSharedSeatFare(400, 4)).toBe(400);
    expect(calculateSharedSeatFare(400, 7)).toBe(400);
    expect(calculateSharedSeatFare(400, 10)).toBe(350);
    expect(calculateSharedSeatFare(400, 11)).toBe(350);
    expect(calculateSharedFare(400, 10, 3)).toBe(1050);
  });

  it("charges Mireli KSh 50 per shared seat and only one recorded fee inside a charter share", () => {
    expect(calculateBookingFeeAmount(50, 3)).toBe(150);
    expect(calculateBookingFeeAmount(50, 4, true)).toBe(50);
  });

  it("rejects invalid capacities, seat counts, and discounts that erase the fare", () => {
    expect(() => calculateSharedSeatFare(50, 10)).toThrow();
    expect(() => calculateSharedFare(400, 7, 0)).toThrow();
    expect(() => calculateBookingFeeAmount(50, 0)).toThrow();
  });
});
