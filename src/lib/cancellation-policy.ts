export const DEFAULT_FULL_REFUND_CUTOFF_MINUTES = 24 * 60;
export const LATE_CANCELLATION_CREDIT_NUMERATOR = 3;
export const LATE_CANCELLATION_CREDIT_DENOMINATOR = 4;
export const LATE_CANCELLATION_CREDIT_VALIDITY_DAYS = 30;

export type PassengerCancellationTier = "early" | "late";

/** A request before the configured cutoff receives the full refund tier. */
export function getPassengerCancellationTier(
  requestedAt: Date,
  pickupAt: Date,
  cutoffMinutes = DEFAULT_FULL_REFUND_CUTOFF_MINUTES,
): PassengerCancellationTier {
  if (!Number.isFinite(requestedAt.getTime()) || !Number.isFinite(pickupAt.getTime()) ||
      !Number.isSafeInteger(cutoffMinutes) || cutoffMinutes < 0) {
    throw new RangeError("Cancellation requires valid request and pickup times.");
  }
  return requestedAt.getTime() <= pickupAt.getTime() - cutoffMinutes * 60_000 ? "early" : "late";
}

export function describeCancellationCutoff(cutoffMinutes: number): string {
  if (!Number.isSafeInteger(cutoffMinutes) || cutoffMinutes < 0) {
    throw new RangeError("Cancellation cutoff must be a non-negative whole number of minutes.");
  }
  if (cutoffMinutes % 60 === 0) {
    const hours = cutoffMinutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${cutoffMinutes} minutes`;
}

/** Return exactly 75% as integer KSh credit without rounding the customer's credit upward. */
export function calculateLateCancellationCredit(totalAmount: number): number {
  if (!Number.isSafeInteger(totalAmount) || totalAmount < 0) {
    throw new RangeError("Cancellation credit requires a valid fare amount.");
  }
  const wholeQuarters = Math.floor(totalAmount / LATE_CANCELLATION_CREDIT_DENOMINATOR);
  const remainder = totalAmount % LATE_CANCELLATION_CREDIT_DENOMINATOR;
  return wholeQuarters * LATE_CANCELLATION_CREDIT_NUMERATOR +
    Math.floor(remainder * LATE_CANCELLATION_CREDIT_NUMERATOR / LATE_CANCELLATION_CREDIT_DENOMINATOR);
}
