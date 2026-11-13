import { GeoPlacesClient, SearchTextCommand } from "@aws-sdk/client-geo-places";
import { CalculateRoutesCommand, GeoRoutesClient } from "@aws-sdk/client-geo-routes";
import { GeoMapsClient, GetTileCommand } from "@aws-sdk/client-geo-maps";
import { DriverError, text } from "./errors";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";

const region = () => process.env.AWS_REGION;
const providerUnavailable = () => new DriverError(502, "MAP_PROVIDER_UNAVAILABLE", "The map service could not respond. Try again or open Google Maps.");
export const amazonLocationConfigured = () => process.env.NODE_ENV === "production" && !isLocalDemoEnabled() &&
  region() === "eu-north-1" && !!process.env.DRIVER_DOCUMENT_BUCKET;

export async function searchDriverDestinations(input: Record<string, unknown>) {
  const query = text(input.query, "Destination", 3, 120);
  const latitude = input.latitude, longitude = input.longitude;
  const bias = typeof latitude === "number" && typeof longitude === "number" &&
    latitude >= -4.8 && latitude <= 5.1 && longitude >= 33.9 && longitude <= 42.0 ? [longitude, latitude] : null;
  const response = await new GeoPlacesClient({ region: region(), maxAttempts: 1 }).send(new SearchTextCommand({
    QueryText: query, MaxResults: 5, Language: "en", IntendedUse: "SingleUse",
    ...(bias ? { BiasPosition: bias } : {}),
    Filter: { ...(!bias ? { BoundingBox: [33.9, -4.8, 42.0, 5.1] } : {}), IncludeCountries: ["KEN"] },
  }), { abortSignal: AbortSignal.timeout(10_000) }).catch(() => { throw providerUnavailable(); });
  return { places: (response.ResultItems ?? []).flatMap(({ PlaceId, Title, Address, Position }) => {
    if (!PlaceId || !Title || Position?.length !== 2 || !Position.every(Number.isFinite)) return [];
    return [{ id: PlaceId, name: Title, detail: Address?.Label ?? "", longitude: Position[0], latitude: Position[1] }];
  }) };
}

type Coordinate = { latitude: number; longitude: number };

export async function calculateAmazonDriverRoute(origin: Coordinate, destination: Coordinate) {
  const response = await new GeoRoutesClient({ region: region(), maxAttempts: 1 }).send(new CalculateRoutesCommand({
    Origin: [origin.longitude, origin.latitude], Destination: [destination.longitude, destination.latitude],
    TravelMode: "Car", LegGeometryFormat: "Simple", TravelStepType: "TurnByTurn", Languages: ["en"],
  }), { abortSignal: AbortSignal.timeout(12_000) }).catch(() => { throw providerUnavailable(); });
  const leg = response.Routes?.[0]?.Legs?.[0];
  const points = leg?.Geometry?.LineString;
  const details = leg?.VehicleLegDetails;
  const summary = details?.Summary?.Overview;
  if (!points || points.length < 2 || points.length > 16_000 || !points.every(p => p.length === 2 && p.every(Number.isFinite)) ||
      !summary?.Distance || !summary.Duration) {
    throw new DriverError(422, "NO_DRIVING_ROUTE", "No driving route was found to that destination.");
  }
  const steps = details?.TravelSteps ?? [];
  const maneuvers = steps.slice(0, 120).map((step, index) => {
    const road = step.NextRoad?.RoadName?.[0]?.Value;
    const direction = step.TurnStepDetails?.SteeringDirection?.toLowerCase();
    const instruction = step.Type === "Arrive" ? "Arrive at your destination" : step.Type === "Depart" ? "Start driving" :
      direction === "left" || direction === "right" ? `Turn ${direction}` : step.Type === "RoundaboutEnter" ? "Enter the roundabout" : "Continue";
    return { instruction: `${instruction}${road ? ` onto ${road}` : ""}`.slice(0, 240),
      distanceMeters: Math.round(step.Distance ?? 0), durationSeconds: Math.round(step.Duration ?? 0),
      beginShapeIndex: step.GeometryOffset ?? 0, endShapeIndex: steps[index + 1]?.GeometryOffset ?? points.length - 1 };
  });
  return { provider: "amazon-location", points, distanceMeters: Math.round(summary.Distance), durationSeconds: Math.round(summary.Duration),
    maneuvers: maneuvers.length ? maneuvers : [{ instruction: "Follow the highlighted route", distanceMeters: Math.round(summary.Distance),
      durationSeconds: Math.round(summary.Duration), beginShapeIndex: 0, endShapeIndex: points.length - 1 }] };
}

export async function satelliteTile(z: string, x: string, y: string): Promise<Response> {
  const zoom = Number(z);
  if (zoom < 0 || zoom > 19 || Number(x) >= 2 ** zoom || Number(y) >= 2 ** zoom) {
    throw new DriverError(404, "TILE_NOT_FOUND", "Map tile not found.");
  }
  const tile = await new GeoMapsClient({ region: region(), maxAttempts: 1 }).send(new GetTileCommand({
    Tileset: "raster.satellite", Z: z, X: x, Y: y,
  }), { abortSignal: AbortSignal.timeout(10_000) }).catch(() => { throw providerUnavailable(); });
  if (!tile.Blob || !/^image\/(jpeg|png|webp)$/.test(tile.ContentType ?? "")) throw providerUnavailable();
  return new Response(Uint8Array.from(tile.Blob), { headers: {
    "Content-Type": tile.ContentType!, "Cache-Control": `private, ${tile.CacheControl?.match(/max-age=\d+/)?.[0] ?? "max-age=0"}`, "X-Content-Type-Options": "nosniff",
  } });
}
