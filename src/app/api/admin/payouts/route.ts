import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { executePayout, getConfig, isPayoutBatchDue, runPayoutBatch } from "@/lib/money";

/** Payout records — dispatch starts automatically when a trip completes. */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = await getConfig();

  const payouts = await db.payoutRecord.findMany({
    orderBy: { initiatedAt: "desc" },
    take: 200,
    include: { driver: true, trip: { include: { route: true } } },
  });
  const batch = await isPayoutBatchDue();

  return NextResponse.json({
    payoutMode: cfg.payoutMode,
    payoutDay: cfg.payoutDay,
    lastPayoutRunAt: cfg.lastPayoutRunAt,
    batch,
    totals: {
      queued: payouts.filter((p) => p.status === "queued").reduce((s, p) => s + p.netPayoutAmount, 0),
      paid: payouts.filter((p) => p.status === "completed" && p.settlementVerified).reduce((s, p) => s + p.netPayoutAmount, 0),
      commission: payouts.filter((p) => p.status === "completed" && p.settlementVerified).reduce((s, p) => s + p.commissionAmount, 0),
      platformFees: payouts.filter((p) => p.status === "completed" && p.settlementVerified).reduce((s, p) => s + p.platformFeeAmount, 0),
      processing:payouts.filter(p=>p.status==="processing").reduce((s,p)=>s+p.netPayoutAmount,0),
      ambiguous:payouts.filter(p=>p.status==="ambiguous").reduce((s,p)=>s+p.netPayoutAmount,0),
      failed: payouts.filter((p) => p.status === "failed").reduce((s, p) => s + p.netPayoutAmount, 0),
    },
    payouts: payouts.map((p) => ({
      id: p.id,
      driver: p.driver.name,
      plate: p.driver.plate,
      mpesaNumber: p.driver.mpesaNumber,
      route: p.trip?.route.name || null,
      gross: p.grossFareTotal,
      commission: p.commissionAmount,
      homeSurcharge: p.homeSurchargeAmount,
      platformFee: p.platformFeeAmount,
      net: p.netPayoutAmount,
      method: p.method,
      status: p.status === "completed" && !p.settlementVerified ? "needs_review" : p.status,
      result: p.mpesaResultCode,
      failureReason: p.failureReason,
      batchId: p.batchId,
      initiatedAt: p.initiatedAt,
      completedAt: p.completedAt,
    })),
  });
}

/** Payout actions: run the scheduled batch now, or retry a single failed payout. */
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const actor = { id: session.id, name: session.name, role: "admin" as const };

  if (body.action === "run_batch") {
    const result = await runPayoutBatch(actor);
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.action === "retry") {
    const ok = await executePayout(body.id);
    const payout = await db.payoutRecord.findUnique({ where: { id: body.id } });
    await audit({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: "admin",
      action: "money.payout_retry",
      entity: "payout",
      entityId: body.id,
      metadata: { ok },
    });
    return NextResponse.json({ ok, status: payout?.status, result: payout?.mpesaResultCode, failureReason: payout?.failureReason });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
