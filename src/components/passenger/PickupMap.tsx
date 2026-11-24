"use client";

import { PASSENGER_TERMINUS } from "@/lib/passenger-terminus";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { MAP_STYLE_URL } from "@/lib/map-proxy";

export type MapPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

export type MapCab = {
  id: string;
  lat: number;
  lng: number;
  label?: string;
};

export type RideMapSelection = {
  stops: MapPoint[];
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  detail: string;
  reverse?: boolean;
  routeOrigin?: MapPoint;
};

type PickupMapProps = {
  origin?: MapPoint;
  stops?: MapPoint[];
  cabs?: MapCab[];
  cabCount?: number;
  selectedStopId?: string | null;
  onSelectStop?: (id: string) => void;
  heightClassName?: string;
  caption?: string;
  detail?: string;
  showLocation?: boolean;
  /** Poll the newest GPS fix of every active pooled cab and glide the markers to it. */
  live?: boolean;
  /** Reframe the map to include origin + all stops whenever the stop set changes. */
  fitStops?: boolean;
  reverse?: boolean;
  routeOrigin?: MapPoint;
};

type LiveCabFix = {
  id: string;
  lat: number;
  lng: number;
};

const LIVE_POLL_MS = 5_000;

/** Shared empty defaults: a fresh `[]` literal per render would retrigger the map effect. */
const EMPTY_STOPS: MapPoint[] = [];
const EMPTY_CABS: MapCab[] = [];

/**
 * Passenger-side map. It runs on the same MapLibre engine and OpenFreeMap style
 * as the driver app so both products look and behave like one service.
 *
 * The map is loaded only once it is close to the viewport, so it never competes
 * with the booking controls for first paint. Location is requested only after
 * the passenger asks for it.
 */
export default function PickupMap({
  origin = PASSENGER_TERMINUS,
  stops = EMPTY_STOPS,
  cabs = EMPTY_CABS,
  cabCount = 0,
  selectedStopId = null,
  onSelectStop,
  heightClassName = "h-[220px]",
  caption = "Your pickup area",
  detail = "Mombasa Terminus · Miritini",
  showLocation = true,
  live = true,
  fitStops = false,
  reverse = false,
  routeOrigin,
}: PickupMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const locationMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const stopSelectionRef = useRef(onSelectStop);
  const stopMarkersRef = useRef<Map<string, import("maplibre-gl").Marker>>(new Map());
  const liveLayerRef = useRef<
    Map<string, { marker: import("maplibre-gl").Marker; lng: number; lat: number; toLng: number; toLat: number }>
  >(new Map());
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === "undefined");
  const mapReadyRef = useRef(false);
  const [mapReady, setMapReady] = useState(0);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [mapState, setMapState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [locationState, setLocationState] = useState<"idle" | "locating" | "found" | "denied" | "unavailable">("idle");
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [liveCabCount, setLiveCabCount] = useState(0);
  const endpoint = stops.find((stop) => stop.id === selectedStopId);
  const routeAnchor = routeOrigin ?? origin;
  const start = reverse ? endpoint : routeAnchor;
  const end = reverse ? routeAnchor : endpoint;
  const routeKey = start && end ? `${start.lat},${start.lng}:${end.lat},${end.lng}` : "";
  const [preview, setPreview] = useState<{ key: string; points?: [number, number][]; km?: number; minutes?: number; error?: string } | null>(null);
  const [pendingRoute, setPendingRoute] = useState("");
  const routeRequest = useRef<AbortController | null>(null);
  const activePreview = preview?.key === routeKey ? preview : null;
  useEffect(() => () => routeRequest.current?.abort(), [routeKey]);

  async function previewRoute() {
    if (!start || !end || pendingRoute === routeKey) return;
    routeRequest.current?.abort();
    const controller = new AbortController();
    routeRequest.current = controller;
    setPendingRoute(routeKey);
    const coordinate = (point: MapPoint) => ({ latitude: point.lat, longitude: point.lng });
    try {
      const result = await api<{ points: [number, number][]; distanceMeters: number; durationSeconds: number }>("/api/ride-map", {
        body: { action: "route", origin: coordinate(start), destination: coordinate(end) },
        signal: controller.signal,
        timeoutMs: 15_000,
      });
      if (!controller.signal.aborted) setPreview({
        key: routeKey,
        points: result.points,
        km: Math.round(result.distanceMeters / 100) / 10,
        minutes: Math.max(1, Math.round(result.durationSeconds / 60)),
      });
    } catch (error) {
      if (!controller.signal.aborted) setPreview({ key: routeKey, error: error instanceof Error ? error.message : "Could not load the driving route." });
    } finally {
      if (routeRequest.current === controller) setPendingRoute("");
    }
  }

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport) return;
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let resizeCheck: (() => void) | null = null;
    let loadTimeout: number | undefined;
    const markers: import("maplibre-gl").Marker[] = [];

    const start = async () => {
      setMapState("loading");
      try {
        const maplibregl = await import("maplibre-gl");
        if (disposed || !containerRef.current) return;
        maplibreRef.current = maplibregl;
        // Vector tiles are parsed in a web worker. The bundler cannot emit
        // that worker, so it is published in `public/` at build time.
        maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: process.env.NEXT_PUBLIC_MIRELI_MAP_STYLE_URL || MAP_STYLE_URL,
          center: [origin.lng, origin.lat],
          zoom: 12.4,
          scrollZoom: false,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        // The container can be laid out before the map measures it (iOS Safari
        // resizes mid-load); a late ResizeObserver-driven check keeps the canvas
        // from spilling over the footer controls.
        resizeCheck = () => {
          if (!disposed) map.resize();
        };
        resizeCheck();
        resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resizeCheck);
        resizeObserver?.observe(containerRef.current);
        window.addEventListener("resize", resizeCheck);
        window.visualViewport?.addEventListener("resize", resizeCheck);

        loadTimeout = window.setTimeout(() => {
          if (!disposed && !mapReadyRef.current) setMapState("error");
        }, 10_000);
        map.on("load", () => {
          if (disposed) return;
          window.clearTimeout(loadTimeout);
          const originElement = document.createElement("div");
          originElement.className = "mireli-map-marker mireli-map-marker--origin";
          originElement.setAttribute("aria-hidden", "true");
          markers.push(new maplibregl.Marker({ element: originElement })
            .setLngLat([origin.lng, origin.lat])
            .setPopup(new maplibregl.Popup({ offset: 12 }).setText(origin.name))
            .addTo(map));

          for (const cab of cabs) {
            const cabElement = document.createElement("div");
            cabElement.className = "mireli-map-marker mireli-map-marker--cab";
            cabElement.setAttribute("aria-hidden", "true");
            markers.push(new maplibregl.Marker({ element: cabElement })
              .setLngLat([cab.lng, cab.lat])
              .setPopup(new maplibregl.Popup({ offset: 12 }).setText(cab.label || "Pooled cab"))
              .addTo(map));
          }

          setMapState("ready");
          mapReadyRef.current = true;
          setMapReady((ready) => ready + 1);

        });

      } catch {
        if (!disposed) setMapState("error");
      }
    };

    void start();

    return () => {
      disposed = true;
      window.clearTimeout(loadTimeout);
      resizeObserver?.disconnect();
      if (resizeCheck) {
        window.removeEventListener("resize", resizeCheck);
        window.visualViewport?.removeEventListener("resize", resizeCheck);
      }
      for (const marker of markers) marker.remove();
      for (const stopMarker of stopMarkersRef.current.values()) stopMarker.remove();
      stopMarkersRef.current.clear();
      mapReadyRef.current = false;
      locationMarkerRef.current?.remove();
      locationMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [nearViewport, origin.id, origin.name, origin.lat, origin.lng, cabs, mapAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!live || !map || !maplibregl || !mapReadyRef.current || !mapReady) return;
    let disposed = false;
    let animationFrame: number;
    const cabLayer = liveLayerRef.current;
    const syncCabs = (fixes: LiveCabFix[]) => {
      const seen = new Set<string>();
      for (const fix of fixes) {
        if (!fix.id || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) continue;
        seen.add(fix.id);
        const existing = cabLayer.get(fix.id);
        if (existing) {
          existing.toLng = fix.lng;
          existing.toLat = fix.lat;
        } else {
          const element = document.createElement("div");
          element.className = "mireli-map-marker mireli-map-marker--cab mireli-map-marker--live";
          element.setAttribute("aria-hidden", "true");
          const marker = new maplibregl.Marker({ element })
            .setLngLat([fix.lng, fix.lat])
            .setPopup(new maplibregl.Popup({ offset: 12 }).setText("Pooled cab · on its way"))
            .addTo(map);
          cabLayer.set(fix.id, { marker, lng: fix.lng, lat: fix.lat, toLng: fix.lng, toLat: fix.lat });
        }
      }
      for (const [id, cab] of Array.from(cabLayer)) {
        if (!seen.has(id)) {
          cab.marker.remove();
          cabLayer.delete(id);
        }
      }
      setLiveCabCount(cabLayer.size);
    };
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const response = await fetch("/api/live-cabs", { cache: "no-store" });
        if (!response.ok || disposed) return;
        const data = (await response.json()) as { cabs?: LiveCabFix[] };
        if (!disposed) syncCabs(Array.isArray(data.cabs) ? data.cabs : []);
      } catch {
        // The next tick retries; a quiet map beats an error toast.
      }
    };
    void poll();
    const liveTimer = window.setInterval(() => void poll(), LIVE_POLL_MS);
    const glide = () => {
      if (disposed) return;
      for (const cab of cabLayer.values()) {
        const dLng = cab.toLng - cab.lng;
        const dLat = cab.toLat - cab.lat;
        if (Math.abs(dLng) < 1e-5 && Math.abs(dLat) < 1e-5) continue;
        cab.lng += dLng * 0.05;
        cab.lat += dLat * 0.05;
        cab.marker.setLngLat([cab.lng, cab.lat]);
      }
      animationFrame = requestAnimationFrame(glide);
    };
    animationFrame = requestAnimationFrame(glide);
    return () => {
      disposed = true;
      window.clearInterval(liveTimer);
      cancelAnimationFrame(animationFrame);
      for (const cab of cabLayer.values()) cab.marker.remove();
      cabLayer.clear();
    };
  }, [live, mapReady]);

  useEffect(() => { stopSelectionRef.current = onSelectStop; }, [onSelectStop]);

  // Stop markers are synced in place. The map itself is created once, so the
  // stops that arrive after the first paint do not trigger a second basemap
  // load (which used to double the time to a visible map).
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !mapReadyRef.current) return;

    const existing = stopMarkersRef.current;
    const wanted = new Set(stops.map((stop) => stop.id));

    for (const [id, marker] of Array.from(existing)) {
      if (!wanted.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }

    for (const stop of stops) {
      const selected = stop.id === selectedStopId;
      let marker = existing.get(stop.id);
      if (!marker) {
        const element = onSelectStop ? document.createElement("button") : document.createElement("div");
        marker = new maplibregl.Marker({ element }).setLngLat([stop.lng, stop.lat]);
        if (element instanceof HTMLButtonElement && onSelectStop) {
          element.type = "button";
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            stopSelectionRef.current?.(stop.id);
          });
        } else {
          element.setAttribute("aria-hidden", "true");
          marker.setPopup(new maplibregl.Popup({ offset: 12 }).setText(stop.name));
        }
        marker.addTo(map);
        existing.set(stop.id, marker);
      }
      marker.setLngLat([stop.lng, stop.lat]);
      const element = marker.getElement();
      element.className = [
        "mireli-map-marker mireli-map-marker--stop",
        selected ? "mireli-map-marker--selected" : "",
        onSelectStop ? "mireli-map-marker--interactive" : "",
        onSelectStop && /^[A-Z]{3}$/.test(stop.id) ? "mireli-map-marker--airport" : "",
      ].filter(Boolean).join(" ");
      if (onSelectStop) {
        element.setAttribute("aria-label", stop.name);
        element.setAttribute("aria-pressed", String(selected));
        element.textContent = /^[A-Z]{3}$/.test(stop.id) ? stop.id : "";
      }
    }

  }, [stops, selectedStopId, mapReady, onSelectStop]);

  const focusStop = fitStops ? endpoint : null;
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (map && maplibregl && mapReadyRef.current && focusStop) {
      const bounds = new maplibregl.LngLatBounds();
      bounds.extend([routeAnchor.lng, routeAnchor.lat]);
      bounds.extend([focusStop.lng, focusStop.lat]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 400 });
    }
  }, [focusStop, mapReady, routeAnchor.lng, routeAnchor.lat]);

  const routePoints = activePreview?.points;
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !mapReadyRef.current || !mapReady || !routePoints?.length) return;
    const routeLayer = "mireli-road-route";
    map.addSource(routeLayer, { type: "geojson", data: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: routePoints },
    } });
    map.addLayer({
      id: routeLayer, type: "line", source: routeLayer,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#12576a", "line-width": 5 },
    });
    const bounds = new maplibregl.LngLatBounds();
    for (const point of routePoints) bounds.extend(point);
    map.fitBounds(bounds, { padding: 36, maxZoom: 14, duration: 400 });
    return () => {
      if (mapRef.current !== map) return;
      if (map.getLayer(routeLayer)) map.removeLayer(routeLayer);
      if (map.getSource(routeLayer)) map.removeSource(routeLayer);
    };
  }, [mapReady, routePoints]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !mapReadyRef.current || !location) return;
    const element = document.createElement("div");
    element.className = "mireli-map-marker mireli-map-marker--me";
    element.setAttribute("aria-hidden", "true");
    locationMarkerRef.current?.remove();
    locationMarkerRef.current = new maplibre.Marker({ element }).setLngLat(location).addTo(map);
    map.easeTo({ center: location, duration: 500 });
  }, [location, mapReady]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationState("unavailable");
      return;
    }
    setLocationState("locating");
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocation([position.coords.longitude, position.coords.latitude]);
        setLocationState("found");
      },
      error => setLocationState(error.code === 1 ? "denied" : "unavailable"),
      // High accuracy is the point: the driver needs the passenger's real
      // roadside position, not a cell-tower estimate. No cached fixes.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, []);

  const directions = start && end ? new URLSearchParams({
    api: "1",
    travelmode: "driving",
    origin: `${start.lat},${start.lng}`,
    destination: `${end.lat},${end.lng}`,
  }) : null;
  const stopLabel = live && stops.length > 0 ? `${stops.length} approved stop${stops.length > 1 ? "s" : ""} · ${detail}` : detail;

  return (
    <section className="overflow-hidden rounded-2xl border bg-card" aria-label={caption}>
      <div className="relative bg-muted">
        <div
          ref={containerRef}
          className={`relative w-full overflow-hidden ${heightClassName}`}
          role={onSelectStop ? "region" : "img"}
          aria-label={`${caption}. ${stopLabel}.`}
        />
        {mapState !== "ready" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center">
            <div className="rounded-xl bg-card/95 px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-foreground" role="status">
                {mapState === "error" ? "Map unavailable" : "Loading map…"}
              </p>
              {mapState === "error" && (
                <button type="button" onClick={() => setMapAttempt((attempt) => attempt + 1)} className="pointer-events-auto mt-1 min-h-11 text-sm font-semibold text-primary underline">
                  Retry map
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{caption}</p>
          <p className="text-xs text-muted-foreground">{stopLabel}</p>
          <p role="status" className="text-xs text-muted-foreground">
            {locationState === "denied" && "Allow location in your browser settings, then retry."}
            {locationState === "unavailable" && "Could not get your location. You can still choose a stop."}
            {locationState === "found" && (mapState === "ready" ? "Your location is on the map." : "Location found.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {directions && (
            <a href={`https://www.google.com/maps/dir/?${directions}`} target="_blank" rel="noreferrer"
              className="inline-flex min-h-11 items-center rounded-full px-2.5 text-xs font-semibold text-primary underline underline-offset-4">
              Directions
            </a>
          )}
          {showLocation && locationState !== "found" && (
            <button
              type="button"
              onClick={requestLocation}
              disabled={locationState === "locating"}
              className="min-h-11 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            >
              {locationState === "locating" ? "Finding location…" : locationState === "idle" ? "Use my location" : "Retry location"}
            </button>
          )}
          {live && <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-secondary-foreground">
            {liveCabCount > 0
              ? `${liveCabCount} live`
              : cabCount > 0
                ? `${cabCount} cab${cabCount > 1 ? "s" : ""} ready`
                : "Mombasa"}
          </span>}
        </div>
      </div>
      {directions && (
        <div className="flex flex-wrap items-center gap-x-3 border-t px-3.5 py-1">
          <button type="button" onClick={previewRoute} disabled={mapState !== "ready" || pendingRoute === routeKey}
            className="min-h-11 text-sm font-semibold text-primary underline underline-offset-4 disabled:opacity-50">
            {pendingRoute === routeKey ? "Finding driving route…" : "Preview driving route"}
          </button>
          <p role="status" className="text-xs text-muted-foreground">
            {activePreview?.error ?? (activePreview?.points ? `${activePreview.km} km · About ${activePreview.minutes} min` : "")}
          </p>
        </div>
      )}
    </section>
  );
}
