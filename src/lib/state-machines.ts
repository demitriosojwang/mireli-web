/**
 * Mireli state machines — the single source of truth for every lifecycle.
 *
 * Pattern proven in src/lib/driver/trips.ts (DriverTripProgress.phase table):
 * each machine declares its states and allowed transitions once; writes go
 * through a compare-and-swap helper so a status change is always guarded at
 * the DB level (no read-then-write races, no TOCTOU on money paths).
 *
 * Rules for this module:
 *  - Status string literals appear HERE and nowhere else.
 *  - Every machine write goes through `casUpdate` / `casUpdateMany` or a
 *    lib function that uses them.
 *  - Adding a state means adding it here first; TypeScript then points at
 *    every place that must learn about it.
 */
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/* ------------------------------------------------------------------ */
/* Core types                                                          */
/* ------------------------------------------------------------------ */

/** A machine: its states plus the only allowed transitions. */
export interface Machine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  /** from -> set of allowed to-states. */
  readonly transitions: Readonly<Record<S, readonly S[]>>;
}

export class TransitionError extends Error {
  constructor(machine: string, from: string, to: string) {
    super(`Illegal ${machine} transition: ${from} -> ${to}`);
    this.name = "TransitionError";
  }
}

export function assertTransition<S extends string>(
  machine: Machine<S>,
  from: S,
  to: S,
): void {
  if (!machine.states.includes(from)) {
    throw new TransitionError(machine.name, from, to);
  }
  const allowed = machine.transitions[from];
  if (!allowed || !allowed.includes(to)) {
    throw new TransitionError(machine.name, from, to);
  }
}

export function canTransition<S extends string>(
  machine: Machine<S>,
  from: S,
  to: S,
): boolean {
  try {
    assertTransition(machine, from, to);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compare-and-swap status update: the row moves to `to` only if it is
 * currently in `from`. Returns the count of rows updated (0 = raced or
 * already moved — callers must treat 0 as "someone else got there first",
 * never as an error to retry blindly).
 */
export async function casUpdateMany<S extends string>(
  model: "booking" | "trip" | "mpesaTransaction" | "ledgerEntry" | "refundRecord"
    | "refundAttempt" | "payoutRecord" | "payoutAttempt" | "credit"
    | "ticketEmailDelivery" | "driver" | "driverApplication"
    | "driverTripProgress" | "driverSupportCase" | "driverPayoutDestination",
  where: Record<string, unknown>,
  machine: Machine<S>,
  from: S | readonly S[],
  to: S,
  extraData: Record<string, unknown> = {},
): Promise<number> {
  const froms = (Array.isArray(from) ? [...from] : [from]) as S[];
  for (const f of froms) assertTransition(machine, f, to);
  const delegate = (db as unknown as Record<string, {
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
  }>)[model];
  const result = await delegate.updateMany({
    where: { ...where, status: { in: froms } },
    data: { status: to, ...extraData },
  });
  return result.count;
}

/* ------------------------------------------------------------------ */
/* Shared status sets — import these, never re-type the arrays         */
/* ------------------------------------------------------------------ */

/** Booking statuses that represent a live, actionable seat. */
export const ACTIVE_BOOKING_STATUSES: readonly string[] = ["awaiting_payment", "confirmed", "boarded"];

/** Complement used for "past bookings" partitions. */
export const INACTIVE_BOOKING_STATUSES: readonly string[] = ["cancelled", "completed", "no_show"];

/** Trip statuses that still have seats to sell. */
export const SELLABLE_TRIP_STATUSES: readonly string[] = ["scheduled", "filling"];

/* ------------------------------------------------------------------ */
/* Booking                                                             */
/* ------------------------------------------------------------------ */

export type BookingStatus =
  | "awaiting_payment" | "confirmed" | "boarded" | "cancelled" | "completed" | "no_show";

export const BOOKING_MACHINE: Machine<BookingStatus> = {
  name: "Booking",
  states: ["awaiting_payment", "confirmed", "boarded", "cancelled", "completed", "no_show"],
  transitions: {
    awaiting_payment: ["confirmed", "cancelled"],
    confirmed: ["boarded", "cancelled", "completed", "no_show"],
    boarded: ["completed", "no_show"],
    cancelled: [],
    completed: [],
    no_show: [],
  },
};

/* ------------------------------------------------------------------ */
/* Trip                                                                */
/* ------------------------------------------------------------------ */

export type TripStatus = "scheduled" | "filling" | "locked" | "departed" | "completed" | "cancelled";

export const TRIP_MACHINE: Machine<TripStatus> = {
  name: "Trip",
  states: ["scheduled", "filling", "locked", "departed", "completed", "cancelled"],
  transitions: {
    scheduled: ["filling", "locked", "cancelled"],
    filling: ["locked", "cancelled"],
    locked: ["departed", "cancelled"],
    departed: ["completed"],
    completed: [],
    cancelled: [],
  },
};

/* ------------------------------------------------------------------ */
/* MpesaTransaction                                                    */
/* ------------------------------------------------------------------ */

export type MpesaStatus = "pending" | "stk_push_sent" | "confirmed" | "failed" | "ambiguous";

export const MPESA_MACHINE: Machine<MpesaStatus> = {
  name: "MpesaTransaction",
  states: ["pending", "stk_push_sent", "confirmed", "failed", "ambiguous"],
  transitions: {
    pending: ["stk_push_sent", "confirmed", "failed", "ambiguous"],
    stk_push_sent: ["confirmed", "failed", "ambiguous"],
    // Terminal states accept no further writes: a late `failed` callback can
    // never overwrite a `confirmed` transaction (the CAS guard enforces this
    // at the DB level even if a caller forgets to check).
    confirmed: [],
    failed: [],
    ambiguous: ["confirmed", "failed"],
  },
};

/* ------------------------------------------------------------------ */
/* LedgerEntry                                                         */
/* ------------------------------------------------------------------ */

export type LedgerStatus =
  | "held" | "driver_payable" | "commission_taken" | "refunded"
  | "partially_refunded" | "converted_to_credit" | "partially_converted_to_credit" | "forfeited";

export const LEDGER_MACHINE: Machine<LedgerStatus> = {
  name: "LedgerEntry",
  states: [
    "held", "driver_payable", "commission_taken", "refunded",
    "partially_refunded", "converted_to_credit", "partially_converted_to_credit", "forfeited",
  ],
  transitions: {
    held: ["driver_payable", "commission_taken", "refunded", "partially_refunded",
      "converted_to_credit", "partially_converted_to_credit", "forfeited"],
    driver_payable: ["commission_taken", "refunded", "partially_refunded"],
    commission_taken: ["refunded", "partially_refunded", "forfeited"],
    refunded: [],
    partially_refunded: ["refunded"],
    converted_to_credit: [],
    partially_converted_to_credit: ["converted_to_credit"],
    forfeited: [],
  },
};

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

export type RefundRecordStatus = "pending" | "completed" | "failed";

export const REFUND_RECORD_MACHINE: Machine<RefundRecordStatus> = {
  name: "RefundRecord",
  states: ["pending", "completed", "failed"],
  transitions: {
    pending: ["completed", "failed"],
    completed: [],
    failed: [],
  },
};

export type RefundAttemptState = "submitting" | "processing" | "ambiguous" | "confirmed" | "failed";

export const REFUND_ATTEMPT_MACHINE: Machine<RefundAttemptState> = {
  name: "RefundAttempt",
  states: ["submitting", "processing", "ambiguous", "confirmed", "failed"],
  transitions: {
    submitting: ["processing", "ambiguous", "confirmed", "failed"],
    processing: ["ambiguous", "confirmed", "failed"],
    ambiguous: ["confirmed", "failed"],
    confirmed: [],
    failed: [],
  },
};

/* ------------------------------------------------------------------ */
/* Payouts                                                             */
/* ------------------------------------------------------------------ */

/**
 * PayoutRecord statuses actually written by the code. The schema comment
 * lists only queued|completed|failed; `processing`, `ambiguous` and
 * `needs_review` are real runtime values (beneficiary.ts, driver earnings)
 * and are documented here as the authoritative set.
 */
export type PayoutRecordStatus = "queued" | "processing" | "ambiguous" | "needs_review" | "completed" | "failed";

export const PAYOUT_RECORD_MACHINE: Machine<PayoutRecordStatus> = {
  name: "PayoutRecord",
  states: ["queued", "processing", "ambiguous", "needs_review", "completed", "failed"],
  transitions: {
    queued: ["processing", "completed", "failed"],
    processing: ["ambiguous", "completed", "failed", "needs_review"],
    ambiguous: ["completed", "failed", "needs_review"],
    needs_review: ["processing", "completed", "failed"],
    completed: [],
    failed: [],
  },
};

export type PayoutAttemptState = "submitting" | "processing" | "ambiguous" | "confirmed" | "failed";

export const PAYOUT_ATTEMPT_MACHINE: Machine<PayoutAttemptState> = {
  name: "PayoutAttempt",
  states: ["submitting", "processing", "ambiguous", "confirmed", "failed"],
  transitions: {
    submitting: ["processing", "ambiguous", "confirmed", "failed"],
    processing: ["ambiguous", "confirmed", "failed"],
    ambiguous: ["confirmed", "failed"],
    confirmed: [],
    failed: [],
  },
};

/* ------------------------------------------------------------------ */
/* Credits                                                             */
/* ------------------------------------------------------------------ */

export type CreditStatus = "active" | "redeemed" | "expired";

export const CREDIT_MACHINE: Machine<CreditStatus> = {
  name: "Credit",
  states: ["active", "redeemed", "expired"],
  transitions: {
    active: ["redeemed", "expired"],
    redeemed: [],
    expired: [],
  },
};

/* ------------------------------------------------------------------ */
/* Ticket email delivery                                               */
/* ------------------------------------------------------------------ */

export type TicketEmailStatus = "pending" | "sending" | "sent" | "failed" | "blocked" | "uncertain";

export const TICKET_EMAIL_MACHINE: Machine<TicketEmailStatus> = {
  name: "TicketEmailDelivery",
  states: ["pending", "sending", "sent", "failed", "blocked", "uncertain"],
  transitions: {
    pending: ["sending", "sent", "failed", "blocked", "uncertain"],
    // `sending` can fall back to pending so an orphaned send (crash between
    // mark-sending and the provider result) becomes retryable again.
    sending: ["sent", "failed", "blocked", "uncertain", "pending"],
    sent: [],
    failed: ["pending"],
    blocked: [],
    uncertain: ["pending", "sent"],
  },
};

/* ------------------------------------------------------------------ */
/* Driver                                                             */
/* ------------------------------------------------------------------ */

export type DriverStatus = "active" | "inactive" | "suspended";

export const DRIVER_MACHINE: Machine<DriverStatus> = {
  name: "Driver",
  states: ["active", "inactive", "suspended"],
  transitions: {
    active: ["inactive", "suspended"],
    inactive: ["active"],
    suspended: ["active", "inactive"],
  },
};

/* ------------------------------------------------------------------ */
/* DriverTripProgress (the original pattern this module generalizes)   */
/* ------------------------------------------------------------------ */

export type DriverPhase = "assigned" | "accepted" | "at_pickup" | "in_progress" | "completed" | "cancelled";

export const DRIVER_PHASE_MACHINE: Machine<DriverPhase> = {
  name: "DriverTripProgress",
  states: ["assigned", "accepted", "at_pickup", "in_progress", "completed", "cancelled"],
  transitions: {
    assigned: ["accepted", "cancelled"],
    accepted: ["at_pickup", "cancelled"],
    at_pickup: ["in_progress", "completed", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  },
};

/* ------------------------------------------------------------------ */
/* Support / destinations / applications                               */
/* ------------------------------------------------------------------ */

export type SupportCaseStatus = "open" | "resolved";

export const SUPPORT_CASE_MACHINE: Machine<SupportCaseStatus> = {
  name: "DriverSupportCase",
  states: ["open", "resolved"],
  transitions: {
    open: ["resolved"],
    resolved: ["open"],
  },
};

export type PayoutDestinationStatus = "pending_review" | "approved" | "rejected" | "disabled";

export const PAYOUT_DESTINATION_MACHINE: Machine<PayoutDestinationStatus> = {
  name: "DriverPayoutDestination",
  states: ["pending_review", "approved", "rejected", "disabled"],
  transitions: {
    pending_review: ["approved", "rejected"],
    approved: ["disabled"],
    rejected: ["pending_review"],
    disabled: ["approved"],
  },
};

export type ApplicationStatus = "draft" | "submitted" | "changes_requested" | "approved";

export const APPLICATION_MACHINE: Machine<ApplicationStatus> = {
  name: "DriverApplication",
  states: ["draft", "submitted", "changes_requested", "approved"],
  transitions: {
    draft: ["submitted"],
    submitted: ["changes_requested", "approved"],
    changes_requested: ["submitted", "approved"],
    approved: [],
  },
};

/* ------------------------------------------------------------------ */
/* Convenience: Prisma where fragments                                 */
/* ------------------------------------------------------------------ */

/** `status: { in: [...] }` fragment for CAS guards on a list of states. */
export function statusIn<S extends string>(states: readonly S[]): Prisma.StringFilter {
  return { in: [...states] } as Prisma.StringFilter;
}
