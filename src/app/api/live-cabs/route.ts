import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** How long a GPS fix stays visible on the passenger map. */
const RECENT_FIX_MS = 15 * 60 * 1000;
const MAX_CABS = 200;

/**
 * Anonymous live cab positions for the passenger map. Only the newest fix of
 * an active trip is stored, so this never exposes a route history, a name, or
 * a plate — just where each pooled cab is right now.
 */
export async function GET() {
  try {
    const cutoff = new Date(Date.now() - RECENT_FIX_MS);
    const positions = await db.driverPosition.findMany({
      where: { recordedAt: { gte: cutoff }, driver: { is: { status: "active" } } },
      select: { tripId: true, lat: true, lng: true, bearingDeg: true, recordedAt: true },
      orderBy: { recordedAt: "desc" },
      take: MAX_CABS,
    });

    return NextResponse.json(
      {
        cabs: positions.map((position) => ({
          id: position.tripId,
          lat: position.lat,
          lng: position.lng,
          bearingDeg: position.bearingDeg,
          recordedAt: position.recordedAt,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
    console.error("live cabs failed", { code });
    return NextResponse.json({ error: "Live cabs are temporarily unavailable." }, { status: 503 });
  }
}
