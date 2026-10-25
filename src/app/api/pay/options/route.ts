import { NextResponse } from "next/server";
import { getPublicPayOptions } from "@/lib/daraja";

/**
 * Public (no session) — tells the Pay Sheet which payment options exist.
 * The Paybill option only appears once the platform's M-Pesa shortcode is
 * configured (env or Admin → Payments). STK is advertised only when real
 * payment and signed HTTPS callback configuration is ready, or in local demo.
 */
export async function GET() {
  try {
    const options = await getPublicPayOptions();
    return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : "UNKNOWN";
    // Configuration and provider errors must not leak credentials or internal
    // database messages into the public checkout response.
    console.error("payment option discovery failed", { code });
    return NextResponse.json(
      { error: "Payment methods are temporarily unavailable.", code: "PAYMENT_OPTIONS_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
