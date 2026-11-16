import { PASSENGER_TERMINUS } from "@/lib/passenger-terminus";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const MAX_STOPS = 240;

/**
 * Published stop geometry for the passenger map. Stop names and coordinates are
 * already public through the point-search endpoint; this adds the full ordered
 * network so the map can draw the route without a search query.
 */
export async function GET() {
  try {
    const stops = await db.routeStage.findMany({
      where: {
        order: { gt: 0 },
        fare: { gt: 0 },
        homeSurcharge: { gte: 0 },
        route: { is: { active: true } },
      },
      select: {
        id: true,
        name: true,
        lat: true,
        lng: true,
        order: true,
        route: { select: { id: true, name: true } },
      },
      orderBy: [{ route: { name: "asc" } }, { order: "asc" }],
      take: MAX_STOPS,
    });

    return NextResponse.json({
      origin: PASSENGER_TERMINUS,
      stops: stops.map((stop) => ({
        id: stop.id,
        name: stop.name,
        lat: stop.lat,
        lng: stop.lng,
        routeId: stop.route.id,
        routeName: stop.route.name,
      })),
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
    console.error("route map failed", { code });
    return NextResponse.json({ error: "The route map is temporarily unavailable." }, { status: 503 });
  }
}
