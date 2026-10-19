import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import * as daraja from "@/lib/daraja";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";
import { DriverError } from "@/lib/driver/errors";
import { audit } from "@/lib/audit";

type RefundCallback = {
  ResultCode?: string | number;
  ResultType?: string | number;
  ResultDesc?: string;
  ConversationID?: string;
  OriginatorConversationID?: string;
  TransactionID?: string;
  ResultParameters?: { ResultParameter?: { Key: string; Value?: unknown }[] };
};

const terminalStates = ["confirmed", "failed"];
const activeStates = ["submitting", "processing", "ambiguous"];

function normalPhone(value: string) {
  return value.replace(/\D/g, "");
}

/** Submit a persisted refund attempt. Provider acceptance remains pending until
 * the attempt-specific, authenticated result callback confirms its outcome. */
export async function submitRefund(refundId: string, options: { retryFailed?: boolean } = {}): Promise<"completed" | "pending" | "failed"> {
  const refund = await db.refundRecord.findUnique({
    where: { id: refundId },
    include: { booking: { include: { passenger: true } }, ledgerEntry: true },
  });
  if (!refund) throw new DriverError(404, "REFUND_NOT_FOUND", "Refund record not found.");
  if (refund.status === "completed") return "completed";
  if (refund.status === "failed" && !options.retryFailed) return "failed";
  const existing = await db.refundAttempt.findFirst({
    where: { refundId, state: { in: activeStates } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return "pending";
  if (!Number.isSafeInteger(refund.amount) || refund.amount < 1) {
    throw new DriverError(409, "INVALID_REFUND", "Refund amount requires finance review.");
  }

  const creds = await daraja.resolveDaraja();
  const demo = isLocalDemoEnabled() && creds.mode === "mock";
  const base = creds.callbackBaseUrl.replace(/\/+$/, "");
  if (!demo && (process.env.MPESA_LIVE_REFUNDS_ENABLED !== "true" || creds.mode !== "live" || !base.startsWith("https://"))) {
    // Leave the refund pending and therefore payout-blocking until operations
    // explicitly enables live refunds and a public HTTPS callback is configured.
    await db.refundRecord.update({
      where: { id: refund.id },
      data: { failureReason: "Live refunds are not enabled with a verified HTTPS callback." },
    });
    return refund.status === "failed" ? "failed" : "pending";
  }

  const capability = randomBytes(32).toString("hex");
  const originatorId = refund.method === "b2c" ? `MR-${randomBytes(8).toString("hex")}` : null;
  let callbackToken: string | null = null;
  if (!demo) {
    try {
      callbackToken = new URL(daraja.callbackUrls(creds).b2cResult).searchParams.get("mireli_token");
    } catch {
      await db.refundRecord.update({
        where: { id: refund.id },
        data: { failureReason: "Refund callback authorization is not configured." },
      });
      return refund.status === "failed" ? "failed" : "pending";
    }
    if (!callbackToken) return refund.status === "failed" ? "failed" : "pending";
  }

  if (refund.status === "failed") {
    const claimed = await db.refundRecord.updateMany({
      where: { id: refund.id, status: "failed" },
      data: { status: "pending", failureReason: null, stuckFlaggedAt: null, mpesaResultCode: null, completedAt: null },
    });
    if (claimed.count !== 1) return "pending";
  }

  const attempt = await db.refundAttempt.create({
    data: {
      refundId: refund.id,
      callbackHash: createHash("sha256").update(capability).digest("hex"),
      method: refund.method,
      amount: refund.amount,
      receiverPhone: refund.method === "b2c" ? refund.booking.passengerPhone || refund.booking.passenger.phone : null,
      originalReceipt: refund.ledgerEntry.mpesaReceipt,
      originatorId,
      state: "submitting",
    },
  });

  let result: daraja.DarajaResultCode;
  try {
    if (refund.method === "reversal") {
      if (!attempt.originalReceipt) {
        result = { resultCode: "MISSING_RECEIPT", resultDesc: "Original M-Pesa receipt is missing." };
      } else {
        result = await daraja.reversal({
          transactionId: attempt.originalReceipt,
          amount: attempt.amount,
          resultUrl: demo ? undefined : `${base}/api/pay/mpesa/refund-result/${capability}?mireli_token=${callbackToken}`,
          timeoutUrl: demo ? undefined : `${base}/api/pay/mpesa/refund-result/${capability}?timeout=1&mireli_token=${callbackToken}`,
          remarks: `Mireli refund ${refund.id}`,
        });
      }
    } else {
      if (!attempt.receiverPhone) {
        result = { resultCode: "MISSING_PHONE", resultDesc: "Passenger M-Pesa number is missing." };
      } else {
        result = await daraja.b2c({
          receiverPhone: attempt.receiverPhone,
          amount: attempt.amount,
          remarks: `Mireli refund ${refund.id}`,
          originatorId: originatorId || undefined,
          resultUrl: demo ? undefined : `${base}/api/pay/mpesa/refund-result/${capability}?mireli_token=${callbackToken}`,
          timeoutUrl: demo ? undefined : `${base}/api/pay/mpesa/refund-result/${capability}?timeout=1&mireli_token=${callbackToken}`,
        });
      }
    }
  } catch (error) {
    result = { resultCode: "UNKNOWN", resultDesc: error instanceof Error ? error.message : "Refund outcome is unknown." };
  }

  if (result.settled && result.resultCode === daraja.RESULT_CODES.SUCCESS) {
    if (!demo) throw new Error("Synchronous refund settlement is restricted to local simulation.");
    await finalizeRefund(attempt.id, { ResultCode: result.resultCode, ResultType: 0, ConversationID: result.conversationId,
      OriginatorConversationID: result.originatorId, TransactionID: result.receipt,
      ResultParameters: { ResultParameter: [
        { Key: "TransactionAmount", Value: attempt.amount },
        { Key: "ReceiverPartyPublicName", Value: attempt.receiverPhone },
      ] } }, true);
    return "completed";
  }

  const accepted = result.resultCode === "ACCEPTED" && (refund.method === "reversal" || !!result.conversationId);
  const definitiveFailure = result.resultCode !== "UNKNOWN" && result.resultCode !== "TIMEOUT" &&
    result.resultCode !== daraja.RESULT_CODES.TIMEOUT && !accepted;
  await db.$transaction(async (tx) => {
    const current = await tx.refundAttempt.findUnique({ where: { id: attempt.id } });
    if (!current || terminalStates.includes(current.state)) return;
    const nextState = accepted ? "processing" : definitiveFailure ? "failed" : "ambiguous";
    await tx.refundAttempt.update({ where: { id: attempt.id }, data: {
      state: nextState,
      conversationId: result.conversationId || null,
      originatorId: result.originatorId || current.originatorId,
      resultCode: result.resultCode,
    } });
    if (definitiveFailure) await tx.refundRecord.update({ where: { id: refund.id }, data: {
      status: "failed", mpesaResultCode: result.resultCode, failureReason: result.resultDesc,
    } });
    else await tx.refundRecord.update({ where: { id: refund.id }, data: { failureReason: result.resultDesc } });
  });
  const settled = await db.refundRecord.findUnique({ where: { id: refund.id }, select: { status: true } });
  if (settled?.status === "completed") return "completed";
  if (settled?.status === "failed") return "failed";
  return "pending";
}

/** Settle one refund only after its private callback URL and provider IDs match. */
export async function settleRefundCallback(capability: string, result: RefundCallback, timeout = false) {
  if (!/^[a-f0-9]{64}$/.test(capability)) throw new DriverError(404, "NOT_FOUND", "Refund attempt not found.");
  const attempt = await db.refundAttempt.findUnique({
    where: { callbackHash: createHash("sha256").update(capability).digest("hex") },
    include: { refund: { include: { ledgerEntry: true } } },
  });
  if (!attempt) throw new DriverError(404, "NOT_FOUND", "Refund attempt not found.");
  if (timeout) {
    await db.$transaction(async (tx) => {
      await tx.refundAttempt.updateMany({ where: { id: attempt.id, state: { in: ["submitting", "processing"] } }, data: { state: "ambiguous" } });
      // A timeout is not proof of failure. Keep the refund pending and block payout.
      await tx.refundRecord.updateMany({ where: { id: attempt.refundId, status: "pending" }, data: { failureReason: "Daraja callback timed out; reconciliation is required." } });
    });
    return { duplicate: false, state: "ambiguous" };
  }
  if ((attempt.originatorId && result.OriginatorConversationID !== attempt.originatorId) ||
      (attempt.conversationId && result.ConversationID !== attempt.conversationId)) {
    throw new DriverError(400, "RESULT_MISMATCH", "Provider correlation does not match this refund.");
  }
  const code = String(result.ResultCode ?? "");
  if (!/^\d+$/.test(code)) throw new DriverError(400, "INVALID_RESULT", "Provider result code is invalid.");
  const params = result.ResultParameters?.ResultParameter || [];
  const param = (key: string) => params.find((p) => p.Key === key)?.Value;
  let receipt = typeof param("TransactionReceipt") === "string" ? String(param("TransactionReceipt")) :
    typeof param("ReceiptNo") === "string" ? String(param("ReceiptNo")) :
    typeof result.TransactionID === "string" ? result.TransactionID : "";

  if (code === "0") {
    if (result.ResultType !== undefined && String(result.ResultType) !== "0") {
      await db.refundAttempt.updateMany({ where: { id: attempt.id, state: { in: activeStates } }, data: { state: "ambiguous", resultCode: code } });
      return { duplicate: false, state: "ambiguous" };
    }
    if (attempt.method === "reversal" && receipt === "MBN0000000") receipt = "";
    if (!result.OriginatorConversationID || !result.ConversationID || (attempt.method === "b2c" && !receipt)) {
      throw new DriverError(400, "RESULT_INCOMPLETE", "Successful refund result is missing provider references.");
    }
    if (attempt.method === "b2c") {
      const amount = Number(param("TransactionAmount"));
      const receiver = String(param("ReceiverPartyPublicName") ?? "");
      const expected = attempt.receiverPhone ? normalPhone(attempt.receiverPhone) : "";
      if (!/^[A-Z0-9]{8,20}$/.test(receipt) || amount !== attempt.amount || !expected || !normalPhone(receiver).startsWith(expected)) {
        throw new DriverError(400, "RESULT_MISMATCH", "Refund amount, receipt, or recipient could not be verified.");
      }
    }
  }
  return finalizeRefund(attempt.id, result, false, code, receipt || null);
}

async function finalizeRefund(attemptId: string, result: RefundCallback, simulated = false, codeOverride?: string, receiptOverride?: string | null) {
  const snapshot = await db.refundAttempt.findUnique({ where: { id: attemptId }, include: { refund: { include: { ledgerEntry: true } } } });
  if (!snapshot) throw new DriverError(404, "NOT_FOUND", "Refund attempt not found.");
  const code = codeOverride || String(result.ResultCode ?? "");
  const receipt = receiptOverride !== undefined ? receiptOverride : (typeof result.TransactionID === "string" ? result.TransactionID : null);
  const success = code === "0";
  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const current = await tx.refundAttempt.findUnique({ where: { id: attemptId } });
    if (!current) throw new DriverError(404, "NOT_FOUND", "Refund attempt not found.");
    if (terminalStates.includes(current.state)) {
      if (current.resultCode !== code || (success && current.receipt !== receipt)) throw new DriverError(409, "RESULT_CONFLICT", "Conflicting refund result requires finance review.");
      return false;
    }
    const attemptUpdate = await tx.refundAttempt.updateMany({
      where: { id: attemptId, state: { in: activeStates } },
      data: { state: success ? "confirmed" : "failed", resultCode: code,
        receipt: success ? receipt : null, conversationId: result.ConversationID || current.conversationId,
        originatorId: result.OriginatorConversationID || current.originatorId },
    });
    if (attemptUpdate.count !== 1) throw new DriverError(409, "RESULT_CONFLICT", "Refresh refund state before reconciling.");
    const completedRefunds = await tx.refundRecord.aggregate({
      where: { ledgerEntryId: snapshot.refund.ledgerEntry.id, status: "completed" },
      _sum: { amount: true },
    });
    const totalRefunded = (completedRefunds._sum.amount || 0) + (success ? snapshot.refund.amount : 0);
    await tx.refundRecord.update({ where: { id: current.refundId }, data: {
      status: success ? "completed" : "failed", mpesaResultCode: code,
      failureReason: success ? null : (result.ResultDesc || "Provider reported refund failure."),
      completedAt: success ? now : null,
    } });
    if (success) {
      const ledger = snapshot.refund.ledgerEntry;
      await tx.ledgerEntry.update({ where: { id: ledger.id }, data: {
        status: totalRefunded >= ledger.cashAmount ? "refunded" : "partially_refunded",
        statusChangedAt: now,
      } });
    }
    return true;
  });
  if (updated) await audit({ actorId: "system", actorName: simulated ? "Local refund simulator" : "Daraja Webhook", actorRole: "system",
    action: success ? "money.refund_result" : "money.refund_failed", entity: "refund", entityId: snapshot.refundId,
    metadata: { attemptId, resultCode: code, receipt: success ? receipt : undefined } });
  return { duplicate: !updated, state: success ? "completed" : "failed" };
}
