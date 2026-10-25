/** Decide whether the booking form can open before passenger details are collected. */
export function getBookingPaymentPreflight(
  total: number,
  creditBalance: number,
  stkAvailable: boolean,
): { canProceed: boolean; useCredit: boolean } {
  if (!Number.isSafeInteger(total) || total <= 0) {
    return { canProceed: false, useCredit: false };
  }
  if (stkAvailable) return { canProceed: true, useCredit: false };

  const creditCoversTotal =
    Number.isSafeInteger(creditBalance) && creditBalance >= total;
  return { canProceed: creditCoversTotal, useCredit: creditCoversTotal };
}
