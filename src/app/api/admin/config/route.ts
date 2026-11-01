import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { getConfig, NTSA_COMMISSION_CAP } from "@/lib/money";
import { audit } from "@/lib/audit";

/** Platform config — the levers the admin is allowed to touch. */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = await getConfig();
  return NextResponse.json({
    config: {
      commissionRate: cfg.commissionRate,
      bookingFeeAmount: cfg.bookingFeeAmount,
      fullRefundCutoffMinutes: cfg.fullRefundCutoffMinutes,
      seatFillThresholdPercent: cfg.seatFillThresholdPercent,
      creditValidityDays: cfg.creditValidityDays,
      payoutMode: cfg.payoutMode,
      payoutDay: cfg.payoutDay,
      stuckRefundHours: cfg.stuckRefundHours,
      stuckPayoutHours: cfg.stuckPayoutHours,
      sweepPendingMinutes: cfg.sweepPendingMinutes,
      unpaidBookingHoldMinutes: cfg.unpaidBookingHoldMinutes,
      tripHorizonDays: cfg.tripHorizonDays,
      bookingWindowMinutes: cfg.bookingWindowMinutes,
      terminusArrivalBufferMinutes: cfg.terminusArrivalBufferMinutes,
      trainMeetBufferMinutes: cfg.trainMeetBufferMinutes,
      adminEmails: JSON.parse(cfg.adminEmails),
      admin2faCode: cfg.admin2faCode,
    },
    ntsaCap: NTSA_COMMISSION_CAP,
    lastPayoutRunAt: cfg.lastPayoutRunAt,
    lastReconciliationAt: cfg.lastReconciliationAt,
  });
}

export async function PUT(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const cfg = await getConfig();
  const data: Record<string, unknown> = {};

  if (body.commissionRate !== undefined) {
    const rate = Number(body.commissionRate);
    if (Number.isNaN(rate) || rate < 0) {
      return NextResponse.json({ error: "Commission rate must be a positive number" }, { status: 400 });
    }
    if (rate > NTSA_COMMISSION_CAP) {
      return NextResponse.json(
        { error: `Commission must stay under the NTSA cap of ${(NTSA_COMMISSION_CAP * 100).toFixed(0)}%` },
        { status: 400 }
      );
    }
    data.commissionRate = rate;
  }
  if (body.bookingFeeAmount !== undefined) {
    const amount = Number(body.bookingFeeAmount);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10000) {
      return NextResponse.json({ error: "Booking fee must be a whole KSh amount from 0 to 10,000" }, { status: 400 });
    }
    data.bookingFeeAmount = amount;
  }
  if (body.fullRefundCutoffMinutes !== undefined) {
    const v = parseInt(body.fullRefundCutoffMinutes, 10);
    if (Number.isNaN(v) || v < 0 || v > 24 * 60) return NextResponse.json({ error: "Cutoff must be 0–1440 minutes" }, { status: 400 });
    data.fullRefundCutoffMinutes = v;
  }
  if (body.seatFillThresholdPercent !== undefined) {
    const v = parseInt(body.seatFillThresholdPercent, 10);
    if (Number.isNaN(v) || v < 0 || v > 100) return NextResponse.json({ error: "Seat fill threshold must be 0–100%" }, { status: 400 });
    data.seatFillThresholdPercent = v;
  }
  if (body.creditValidityDays !== undefined) {
    const v = parseInt(body.creditValidityDays, 10);
    if (Number.isNaN(v) || v < 1 || v > 365) return NextResponse.json({ error: "Credit validity must be 1–365 days" }, { status: 400 });
    data.creditValidityDays = v;
  }
  if (body.payoutMode !== undefined) {
    if (body.payoutMode !== "instant_per_trip") {
      return NextResponse.json({ error: "Driver payouts are configured to start after each completed trip." }, { status: 400 });
    }
    data.payoutMode = "instant_per_trip";
  }
  if (body.payoutDay !== undefined) {
    const v = parseInt(body.payoutDay, 10);
    if (Number.isNaN(v) || v < 0 || v > 6) return NextResponse.json({ error: "payoutDay must be 0 (Sun) – 6 (Sat)" }, { status: 400 });
    data.payoutDay = v;
  }
  if (body.stuckRefundHours !== undefined) {
    const v = parseInt(body.stuckRefundHours, 10);
    if (Number.isNaN(v) || v < 1 || v > 72) return NextResponse.json({ error: "Stuck-refund threshold must be 1–72 hours" }, { status: 400 });
    data.stuckRefundHours = v;
  }
  if (body.stuckPayoutHours !== undefined) {
    const v = parseInt(body.stuckPayoutHours, 10);
    if (Number.isNaN(v) || v < 1 || v > 168) return NextResponse.json({ error: "Stuck-payout threshold must be 1–168 hours" }, { status: 400 });
    data.stuckPayoutHours = v;
  }
  if (body.sweepPendingMinutes !== undefined) {
    const v = parseInt(body.sweepPendingMinutes, 10);
    if (Number.isNaN(v) || v < 1 || v > 120) return NextResponse.json({ error: "Sweep threshold must be 1–120 minutes" }, { status: 400 });
    data.sweepPendingMinutes = v;
  }
  if (body.unpaidBookingHoldMinutes !== undefined) {
    const v = parseInt(body.unpaidBookingHoldMinutes, 10);
    if (Number.isNaN(v) || v < 1 || v > 120) return NextResponse.json({ error: "Unpaid booking hold must be 1–120 minutes" }, { status: 400 });
    data.unpaidBookingHoldMinutes = v;
  }
  if (body.tripHorizonDays !== undefined) {
    const v = parseInt(body.tripHorizonDays, 10);
    if (Number.isNaN(v) || v < 1 || v > 14) return NextResponse.json({ error: "Trip horizon must be 1–14 days" }, { status: 400 });
    data.tripHorizonDays = v;
  }
  if (body.bookingWindowMinutes !== undefined) {
    const v = parseInt(body.bookingWindowMinutes, 10);
    if (Number.isNaN(v) || v < 0 || v > 240) return NextResponse.json({ error: "Booking window must be 0–240 minutes" }, { status: 400 });
    data.bookingWindowMinutes = v;
  }
  if (body.terminusArrivalBufferMinutes !== undefined) {
    const v = parseInt(body.terminusArrivalBufferMinutes, 10);
    if (Number.isNaN(v) || v < 0 || v > 180) return NextResponse.json({ error: "Terminus arrival buffer must be 0–180 minutes" }, { status: 400 });
    data.terminusArrivalBufferMinutes = v;
  }
  if (body.trainMeetBufferMinutes !== undefined) {
    const v = parseInt(body.trainMeetBufferMinutes, 10);
    if (Number.isNaN(v) || v < 0 || v > 180) return NextResponse.json({ error: "Train meet buffer must be 0–180 minutes" }, { status: 400 });
    data.trainMeetBufferMinutes = v;
  }
  if (Array.isArray(body.adminEmails)) {
    const emails = body.adminEmails.map((e: string) => String(e).trim().toLowerCase()).filter(Boolean);
    data.adminEmails = JSON.stringify(emails);
  }
  if (body.admin2faCode) {
    data.admin2faCode = String(body.admin2faCode).trim();
  }

  const updated = await db.platformConfig.update({ where: { id: cfg.id }, data });
  await audit({
    actorId: session.id,
    actorName: session.name,
    actorRole: "admin",
    action: "config.update",
    entity: "config",
    entityId: "main",
    metadata: data,
  });
  return NextResponse.json({ ok: true, config: updated });
}
