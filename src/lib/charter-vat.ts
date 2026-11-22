/** Charter VAT — Kenya VAT rate applied on top of the charter fare. The client
 *  incurs the VAT: it is added after the fare and the driver's 10% split is
 *  always computed on the pre-VAT fare only. */
export const CHARTER_VAT_RATE = 0.16;

/** VAT in whole shillings, rounded to the nearest shilling (.5 rounds up). */
export function calculateCharterVat(charterFare: number): number {
  if (!Number.isSafeInteger(charterFare) || charterFare < 0) {
    throw new RangeError("Charter VAT requires a valid charter fare.");
  }
  const vat = Math.round(charterFare * CHARTER_VAT_RATE);
  if (!Number.isSafeInteger(vat)) {
    throw new RangeError("Charter VAT exceeds the supported amount.");
  }
  return vat;
}

/** Extract VAT already included in the supplied gross fare (16 / 116). */
export function calculateIncludedVat(grossFare: number): number {
  if (!Number.isSafeInteger(grossFare) || grossFare < 0) {
    throw new RangeError("Included VAT requires a valid gross fare.");
  }
  const vat = Math.round(grossFare * CHARTER_VAT_RATE / (1 + CHARTER_VAT_RATE));
  if (!Number.isSafeInteger(vat)) throw new RangeError("Included VAT exceeds the supported amount.");
  return vat;
}

/** Passenger total for a charter: fare + VAT on top. */
export function charterTotalWithVat(charterFare: number): number {
  const vat = calculateCharterVat(charterFare);
  const total = charterFare + vat;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("Charter total exceeds the supported amount.");
  }
  return total;
}
