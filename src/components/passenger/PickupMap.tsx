"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FALLBACK_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

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
};

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
}: PickupMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const locationMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === "undefined");
  const [mapState, setMapState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [locationState, setLocationState] = useState<"idle" | "locating" | "found" | "denied">("idle");

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
    const markers: import("maplibre-gl").Marker[] = [];

    const start = async () => {
      setMapState("loading");
      try {
        const maplibregl = await import("maplibre-gl");
        if (disposed || !containerRef.current) return;
        maplibreRef.current = maplibregl;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: process.env.NEXT_PUBLIC_MIRELI_MAP_STYLE_URL || FALLBACK_STYLE_URL,
          center: [origin.lng, origin.lat],
          zoom: 12.4,
          scrollZoom: false,
          cooperativeGestures: true,
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
        });

        map.on("error", (event) => {
          if (disposed) return;
          const message = event?.error?.message ?? "";
          if (/style|stylesheet|json|sprite/i.test(message)) setMapState("error");
        });
      } catch {
        if (!disposed) setMapState("error");
      }
    };

    void start();

    return () => {
      disposed = true;
      for (const marker of markers) marker.remove();
      locationMarkerRef.current?.remove();
      locationMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [nearViewport, origin.id, origin.lat, origin.lng, stops, cabs, selectedStopId]);

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
            {cabCount > 0 ? `${cabCount} cab${cabCount > 1 ? "s" : ""} ready` : "Mombasa"}
          </span>
        </div>
      </div>
    </section>
  );
}
