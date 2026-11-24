"use client";

import { useCallback, useEffect, useState } from "react";
import AirportRequestForm, { AIRPORT_TRANSFER_OPTIONS, type TransferAirport } from "@/app/airport-transfers/request-form";
import type { MapPoint, RideMapSelection } from "@/components/passenger/PickupMap";
import type { PassengerPlace } from "@/components/passenger/PassengerPlaceLookup";

export function AirportsFlow({ onMapChange }: { onMapChange: (map: RideMapSelection) => void }) {
  const [airport, setAirport] = useState<TransferAirport | null>(null);
  const [place, setPlace] = useState<PassengerPlace | null>(null);
  const [direction, setDirection] = useState<"from" | "to">("from");
  const selectedAirport = AIRPORT_TRANSFER_OPTIONS.find((option) => option.id === airport);

  const selectMapAirport = useCallback((id: string) => {
    const option = AIRPORT_TRANSFER_OPTIONS.find((candidate) => candidate.point.id === id);
    if (option) setAirport(option.id);
  }, []);

  useEffect(() => {
    const anchor = selectedAirport?.point;
    const hasRoute = !!anchor && !!place;
    const stops: MapPoint[] = AIRPORT_TRANSFER_OPTIONS.map((option) => option.point);
    if (hasRoute) stops.push(place);
    onMapChange({
      stops,
      selectedStopId: hasRoute ? place.id : anchor?.id ?? null,
      onSelectStop: selectMapAirport,
      routeOrigin: anchor,
      reverse: direction === "to",
      detail: hasRoute
        ? direction === "to" ? `${place.name} → ${anchor.name}` : `${anchor.name} → ${place.name}`
        : anchor?.name ?? "Tap an airport pin or search by name.",
    });
  }, [selectedAirport, place, direction, onMapChange, selectMapAirport]);

  return (
    <AirportRequestForm
      airport={airport}
      onAirportChange={setAirport}
      direction={direction}
      onDirectionChange={setDirection}
      onPlaceChange={setPlace}
    />
  );
}
