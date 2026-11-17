import "server-only";

import { GeoPlacesClient, SearchTextCommand } from "@aws-sdk/client-geo-places";
import { CalculateRoutesCommand, GeoRoutesClient } from "@aws-sdk/client-geo-routes";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";
import { hasCompleteOffstageStageLocations, isMombasaCoastLocation, nearestOffstageStage } from "@/lib/offstage-quote-core";
import type { GeoLocation, OffstageStage } from "@/lib/offstage-quote-core";

const LOCATION_REGION = "eu-north-1";
export { hasCompleteOffstageStageLocations } from "@/lib/offstage-quote-core";
export type { OffstageStage } from "@/lib/offstage-quote-core";

export class OffstageQuoteError extends Error {
  constructor(
    readonly code: "OFFSTAGE_NOT_ENABLED" | "ADDRESS_NOT_FOUND" | "NO_DRIVING_ROUTE" | "QUOTE_UNAVAILABLE",
  ) {
    super(code);
    this.name = "OffstageQuoteError";
  }
}

/** Shared off-stage service stays hidden outside strict production and until the owner approves exact routes. */
export function getEnabledOffstageQuoteRouteIds(): string[] {
  if (process.env.NODE_ENV !== "production" || process.env.MIRELI_DEMO_MODE !== "false" ||
      process.env.AWS_REGION !== LOCATION_REGION || isLocalDemoEnabled()) return [];

  return [...new Set((process.env.MIRELI_OFFSTAGE_VERIFIED_ROUTE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 100))].slice(0, 100);
}

export function isOffstageQuoteRouteEnabled(routeId: string): boolean {
  return getEnabledOffstageQuoteRouteIds().includes(routeId);
}

export function findNearestOffstageStage(stages: OffstageStage[], location: { latitude: number; longitude: number }): OffstageStage {
  if (!isMombasaCoastLocation(location)) throw new OffstageQuoteError("ADDRESS_NOT_FOUND");
  const nearest = nearestOffstageStage(stages, location);
  if (!nearest) throw new OffstageQuoteError("OFFSTAGE_NOT_ENABLED");
  return nearest;
}

/**
 * Geocode once for this quote and immediately route to the nearest eligible
 * stage. Coordinates are deliberately returned only to this function caller
 * and are never persisted or included in the API response.
 */
export async function quoteOffstageAddress(
  routeId: string,
  address: string,
  stages: OffstageStage[],
  direction: "FROM_TERMINUS" | "TO_TERMINUS",
) {
  if (!isOffstageQuoteRouteEnabled(routeId)) throw new OffstageQuoteError("OFFSTAGE_NOT_ENABLED");

  if (!hasCompleteOffstageStageLocations(stages)) throw new OffstageQuoteError("OFFSTAGE_NOT_ENABLED");
  const validStages = stages.filter((stage) => stage.order > 0);
  const query = address.trim();
  if (query.length < 5 || query.length > 200) throw new OffstageQuoteError("ADDRESS_NOT_FOUND");

  const centroid = validStages.reduce((result, stage) => ({
    longitude: result.longitude + stage.lng / validStages.length,
    latitude: result.latitude + stage.lat / validStages.length,
  }), { longitude: 0, latitude: 0 });

  let location: GeoLocation;
  try {
    const geocode = await new GeoPlacesClient({ region: LOCATION_REGION, maxAttempts: 1 }).send(
      new SearchTextCommand({
        QueryText: query,
        MaxResults: 1,
        Language: "en",
        IntendedUse: "SingleUse",
        BiasPosition: [centroid.longitude, centroid.latitude],
        Filter: {
          BoundingBox: [39.2, -4.6, 40.5, -3.0],
          IncludeCountries: ["KEN"],
        },
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    const position = geocode.ResultItems?.[0]?.Position;
    if (!position || position.length !== 2 || !position.every(Number.isFinite)) {
      throw new OffstageQuoteError("ADDRESS_NOT_FOUND");
    }
    location = { longitude: position[0], latitude: position[1] };
    if (!isMombasaCoastLocation(location)) {
      throw new OffstageQuoteError("ADDRESS_NOT_FOUND");
    }
  } catch (error) {
    if (error instanceof OffstageQuoteError) throw error;
    throw new OffstageQuoteError("QUOTE_UNAVAILABLE");
  }

  const nearestStage = findNearestOffstageStage(validStages, location);
  const stagePosition: [number, number] = [nearestStage.lng, nearestStage.lat];
  const addressPosition: [number, number] = [location.longitude, location.latitude];
  const origin = direction === "FROM_TERMINUS" ? stagePosition : addressPosition;
  const destination = direction === "FROM_TERMINUS" ? addressPosition : stagePosition;

  try {
    const result = await new GeoRoutesClient({ region: LOCATION_REGION, maxAttempts: 1 }).send(
      new CalculateRoutesCommand({
        Origin: origin,
        Destination: destination,
        TravelMode: "Car",
        OptimizeRoutingFor: "ShortestRoute",
        Avoid: { Ferries: true },
        LegAdditionalFeatures: ["Summary"],
      }),
      { abortSignal: AbortSignal.timeout(12_000) },
    );
    const route = result.Routes?.[0];
    const legs = route?.Legs ?? [];
    if (!legs.length || legs.some((leg) => leg.Type === "Ferry" || !!leg.FerryLegDetails)) {
      throw new OffstageQuoteError("NO_DRIVING_ROUTE");
    }
    const distanceMeters = legs.reduce((sum, leg) => {
      const distance = leg.VehicleLegDetails?.Summary?.Overview?.Distance;
      return distance === undefined || !Number.isFinite(distance) || distance < 0 ? Number.NaN : sum + distance;
    }, 0);
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || !Number.isSafeInteger(Math.round(distanceMeters))) {
      throw new OffstageQuoteError("NO_DRIVING_ROUTE");
    }
    return { nearestStage, distanceMeters: Math.round(distanceMeters) };
  } catch (error) {
    if (error instanceof OffstageQuoteError) throw error;
    throw new OffstageQuoteError("QUOTE_UNAVAILABLE");
  }
}
