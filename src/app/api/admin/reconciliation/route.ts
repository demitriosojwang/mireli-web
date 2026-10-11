import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { runReconciliationSweep } from "@/lib/money";
import {
  setPayoutFailureInjection,
  setRefundFailureInjection,
} from "@/lib/daraja";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";

/**
 * Reconciliation — the admin's spot-check surface for the nightly sweep:
 * ambiguous payments, failed Daraja transactions, stuck items, and the
 * daily commission-vs-payout bookkeeping summary.
 */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cfg = await getConfigQuick();
  const now = new Date();

  // MpesaTransaction → Booking join is done manually so the route works
  // regardless of generated-client version.
  async function attachBookings<T extends { bookingId: string }>(txs: T[]) {
    const bookings = await db.booking.findMany({
      where: { id: { in: [...new Set(txs.map((t) => t.bookingId))] } },
      include: { passenger: true },
    });
    const byId = new Map(bookings.map((b) => [b.id, b]));
    return txs.map((t) => ({ tx: t, booking: byId.get(t.bookingId) }));
  }

  const ambiguousRaw = await db.mpesaTransaction.findMany({
    where: { status: { in: ["stk_push_sent", "pending", "ambiguous"] } },
    orderBy: { createdAt: "desc" },
  });
  const failedTxRaw = await db.mpesaTransaction.findMany({
    where: { status: "failed" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const recentRaw = await db.mpesaTransaction.findMany({
    where: { status: "confirmed" },
    orderBy: { confirmedAt: "desc" },
    take: 10,
  });
  const ambiguous = await attachBookings(ambiguousRaw);
  const failedTx = await attachBookings(failedTxRaw);
  const recentlyConfirmed = await attachBookings(recentRaw);

  // Daily bookkeeping: last 7 days commission earned vs payouts made
  const payouts = await db.payoutRecord.findMany({ where: { status: "completed",settlementVerified:true } });
  const days: { date: string; commission: number; paidOut: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const start = new Date(d); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const inDay = payouts.filter((p) => p.completedAt && p.completedAt >= start && p.completedAt < end);
    days.push({
      date: start.toISOString().slice(0, 10),
      commission: inDay.reduce((s, p) => s + p.commissionAmount, 0),
      paidOut: inDay.reduce((s, p) => s + p.netPayoutAmount, 0),
    });
  }

  const stuckRefunds = await db.refundRecord.count({ where: { stuckFlaggedAt: { not: null } } });
  const pendingRefunds = await db.refundRecord.count({ where: { status: "pending" } });
  const failedPayouts = await db.payoutRecord.count({ where: { status: "failed" } });
  const failedRefunds = await db.refundRecord.count({ where: { status: "failed" } });

  return NextResponse.json({
    simulation: isLocalDemoEnabled(),
    lastReconciliationAt: cfg.lastReconciliationAt,
    sweepPendingMinutes: cfg.sweepPendingMinutes,
    counts: { ambiguous: ambiguous.length, stuckRefunds, pendingRefunds, failedPayouts, failedRefunds, failedTx: failedTx.length },
    daily: days,
    ambiguous: ambiguous.map(({ tx: t, booking }) => ({
      id: t.id,
      code: booking?.code || "?",
      passenger: booking?.passenger.name || "?",
      phone: t.phone,
      amount: t.amount,
      status: t.status,
      ageMinutes: Math.round((now.getTime() - t.createdAt.getTime()) / 60000),
      createdAt: t.createdAt,
    })),
    failedTransactions: failedTx.map(({ tx: t, booking }) => ({
      id: t.id,
      code: booking?.code || "?",
      passenger: booking?.passenger.name || "?",
      amount: t.amount,
      result: t.resultCode,
      desc: t.resultDesc,
      createdAt: t.createdAt,
    })),
    recentConfirmed: recentlyConfirmed.map(({ tx: t, booking }) => ({
      id: t.id,
      code: booking?.code || "?",
      passenger: booking?.passenger.name || "?",
      amount: t.amount,
      receipt: t.mpesaReceipt,
      confirmedAt: t.confirmedAt,
    })),
  });
}

/** Reconciliation actions. */
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const actor = { id: session.id, name: session.name, role: "admin" as const };

  if (
    ["simulate_missed_callback", "inject_refund_failure", "inject_payout_failure"].includes(body.action) &&
    !isLocalDemoEnabled()
  ) {
    return NextResponse.json({ error: "Simulation tools are available only in the local demo." }, { status: 404 });
  }

  if (body.action === "sweep") {
    const summary = await runReconciliationSweep(actor);
    return NextResponse.json({ ok: true, summary });
  }

  if (body.action === "simulate_missed_callback") {
    // Pick the oldest unverified STK push and mark it ambiguous — simulating
    // a webhook that never arrived even though the customer PAID. The sweep
    // then recovers it via the Transaction Status API.
    const tx = await db.mpesaTransaction.findFirst({
      where: { status: "stk_push_sent" },
      orderBy: { createdAt: "asc" },
    });
    if (!tx) {
      return NextResponse.json({ error: "No unverified M-Pesa prompts right now. Ask a passenger to start a payment first." }, { status: 400 });
    }
    const booking = await db.booking.findUnique({ where: { id: tx.bookingId } });
    await db.mpesaTransaction.update({
      where: { id: tx.id },
      data: { status: "ambiguous" },
    });
    await audit({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: "admin",
      action: "recon.simulate_missed_callback",
      entity: "mpesa_transaction",
      entityId: tx.id,
      metadata: { code: booking?.code },
    });
    return NextResponse.json({ ok: true, message: `Marked ${booking?.code || "payment"} as ambiguous (webhook lost). Run the sweep to recover it.` });
  }

  if (body.action === "inject_refund_failure") {
    setRefundFailureInjection(true);
    return NextResponse.json({ ok: true, message: "Next refund (Reversal/B2C) will fail with a Daraja error — watch it flag for review." });
  }
  if (body.action === "inject_payout_failure") {
    setPayoutFailureInjection(true);
    return NextResponse.json({ ok: true, message: "Next payout (B2C) will fail with a Daraja error — watch it flag for review." });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

async function getConfigQuick() {
  const { getConfig } = await import("@/lib/money");
  return getConfig();
}
