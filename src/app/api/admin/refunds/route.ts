import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { submitRefund } from "@/lib/refund-settlement";

/** Refund records — pending stays visible until a provider result is confirmed. */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const refunds = await db.refundRecord.findMany({
    orderBy: { initiatedAt: "desc" },
    take: 200,
    include: {
      booking: { include: { passenger: true } },
      ledgerEntry: true,
      attempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return NextResponse.json({
    refunds: refunds.map((r) => ({
      id: r.id,
      code: r.booking.code,
      passenger: r.booking.passenger.name,
      amount: r.amount,
      creditRestored: r.creditRestored,
      commissionReversed: r.commissionReversed,
      driverClawback: r.driverClawback,
      reason: r.reason,
      method: r.method,
      status: r.status,
      stuck: r.stuckFlaggedAt !== null,
      result: r.mpesaResultCode,
      failureReason: r.failureReason,
      initiatedAt: r.initiatedAt,
      completedAt: r.completedAt,
      ledgerStatus: r.ledgerEntry.status,
      attemptState: r.attempts[0]?.state || null,
    })),
  });
}

/** Start an unsubmitted refund or retry a confirmed provider failure.
 * Pending/ambiguous attempts cannot be resent until reconciliation proves the
 * original transfer did not reach the passenger. */
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const refund = await db.refundRecord.findUnique({
    where: { id: body.id },
    include: { booking: { include: { passenger: true } }, ledgerEntry: true },
  });
  if (!refund) return NextResponse.json({ error: "Refund not found" }, { status: 404 });
  if (refund.status === "completed") return NextResponse.json({ error: "Refund already completed" }, { status: 400 });
  if (refund.status === "pending") {
    const activeAttempt = await db.refundAttempt.findFirst({
      where: { refundId: refund.id, state: { in: ["submitting", "processing", "ambiguous"] } },
      select: { id: true },
    });
    if (activeAttempt) {
      return NextResponse.json({ error: "Refund outcome is still pending. Reconcile the existing attempt before retrying." }, { status: 409 });
    }
  }
  const state = await submitRefund(refund.id, { retryFailed: refund.status === "failed" });
  const result = state === "completed" ? "Refund confirmed by the provider." : state === "failed" ? "Provider rejected the refund. Review details before another retry." : "Refund request is pending provider confirmation.";
  await audit({
    actorId: session.id,
    actorName: session.name,
    actorRole: "admin",
    action: "money.refund_retry",
    entity: "refund",
    entityId: refund.id,
    metadata: { state, method: refund.method },
  });
  return NextResponse.json({ ok: state === "completed", state, result });
}
