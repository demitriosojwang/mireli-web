import { describe, expect, it } from "vitest";
import { getBookingPaymentPreflight } from "@/lib/booking-payment-preflight";

describe("booking payment preflight", () => {
  it("allows checkout when real STK payment is available", () => {
    expect(getBookingPaymentPreflight(2_000, 0, true)).toEqual({
      canProceed: true,
      useCredit: false,
    });
  });

  it("lets the booking be created without STK; credit is only auto-selected when it covers the total", () => {
    expect(getBookingPaymentPreflight(2_000, 2_000, false)).toEqual({
      canProceed: true,
      useCredit: true,
    });
    expect(getBookingPaymentPreflight(2_000, 1_999, false)).toEqual({
      canProceed: true,
      useCredit: false,
    });
    expect(getBookingPaymentPreflight(2_000, 0, false)).toEqual({
      canProceed: true,
      useCredit: false,
    });
  });

  it("fails closed for invalid totals", () => {
    expect(getBookingPaymentPreflight(0, 1_000, true)).toEqual({
      canProceed: false,
      useCredit: false,
    });
    expect(getBookingPaymentPreflight(Number.NaN, 1_000, false)).toEqual({
      canProceed: false,
      useCredit: false,
    });
  });
});
