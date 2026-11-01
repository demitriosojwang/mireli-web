import { DriverError } from "@/lib/driver/errors";
import { readBoundedBody } from "@/lib/http-body";
import { verifyCallbackToken } from "@/lib/daraja";
import { settleRefundCallback } from "@/lib/refund-settlement";

export async function POST(req: Request, { params }: { params: Promise<{ capability: string }> }) {
  if (!verifyCallbackToken("b2c", new URL(req.url).searchParams.get("mireli_token"))) {
    return Response.json({ error: "Invalid callback authorization" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("timeout") === "1") {
      await settleRefundCallback((await params).capability, {}, true);
      return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }
    const body = JSON.parse((await readBoundedBody(req, 16384)).toString("utf8")) as { Result?: Record<string, unknown> };
    const result = body.Result;
    if (!result) return Response.json({ error: "INVALID_RESULT" }, { status: 400 });
    await settleRefundCallback((await params).capability, result as Parameters<typeof settleRefundCallback>[1]);
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    return Response.json({
      error: error instanceof DriverError ? error.code : "REFUND_CALLBACK_UNAVAILABLE",
    }, { status: error instanceof DriverError ? error.status : 503 });
  }
}
