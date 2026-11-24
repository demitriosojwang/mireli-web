import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getPassengerSession } from "@/lib/session";
import { amazonLocationConfigured, calculateAmazonDriverRoute, searchDriverDestinations } from "@/lib/driver/amazon-location";
import { DriverError } from "@/lib/driver/errors";

type Coordinate = { latitude: number; longitude: number };

function isCoastalLocation(value: unknown): value is Coordinate {
  if (!value || typeof value !== "object" || !("latitude" in value) || !("longitude" in value)) return false;
  const { latitude, longitude } = value;
  return typeof latitude === "number" && latitude >= -4.8 && latitude <= -1.8 &&
    typeof longitude === "number" && longitude >= 38.7 && longitude <= 41.5;
}

function response(value: object, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function takeMapRequest(passengerId: string) {
  const now = Date.now();
  const limits = [
    { scope: passengerId, duration: 60_000, max: 8 },
    { scope: "all", duration: 60_000, max: 120 },
    { scope: "all", duration: 86_400_000, max: 2_000 },
  ];
  const counters = await db.$transaction(limits.map(({ scope, duration }) => {
    const start = Math.floor(now / duration) * duration;
    const key = createHash("sha256").update(`passenger-map:${scope}:${duration}:${start}`).digest("hex");
    return db.driverRateLimit.upsert({
      where: { key },
      create: { key, expiresAt: new Date(start + duration) },
      update: { count: { increment: 1 } },
    });
  }));
  return counters.every((counter, index) => counter.count <= limits[index].max);
}

export async function POST(request: Request) {
  try {
    const passenger = await getPassengerSession();
    if (!passenger) return response({ error: "Refresh to start a booking session." }, 401);
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return response({ error: "Send the map request as JSON." }, 415);
    }
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("action" in body)) return response({ error: "Invalid map request." }, 400);
    if (!amazonLocationConfigured()) return response({ error: "Map lookup is temporarily unavailable." }, 503);

    if (body.action === "places" && "query" in body && typeof body.query === "string") {
      const query = body.query.trim();
      if (query.length < 3 || query.length > 120) return response({ error: "Enter an address or landmark name." }, 400);
      if (!await takeMapRequest(passenger.id)) return response({ error: "Wait a moment before searching again." }, 429);
      const result = await searchDriverDestinations({ query, latitude: -4.04, longitude: 39.66 });
      return response({ places: result.places.filter(isCoastalLocation) });
    }

    if (body.action === "route" && "origin" in body && "destination" in body &&
        isCoastalLocation(body.origin) && isCoastalLocation(body.destination)) {
      if (!await takeMapRequest(passenger.id)) return response({ error: "Wait a moment before requesting another route." }, 429);
      const { points, distanceMeters, durationSeconds } = await calculateAmazonDriverRoute(body.origin, body.destination, false);
      return response({ points, distanceMeters, durationSeconds });
    }

    return response({ error: "Choose a pickup and drop-off on the Kenya coast." }, 400);
  } catch (error) {
    if (error instanceof DriverError) return response({ error: error.message }, error.status);
    return response({ error: "Map lookup is temporarily unavailable." }, 503);
  }
}
