import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import * as daraja from "@/lib/daraja";
import type {Prisma} from "@prisma/client";
import {calculateSettlement} from "@/lib/payout-settlement";
import {DriverError} from "@/lib/driver/errors";
import { attemptBookingTicketEmail } from "@/lib/booking-ticket-email";

/**
 * The money engine.
 *
 * Principle: money is collected into the platform's own M-Pesa shortcode first
 * — it never goes directly to a driver. Every shilling is tracked in the
 * ledger as exactly one of:
 *   held | driver_payable | commission_taken | refunded | partially_refunded
 *   | converted_to_credit | forfeited
 *
 * The admin never touches these flows — they are config-driven and automatic.
 */

// ─── Config ──────────────────────────────────────────────────────────────────

export const NTSA_COMMISSION_CAP = 0.18;

export async function getConfig() {
  const cfg = await db.platformConfig.findUnique({ where: { id: "main" } });
  if (!cfg) throw new DriverError(503,"PLATFORM_NOT_CONFIGURED","Booking and settlement settings require operations setup.");
  return cfg;
}

// ─── Credits (travel vouchers — never cashed out) ────────────────────────────

export async function issueCredit(params: {
  passengerId: string;
  sourceBookingId?: string;
  amount: number;
  note?: string;
  validityDays: number;
}) {
  return db.credit.create({
    data: {
      passengerId: params.passengerId,
      sourceBookingId: params.sourceBookingId,
      amount: params.amount,
      initialAmount: params.amount,
      note: params.note,
      expiresAt: new Date(Date.now() + params.validityDays * 24 * 60 * 60 * 1000),
    },
  });
}

/** FIFO partial redemption across a passenger's active credits.
 *  Returns total applied; each credit is reduced (marked "redeemed" only once
 *  fully used). A credit is never cashed out — it only ever offsets fares. */
export async function applyCredits(
  passengerId: string,
  bookingId: string,
  needed: number
): Promise<number> {
  const credits = await db.credit.findMany({
    where: {
      passengerId,
      status: "active",
      amount: { gt: 0 },
      expiresAt: { gt: new Date() },
    },
    orderBy: { expiresAt: "asc" }, // use soonest-expiring first
  });
  let applied = 0;
  for (const c of credits) {
    if (applied >= needed) break;
    const take = Math.min(c.amount, needed - applied);
    if (take <= 0) continue;
    const remaining = c.amount - take;
    await db.credit.update({
      where: { id: c.id },
      data: {
        amount: remaining,
        status: remaining <= 0 ? "redeemed" : "active",
        redeemedAt: remaining <= 0 ? new Date() : null,
        redeemedBookingId: bookingId,
      },
    });
    applied += take;
  }
  return applied;
}

/** Restore a credit portion when a booking that used credit is cancelled
 *  early or by the platform (the passenger gave notice / wasn't at fault). */
export async function restoreCredit(params: {
  passengerId: string;
  sourceBookingId: string;
  amount: number;
  validityDays: number;
  note: string;
}) {
  if (params.amount <= 0) return null;
  return issueCredit({
    passengerId: params.passengerId,
    sourceBookingId: params.sourceBookingId,
    amount: params.amount,
    note: params.note,
    validityDays: params.validityDays,
  });
}

export async function expireStaleCredits(): Promise<number> {
  const res = await db.credit.updateMany({
    where: { status: "active", expiresAt: { lte: new Date() } },
    data: { status: "expired" },
  });
  return res.count;
}

// ─── Fare collection → ledger ────────────────────────────────────────────────

/** On STK success callback: create the ledger entry with status = held.
 *  This is money sitting in the platform shortcode, not yet belonging to
 *  anyone. Credit-funded value is recorded alongside for full-fare tracking
 *  but only `cashAmount` ever moved through M-Pesa. */
export async function recordCollection(params: {
  bookingId: string;
  tripId: string | null;
  totalAmount: number;
  cashAmount: number;
  creditApplied: number;
  homeSurchargeAmount: number;
  platformFeeAmount: number;
  mpesaReceipt: string | null;
}) {
  const existing = await db.ledgerEntry.findUnique({
    where: { bookingId: params.bookingId },
  });
  if (existing) return existing; // idempotent — never double-record a collection
  return db.ledgerEntry.create({
    data: {
      bookingId: params.bookingId,
      tripId: params.tripId,
      totalAmount: params.totalAmount,
      cashAmount: params.cashAmount,
      creditApplied: params.creditApplied,
      homeSurchargeAmount: params.homeSurchargeAmount,
      platformFeeAmount: params.platformFeeAmount,
      mpesaReceipt: params.mpesaReceipt,
      collectedAt: params.cashAmount > 0 ? new Date() : null,
      status: "held",
    },
  });
}

// ─── Refund tiers ────────────────────────────────────────────────────────────

export type RefundTier =
  | "early" // before trip lock → full cash refund
  | "late" // after lock, before departure → full fare converts to credit
  | "no_show" // never cancelled, never showed → forfeited
  | "platform_cancelled"; // platform/driver cancelled → full cash refund always

/** Resolves the tier from the booking/trip state + config (never hardcoded). */
export async function resolveRefundTier(bookingId: string): Promise<{
  tier: RefundTier | null;
  detail: string;
}> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { trip: true },
  });
  if (!booking) return { tier: null, detail: "Booking not found" };

  if (booking.status === "awaiting_payment")
    return { tier: null, detail: "Nothing collected yet — booking simply voids." };
  if (["cancelled", "completed", "no_show"].includes(booking.status))
    return { tier: null, detail: `Booking already ${booking.status}.` };

  const trip = booking.trip;
  if (!trip)
    return { tier: null, detail: "Booking not yet allocated to a trip — voids without refund." };

  if (trip.status === "cancelled")
    return { tier: "platform_cancelled", detail: "Trip was cancelled by the platform." };
  if (trip.status === "departed" || trip.status === "completed")
    return { tier: null, detail: "Trip already departed — cancellation window closed." };

  // Trip still pre-departure: lock state decides early vs late
  const locked = trip.status === "locked" || trip.lockedAt !== null;
  if (locked) return { tier: "late", detail: "Trip locked — late cancellation converts fare to credit." };
  return { tier: "early", detail: "Before lock — full cash refund." };
}

const REFUND_METHOD_WINDOW_MS = 24 * 60 * 60 * 1000; // Reversal works in a short window

/** Executes the cancellation outcome for a collected booking. */
export async function executeCancellation(params: {
  bookingId: string;
  actor: { id: string; name: string; role: "passenger" | "admin" | "system" };
  trigger:
    | "passenger_cancel"
    | "platform_cancel"
    | "trip_cancel_unboarded"
    | "admin_override"
    | "no_show_resolution";
  overrideAmount?: number; // admin_override partial refund
}): Promise<{ outcome: string; tier: RefundTier | null }> {
  const cfg = await getConfig();
  const booking = await db.booking.findUnique({
    where: { id: params.bookingId },
    include: { trip: true, ledgerEntry: true },
  });
  if (!booking) throw new Error("Booking not found");
  const entry = booking.ledgerEntry;

  // Nothing collected yet → just void the booking
  if (!entry) {
    await db.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled", cancelledAt: new Date(), cancelTier: "early" },
    });
    await audit({
      actorId: params.actor.id,
      actorName: params.actor.name,
      actorRole: params.actor.role,
      action: "booking.void_unpaid",
      entity: "booking",
      entityId: booking.id,
      metadata: { code: booking.code },
    });
    return { outcome: "voided_unpaid", tier: "early" };
  }

  let tier: RefundTier;
  if (params.trigger === "no_show_resolution") {
    tier = "no_show";
  } else if (params.trigger === "platform_cancel" || params.trigger === "trip_cancel_unboarded") {
    tier = "platform_cancelled";
  } else if (params.trigger === "admin_override") {
    tier = "late"; // override treated as a discretionary cash refund post-lock
  } else {
    const resolved = await resolveRefundTier(booking.id);
    if (!resolved.tier) throw new Error(resolved.detail);
    tier = resolved.tier;
  }

  const now = new Date();

  if (tier === "early" || tier === "platform_cancelled") {
    // Full cash refund — Reversal if inside the short window, else B2C
    const method =
      entry.collectedAt && now.getTime() - entry.collectedAt.getTime() < REFUND_METHOD_WINDOW_MS
        ? "reversal"
        : "b2c";
    const refund = await db.refundRecord.create({
      data: {
        ledgerEntryId: entry.id,
        bookingId: booking.id,
        amount: entry.cashAmount,
        creditRestored: entry.creditApplied,
        reason:
          tier === "platform_cancelled"
            ? "platform_cancelled"
            : "cancelled_early",
        method,
        status: "pending",
      },
    });

    if (entry.cashAmount > 0) {
      const result =
        method === "reversal"
          ? await daraja.reversal({ transactionId: entry.mpesaReceipt || booking.code, amount: entry.cashAmount })
          : await daraja.b2c({ receiverPhone: await passengerPhone(booking.passengerId), amount: entry.cashAmount });
      const ok = result.resultCode === daraja.RESULT_CODES.SUCCESS;
      await db.refundRecord.update({
        where: { id: refund.id },
        data: {
          status: ok ? "completed" : "failed",
          mpesaResultCode: result.resultCode,
          failureReason: ok ? null : result.resultDesc,
          completedAt: ok ? new Date() : null,
        },
      });
      await db.ledgerEntry.update({
        where: { id: entry.id },
        data: {
          status: ok ? "refunded" : "partially_refunded",
          statusChangedAt: new Date(),
        },
      });
    } else {
      // Credit-only booking: no cash to move, ledger simply releases the hold
      await db.refundRecord.update({
        where: { id: refund.id },
        data: { status: "completed", mpesaResultCode: daraja.RESULT_CODES.SUCCESS, completedAt: new Date() },
      });
      await db.ledgerEntry.update({
        where: { id: entry.id },
        data: { status: "refunded", statusChangedAt: new Date() },
      });
    }

    // Restore the credit portion (passenger gave notice / not at fault)
    await restoreCredit({
      passengerId: booking.passengerId,
      sourceBookingId: booking.id,
      amount: entry.creditApplied,
      validityDays: cfg.creditValidityDays,
      note: `Credit restored — refund on ${booking.code}`,
    });

    await db.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled", cancelledAt: now, cancelTier: tier },
    });
    await audit({
      actorId: params.actor.id,
      actorName: params.actor.name,
      actorRole: params.actor.role,
      action: tier === "platform_cancelled" ? "money.platform_refund" : "money.refund_early",
      entity: "booking",
      entityId: booking.id,
      metadata: { code: booking.code, amount: entry.cashAmount, method, tier },
    });
    return { outcome: "refunded", tier };
  }

  if (tier === "late") {
    if (params.trigger === "admin_override") {
      // Discretionary cash refund by admin (disputes) — amount from params
      const amount = Math.min(params.overrideAmount ?? entry.cashAmount, entry.cashAmount);
      const refund = await db.refundRecord.create({
        data: {
          ledgerEntryId: entry.id,
          bookingId: booking.id,
          amount,
          reason: "admin_override",
          method: "b2c",
          status: "pending",
        },
      });
      const result = await daraja.b2c({
        receiverPhone: await passengerPhone(booking.passengerId),
        amount,
      });
      const ok = result.resultCode === daraja.RESULT_CODES.SUCCESS;
      await db.refundRecord.update({
        where: { id: refund.id },
        data: {
          status: ok ? "completed" : "failed",
          mpesaResultCode: result.resultCode,
          failureReason: ok ? null : result.resultDesc,
          completedAt: ok ? new Date() : null,
        },
      });
      // Commission reversal is proportional — the platform never keeps a
      // commission on a refunded fare.
      const cfgC = await getConfig();
      const commissionableFare = Math.max(0, entry.totalAmount - entry.homeSurchargeAmount - entry.platformFeeAmount);
      const refundedShare = entry.totalAmount > 0 ? Math.min(1, amount / entry.totalAmount) : 0;
      const commissionReversed = booking.isCharter
        ? Math.round(commissionableFare * refundedShare * cfgC.commissionRate)
        : 0;
      const driverClawback = amount - commissionReversed;
      await db.refundRecord.update({
        where: { id: refund.id },
        data: { commissionReversed, driverClawback },
      });
      await db.ledgerEntry.update({
        where: { id: entry.id },
        data: {
          status: amount >= entry.cashAmount ? "refunded" : "partially_refunded",
          statusChangedAt: new Date(),
        },
      });
      await db.booking.update({
        where: { id: booking.id },
        data: { status: "cancelled", cancelledAt: now, cancelTier: "late" },
      });
      await audit({
        actorId: params.actor.id,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        action: "money.admin_override_refund",
        entity: "booking",
        entityId: booking.id,
        metadata: { code: booking.code, amount, commissionReversed, driverClawback },
      });
      return { outcome: "admin_refund", tier: "late" };
    }

    // Passenger late cancellation: NO cash moves — full fare converts to a
    // travel credit. The money stays on the platform as a liability, not a
    // payout, and the passenger never loses it.
    await issueCredit({
      passengerId: booking.passengerId,
      sourceBookingId: booking.id,
      amount: entry.totalAmount, // full fare: cash + credit portions
      note: `Late cancellation of ${booking.code} — fare saved as credit`,
      validityDays: cfg.creditValidityDays,
    });
    await db.ledgerEntry.update({
      where: { id: entry.id },
      data: { status: "converted_to_credit", statusChangedAt: new Date() },
    });
    await db.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled", cancelledAt: now, cancelTier: "late" },
    });
    await audit({
      actorId: params.actor.id,
      actorName: params.actor.name,
      actorRole: params.actor.role,
      action: "money.late_cancel_to_credit",
      entity: "booking",
      entityId: booking.id,
      metadata: {
        code: booking.code,
        creditIssued: entry.totalAmount,
        validDays: cfg.creditValidityDays,
      },
    });
    return { outcome: "converted_to_credit", tier: "late" };
  }

  // no_show — reached only via the completion engine
  await db.booking.update({
    where: { id: booking.id },
    data: { status: "no_show", cancelTier: "no_show" },
  });
  await db.ledgerEntry.update({
    where: { id: entry.id },
    data: { status: "forfeited", statusChangedAt: new Date() },
  });
  await audit({
    actorId: params.actor.id,
    actorName: params.actor.name,
    actorRole: params.actor.role,
    action: "money.no_show_forfeit",
    entity: "booking",
    entityId: booking.id,
    metadata: { code: booking.code, amount: entry.totalAmount },
  });
  return { outcome: "forfeited", tier: "no_show" };
}

async function passengerPhone(passengerId: string): Promise<string> {
  const p = await db.passenger.findUnique({ where: { id: passengerId } });
  return p?.phone || "";
}

// ─── Trip completion → payout records ────────────────────────────────────────

/** Fires when a trip is COMPLETED (service delivered) — never at booking,
 *  never at lock. Creates one payout record per booking manifest line. */
export async function onTripCompleted(tripId: string) {
  const cfg=await getConfig();
  const payoutIds=await db.$transaction(tx=>settleCompletedTrip(tx,tripId,cfg.commissionRate));
  if(cfg.payoutMode==="instant_per_trip")for(const id of payoutIds)await executePayout(id);
}

/** Also called inside a driver command transaction, so its receipt and money state commit together. */
export async function settleCompletedTrip(tx:Prisma.TransactionClient,tripId:string,commissionRate:number) {
    const trip=await tx.trip.findUnique({where:{id:tripId},include:{bookings:{include:{ledgerEntry:true}}}});
    if(!trip || trip.status!=="departed" || !trip.driverId)return [];
    if(trip.bookings.some(b=>b.status==="confirmed"))throw new Error("Resolve every passenger boarding outcome before completion.");
    const claimed=await tx.trip.updateMany({where:{id:tripId,status:"departed"},data:{status:"completed",completedAt:new Date()}});
    if(claimed.count!==1)return [];
    const ids:string[]=[];
    for(const booking of trip.bookings) {
      const entry=booking.ledgerEntry;
      if(booking.status!=="boarded" || !entry || entry.status!=="held")continue;
      const split=calculateSettlement(entry.totalAmount,entry.homeSurchargeAmount,entry.platformFeeAmount,Math.round(commissionRate*10000),booking.isCharter);
      // A partially boarded party needs an explicit operations decision about its fare.
      // Preserve the held funds and show the unsettled statement without guessing a refund policy.
      const needsReview=booking.noShowSeats>0;
      const payout=await tx.payoutRecord.create({data:{driverId:trip.driverId,tripId,ledgerEntryId:entry.id,
        grossFareTotal:split.gross,commissionAmount:split.commission,homeSurchargeAmount:split.surcharge,platformFeeAmount:split.platformFee,netPayoutAmount:split.net,status:needsReview?"needs_review":"queued",
        failureReason:needsReview?"Partial party no-show: settlement requires operations review.":null}});
      if(!needsReview)await tx.ledgerEntry.update({where:{id:entry.id},data:{status:"driver_payable",statusChangedAt:new Date()}});
      await tx.booking.update({where:{id:booking.id},data:{status:"completed"}});
      if(!needsReview)ids.push(payout.id);
    }
    await tx.auditLog.create({data:{actorId:"system",actorRole:"system",actorName:"Settlement service",action:"trip.completed",entity:"trip",entityId:tripId,metadata:JSON.stringify({payoutsCreated:ids.length})}});
    return ids;
}

/** Executes one queued payout via B2C. Failure flags for admin review —
 *  never silently retried against a possibly bad number. */
export async function executePayout(payoutId: string): Promise<boolean> {
  const {sendPayout}=await import("@/lib/payout-settlement");
  return sendPayout(payoutId);
}

/** Queued records are the durable jobs; request completion is only a prompt to drain them. */
export async function dispatchInstantPayouts(driverId:string,tripId:string) {
  const cfg=await getConfig();if(cfg.payoutMode!=="instant_per_trip")return;
  const records=await db.payoutRecord.findMany({where:{driverId,tripId,status:"queued"},take:100});
  for(const record of records)try{await executePayout(record.id);}catch(error){
    await db.payoutRecord.updateMany({where:{id:record.id,status:"queued"},data:{failureReason:error instanceof DriverError?error.message:"Transfer preparation requires operations review."}});
  }
}

/** Uses durable, individually correlated transfer attempts; never treats provider acceptance as payment. */
export async function runPayoutBatch(actor: {id:string;name:string;role:"passenger"|"admin"|"system"}) {
  const records=await db.payoutRecord.findMany({where:{status:"queued"},take:100,orderBy:{initiatedAt:"asc"}});
  const drivers=new Set(records.map(p=>p.driverId));
  const counts={drivers:drivers.size,completed:0,failed:0,processing:0,ambiguous:0,deferred:0};
  for(const record of records) {
    try{await executePayout(record.id);}catch(error){
      await db.payoutRecord.updateMany({where:{id:record.id,status:"queued"},data:{failureReason:error instanceof DriverError?error.message:"Transfer preparation requires operations review."}});
    }
    const current=await db.payoutRecord.findUnique({where:{id:record.id}});
    if(current?.status==="queued")counts.deferred++;
    if(current && current.status in counts && current.status!=="drivers") counts[current.status as "completed"|"failed"|"processing"|"ambiguous"]++;
  }
  if(counts.deferred===0)await db.platformConfig.update({where:{id:"main"},data:{lastPayoutRunAt:new Date()}});
  await audit({actorId:actor.id,actorName:actor.name,actorRole:actor.role,action:"money.payout_batch_run",entity:"system",entityId:"batch",metadata:counts});
  return counts;
}

/** Is recovery work needed for after-trip payouts? Legacy batch modes remain migration-only. */
export async function isPayoutBatchDue(): Promise<{ due: boolean; mode: string; note: string }> {
  const cfg = await getConfig();
  if (cfg.payoutMode === "instant_per_trip")
    return { due:await db.payoutRecord.count({where:{status:"queued"}})>0, mode:cfg.payoutMode,note:"Completion prompts transfer dispatch; sweeps recover queued records. Provider confirmation is still required." };
  const now = new Date();
  if (cfg.payoutMode === "daily") {
    const last = cfg.lastPayoutRunAt;
    const due = !last || now.getTime() - last.getTime() >= 20 * 60 * 60 * 1000;
    return { due, mode: "daily", note: due ? "Daily batch due." : "Already run today." };
  }
  // weekly
  const due = now.getUTCDay() === cfg.payoutDay;
  const last = cfg.lastPayoutRunAt;
  const alreadyThisWeek =
    last && now.getTime() - last.getTime() < 6 * 24 * 60 * 60 * 1000;
  return {
    due: due && !alreadyThisWeek,
    mode: "weekly",
    note: due
      ? alreadyThisWeek
        ? "Batch day — already ran this week."
        : "Payout batch due."
      : `Runs on day ${cfg.payoutDay} of the week.`,
  };
}

// ─── Reconciliation sweep (the nightly job) ──────────────────────────────────

/** Never rely on the callback alone. This sweep resolves any booking left in
 *  an ambiguous state so a missed webhook never silently loses a passenger's
 *  paid seat or a driver's payout trigger. */
export async function runReconciliationSweep(
  actor: { id: string; name: string; role: "passenger" | "admin" | "system" }
) {
  const cfg = await getConfig();
  const now = new Date();
  const summary = {
    recoveredPayments: 0,
    failedPayments: 0,
    completedRefunds: 0,
    flaggedStuckRefunds: 0,
    expiredCredits: 0,
  };

  // 1. Ambiguous STK pushes older than the sweep threshold
  const cutoff = new Date(now.getTime() - cfg.sweepPendingMinutes * 60 * 1000);
  const ambiguous = await db.mpesaTransaction.findMany({
    where: { status: { in: ["stk_push_sent", "pending", "ambiguous"] }, createdAt: { lte: cutoff } },
  });
  for (const tx of ambiguous) {
    const statusResult = await daraja.transactionStatus(tx.checkoutRequestId);
    if (statusResult.pending) {
      // Live mode: Daraja has no terminal result yet — leave it for the next sweep.
      continue;
    }
    const ok = statusResult.resultCode === daraja.RESULT_CODES.SUCCESS;
    if (ok && statusResult.mpesaReceipt) {
      await db.mpesaTransaction.update({
        where: { id: tx.id },
        data: {
          status: "confirmed",
          resultCode: statusResult.resultCode,
          resultDesc: statusResult.resultDesc,
          mpesaReceipt: statusResult.mpesaReceipt,
          confirmedAt: now,
        },
      });
      const applied = await confirmBookingPayment(tx.bookingId, {
        receipt: statusResult.mpesaReceipt,
        checkoutRequestId: tx.checkoutRequestId,
      });
      if (applied) summary.recoveredPayments++;
    } else {
      await db.mpesaTransaction.update({
        where: { id: tx.id },
        data: { status: "failed", resultCode: daraja.RESULT_CODES.CANCELLED, resultDesc: "No confirmation — treated as cancelled" },
      });
      summary.failedPayments++;
    }
  }

  // 2. Refunds stuck in pending — give them a terminal state or flag
  const pendingRefunds = await db.refundRecord.findMany({ where: { status: "pending" } });
  for (const r of pendingRefunds) {
    const stuck = now.getTime() - r.initiatedAt.getTime() > cfg.stuckRefundHours * 60 * 60 * 1000;
    if (stuck) {
      await db.refundRecord.update({
        where: { id: r.id },
        data: { stuckFlaggedAt: now },
      });
      summary.flaggedStuckRefunds++;
    }
  }
  // Prototype: sweep also completes pending reversals/b2c (simulated callback)
  const completable = await db.refundRecord.findMany({
    where: { status: "pending", stuckFlaggedAt: null },
    take: 20,
  });
  for (const r of completable) {
    // Prototype: the refund callback arrives — give it its terminal state.
    await db.refundRecord.update({
      where: { id: r.id },
      data: { status: "completed", mpesaResultCode: daraja.RESULT_CODES.SUCCESS, completedAt: now },
    });
    await db.ledgerEntry.update({
      where: { id: r.ledgerEntryId },
      data: { status: "refunded", statusChangedAt: now },
    });
    summary.completedRefunds++;
  }

  // 3. Expire stale credits
  summary.expiredCredits = await expireStaleCredits();

  await db.platformConfig.update({
    where: { id: "main" },
    data: { lastReconciliationAt: now },
  });
  await audit({
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: "money.reconciliation_sweep",
    entity: "system",
    entityId: "sweep",
    metadata: summary,
  });
  return summary;
}

// ─── Payment confirmation (shared by verify step + sweep) ────────────────────

export async function confirmBookingPayment(
  bookingId: string,
  tx: { receipt: string; checkoutRequestId: string }
): Promise<boolean> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { ledgerEntry: true },
  });
  if (!booking) return false;
  if (booking.status === "awaiting_payment") {
    await db.booking.update({
      where: { id: bookingId },
      data: { status: "confirmed" },
    });
  }
  await recordCollection({
    bookingId: booking.id,
    tripId: booking.tripId,
    totalAmount: booking.fareAmount,
    cashAmount: booking.cashDue,
    creditApplied: booking.creditApplied,
    homeSurchargeAmount: booking.homeSurcharge,
    platformFeeAmount: booking.platformFeeAmount,
    mpesaReceipt: tx.receipt,
  });
  await audit({
    actorId: booking.passengerId,
    actorName: "Passenger",
    actorRole: "passenger",
    action: "payment.confirm",
    entity: "booking",
    entityId: booking.id,
    metadata: { receipt: tx.receipt, amount: booking.cashDue },
  });
  await attemptBookingTicketEmail(booking.id);
  return true;
}
