import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_BOOKING_FEE_AMOUNT } from "@/lib/pricing";

/** Public discovery price. Actual booking totals are recalculated and checked by the booking API. */
export async function GET() {
  try {
    const config = await db.platformConfig.findUnique({
      where: { id: "main" },
      select: { bookingFeeAmount: true },
    });
    const configuredAmount = config?.bookingFeeAmount;
    const bookingFeeAmount = typeof configuredAmount === "number" && Number.isSafeInteger(configuredAmount) && configuredAmount >= 0 && configuredAmount <= 10_000
      ? configuredAmount
      : DEFAULT_BOOKING_FEE_AMOUNT;
    return NextResponse.json({ bookingFeeAmount });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
    console.error("booking fee discovery failed", { code });
    return NextResponse.json({ bookingFeeAmount: DEFAULT_BOOKING_FEE_AMOUNT });
  }
}
