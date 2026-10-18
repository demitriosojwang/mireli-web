import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPassengerSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import {
  confirmBookingPayment,
  executeCancellation,
  resolveRefundTier,
} from "@/lib/money";
import * as daraja from "@/lib/daraja";
import { isBookingReadyForPayment } from "@/lib/booking-payment-eligibility";

type Params = { params: Promise<{ id: string }> };

/** Refund-tier quote for the cancel dialog (policy is config-driven). */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getPassengerSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const booking = await db.booking.findUnique({
    where: { id },
    include: { ledgerEntry: true, trip: true },
  });
  if (!booking || booking.passengerId !== session.id) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  const cfg = await getConfigQuick();
  const { tier, detail } = await resolveRefundTier(id);
  return NextResponse.json({
    code: booking.code,
    tier,
    detail,
    cashDue: booking.cashDue,
    creditApplied: booking.creditApplied,
    creditValidityDays: cfg.creditValidityDays,
    policy: {
      early: "Full cash refund to your M-Pesa.",
      late: `No cash refund — your full fare converts to travel credit, valid ${cfg.creditValidityDays} days.`,
      no_show: "Fare forfeited — the seat was held and the driver went to the stage for it.",
      platform_cancelled: "Full cash refund always, regardless of timing.",
    },
  });
}

async function getConfigQuick() {
  const { getConfig } = await import("@/lib/money");
  return getConfig();
}

/** Booking actions: pay (STK push), verify, cancel, check-in. */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getPassengerSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  const booking = await db.booking.findUnique({
    where: { id },
    include: { ledgerEntry: true, trip: { include: { driver: true } } },
  });
  if (!booking || booking.passengerId !== session.id) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  const actor = { id: session.id, name: session.name, role: "passenger" as const };

  /** Driver contact is revealed with the receipt once the fare is settled. */
  const driverContact = () =>
    booking.trip?.driver
      ? { name: booking.trip.driver.name, plate: booking.trip.driver.plate, phone: booking.trip.driver.phone }
      : null;

  // ── Pay: initiate STK push for the residual cash ──────────────────────────
  if (action === "pay") {
    if (booking.status !== "awaiting_payment" || booking.cashDue <= 0) {
      return NextResponse.json({ error: "Nothing to pay on this booking" }, { status: 400 });
    }
    if (!isBookingReadyForPayment(booking)) {
      return NextResponse.json(
        { error: "An active driver and future departure are not secured for this booking. No payment request was sent." },
        { status: 409 },
      );
    }
    const phoneRaw = String(body.phone || "");
    const { normalizePhone } = await import("@/lib/session");
    const phone = normalizePhone(phoneRaw);
    if (!phone) return NextResponse.json({ error: "Enter a valid M-Pesa number (07XX or 2547XX)" }, { status: 400 });

    // Persist an idempotent intent before contacting Daraja. Lock the booking
    // row so simultaneous taps cannot each initiate a separate charge.
    const attempt = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
      const live = await tx.mpesaTransaction.findFirst({
        where: { bookingId: booking.id, status: { in: ["pending", "stk_push_sent", "ambiguous"] } },
        orderBy: { createdAt: "desc" },
      });
      if (live) return { transaction: live, created: false };

      const intentReference = `${daraja.PAYMENT_INTENT_PREFIX}${randomUUID()}`;
      const transaction = await tx.mpesaTransaction.create({
        data: {
          bookingId: booking.id,
          phone,
          amount: booking.cashDue,
          checkoutRequestId: intentReference,
          merchantRequestId: `intent-${randomUUID()}`,
          status: "pending",
        },
      });
      return { transaction, created: true };
    });

    if (!attempt.created) {
      const existing = attempt.transaction;
      const unresolved = daraja.isPaymentIntentId(existing.checkoutRequestId) || existing.status === "ambiguous";
      return NextResponse.json({
        ok: true,
        amount: existing.amount,
        phone: existing.phone,
        reused: true,
        paymentPending: unresolved || existing.status === "pending",
        message: unresolved || existing.status === "pending"
          ? "An earlier M-Pesa request is still being checked. Please do not start another payment."
          : undefined,
      });
    }

    const tx = attempt.transaction;
    const push = await daraja.stkPush(phone, booking.cashDue, booking.code, tx.id);
    if (!push.ok || !push.checkoutRequestId) {
      const uncertain = push.responseCode === daraja.RESULT_CODES.TIMEOUT || push.ok;
      await db.mpesaTransaction.updateMany({
        where: { id: tx.id, status: "pending" },
        data: {
          status: uncertain ? "ambiguous" : "failed",
          resultCode: push.responseCode,
          resultDesc: push.responseDescription,
        },
      });
      if (uncertain) {
        return NextResponse.json({
          ok: true,
          paymentPending: true,
          amount: booking.cashDue,
          phone,
          message: "The M-Pesa request may still be processing. Do not pay again; check your phone and use Verify shortly.",
        });
      }
      await audit({
        actorId: session.id,
        actorName: session.name,
        actorRole: "passenger",
        action: "payment.push_rejected",
        entity: "booking",
        entityId: booking.id,
        metadata: { code: booking.code, amount: booking.cashDue, phone, responseCode: push.responseCode, desc: push.responseDescription },
      });
      return NextResponse.json({ error: push.responseDescription || "M-Pesa rejected the payment request" }, { status: 400 });
    }
    await db.mpesaTransaction.updateMany({
      where: { id: tx.id, checkoutRequestId: tx.checkoutRequestId, status: "pending" },
      data: {
        checkoutRequestId: push.checkoutRequestId,
        merchantRequestId: push.merchantRequestId,
        status: "stk_push_sent",
      },
    });
    await audit({
      actorId: session.id,
      actorName: session.name,
      actorRole: "passenger",
      action: "payment.initiate",
      entity: "booking",
      entityId: booking.id,
      metadata: { code: booking.code, amount: booking.cashDue, phone },
    });
    return NextResponse.json({ ok: true, amount: booking.cashDue, phone });
  }

  // ── Verify: the customer acted on the prompt → poll the result ────────────
  // Live mode polls Daraja's stkpushquery; demo mode auto-confirms. With no
  // pending push (Paybill path) the demo simulates the C2B confirmation,
  // live mode waits for the real C2B webhook to land.
  if (action === "verify") {
    if (booking.status === "awaiting_payment" && !isBookingReadyForPayment(booking)) {
      return NextResponse.json(
        { error: "An active driver and future departure are not secured for this booking. Payment cannot be confirmed yet." },
        { status: 409 },
      );
    }
    const tx = await db.mpesaTransaction.findFirst({
      where: { bookingId: booking.id, status: { in: ["stk_push_sent", "pending", "ambiguous"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!tx) {
      // Maybe already confirmed (sweep or webhook got there first)
      if (booking.status === "confirmed" && booking.ledgerEntry) {
        return NextResponse.json({ ok: true, alreadyConfirmed: true, receipt: booking.ledgerEntry.mpesaReceipt, driver: driverContact() });
      }
      const unmatchedPaybill = await db.mpesaTransaction.findFirst({
        where: { bookingId: booking.id, merchantRequestId: { startsWith: "c2b-" }, status: "failed" },
        orderBy: { createdAt: "desc" },
      });
      if (unmatchedPaybill) {
        const supportEmail = process.env.MIRELI_SUPPORT_EMAIL?.trim() || "mirelisgr001@gmail.com";
        const error = unmatchedPaybill.amount > 0
          ? `We received a Paybill payment of KSh ${unmatchedPaybill.amount}, but this booking requires exactly KSh ${booking.cashDue}. Please contact ${supportEmail} with reference ${booking.code} before paying again.`
          : `We received a Paybill receipt for this booking that could not be matched to its fare. Please contact ${supportEmail} with reference ${booking.code} before paying again.`;
        return NextResponse.json({ error, paymentNeedsReview: true }, { status: 409 });
      }
      const creds = await daraja.resolveDaraja();
      if (creds.mode === "mock") {
        const receipt = daraja.generateMpesaReceipt();
        await db.mpesaTransaction.create({
          data: {
            bookingId: booking.id,
            phone: "paybill",
            amount: booking.cashDue,
            checkoutRequestId: daraja.generateCheckoutRequestId(),
            merchantRequestId: daraja.generateMerchantRequestId(),
            status: "confirmed",
            resultCode: daraja.RESULT_CODES.SUCCESS,
            resultDesc: "Paybill payment confirmed (demo simulation)",
            mpesaReceipt: receipt,
            confirmedAt: new Date(),
          },
        });
        await confirmBookingPayment(booking.id, { receipt, checkoutRequestId: `pb-${booking.code}` });
        return NextResponse.json({ ok: true, receipt, amount: booking.cashDue, driver: driverContact() });
      }
      return NextResponse.json(
        { error: "We can't see your payment yet — it usually lands within a minute. Try again shortly." },
        { status: 409 },
      );
    }
    if (daraja.isPaymentIntentId(tx.checkoutRequestId)) {
      return NextResponse.json(
        { error: "M-Pesa is still confirming this request. Do not pay again; wait briefly and check your phone before retrying.", paymentPending: true },
        { status: 409 },
      );
    }
    const result = await daraja.queryStkResult(tx.checkoutRequestId);
    if (result.pending) {
      return NextResponse.json(
        { error: "Payment not completed yet — check your phone and try again in a moment." },
        { status: 409 },
      );
    }
    if (result.resultCode !== daraja.RESULT_CODES.SUCCESS || !result.mpesaReceipt) {
      await db.mpesaTransaction.update({
        where: { id: tx.id },
        data: {
          status: "failed",
          resultCode: result.resultCode || daraja.RESULT_CODES.CANCELLED,
          resultDesc: result.resultDesc,
        },
      });
      return NextResponse.json({ error: result.resultDesc || "The M-Pesa prompt was not completed" }, { status: 402 });
    }
    await db.mpesaTransaction.update({
      where: { id: tx.id },
      data: {
        status: "confirmed",
        resultCode: result.resultCode,
        resultDesc: result.resultDesc,
        mpesaReceipt: result.mpesaReceipt,
        confirmedAt: new Date(),
      },
    });
    await confirmBookingPayment(booking.id, {
      receipt: result.mpesaReceipt,
      checkoutRequestId: tx.checkoutRequestId,
    });
    const fresh = await db.booking.findUnique({ where: { id: booking.id }, include: { ledgerEntry: true } });
    return NextResponse.json({
      ok: true,
      receipt: result.mpesaReceipt,
      amount: booking.cashDue,
      status: fresh?.status,
      ledgerStatus: fresh?.ledgerEntry?.status,
      driver: driverContact(),
    });
  }

  // ── Cancel: resolve the config-driven tier and execute ───────────────────
  if (action === "cancel") {
    if (!["awaiting_payment", "confirmed", "boarded"].includes(booking.status)) {
      return NextResponse.json({ error: "This booking can no longer be cancelled" }, { status: 400 });
    }
    if (booking.trip && ["departed", "completed"].includes(booking.trip.status)) {
      return NextResponse.json({ error: "Trip already departed — cancellation window closed" }, { status: 400 });
    }
    const result = await executeCancellation({ bookingId: booking.id, actor, trigger: "passenger_cancel" });
    const messages: Record<string, string> = {
      voided_unpaid: "Booking cancelled — nothing was collected.",
      refunded: "Full cash refund sent to your M-Pesa.",
      refund_pending: "Your booking is cancelled. Your M-Pesa refund is processing and will be confirmed after Safaricom responds.",
      refund_failed: "Your booking is cancelled, but the M-Pesa refund needs support review. Please contact Mireli support.",
      converted_to_credit: "Your fare is saved as travel credit for your next ride.",
      forfeited: "Fare forfeited.",
    };
    return NextResponse.json({ ok: true, ...result, message: messages[result.outcome] || result.outcome });
  }

  // ── Check in at the stage (prevents the no-show tier) ─────────────────────
  if (action === "checkin") {
    if (booking.status !== "confirmed") {
      return NextResponse.json({ error: "Only confirmed bookings can check in" }, { status: 400 });
    }
    if (booking.trip && ["departed", "completed", "cancelled"].includes(booking.trip.status)) {
      return NextResponse.json({ error: "Trip is no longer boarding" }, { status: 400 });
    }
    await db.booking.update({
      where: { id: booking.id },
      data: { status: "boarded", checkedInAt: new Date() },
    });
    await audit({
      actorId: session.id,
      actorName: session.name,
      actorRole: "passenger",
      action: "booking.checkin",
      entity: "booking",
      entityId: booking.id,
      metadata: { code: booking.code },
    });
    return NextResponse.json({ ok: true, message: "Checked in — the driver will meet you at your pickup point." });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
