import { calculateServiceRoute, navigationRoutingConfigured } from "@/lib/driver/navigation";

type Point = { lat: number; lng: number };
const entries = new Map<string, { expiresAt: number; estimate: Promise<number | null> }>();
const CACHE_MS = 45_000;
const MAX_ENTRIES = 120;

export function passengerPickupEta(tripId: string, origin: Point, pickup: Point) {
  if (!navigationRoutingConfigured()) return Promise.resolve(null);
  const key = [tripId, pickup.lat, pickup.lng].join(":");
  const now = Date.now();
  const cached = entries.get(key);
  if (cached && cached.expiresAt > now) return cached.estimate;
  if (entries.size >= MAX_ENTRIES && !cached) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  const point = ({ lat, lng }: Point) => ({ latitude: lat, longitude: lng });
  const estimate = calculateServiceRoute(point(origin), point(pickup), false)
    .then(route => route.durationSeconds > 0 && Number.isFinite(route.durationSeconds) ? route.durationSeconds : null)
    .catch(() => null);
  entries.set(key, { expiresAt: now + CACHE_MS, estimate });
  return estimate;
}
