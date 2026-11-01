import { NextResponse } from "next/server";
import { db } from "@/lib/db";

function logCatalogueDatabaseError(operation: string, error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
  // Keep the useful Prisma code in server logs without logging connection URLs
  // or raw driver messages that may contain credentials.
  console.error(`route catalogue ${operation} failed`, { code });
}

/** Lightweight point-discovery bootstrap. Fee and driver-supply reads have separate endpoints so neither can delay the stop picker. */
export async function GET() {
  try {
    // Stage details are fetched on demand by the bounded point-search endpoint.
    const pointCount = await db.routeStage.count({
      where: {
        order: { gt: 0 },
        fare: { gt: 0 },
        homeSurcharge: { gte: 0 },
        route: { is: { active: true } },
      },
    });
    return NextResponse.json({ pointCount });
  } catch (error) {
    logCatalogueDatabaseError("point count", error);
    return NextResponse.json({ error: "The route catalogue is temporarily unavailable." }, { status: 503 });
  }
}
