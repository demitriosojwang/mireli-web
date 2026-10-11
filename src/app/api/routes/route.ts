import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_BOOKING_FEE_AMOUNT } from "@/lib/pricing";

/** Network map for the booking form: routes with ordered stages + fares. */
export async function GET() {
  try {
  const routes = await db.route.findMany({
    where: { active: true },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  const config = await db.platformConfig.findUnique({
    where: { id: "main" },
    select: { bookingFeeAmount: true },
  });
  return NextResponse.json({
    bookingFeeAmount: config?.bookingFeeAmount ?? DEFAULT_BOOKING_FEE_AMOUNT,
    routes: routes.map((r) => ({
      id: r.id,
      name: r.name,
      durationMinutes: r.durationMinutes,
      charterPrice: r.charterPrice,
      stages: r.stages.map((s) => ({
        id: s.id,
        name: s.name,
        order: s.order,
        fare: s.fare,
        homeSurcharge: s.homeSurcharge,
      })),
    })),
  });
  } catch {
    return NextResponse.json({error: "The route catalogue is temporarily unavailable."}, {status: 503});
  }
}
