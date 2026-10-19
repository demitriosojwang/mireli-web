import { describe, expect, it } from "vitest";
import { isBookingReadyForPayment } from "@/lib/booking-payment-eligibility";

const now = new Date("2026-10-16T06:00:00.000Z");
const futureDeparture = new Date("2026-10-16T08:00:00.000Z");

const readyBooking = {
  status: "awaiting_payment",
  cashDue: 500,
  trip: {
    driverId: "driver-1",
    status: "scheduled",
    departureAt: futureDeparture,
    driver: { status: "active" },
  },
};

describe("passenger payment eligibility", () => {
  it.each(["scheduled", "locked"])("allows a future %s trip with an active assigned driver", (status) => {
    expect(isBookingReadyForPayment({
      ...readyBooking,
      trip: { ...readyBooking.trip, status },
    }, now)).toBe(true);
  });

  it.each([
    ["no trip", { trip: null }],
    ["no assigned driver", { trip: { ...readyBooking.trip, driverId: null } }],
    ["inactive driver", { trip: { ...readyBooking.trip, driver: { status: "suspended" } } }],
    ["cancelled trip", { trip: { ...readyBooking.trip, status: "cancelled" } }],
    ["departed trip", { trip: { ...readyBooking.trip, status: "departed" } }],
    ["past departure", { trip: { ...readyBooking.trip, departureAt: now } }],
    ["already confirmed booking", { status: "confirmed" }],
    ["no cash due", { cashDue: 0 }],
  ] as const)("rejects payment when %s", (_reason, override) => {
    expect(isBookingReadyForPayment({ ...readyBooking, ...override }, now)).toBe(false);
  });
});
