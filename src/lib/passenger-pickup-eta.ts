import { calculateServiceRoute, navigationRoutingConfigured } from "@/lib/driver/navigation";

type Point = { lat: number; lng: number };
type TripRoute = { durationSeconds: number; coordinates: number[][] };
const entries = new Map<string, { expiresAt: number; route: Promise<TripRoute | null> }>();
const CACHE_MS = 45_000;
const MAX_ENTRIES = 120;

/** Valhalla encodes latitude first at six decimal places; GeoJSON is longitude first. */
function decodePolyline6(encoded: string): number[][] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const points: number[][] = [];
  const readDelta = () => {
    let value = 0;
    for (let shift = 0; shift <= 25 && index < encoded.length; shift += 5) {
      const group = encoded.charCodeAt(index++) - 63;
      if (group < 0 || group > 63) break;
      value |= (group & 31) << shift;
      if (group < 32) return value & 1 ? ~(value >> 1) : value >> 1;
    }
    throw new Error("Invalid route geometry");
  };
  while (index < encoded.length) {
    lat += readDelta();
    lng += readDelta();
    if (Math.abs(lat) > 90e6 || Math.abs(lng) > 180e6 || points.length >= 16_000) return [];
    points.push([lng / 1e6, lat / 1e6]);
  }
  return points;
}

export function passengerTrackingRoute(tripId: string, origin: Point, target: Point) {
  if (!navigationRoutingConfigured()) return Promise.resolve(null);
  const key = [tripId, target.lat, target.lng].join(":");
  const now = Date.now();
  const cached = entries.get(key);
  if (cached && cached.expiresAt > now) return cached.route;
  if (entries.size >= MAX_ENTRIES && !cached) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  const point = ({ lat, lng }: Point) => ({ latitude: lat, longitude: lng });
  const route = calculateServiceRoute(point(origin), point(target), false)
    .then(result => {
      if (result.durationSeconds <= 0 || !Number.isFinite(result.durationSeconds)) return null;
      const coordinates = "points" in result ? result.points : decodePolyline6(result.geometry);
      return { durationSeconds: result.durationSeconds, coordinates };
    })
    .catch(() => null);
  entries.set(key, { expiresAt: now + CACHE_MS, route });
  return route;
}
