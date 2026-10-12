import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_BOOKING_FEE_AMOUNT } from "@/lib/pricing";

/** Lightweight booking bootstrap: whether customer-selectable points exist and the flat fee. */
export async function GET() {
  try {
    // Stage details are fetched on demand by the bounded point-search endpoint.
    const [pointCount, config] = await Promise.all([
      db.routeStage.count({
        where: { order: { gt: 0 }, route: { is: { active: true } } },
      }),
      db.platformConfig.findUnique({
        where: { id: "main" },
        select: { bookingFeeAmount: true },
      }),
    ]);

    return NextResponse.json({
      bookingFeeAmount: config?.bookingFeeAmount ?? DEFAULT_BOOKING_FEE_AMOUNT,
      pointCount,
    });
  } catch {
    return NextResponse.json({ error: "The route catalogue is temporarily unavailable." }, { status: 503 });
  }
}

