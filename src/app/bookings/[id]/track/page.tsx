"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { SiteFooter, SiteHeader, SiteNav } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, useMe } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import { ArrowLeft, MapPin, Radio } from "lucide-react";
import Link from "next/link";
import { PASSENGER_TERMINUS } from "@/lib/passenger-terminus";

type TrackData = {
  bookingCode: string;
  bookingStatus: string;
  departureAt: string | null;
  phase: "no_trip" | "scheduled" | "boarding" | "on_the_road" | "unavailable";
  etaSeconds: number | null;
  canEstimatePickup: boolean;
  pickup: { name: string; lat: number; lng: number } | null;
  target: { name: string; lat: number; lng: number } | null;
  route: number[][] | null;
  cab: {
    lat: number;
    lng: number;
    bearingDeg: number | null;
    recordedAt: string;
  } | null;
};

const POLL_MS = 5_000;
const ROUTE_SOURCE = "passenger-trip-route";

function routeKey(track: TrackData) {
  const target = track.target;
  return track.cab && target ? `${target.lng}:${target.lat}:${track.canEstimatePickup}` : null;
}

/**
 * Bolt-style live tracking for one booking. The map is the same MapLibre
 * engine as the booking map; the marker is the passenger's own cab's newest
 * GPS fix, polled and glided between polls. No driver identity is shown
 * beyond what the bookings list already shows.
 */
export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const { me, loading: meLoading } = useMe();
  return <TrackingPage key={id + ":" + (me?.session?.id ?? "")} id={id} sessionId={me?.session?.id} meLoading={meLoading} />;
}

function TrackingPage({ id, sessionId, meLoading }: { id: string; sessionId?: string; meLoading: boolean }) {
  const [track, setTrack] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [route, setRoute] = useState<{ key: string; coordinates: TrackData["route"]; eta: number | null } | null>(null);

  useEffect(() => {
    if (!sessionId || !id) return;
    const controller = new AbortController();
    const endpoint = "/api/bookings/" + encodeURIComponent(id) + "/track";
    let timer: number | undefined;
    let routeTimer = 0;
    let routeRequest = 0;
    let lastRouteKey: string | null = null;
    let pending: AbortController | undefined;
    const poll = async () => {
      let timeout: number | undefined;
      try {
        if (document.hidden) return;
        pending = new AbortController();
        const request = pending;
        timeout = window.setTimeout(() => request.abort(), 12_000);
        const res = await fetch(endpoint, { cache: "no-store", signal: request.signal });
        if (controller.signal.aborted) return;
        if (res.status === 401 || res.status === 404) {
          setTrack(null);
          setError(res.status === 401 ? "Sign in to track your ride." : "Booking not found.");
          controller.abort();
          return;
        }
        if (!res.ok) throw new Error("Could not refresh tracking");
        const data: TrackData = await res.json();
        if (controller.signal.aborted) return;
        setTrack(data);
        setError(null);
        if (data.phase === "unavailable") {
          controller.abort();
          return;
        }
        const key = routeKey(data);
        if (key !== lastRouteKey) {
          lastRouteKey = key;
          routeRequest++;
          routeTimer = 0;
          setRoute(null);
        }
        if (key && Date.now() >= routeTimer) {
          routeTimer = Date.now() + 45_000;
          const requestNumber = ++routeRequest;
          void api<TrackData>(endpoint + "?eta=1", { signal: controller.signal, timeoutMs: 14_000 })
            .then(estimate => {
              if (!controller.signal.aborted && requestNumber === routeRequest) {
                setRoute(routeKey(estimate) === key ? { key, coordinates: estimate.route, eta: estimate.etaSeconds } : null);
              }
            })
            .catch(() => { if (!controller.signal.aborted && requestNumber === routeRequest) setRoute(null); });
        }
      } catch {
        if (!controller.signal.aborted) {
          routeRequest++;
          routeTimer = 0;
          setError("Could not refresh the cab’s location. Retrying…");
          setRoute(null);
        }
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
        pending = undefined;
        if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), POLL_MS);
      }
    };
    void poll();
    return () => {
      controller.abort();
      pending?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [sessionId, id]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <SiteNav />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-6 sm:max-w-2xl">
        <div className="flex items-center gap-2 py-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <Link href="/bookings" aria-label="Back to my rides">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-base font-semibold">Live ride tracking</h1>
        </div>

        {meLoading ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : !sessionId ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Sign in to track your ride.
            </CardContent>
          </Card>
        ) : error && !track ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">{error}</CardContent>
          </Card>
        ) : !track ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : (
          <>
            {error && <p role="status" className="mb-3 text-sm text-muted-foreground">{error}</p>}
            {track.phase === "unavailable" ? (
              <Card><CardContent className="p-4 text-sm">Live tracking is unavailable for this booking.</CardContent></Card>
            ) : (
              <TrackView
                track={error ? { ...track, cab: null } : track}
                route={!error && route?.key === routeKey(track) ? route : null}
              />
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function TrackView({ track, route }: { track: TrackData; route: { coordinates: TrackData["route"]; eta: number | null } | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const cabMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const pickupMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const glideRef = useRef<{ lng: number; lat: number; toLng: number; toLat: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const cab = track.cab;
  const eta = route?.eta ?? null;

  // Map lifecycle: created once per mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let animationFrame: number | undefined;
    let resizeObserver: ResizeObserver | null = null;
    let resizeCheck: (() => void) | null = null;

    const start = async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        if (disposed || !containerRef.current) return;
        maplibreRef.current = maplibregl;
        maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
        const { MAP_STYLE_URL } = await import("@/lib/map-proxy");
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: process.env.NEXT_PUBLIC_MIRELI_MAP_STYLE_URL || MAP_STYLE_URL,
          center: [PASSENGER_TERMINUS.lng, PASSENGER_TERMINUS.lat],
          zoom: 12.5,
          scrollZoom: false,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        resizeCheck = () => {
          if (!disposed) map.resize();
        };
        resizeCheck();
        resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resizeCheck);
        resizeObserver?.observe(container);
        window.addEventListener("resize", resizeCheck);
        window.visualViewport?.addEventListener("resize", resizeCheck);
        map.on("load", () => {
          if (disposed) return;
          map.addSource(ROUTE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({
            id: ROUTE_SOURCE, source: ROUTE_SOURCE, type: "line",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#168557", "line-width": 5 },
          });
          setMapReady(true);
          setMapFailed(false);
        });
        map.on("error", () => { if (!disposed && !map.isStyleLoaded()) setMapFailed(true); });
        const glide = () => {
          if (disposed) return;
          const g = glideRef.current;
          if (g) {
            const dLng = g.toLng - g.lng;
            const dLat = g.toLat - g.lat;
            if (Math.abs(dLng) >= 1e-5 || Math.abs(dLat) >= 1e-5) {
              g.lng += dLng * 0.05;
              g.lat += dLat * 0.05;
              cabMarkerRef.current?.setLngLat([g.lng, g.lat]);
            }
          }
          animationFrame = requestAnimationFrame(glide);
        };
        animationFrame = requestAnimationFrame(glide);
      } catch {
        if (!disposed) setMapFailed(true);
      }
    };
    void start();
    return () => {
      disposed = true;
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      if (resizeCheck) {
        window.removeEventListener("resize", resizeCheck);
        window.visualViewport?.removeEventListener("resize", resizeCheck);
      }
      cabMarkerRef.current?.remove();
      pickupMarkerRef.current?.remove();
      cabMarkerRef.current = null;
      pickupMarkerRef.current = null;
      glideRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const targetLat = track.target?.lat;
  const targetLng = track.target?.lng;
  const targetName = track.target?.name;
  const coordinates = route?.coordinates;

  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.getSource<import("maplibre-gl").GeoJSONSource>(ROUTE_SOURCE)?.setData({
      type: "FeatureCollection",
      features: coordinates ? [{
        type: "Feature", properties: {}, geometry: { type: "LineString", coordinates },
      }] : [],
    });
  }, [mapReady, coordinates]);

  // The target switches from pickup to drop-off as the passenger boards.
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !mapReady) return;
    if (targetLng === undefined || targetLat === undefined || !targetName) {
      pickupMarkerRef.current?.remove();
      pickupMarkerRef.current = null;
      return;
    }
    if (!pickupMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "size-4 rounded-full border-4 border-[#168557] bg-white shadow";
      element.setAttribute("aria-hidden", "true");
      pickupMarkerRef.current = new maplibregl.Marker({ element })
        .setLngLat([targetLng, targetLat])
        .addTo(map);
    }
    pickupMarkerRef.current.setLngLat([targetLng, targetLat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setText(targetName));
    const cabPoint = cabMarkerRef.current?.getLngLat();
    if (cabPoint) {
      map.fitBounds(new maplibregl.LngLatBounds(cabPoint, cabPoint).extend([targetLng, targetLat]), { padding: 48, maxZoom: 15 });
    } else {
      map.jumpTo({ center: [targetLng, targetLat] });
    }
  }, [mapReady, targetLng, targetLat, targetName]);

  // Cab marker: created on first fix, glided on every later fix.
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !mapReady) return;
    if (!cab) {
      cabMarkerRef.current?.remove();
      cabMarkerRef.current = null;
      glideRef.current = null;
      return;
    }
    if (!cabMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "pointer-events-none h-11 w-7 bg-[url('/markers/live-cab.svg')] bg-contain bg-center bg-no-repeat drop-shadow-md";
      element.setAttribute("aria-hidden", "true");
      cabMarkerRef.current = new maplibregl.Marker({ element, rotationAlignment: "map" })
        .setLngLat([cab.lng, cab.lat])
        .addTo(map);
      glideRef.current = { lng: cab.lng, lat: cab.lat, toLng: cab.lng, toLat: cab.lat };
      const target = pickupMarkerRef.current?.getLngLat();
      if (target) {
        map.fitBounds(new maplibregl.LngLatBounds(target, target).extend([cab.lng, cab.lat]), { padding: 48, maxZoom: 15 });
      } else {
        map.easeTo({ center: [cab.lng, cab.lat], zoom: 13.5, duration: 900 });
      }
    } else {
      const g = glideRef.current;
      if (g) {
        const north = cab.lat - g.toLat;
        const east = (cab.lng - g.toLng) * Math.cos(cab.lat * Math.PI / 180);
        if (cab.bearingDeg == null && Math.hypot(north, east) > 0.00004) {
          cabMarkerRef.current.setRotation(Math.atan2(east, north) * 180 / Math.PI);
        }
        g.toLng = cab.lng;
        g.toLat = cab.lat;
      }
    }
    if (typeof cab.bearingDeg === "number" && Number.isFinite(cab.bearingDeg)) {
      cabMarkerRef.current.setRotation(cab.bearingDeg);
    }
  }, [mapReady, cab]);

  const phaseLabel =
    track.phase === "on_the_road"
      ? "Your cab is on the road"
      : track.phase === "boarding"
        ? "Boarding"
        : track.phase === "scheduled"
          ? "Waiting for departure"
          : "Cab assignment pending";

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="relative bg-muted">
          <div ref={containerRef} className="relative h-[300px] w-full overflow-hidden" role="img"
            aria-label={`Live map of booking ${track.bookingCode}.`} />
          {!mapReady && (
            <div className="absolute inset-0 grid place-items-center bg-muted text-sm text-muted-foreground">
              {mapFailed ? "Map unavailable on this device." : "Loading the live map…"}
            </div>
          )}
        </div>
        <CardContent className="space-y-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Radio className={`h-4 w-4 ${track.cab ? "text-emerald-600" : "text-muted-foreground"}`} />
              {phaseLabel}
            </p>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-secondary-foreground">
              {track.cab ? "Live" : "Standby"}
            </span>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            {track.target?.name ?? "See your ticket for the agreed pickup or drop-off"}
          </p>
          {track.departureAt && (
            <p className="text-xs text-muted-foreground">
              Departure {fmtDateTime(track.departureAt)}
            </p>
          )}
          {track.canEstimatePickup && eta !== null && (
            <p className="text-sm font-medium">Estimated pickup in {Math.max(1, Math.ceil(eta / 60))} min</p>
          )}
          {cab && <p className="text-xs text-muted-foreground">Location updated {fmtDateTime(cab.recordedAt)}</p>}
          <p className="font-mono text-xs text-muted-foreground">{track.bookingCode}</p>
        </CardContent>
      </Card>
    </div>
  );
}
