import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { getConfig, isPayoutBatchDue } from "@/lib/money";
import { runOperationalTick } from "@/lib/engine";

const LEDGER_BUCKETS = [
  "held",
  "driver_payable",
  "commission_taken",
  "refunded",
  "partially_refunded",
  "converted_to_credit",
  "forfeited",
] as const;

/** Admin overview — the money surface: totals and exceptions, not individual bookings. */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await runOperationalTick();

  const cfg = await getConfig();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Ledger buckets
  const entries = await db.ledgerEntry.findMany();
  const buckets: Record<string, { count: number; total: number }> = {};
  for (const b of LEDGER_BUCKETS) buckets[b] = { count: 0, total: 0 };
  for (const e of entries) {
    if (!buckets[e.status]) buckets[e.status] = { count: 0, total: 0 };
    buckets[e.status].count++;
    buckets[e.status].total += e.totalAmount;
  }

  // Today's money
  const todayEntries = entries.filter((e) => e.collectedAt && e.collectedAt >= todayStart);
  const payouts = await db.payoutRecord.findMany();
  const todayPayouts = payouts.filter((p) => p.status==="completed" && p.settlementVerified && p.completedAt && p.completedAt >= todayStart);
  const todayCommission = payouts
    .filter((p) => p.status==="completed" && p.settlementVerified && p.completedAt && p.completedAt >= todayStart)
    .reduce((s, p) => s + p.commissionAmount, 0);

  // Alerts / exceptions
  const stuckRefunds = await db.refundRecord.findMany({
    where: { stuckFlaggedAt: { not: null } },
    include: { booking: true },
  });
  const failedPayouts = await db.payoutRecord.findMany({
    where: { status: "failed" },
    include: { driver: true },
  });
  const failedRefunds = await db.refundRecord.findMany({
    where: { status: "failed" },
    include: { booking: true },
  });
  const ambiguousTx = await db.mpesaTransaction.findMany({
    where: { status: { in: ["stk_push_sent", "pending", "ambiguous"] } },
  });
  const closedBookingCaptures = await db.mpesaTransaction.findMany({
    where: {
      status: "confirmed",
      booking: {
        is: {
          status: { in: ["cancelled", "no_show"] },
          ledgerEntry: { is: { status: "held" } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { booking: true },
  });
  const unallocated = await db.booking.findMany({
    where: { tripId: null, status: { in: ["awaiting_payment", "confirmed"] } },
  });
  const activeCredits = await db.credit.findMany({
    where: { status: "active", expiresAt: { gt: now } },
  });

  const batch = await isPayoutBatchDue();
  const recentAudit = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 });

  return NextResponse.json({
    config: {
      commissionRate: cfg.commissionRate,
      payoutMode: cfg.payoutMode,
      payoutDay: cfg.payoutDay,
      creditValidityDays: cfg.creditValidityDays,
      lastReconciliationAt: cfg.lastReconciliationAt,
      lastPayoutRunAt: cfg.lastPayoutRunAt,
    },
    buckets,
    today: {
      collected: todayEntries.reduce((s, e) => s + e.cashAmount, 0),
      bookings: await db.booking.count({ where: { createdAt: { gte: todayStart } } }),
      commission: todayCommission,
      paidOut: todayPayouts.reduce((s, p) => s + p.netPayoutAmount, 0),
    },
    payoutsQueued: payouts
      .filter((p) => p.status === "queued")
      .reduce((s, p) => s + p.netPayoutAmount, 0),
    alerts: {
      stuckRefunds: stuckRefunds.map((r) => ({ id: r.id, code: r.booking.code, amount: r.amount, flaggedAt: r.stuckFlaggedAt })),
      failedPayouts: failedPayouts.map((p) => ({ id: p.id, driver: p.driver.name, amount: p.netPayoutAmount, reason: p.failureReason })),
      failedRefunds: failedRefunds.map((r) => ({ id: r.id, code: r.booking.code, amount: r.amount, reason: r.failureReason })),
      ambiguousPayments: ambiguousTx.length,
      closedBookingCaptures: closedBookingCaptures.map((tx) => ({
        id: tx.id,
        code: tx.booking.code,
        amount: tx.amount,
        status: tx.booking.status,
      })),
      unallocatedBookings: unallocated.length,
      creditLiability: activeCredits.reduce((s, c) => s + c.amount, 0),
      activeCredits: activeCredits.length,
    },
    batch,
    recentAudit: recentAudit.map((a) => ({
      id: a.id,
      actorName: a.actorName,
      actorRole: a.actorRole,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      createdAt: a.createdAt,
    })),
  });
}
