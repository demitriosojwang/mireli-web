import { describe, expect, it } from "vitest";
import { calculateCharterFare, calculateCharterPlatformShare } from "@/lib/charter-pricing";

describe("capacity-based charter fare", () => {
  it("prices all vehicle seats and adds KSh 100 per seat", () => {
    expect(calculateCharterFare(4, 400)).toBe(2000);
  });

  it("uses the assigned vehicle capacity", () => {
    expect(calculateCharterFare(7, 400)).toBe(3500);
  });

  it("includes the flat fee in the charter share", () => {
    expect(calculateCharterPlatformShare(2000, 1000)).toBe(200);
  });

  it("rejects invalid capacity, fare, and overflow", () => {
    expect(() => calculateCharterFare(0, 400)).toThrow();
    expect(() => calculateCharterFare(4, -1)).toThrow();
    expect(() => calculateCharterFare(4, 2.5)).toThrow();
    expect(() => calculateCharterFare(Number.MAX_SAFE_INTEGER, 400)).toThrow();
  });
});
