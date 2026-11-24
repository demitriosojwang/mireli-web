"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import type { MapPoint } from "./PickupMap";

export type PassengerPlace = MapPoint & { address: string };

type PlaceResult = { id: string; name: string; detail: string; latitude: number; longitude: number };
type LookupResult = { query: string; places: PlaceResult[]; error?: string };

export function PassengerPlaceLookup({ address, onSelect }: {
  address: string;
  onSelect: (place: PassengerPlace) => void;
}) {
  const [result, setResult] = useState<LookupResult | null>(null);
  const [pendingQuery, setPendingQuery] = useState("");
  const request = useRef<AbortController | null>(null);
  const query = address.trim();
  useEffect(() => () => request.current?.abort(), [query]);

  async function findAddress() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPendingQuery(query);
    setResult(null);
    try {
      const { places } = await api<{ places: PlaceResult[] }>("/api/ride-map", {
        body: { action: "places", query },
        signal: controller.signal,
        timeoutMs: 12_000,
      });
      if (!controller.signal.aborted) setResult({ query, places });
    } catch (error) {
      if (!controller.signal.aborted) setResult({
        query, places: [],
        error: error instanceof Error ? error.message : "Could not find that address.",
      });
    } finally {
      if (request.current === controller) setPendingQuery("");
    }
  }

  const current = result?.query === query ? result : null;
  const loading = !!query && pendingQuery === query;
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={findAddress}
        disabled={query.length < 3 || query.length > 120 || loading}>
        <Search className="size-4" aria-hidden /> {loading ? "Looking up address…" : "Find address on map"}
      </Button>
      {current && !current.places.length && (
        <p role="status" className="text-xs text-muted-foreground">{current.error ?? "No nearby match. Try a landmark, estate or hotel name."}</p>
      )}
      {current && current.places.length > 0 && (
        <ul aria-label="Matching addresses" className="divide-y">
          {current.places.map((place) => (
            <li key={place.id}>
              <button type="button" className="flex min-h-11 w-full items-start gap-2 py-2 text-start text-sm hover:bg-primary/5" onClick={() => {
                setResult(null);
                const address = place.detail ? `${place.name}, ${place.detail}` : place.name;
                onSelect({ id: "private-address", name: place.name, address: address.slice(0, 160), lat: place.latitude, lng: place.longitude });
              }}>
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{place.name}{place.detail && <span className="block text-xs text-muted-foreground">{place.detail}</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
