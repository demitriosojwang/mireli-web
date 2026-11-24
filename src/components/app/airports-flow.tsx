"use client";

import { useCallback, useEffect, useState } from "react";
import AirportRequestForm, { AIRPORT_TRANSFER_OPTIONS, type TransferAirport, type TrackedTransfer } from "@/app/airport-transfers/request-form";
import type { MapPoint, RideMapSelection } from "@/components/passenger/PickupMap";
import type { PassengerPlace } from "@/components/passenger/PassengerPlaceLookup";
import { isTransferPin, nearAirport, type TransferPin } from "@/lib/airport-transfer-pins";

export function AirportsFlow({ onMapChange }: { onMapChange: (map: RideMapSelection) => void }) {
  const [airport, setAirport] = useState<TransferAirport | null>(null);
  const [place, setPlace] = useState<PassengerPlace | null>(null);
  const [direction, setDirection] = useState<"from" | "to">("from");
  const [airportOverride, setAirportOverride] = useState<{ airport: TransferAirport; pin: TransferPin } | null>(null);
  const [pinAddress, setPinAddress] = useState<string | null>(null);
  const [pinError, setPinError] = useState("");
  const [tracking, setTracking] = useState<TrackedTransfer | null>(null);
  const selectedAirport = AIRPORT_TRANSFER_OPTIONS.find((option) => option.id === airport);
  const override = airportOverride?.airport === airport ? airportOverride.pin : null;

  const changeAirport = useCallback((nextAirport: TransferAirport | null) => {
    setAirport(nextAirport);
    setAirportOverride(null);
    setPinAddress(null);
    setPinError("");
  }, []);
  const changeDirection = useCallback((nextDirection: "from" | "to") => {
    setDirection(nextDirection);
    setPinAddress(null);
    setPinError("");
  }, []);
  const selectMapAirport = useCallback((id: string) => {
    const option = AIRPORT_TRANSFER_OPTIONS.find((candidate) => candidate.point.id === id);
    if (option) changeAirport(option.id);
  }, [changeAirport]);

  const restorePins = useCallback((draft: { airport: TransferAirport; address: string; addressPin?: TransferPin | null; airportPin?: TransferPin | null }) => {
    if (isTransferPin(draft.addressPin)) {
      setPlace({ id: "private-address", name: draft.address, address: draft.address, ...draft.addressPin });
    }
    if (isTransferPin(draft.airportPin)) setAirportOverride({ airport: draft.airport, pin: draft.airportPin });
  }, []);

  const pickCoordinate = useCallback((pin: TransferPin) => {
    if (pinAddress === null || !airport || !selectedAirport) return;
    if (!isTransferPin(pin) || (direction === "from" && !nearAirport(pin, selectedAirport.point))) {
      setPinError(direction === "from" ? "Choose a pickup pin near this airport." : "Choose a pickup pin on the Kenya coast.");
      return;
    }
    if (direction === "from") setAirportOverride({ airport, pin });
    else setPlace({ id: "private-address", name: pinAddress, address: pinAddress, ...pin });
    setPinAddress(null);
    setPinError("");
  }, [airport, direction, pinAddress, selectedAirport]);

  useEffect(() => {
    if (tracking) {
      const { pickup, dropoff } = tracking.navigation;
      const points: MapPoint[] = [];
      if (isTransferPin(pickup)) points.push({ id: "transfer-pickup", ...pickup });
      if (isTransferPin(dropoff)) points.push({ id: "transfer-dropoff", ...dropoff });
      const id = tracking.status === "in_progress" ? "transfer-dropoff" : "transfer-pickup";
      const position = tracking.position;
      onMapChange({
        stops: points,
        selectedStopId: points.find(point => point.id === id)?.id ?? null,
        detail: `${pickup.name} → ${dropoff.name}`,
        cabs: position ? [{ id: tracking.id, lat: position.lat, lng: position.lng, label: "Your driver" }] : [],
      });
      return;
    }

    const anchor = selectedAirport ? { ...selectedAirport.point, ...override } : undefined;
    const hasRoute = !!anchor && !!place;
    const stops: MapPoint[] = AIRPORT_TRANSFER_OPTIONS.map((option) => option.id === airport && anchor ? anchor : option.point);
    if (hasRoute) stops.push(place);
    onMapChange({
      stops,
      selectedStopId: hasRoute ? place.id : anchor?.id ?? null,
      onSelectStop: pinAddress === null ? selectMapAirport : undefined,
      onPickCoordinate: pinAddress !== null ? pickCoordinate : undefined,
      routeOrigin: hasRoute ? anchor : undefined,
      reverse: direction === "to",
      detail: pinAddress !== null ? "Tap the map to place your pickup pin." : hasRoute
        ? direction === "to" ? `${place.name} → ${anchor.name}` : `${anchor.name} → ${place.name}`
        : anchor?.name ?? "Tap an airport pin or search by name.",
    });
  }, [airport, selectedAirport, override, place, direction, pinAddress, pickCoordinate, onMapChange, selectMapAirport, tracking]);

  return (
    <AirportRequestForm
      airport={airport}
      onAirportChange={changeAirport}
      direction={direction}
      onDirectionChange={changeDirection}
      place={place}
      airportPin={override}
      onPlaceChange={setPlace}
      onRestorePins={restorePins}
      pinPicking={pinAddress !== null}
      pinError={pinError}
      onAdjustPickup={(address) => {
        setTracking(null);
        setPinError("");
        setPinAddress(address);
        document.getElementById("passenger-ride-map")?.scrollIntoView({ block: "nearest" });
      }}
      onCancelPin={() => { setPinAddress(null); setPinError(""); }}
      onTrack={setTracking}
    />
  );
}
