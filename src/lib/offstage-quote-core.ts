export type OffstageStage = {
  id: string;
  routeId: string;
  name: string;
  order: number;
  lat: number;
  lng: number;
  fare: number;
  homeSurcharge: number;
};

export type GeoLocation = { latitude: number; longitude: number };

const MOMBASA_COAST_BOUNDS = {
  minLat: -4.6,
  maxLat: -3.0,
  minLng: 39.2,
  maxLng: 40.5,
} as const;

export function isMombasaCoastLocation(location: GeoLocation): boolean {
  return Number.isFinite(location.latitude) && Number.isFinite(location.longitude) &&
    location.latitude >= MOMBASA_COAST_BOUNDS.minLat && location.latitude <= MOMBASA_COAST_BOUNDS.maxLat &&
    location.longitude >= MOMBASA_COAST_BOUNDS.minLng && location.longitude <= MOMBASA_COAST_BOUNDS.maxLng;
}

export function hasCompleteOffstageStageLocations(
  stages: Array<Pick<OffstageStage, "name" | "order" | "lat" | "lng" | "fare">>,
): boolean {
  const customerStages = stages.filter((stage) => stage.order > 0);
  return customerStages.length > 0 && customerStages.every((stage) =>
    stage.name.trim().length > 0 && Number.isSafeInteger(stage.fare) && stage.fare > 0 &&
    isMombasaCoastLocation({ latitude: stage.lat, longitude: stage.lng }));
}

function haversineMeters(stage: Pick<OffstageStage, "lat" | "lng">, location: GeoLocation): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(location.latitude - stage.lat);
  const dLng = radians(location.longitude - stage.lng);
  const startLat = radians(stage.lat);
  const endLat = radians(location.latitude);
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;
  const bounded = Math.min(1, Math.max(0, haversine));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}

/** Select the nearest by straight-line distance; the server then prices its road route. */
export function nearestOffstageStage(stages: OffstageStage[], location: GeoLocation): OffstageStage | null {
  if (!isMombasaCoastLocation(location) || !hasCompleteOffstageStageLocations(stages)) return null;
  return stages.filter((stage) => stage.order > 0).reduce((nearest, candidate) =>
    haversineMeters(candidate, location) < haversineMeters(nearest, location) ? candidate : nearest,
  );
}
