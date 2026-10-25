import { describe, expect, it } from "vitest";
import {
  calculateLateCancellationCredit,
  describeCancellationCutoff,
  getPassengerCancellationTier,
} from "@/lib/cancellation-policy";

describe("passenger cancellation policy", () => {
  const pickupAt = new Date("2026-11-01T12:00:00.000Z");

  it("gives the full-refund tier at exactly 24 hours before pickup", () => {
    expect(getPassengerCancellationTier(new Date("2026-10-31T12:00:00.000Z"), pickupAt)).toBe("early");
  });

  it("uses the 75% credit tier inside the 24-hour window", () => {
    expect(getPassengerCancellationTier(new Date("2026-10-31T12:00:00.001Z"), pickupAt)).toBe("late");
  });

  it("returns 75% as integer credit without rounding above the policy share", () => {
    expect(calculateLateCancellationCredit(2_000)).toBe(1_500);
    expect(calculateLateCancellationCredit(401)).toBe(300);
  });

  it("describes whole-hour and minute-based policy cutoffs", () => {
    expect(describeCancellationCutoff(1_440)).toBe("24 hours");
    expect(describeCancellationCutoff(60)).toBe("1 hour");
    expect(describeCancellationCutoff(90)).toBe("90 minutes");
  });
});
