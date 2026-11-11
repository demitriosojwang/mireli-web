import { describe, expect, it } from "vitest";
import {
  assertTransition,
  BOOKING_MACHINE,
  canTransition,
  DRIVER_PHASE_MACHINE,
  LEDGER_MACHINE,
  MPESA_MACHINE,
  PAYOUT_RECORD_MACHINE,
  TransitionError,
  TRIP_MACHINE,
} from "@/lib/state-machines";

describe("state machine transition tables", () => {
  it("allows only the documented booking transitions", () => {
    expect(canTransition(BOOKING_MACHINE, "awaiting_payment", "confirmed")).toBe(true);
    expect(canTransition(BOOKING_MACHINE, "confirmed", "boarded")).toBe(true);
    expect(canTransition(BOOKING_MACHINE, "confirmed", "cancelled")).toBe(true);
    expect(canTransition(BOOKING_MACHINE, "boarded", "no_show")).toBe(true);
    // Terminal states accept nothing.
    expect(canTransition(BOOKING_MACHINE, "cancelled", "confirmed")).toBe(false);
    expect(canTransition(BOOKING_MACHINE, "completed", "cancelled")).toBe(false);
    // Payment can never be un-confirmed by a booking-level move backwards.
    expect(canTransition(BOOKING_MACHINE, "confirmed", "awaiting_payment")).toBe(false);
  });

  it("guards the M-Pesa terminal states against late callbacks", () => {
    // The production bug: a late `failed` callback overwriting `confirmed`.
    expect(canTransition(MPESA_MACHINE, "confirmed", "failed")).toBe(false);
    expect(canTransition(MPESA_MACHINE, "failed", "confirmed")).toBe(false);
    expect(canTransition(MPESA_MACHINE, "stk_push_sent", "confirmed")).toBe(true);
    expect(canTransition(MPESA_MACHINE, "stk_push_sent", "failed")).toBe(true);
    expect(canTransition(MPESA_MACHINE, "ambiguous", "confirmed")).toBe(true);
    expect(canTransition(MPESA_MACHINE, "ambiguous", "failed")).toBe(true);
  });

  it("keeps the trip lifecycle linear with a real cancelled writer", () => {
    expect(canTransition(TRIP_MACHINE, "scheduled", "filling")).toBe(true);
    expect(canTransition(TRIP_MACHINE, "filling", "locked")).toBe(true);
    expect(canTransition(TRIP_MACHINE, "locked", "departed")).toBe(true);
    expect(canTransition(TRIP_MACHINE, "departed", "completed")).toBe(true);
    // Pre-departure cancellation is allowed; departed trips complete instead.
    expect(canTransition(TRIP_MACHINE, "locked", "cancelled")).toBe(true);
    expect(canTransition(TRIP_MACHINE, "departed", "cancelled")).toBe(false);
    expect(canTransition(TRIP_MACHINE, "completed", "cancelled")).toBe(false);
  });

  it("never lets a driver_payable ledger return to held", () => {
    expect(canTransition(LEDGER_MACHINE, "held", "driver_payable")).toBe(true);
    expect(canTransition(LEDGER_MACHINE, "driver_payable", "refunded")).toBe(true);
    expect(canTransition(LEDGER_MACHINE, "refunded", "driver_payable")).toBe(false);
    expect(canTransition(LEDGER_MACHINE, "forfeited", "held")).toBe(false);
  });

  it("documents the real PayoutRecord value set including needs_review", () => {
    expect(PAYOUT_RECORD_MACHINE.states).toContain("needs_review");
    expect(PAYOUT_RECORD_MACHINE.states).toContain("processing");
    expect(PAYOUT_RECORD_MACHINE.states).toContain("ambiguous");
    expect(canTransition(PAYOUT_RECORD_MACHINE, "processing", "completed")).toBe(true);
    expect(canTransition(PAYOUT_RECORD_MACHINE, "completed", "processing")).toBe(false);
  });

  it("preserves the driver phase table that started this module", () => {
    expect(canTransition(DRIVER_PHASE_MACHINE, "assigned", "accepted")).toBe(true);
    expect(canTransition(DRIVER_PHASE_MACHINE, "accepted", "at_pickup")).toBe(true);
    expect(canTransition(DRIVER_PHASE_MACHINE, "at_pickup", "in_progress")).toBe(true);
    expect(canTransition(DRIVER_PHASE_MACHINE, "in_progress", "completed")).toBe(true);
    expect(canTransition(DRIVER_PHASE_MACHINE, "accepted", "completed")).toBe(false);
  });

  it("throws TransitionError with machine name and states for illegal moves", () => {
    expect(() => assertTransition(BOOKING_MACHINE, "cancelled", "confirmed")).toThrow(TransitionError);
    expect(() => assertTransition(BOOKING_MACHINE, "cancelled", "confirmed")).toThrow(/Booking/);
  });
});
