import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_BOOKING_FEE_AMOUNT } from "@/lib/pricing";

function logCatalogueDatabaseError(operation: string, error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
  // Keep the useful Prisma code in server logs without logging connection URLs
  // or raw driver messages that may contain credentials.
  console.error(`route catalogue ${operation} failed`, { code });
}

/** Lightweight booking bootstrap: whether customer-selectable points exist and the flat fee. */
export async function GET() {
  let pointCount: number;
  try {
    // Stage details are fetched on demand by the bounded point-search endpoint.
    pointCount = await db.routeStage.count({
      where: {
        order: { gt: 0 },
        fare: { gt: 0 },
        homeSurcharge: { gte: 0 },
        route: { is: { active: true } },
      },
    });
  } catch (error) {
    logCatalogueDatabaseError("point count", error);
    return NextResponse.json({ error: "The route catalogue is temporarily unavailable." }, { status: 503 });
  }

  let bookingFeeAmount = DEFAULT_BOOKING_FEE_AMOUNT;
  try {
    const config = await db.platformConfig.findUnique({
      where: { id: "main" },
      select: { bookingFeeAmount: true },
    });
    bookingFeeAmount = config?.bookingFeeAmount ?? DEFAULT_BOOKING_FEE_AMOUNT;
  } catch (error) {
    // The KSh 50 default is the confirmed flat booking fee. Keep discovery of
    // stops independent from an operations-config read; booking and trip APIs
    // still require the full config before they can proceed.
    logCatalogueDatabaseError("fee config", error);
  }

  return NextResponse.json({ bookingFeeAmount, pointCount });
}
