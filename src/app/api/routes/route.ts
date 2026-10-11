import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_BOOKING_FEE_AMOUNT } from "@/lib/pricing";

/** Network map for the booking form: routes with ordered stages + fares. */
export async function GET() {
  try {
    // The booking picker needs only names and fare fields. Avoid loading
    // coordinates and other admin-only stage data into every customer session.
    const [routes, config] = await Promise.all([
      db.route.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          durationMinutes: true,
          charterPrice: true,
          stages: {
            orderBy: { order: "asc" },
            select: { id: true, name: true, order: true, fare: true, homeSurcharge: true },
          },
        },
      }),
      db.platformConfig.findUnique({
        where: { id: "main" },
        select: { bookingFeeAmount: true },
      }),
    ]);

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
    return NextResponse.json({ error: "The route catalogue is temporarily unavailable." }, { status: 503 });
  }
}
