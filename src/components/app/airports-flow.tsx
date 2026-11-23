"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Clock, Loader2, Plane, PlaneLanding, PlaneTakeoff } from "lucide-react";
import { BookingSheet, type BookableTrip, type BookingDraft, type BookableTripWithStages } from "@/components/booking-sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { VehicleTypeIcon } from "@/components/vehicle-type-icon";
import { api } from "@/lib/client";
import { calculateSharedFare } from "@/lib/pricing";
import { calculateVehicleBookingFee } from "@/lib/vehicle-fares";
import { calculateCharterFare } from "@/lib/charter-pricing";
import { calculateCharterVat } from "@/lib/charter-vat";
import { fmtTime, ksh } from "@/lib/format";
import { nairobiToday } from "@/lib/nairobi-time";
import { VEHICLE_CATEGORIES, VEHICLE_CATEGORY_LABELS, vehicleCategoryFromCabType, type VehicleCategory } from "@/lib/vehicle-types";
import { cn } from "@/lib/utils";
import AirportRequestForm from "@/app/airport-transfers/request-form";
import PickupMap from "@/components/passenger/PickupMap";

/** Airport coordinates for the shared map (public geography, not config). */
const AIRPORT_COORDS: Record<string, { lat: number; lng: number }> = {
  MBA: { lat: -4.0348, lng: 39.5942 }, // Moi International, Mombasa
  UKA: { lat: -4.2865, lng: 39.5892 }, // Diani/Ukunda
  MYD: { lat: -3.2236, lng: 40.0994 }, // Malindi International
  LAU: { lat: -2.4008, lng: 40.7269 }, // Manda, Lamu
  VPG: { lat: -3.8736, lng: 39.7833 }, // Vipingo Ridge
};

interface ShuttleSlot {
  id: string;
  direction: "FROM_AIRPORT" | "TO_AIRPORT";
  departTime: string;
}

interface AirportJourney {
  routeId: string;
  stage: { id: string; name: string; order: number; fare: number; homeSurcharge: number };
}

interface AirportRow {
  code: string;
  name: string;
  durationMinutes: number;
  journeys: Record<"FROM_AIRPORT" | "TO_AIRPORT", AirportJourney | null>;
  slots: ShuttleSlot[];
}

interface AirportTripsResponse {
  hasEligibleDrivers: boolean;
  trips: BookableTrip[];
}

interface AirportAvailability {
  key: string;
  hasEligibleDrivers: boolean;
  trips: BookableTrip[];
  error: string | null;
}

const DIRECTION_LABEL: Record<ShuttleSlot["direction"], string> = {
  FROM_AIRPORT: "Airport to terminus",
  TO_AIRPORT: "Terminus to airport",
};

export function AirportsFlow({ openPrivateTransfer = false }: { openPrivateTransfer?: boolean }) {
  const [airports, setAirports] = useState<AirportRow[] | null>(null);
  const [catalogueAttempt, setCatalogueAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [travelDate, setTravelDate] = useState(() => nairobiToday());
  const [selection, setSelection] = useState<{ airportCode: string; slotId: string } | null>(null);
  // Step 1 of the airport flow: the airport the passenger is travelling to or
  // from, chosen on the "Where to?" screen before any slot is picked.
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AirportAvailability | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleCategory | null>(null);
  const [charter, setCharter] = useState(false);
  const [seats, setSeats] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<{ airports: AirportRow[] }>("/api/airports", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setAirports(data.airports);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load airport shuttles. Check your connection and retry.");
      });
    return () => controller.abort();
  }, [catalogueAttempt]);

  const pickedAirport = airports?.find((airport) => airport.code === pickedCode) ?? null;
  const activeAirport = airports?.find((airport) => airport.code === selection?.airportCode) ?? null;
  const activeSlot = activeAirport?.slots.find((slot) => slot.id === selection?.slotId) ?? null;
  const activeJourney = activeSlot ? activeAirport?.journeys[activeSlot.direction] ?? null : null;
  const selectionKey = `${activeAirport?.code ?? ""}:${activeSlot?.id ?? ""}:${travelDate}`;
  const availabilityKey = activeAirport && activeSlot ? `${selectionKey}:${refreshKey}` : null;
  const activeAvailability = availabilityKey && availability?.key === availabilityKey ? availability : null;
  const trips = activeAvailability?.trips ?? null;
  const tripsError = activeSlot && !activeJourney
    ? "This shuttle is being configured for online booking."
    : activeAvailability?.error ?? null;
  const hasEligibleDrivers = activeAvailability?.hasEligibleDrivers ?? null;

  useEffect(() => {
    if (!activeAirport || !activeSlot || !activeJourney) {
      return;
    }

    const controller = new AbortController();
    const requestKey = `${activeAirport.code}:${activeSlot.id}:${travelDate}:${refreshKey}`;
    const params = new URLSearchParams({
      date: travelDate,
      direction: activeSlot.direction,
      trainId: `airport-${activeAirport.code}-${activeSlot.direction}`,
      routeId: activeJourney.routeId,
    });
    api<AirportTripsResponse>(`/api/trips?${params}`, { signal: controller.signal, timeoutMs: 12_000 })
      .then((data) => {
        if (controller.signal.aborted) return;
        setAvailability({
          key: requestKey,
          hasEligibleDrivers: data.hasEligibleDrivers,
          trips: data.trips.filter((trip) => trip.shuttle?.id === activeSlot.id && trip.routeId === activeJourney.routeId),
          error: null,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability({
          key: requestKey,
          hasEligibleDrivers: false,
          trips: [],
          error: "Shuttle availability could not load. Try again.",
        });
      });
    return () => controller.abort();
  }, [activeAirport, activeJourney, activeSlot, refreshKey, travelDate]);

  const vehicleChoices = useMemo(() => {
    const stats = new Map<VehicleCategory, { count: number; minFare: number }>();
    for (const trip of trips ?? []) {
      if (!trip.bookable || !trip.vehicle?.cabType) continue;
      const category = vehicleCategoryFromCabType(trip.vehicle.cabType);
      const entry = stats.get(category) ?? { count: 0, minFare: Infinity };
      entry.count += 1;
      const fare = getAirportFare(trip, activeJourney?.stage.fare ?? 0, 1, false);
      if (fare < entry.minFare) entry.minFare = fare;
      stats.set(category, entry);
    }
    return [...stats.entries()]
      .filter(([category]) => (VEHICLE_CATEGORIES as readonly VehicleCategory[]).includes(category))
      .map(([category, { count, minFare }]) => ({
        category,
        count,
        minFare,
      }));
  }, [trips, activeJourney]);

  const categoryTrips = useMemo(() => (trips ?? []).filter((trip) =>
    trip.bookable && trip.vehicle?.cabType && selectedVehicle === vehicleCategoryFromCabType(trip.vehicle.cabType),
  ), [trips, selectedVehicle]);

  const maxSeats = Math.min(6, Math.max(1, ...categoryTrips.map((trip) => trip.seatsLeft)));
  const visibleTrips = categoryTrips.filter((trip) => charter
    ? trip.seatsLeft === trip.capacity
    : trip.seatsLeft >= seats,
  );

  function chooseSlot(airport: AirportRow, slot: ShuttleSlot) {
    setSelectedVehicle(null);
    setCharter(false);
    setSeats(1);
    setSelection({ airportCode: airport.code, slotId: slot.id });
  }

  function pickAirport(airport: AirportRow) {
    setSelectedVehicle(null);
    setCharter(false);
    setSeats(1);
    setSelection(null);
    setPickedCode(airport.code);
  }

  // Map markers: the terminus plus every airport with published slots, so the
  // passenger sees the network before picking and the route after.
  const airportMapStops = useMemo(() => {
    const stops: { id: string; name: string; lat: number; lng: number }[] = [];
    for (const airport of pickedAirport ? [pickedAirport] : airports ?? []) {
      const coords = AIRPORT_COORDS[airport.code];
      if (coords) stops.push({ id: airport.code, name: airport.name, ...coords });
    }
    return stops;
  }, [airports, pickedAirport]);

  function openBooking(trip: BookableTrip) {
    if (!activeAirport || !activeSlot || !activeJourney || !selectedVehicle || !trip.bookable || trip.routeId !== activeJourney.routeId) return;
    const bookingTrip: BookableTripWithStages = {
      ...trip,
      routeName: `${activeAirport.name} shuttle`,
      stages: [activeJourney.stage],
    };
    setDraft({
      trip: bookingTrip,
      stageId: activeJourney.stage.id,
      travelDate,
      seats: charter ? 1 : seats,
      charter,
      vehicleCategory: selectedVehicle,
      homePickup: false,
      homeAddress: "",
      useCredit: false,
    });
    setSheetOpen(true);
  }

  const fromAirport = activeSlot?.direction === "FROM_AIRPORT";
  const airportName = pickedAirport?.name ?? "";
  const routeSummary = activeSlot
    ? fromAirport
      ? `${airportName} → Mombasa Terminus`
      : `Mombasa Terminus → ${airportName}`
    : pickedAirport ? `Mombasa Terminus ↔ ${airportName}` : "Scheduled rides to and from Mombasa Terminus";

  return (
    <div className="space-y-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-9">
        <div className="lg:sticky lg:top-20">
          <PickupMap
            stops={airportMapStops}
            selectedStopId={pickedCode}
            fitStops
            live={false}
            caption="Airport shuttle map"
            detail={routeSummary}
            heightClassName="h-52 sm:h-64 lg:h-[360px]"
          />
        </div>
        <section className="min-w-0" aria-labelledby="airport-shuttle-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 id="airport-shuttle-title" className="text-xl font-bold tracking-tight">Airport shuttles</h1>
              <p className="mt-1 text-sm text-muted-foreground">Choose an airport and departure.</p>
            </div>
            <label className="text-xs font-medium text-muted-foreground">
              Travel date
              <input
                type="date"
                required
                min={nairobiToday()}
                value={travelDate}
                onChange={(event) => {
                  if (!event.target.value || !event.target.validity.valid) return;
                  setSelectedVehicle(null);
                  setCharter(false);
                  setSeats(1);
                  setTravelDate(event.target.value);
                }}
                className="mt-1 block min-h-11 min-w-36 rounded-xl border border-input bg-background px-2 text-base text-foreground"
              />
            </label>
          </div>
          {error && (
            <div className="mt-4 border-s-2 border-destructive py-1 ps-3">
              <p role="alert" className="text-sm text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => {
                setError(null);
                setCatalogueAttempt((attempt) => attempt + 1);
              }}>Try again</Button>
            </div>
          )}

          {!airports && !error && (
            <div role="status" className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
              Loading airports…
            </div>
          )}

          {airports && !pickedAirport && (
            <div className="mt-6" role="group" aria-labelledby="airport-list-title">
              <h2 id="airport-list-title" className="text-base font-semibold">Which airport?</h2>
              {airports.length === 0 && <p className="text-sm text-muted-foreground">No airport shuttles are listed.</p>}
              {airports.map((airport) => (
                <button
                  key={airport.code}
                  type="button"
                  onClick={() => pickAirport(airport)}
                  className="flex min-h-15 w-full items-center justify-between gap-3 border-b py-3 text-left transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10">
                      <Plane className="h-4.5 w-4.5 text-primary" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{airport.name}</span>
                      <span className="block text-xs text-muted-foreground">{airport.code} · About {airport.durationMinutes} min</span>
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-primary" aria-hidden />
                </button>
              ))}
            </div>
          )}
          {pickedAirport && (
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={() => { setPickedCode(null); setSelection(null); }}
                className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <ArrowLeft className="size-4" aria-hidden /> Change airport
              </button>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{pickedAirport.name}</h2>
                  <p className="text-xs text-muted-foreground">{pickedAirport.code} · About {pickedAirport.durationMinutes} min</p>
                </div>
                <Plane className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              </div>

              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                <SlotColumn
                  label="From the airport"
                  icon={<PlaneLanding className="h-3.5 w-3.5" aria-hidden />}
                  slots={pickedAirport.slots.filter((slot) => slot.direction === "FROM_AIRPORT")}
                  selectedSlotId={activeSlot?.id ?? null}
                  onSelect={(slot) => chooseSlot(pickedAirport, slot)}
                />
                <SlotColumn
                  label="To the airport"
                  icon={<PlaneTakeoff className="h-3.5 w-3.5" aria-hidden />}
                  slots={pickedAirport.slots.filter((slot) => slot.direction === "TO_AIRPORT")}
                  selectedSlotId={activeSlot?.id ?? null}
                  onSelect={(slot) => chooseSlot(pickedAirport, slot)}
                />
              </div>

              {activeSlot && (
                <section className="space-y-3 border-t pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold">Choose your ride</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {DIRECTION_LABEL[activeSlot.direction]} · {fmtTime(`${travelDate}T${activeSlot.departTime}:00+03:00`)} EAT
                      </p>
                    </div>
                    <Plane className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  </div>

                  {tripsError && <p className="text-sm text-destructive" role="alert">{tripsError}</p>}
                  {trips === null && !tripsError && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking drivers and seats…
                    </p>
                  )}
                  {trips !== null && (hasEligibleDrivers === false || vehicleChoices.length === 0) && !tripsError && (
                    <div className="space-y-1.5 py-2">
                      <p className="text-sm text-muted-foreground">
                        {hasEligibleDrivers === false
                          ? "No approved drivers are on duty for this departure yet."
                          : "Cabs for this shuttle are still being confirmed."}
                      </p>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setRefreshKey((value) => value + 1)}
                          className="text-xs font-medium text-primary underline underline-offset-4"
                        >
                          Check again
                        </button>
                        <a href="mailto:mirellisgr001@gmail.com" className="text-xs text-muted-foreground underline underline-offset-4">
                          Contact support
                        </a>
                      </div>
                    </div>
                  )}

                  {vehicleChoices.length > 0 && (
                    <>
                      {/* Riider-style ride list: full-width rows, name and
                          availability left, from-price right, selected row
                          outlined. One decision per row, like Bolt. */}
                      <div className="divide-y" role="group" aria-label="Choose a ride">
                        {vehicleChoices.map(({ category, count, minFare }) => (
                          <button
                            key={category}
                            type="button"
                            aria-pressed={selectedVehicle === category}
                            onClick={() => setSelectedVehicle(category)}
                            className={cn(
                              "flex min-h-16 w-full items-center justify-between gap-3 px-2 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                              selectedVehicle === category ? "bg-primary/8 font-semibold" : "hover:bg-primary/5",
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span className="grid h-10 w-11 shrink-0 place-items-center text-primary">
                                <VehicleTypeIcon category={category} className="h-6 w-9 text-primary" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold">{VEHICLE_CATEGORY_LABELS[category]}</span>
                                <span className="block text-xs text-muted-foreground">{count} available</span>
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-sm font-bold tabular-nums text-primary">{ksh(minFare)}</span>
                              <span className="block text-[10px] text-muted-foreground">from / seat</span>
                            </span>
                          </button>
                        ))}
                      </div>

                      {selectedVehicle && (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                            <div>
                              <p className="text-xs font-semibold">{VEHICLE_CATEGORY_LABELS[selectedVehicle]} fare</p>
                              <p className="text-[10px] text-muted-foreground">
                                {charter ? "Whole cab · 16% VAT added on top" : "Per-seat stage fare plus Mi-Reli fee"}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 rounded-full bg-muted p-1">
                              <button type="button" aria-pressed={!charter} onClick={() => setCharter(false)} className={cn("min-h-9 rounded-full px-3 text-xs", !charter && "bg-background font-semibold shadow-sm")}>Shared</button>
                              <button type="button" aria-pressed={charter} onClick={() => setCharter(true)} className={cn("min-h-9 rounded-full px-3 text-xs", charter && "bg-background font-semibold shadow-sm")}>Charter</button>
                            </div>
                          </div>
                          {!charter && (
                            <div role="group" aria-label="Seats" className="flex items-center justify-between border-b pb-2 text-sm">
                              <span>Seats</span>
                              <span className="flex items-center gap-2">
                                <button type="button" aria-label="Remove one seat" disabled={seats <= 1} onClick={() => setSeats((value) => Math.max(1, value - 1))} className="size-11 rounded-full bg-muted hover:bg-primary/10 disabled:opacity-40">−</button>
                                <span className="min-w-4 text-center font-semibold tabular-nums">{seats}</span>
                                <button type="button" aria-label="Add one seat" disabled={seats >= maxSeats} onClick={() => setSeats((value) => Math.min(maxSeats, value + 1))} className="size-11 rounded-full bg-muted hover:bg-primary/10 disabled:opacity-40">+</button>
                              </span>
                            </div>
                          )}

                          {visibleTrips.length === 0 ? (
                            <p className="py-2 text-sm text-muted-foreground">
                              {charter ? "No unbooked cab of this type is available for a charter." : "Not enough seats on this vehicle type. Choose fewer seats or another vehicle."}
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {visibleTrips.map((trip) => (
                                <AirportTripCard
                                  key={trip.id}
                                  trip={trip}
                                  fare={getAirportFare(trip, activeJourney!.stage.fare, seats, charter)}
                                  vat={charter ? calculateCharterVat(calculateCharterFare(trip.capacity, activeJourney!.stage.fare)) : 0}
                                  charter={charter}
                                  seats={seats}
                                  onBook={() => openBooking(trip)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}
            </div>
          )}
        </section>
      </div>
      <Accordion type="single" collapsible defaultValue={openPrivateTransfer ? "private-transfer" : undefined} className="w-full">
        <AccordionItem value="private-transfer" className="border-t">
          <AccordionTrigger className="gap-4 py-4 text-left hover:no-underline">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Private airport transfer</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Request a direct ride to or from Moi or Ukunda</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-1">
            <AirportRequestForm />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <BookingSheet
        open={sheetOpen}
        draft={draft}
        onClose={() => { setSheetOpen(false); setRefreshKey((value) => value + 1); }}
        onBooked={() => setRefreshKey((value) => value + 1)}
      />
    </div>
  );
}

function getAirportFare(trip: BookableTrip, stageFare: number, seats: number, charter: boolean): number {
  if (charter) {
    const fare = calculateCharterFare(trip.capacity, stageFare);
    return fare + calculateCharterVat(fare);
  }
  return calculateSharedFare(stageFare, trip.capacity, seats) + calculateVehicleBookingFee({
    cabType: trip.vehicle?.cabType,
    configuredPerSeatFee: trip.platformFeeAmount,
    seats,
    charter: false,
  });
}

function AirportTripCard({
  trip,
  fare,
  vat,
  charter,
  seats,
  onBook,
}: {
  trip: BookableTrip;
  fare: number;
  vat: number;
  charter: boolean;
  seats: number;
  onBook: () => void;
}) {
  const enoughSeats = charter ? trip.seatsLeft === trip.capacity : trip.seatsLeft >= seats;
  return (
    <article className="flex flex-wrap items-center justify-between gap-3 border-b py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <VehicleTypeIcon category={vehicleCategoryFromCabType(trip.vehicle?.cabType)} className="h-7 w-9 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{trip.vehicle?.cabType ?? "Vehicle"} · {fmtTime(trip.departureAt)}</p>
          <p className="text-[10px] text-muted-foreground">
            {charter ? `Private cab · ${trip.capacity} seats` : `${trip.seatsLeft} seats left · ${seats} ${seats === 1 ? "seat" : "seats"}`}
          </p>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums text-primary">{ksh(fare)}</p>
          <p className="text-[10px] text-muted-foreground">
            {charter
              ? `${ksh(vat)} VAT included`
              : `${ksh(calculateVehicleBookingFee({ cabType: trip.vehicle?.cabType, configuredPerSeatFee: trip.platformFeeAmount, seats, charter: false }))} Mi-Reli fee`}
          </p>
        </div>
        <Button size="sm" className="min-h-11 rounded-full px-4" disabled={!enoughSeats} onClick={onBook}>
          {charter ? "Charter" : "Book"}
        </Button>
      </div>
    </article>
  );
}

function SlotColumn({
  label,
  icon,
  slots,
  selectedSlotId,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  slots: ShuttleSlot[];
  selectedSlotId: string | null;
  onSelect: (slot: ShuttleSlot) => void;
}) {
  return (
    <div className="border-t pt-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {icon}
        {label}
      </div>
      {slots.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">No departures listed.</p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {slots.map((slot) => {
            const selected = selectedSlotId === slot.id;
            return (
              <button
                key={slot.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(slot)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm tabular-nums transition-colors",
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-primary/10",
                )}
              >
                <Clock className="h-3 w-3 text-muted-foreground" aria-hidden />
                {slot.departTime}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


