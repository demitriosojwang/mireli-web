/** Additional charter fare charged for each seat in the reserved vehicle. */
export const CHARTER_PER_SEAT_AMOUNT = 100;

/**
 * A charter reserves every seat in the assigned vehicle. The configured stage
 * fare is per seat; KSh 100 is added per vehicle seat. The flat booking fee is
 * accounted for inside Mireli's 10% share and is not added again here.
 */
export function calculateCharterFare(capacity: number, stageFare: number): number {
  if (!Number.isSafeInteger(capacity) || capacity < 1 ||
      !Number.isSafeInteger(stageFare) || stageFare < 0) {
    throw new RangeError("Charter fare requires a valid vehicle capacity and stage fare.");
  }

  const total = capacity * (stageFare + CHARTER_PER_SEAT_AMOUNT);
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("Charter fare exceeds the supported amount.");
  }
  return total;
}

/** Mireli's percentage share of charter fare, including its embedded flat fee. */
export function calculateCharterPlatformShare(charterFare: number, rateBps: number): number {
  if (!Number.isSafeInteger(charterFare) || charterFare < 0 ||
      !Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000 ||
      !Number.isSafeInteger(charterFare * rateBps)) {
    throw new RangeError("Charter platform share requires a valid fare and commission rate.");
  }
  return Math.round(charterFare * rateBps / 10000);
}
