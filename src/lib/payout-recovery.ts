import { db } from "@/lib/db";

/** A late, authenticated per-attempt callback can still settle a flagged payout. */
export async function flagStalePayouts(now: Date, stuckHours: number): Promise<number> {
  const cutoff = new Date(now.getTime() - stuckHours * 60 * 60 * 1000);
  const result = await db.payoutRecord.updateMany({
    where: {
      status: { in: ["processing", "ambiguous"] },
      initiatedAt: { lte: cutoff },
      attempts: { none: { updatedAt: { gt: cutoff } } },
    },
    data: {
      status: "needs_review",
      failureReason: "Transfer outcome is unresolved. Finance must reconcile it before retrying.",
    },
  });
  return result.count;
}
