import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { verifyCallbackToken } from "@/lib/daraja";

/**
 * Safaricom Daraja → B2C / Reversal result webhook (ResultURL).
 *
 * B2C (payouts, cash refunds) and Reversal are asynchronous: the initial
 * request is merely ACCEPTED; the authoritative outcome arrives here. The
 * driver money engine correlates per-attempt callbacks at payout-result/{capability}.
 * This older webhook cannot settle funds; its job is oversight: every result is
 * written to the audit log where Admin → Audit surfaces it. If a transfer
 * ultimately failed, the admin retries it from the Money & Ledger page —
 * nothing is ever silently retried.
 */
export async function POST(req: NextRequest) {
  const accepted = NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  if (!verifyCallbackToken("b2c", req.nextUrl.searchParams.get("mireli_token"))) {
    return NextResponse.json({ error: "Invalid callback authorization" }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      Result?: {
        ResultType?: number;
        ResultCode?: number | string;
        ResultDesc?: string;
        OriginatorConversationID?: string;
        ConversationID?: string;
        TransactionID?: string;
        ResultParameters?: { ResultParameter?: { Key: string; Value?: unknown }[] };
      };
    };
    const result = body.Result;
    if (!result) return accepted;

    const params = result.ResultParameters?.ResultParameter || [];
    const param = (key: string) => params.find((p) => p.Key === key)?.Value;
    await audit({
      actorId: "system",
      actorName: "Daraja Webhook",
      actorRole: "system",
      action: "money.daraja_result",
      entity: "daraja_result",
      entityId: result.TransactionID || result.ConversationID || "unknown",
      metadata: {
        resultCode: result.ResultCode,
        resultDesc: result.ResultDesc,
        originatorConversationId: result.OriginatorConversationID,
        transactionId: result.TransactionID,
        receiver: param("ReceiverPartyPublicName"),
        amount: param("TransactionAmount"),
        b2cReceipt: param("TransactionReceipt"),
      },
    });
  } catch {
    // Never 500.
  }
  return accepted;
}
