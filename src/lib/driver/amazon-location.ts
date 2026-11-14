import { GeoPlacesClient, SearchTextCommand } from "@aws-sdk/client-geo-places";
import { CalculateRoutesCommand, GeoRoutesClient, type Route } from "@aws-sdk/client-geo-routes";
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

export function noFerryFreeRoute() {
  return new DriverError(422, "NO_FERRY_FREE_ROUTE", "No ferry-free route found. Try Google Maps or allow ferries.");
}

function routeUsesFerry(route: Route): boolean {
  return route.Legs?.some(leg => leg.Type === "Ferry" || !!leg.FerryLegDetails) === true;
}

export function normalizeAmazonDriverRoute(routes: Route[], avoidFerries: boolean) {
  const route = routes.find(candidate => !avoidFerries || !routeUsesFerry(candidate));
  if (avoidFerries && routes.length && !route) throw noFerryFreeRoute();
  const unavailable = () => new DriverError(422, "NO_DRIVING_ROUTE", "No driving route was found to that destination.");
  const legs = route?.Legs;
  if (!route || !legs?.length) throw unavailable();

  const points: number[][] = [];
  const maneuvers: { instruction: string; distanceMeters: number; durationSeconds: number; beginShapeIndex: number; endShapeIndex: number }[] = [];
  let distanceMeters = 0;
  let durationSeconds = 0;
  for (const leg of legs) {
    const line = leg.Geometry?.LineString;
    const vehicle = leg.VehicleLegDetails;
    const ferry = leg.Type === "Ferry" || !!leg.FerryLegDetails;
    const summary = ferry ? leg.FerryLegDetails?.Summary?.Overview : vehicle?.Summary?.Overview;
    if (!line || line.length < 2 || line.length > 16_000 ||
        !line.every(point => point.length === 2 && point.every(Number.isFinite)) ||
        summary?.Distance === undefined || !Number.isFinite(summary.Distance) || summary.Distance < 0 ||
        summary.Duration === undefined || !Number.isFinite(summary.Duration) || summary.Duration < 0) {
      throw unavailable();
    }

    const previous = points.at(-1);
    const sharedEndpoint = previous?.[0] === line[0][0] && previous?.[1] === line[0][1];
    const offset = points.length - (sharedEndpoint ? 1 : 0);
    points.push(...(sharedEndpoint ? line.slice(1) : line));
    if (points.length > 16_000) throw unavailable();
    distanceMeters += summary.Distance;
    durationSeconds += summary.Duration;

    const steps = ferry ? [] : vehicle?.TravelSteps ?? [];
    if (!steps.length) {
      maneuvers.push({ instruction: ferry ? "Take the ferry" : "Follow the highlighted route",
        distanceMeters: Math.round(summary.Distance), durationSeconds: Math.round(summary.Duration),
        beginShapeIndex: offset, endShapeIndex: offset + line.length - 1 });
      continue;
    }
    const indexInRoute = (index: number) => offset + Math.max(0, Math.min(line.length - 1, index));
    for (const [index, step] of steps.entries()) {
      const road = step.NextRoad?.RoadName?.[0]?.Value;
      const direction = step.TurnStepDetails?.SteeringDirection?.toLowerCase();
      const instruction = step.Type === "Arrive" && leg === legs.at(-1) ? "Arrive at your destination" :
        step.Type === "Depart" ? "Start driving" : direction === "left" || direction === "right" ?
        `Turn ${direction}` : step.Type === "RoundaboutEnter" ? "Enter the roundabout" : "Continue";
      maneuvers.push({ instruction: `${instruction}${road ? ` onto ${road}` : ""}`.slice(0, 240),
        distanceMeters: Math.round(step.Distance ?? 0), durationSeconds: Math.round(step.Duration ?? 0),
        beginShapeIndex: indexInRoute(step.GeometryOffset ?? 0),
        endShapeIndex: indexInRoute(steps[index + 1]?.GeometryOffset ?? line.length - 1) });
    }
  }
  if (durationSeconds <= 0 || distanceMeters <= 0) throw unavailable();
  return { provider: "amazon-location", points, distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(durationSeconds), includesFerry: routeUsesFerry(route), maneuvers: maneuvers.slice(0, 120) };
}

export async function calculateAmazonDriverRoute(origin: Coordinate, destination: Coordinate, avoidFerries: boolean) {
  const response = await new GeoRoutesClient({ region: region(), maxAttempts: 1 }).send(new CalculateRoutesCommand({
    Origin: [origin.longitude, origin.latitude], Destination: [destination.longitude, destination.latitude],
    TravelMode: "Car", OptimizeRoutingFor: "FastestRoute", LegGeometryFormat: "Simple", TravelStepType: "TurnByTurn",
    Languages: ["en"], ...(avoidFerries ? { Avoid: { Ferries: true }, MaxAlternatives: 2 } : {}),
  }), { abortSignal: AbortSignal.timeout(12_000) }).catch(() => { throw providerUnavailable(); });
  return normalizeAmazonDriverRoute(response.Routes ?? [], avoidFerries);
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
