"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

type PickupMapProps = {
  origin?: MapPoint;
  stops?: MapPoint[];
  cabs?: MapCab[];
  cabCount?: number;
  selectedStopId?: string | null;
  heightClassName?: string;
  caption?: string;
  detail?: string;
  showLocation?: boolean;
  /** Poll the newest GPS fix of every active pooled cab and glide the markers to it. */
  live?: boolean;
};

type LiveCabFix = {
  id: string;
  lat: number;
  lng: number;
};

const LIVE_POLL_MS = 5_000;

/**
 * Passenger-side map. It runs on the same MapLibre engine and OpenFreeMap style
 * as the driver app so both products look and behave like one service.
 *
 * The map is loaded only once it is close to the viewport, so it never competes
 * with the booking controls for first paint. Location is requested only after
 * the passenger asks for it.
 */
export default function PickupMap({
  origin = { id: "mombasa-terminus", name: "Mombasa Terminus", lat: -4.0214, lng: 39.5802 },
  stops = [],
  cabs = [],
  cabCount = 0,
  selectedStopId = null,
  heightClassName = "h-[220px]",
  caption = "Your pickup area",
  detail = "Mombasa Terminus · Miritini",
  showLocation = true,
  live = true,
}: PickupMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const locationMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const liveLayerRef = useRef<
    Map<string, { marker: import("maplibre-gl").Marker; lng: number; lat: number; toLng: number; toLat: number }>
  >(new Map());
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === "undefined");
  const [mapState, setMapState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [locationState, setLocationState] = useState<"idle" | "locating" | "found" | "denied">("idle");
  const [liveCabCount, setLiveCabCount] = useState(0);

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
    let liveTimer: number | undefined;
    let animationFrame: number | undefined;
    const markers: import("maplibre-gl").Marker[] = [];
    const cabLayer = liveLayerRef.current;

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

        map.on("load", () => {
          if (disposed) return;
          const originElement = document.createElement("div");
          originElement.className = "mireli-map-marker mireli-map-marker--origin";
          originElement.setAttribute("aria-hidden", "true");
          markers.push(new maplibregl.Marker({ element: originElement })
            .setLngLat([origin.lng, origin.lat])
            .setPopup(new maplibregl.Popup({ offset: 12 }).setText(origin.name))
            .addTo(map));

          for (const stop of stops) {
            const stopElement = document.createElement("div");
            stopElement.className = stop.id === selectedStopId
              ? "mireli-map-marker mireli-map-marker--stop mireli-map-marker--selected"
              : "mireli-map-marker mireli-map-marker--stop";
            stopElement.setAttribute("aria-hidden", "true");
            markers.push(new maplibregl.Marker({ element: stopElement })
              .setLngLat([stop.lng, stop.lat])
              .setPopup(new maplibregl.Popup({ offset: 12 }).setText(stop.name))
              .addTo(map));
          }

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

          if (live) {
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
            liveTimer = window.setInterval(() => void poll(), LIVE_POLL_MS);

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
          }
        });

        map.on("error", (event) => {
          if (disposed) return;
          const message = event?.error?.message ?? "";
          if (!map.isStyleLoaded() || /style|stylesheet|json|sprite/i.test(message)) setMapState("error");
        });
      } catch {
        if (!disposed) setMapState("error");
      }
    };

    void start();

    return () => {
      disposed = true;
      if (liveTimer !== undefined) window.clearInterval(liveTimer);
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      for (const marker of markers) marker.remove();
      for (const cab of cabLayer.values()) cab.marker.remove();
      cabLayer.clear();
      setLiveCabCount(0);
      locationMarkerRef.current?.remove();
      locationMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [nearViewport, origin.id, origin.lat, origin.lng, stops, cabs, selectedStopId, live]);

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setLocationState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const maplibregl = maplibreRef.current;
        const map = mapRef.current;
        if (!maplibregl || !map) {
          setLocationState("found");
          return;
        }
        const element = document.createElement("div");
        element.className = "mireli-map-marker mireli-map-marker--me";
        element.setAttribute("aria-hidden", "true");
        locationMarkerRef.current?.remove();
        locationMarkerRef.current = new maplibregl.Marker({ element })
          .setLngLat([position.coords.longitude, position.coords.latitude])
          .addTo(map);
        setLocationState("found");
      },
      () => setLocationState("denied"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
    );
  }, []);

  const stopLabel = stops.length > 0 ? `${stops.length} approved stop${stops.length > 1 ? "s" : ""} · ${detail}` : detail;

  return (
    <section className="overflow-hidden rounded-2xl border bg-card" aria-label={caption}>
      <div className="relative bg-muted">
        <div
          ref={containerRef}
          className={`w-full ${heightClassName}`}
          role="img"
          aria-label={`${caption}. ${stopLabel}.`}
        />
        {mapState !== "ready" && (
          <div className="absolute inset-0 grid place-items-center bg-muted px-4 text-center">
            <div>
              <p className="text-xs font-medium text-foreground">
                {mapState === "error" ? "Map unavailable" : "Loading your pickup area…"}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {mapState === "error" ? "Your booking options below are unaffected." : "Checking the Mombasa terminus and nearby stops."}
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{caption}</p>
          <p className="truncate text-xs text-muted-foreground">
            {stopLabel}
            {locationState === "found" ? " · your location is on the map" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showLocation && mapState === "ready" && (locationState === "idle" || locationState === "denied") && (
            <button
              type="button"
              onClick={requestLocation}
              className="rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            >
              {locationState === "denied" ? "Retry location" : "Use my location"}
            </button>
          )}
          <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-secondary-foreground">
            {liveCabCount > 0
              ? `${liveCabCount} live`
              : cabCount > 0
                ? `${cabCount} cab${cabCount > 1 ? "s" : ""} ready`
                : "Mombasa"}
          </span>
        </div>
      </div>
    </section>
  );
}
