"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Clock, Loader2, Plane, PlaneLanding, PlaneTakeoff } from "lucide-react";
import { BookingSheet, type BookableTrip, type BookingDraft, type BookableTripWithStages } from "@/components/booking-sheet";
import { InstallPrompt } from "@/components/install-prompt";
import { SiteFooter, SiteHeader, SiteNav } from "@/components/site-chrome";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

/**
 * The full airport shuttle booking flow, embeddable. The /airports page wraps
 * it with the site chrome; the Book page embeds it behind the Train/Airport
 * toggle so passengers book either destination type from one place.
 */
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
  fare: number;
  homeSurcharge: number;
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

export function AirportsFlow({ compact = false }: { compact?: boolean }) {
  const [airports, setAirports] = useState<AirportRow[] | null>(null);
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
    let cancelled = false;
    api<{ airports: AirportRow[] }>("/api/airports")
      .then((data) => {
        if (!cancelled) setAirports(data.airports);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load airport shuttles. Check your connection and retry.");
      });
    return () => { cancelled = true; };
  }, []);

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

  const maxSeats = Math.max(1, Math.min(6, ...categoryTrips.map((trip) => trip.seatsLeft)));
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
    for (const airport of airports ?? []) {
      const coords = AIRPORT_COORDS[airport.code];
      if (coords) stops.push({ id: airport.code, name: airport.name, ...coords });
    }
    return stops;
  }, [airports]);

  function openBooking(trip: BookableTrip) {
    if (!activeAirport || !activeSlot || !activeJourney || !trip.bookable || trip.routeId !== activeJourney.routeId) return;
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
      vehicleCategory: selectedVehicle!,
      homePickup: false,
      homeAddress: "",
      useCredit: false,
    });
    setSheetOpen(true);
  }

  return (
    <div className={cn("flex flex-col bg-background", !compact && "min-h-dvh")}>
      {!compact && (
        <>
          <SiteHeader subtitle="Airports" />
          <SiteNav />
        </>
      )}
      <main className={cn("mx-auto w-full px-4 pb-16 pt-4 sm:px-6", compact ? "max-w-md" : "max-w-md sm:max-w-2xl lg:max-w-4xl xl:max-w-5xl")}>
        {/* Bolt-style shared map: terminus and the chosen airport, visible in
            both directions of the journey so the passenger sees the route. */}
        <PickupMap
          stops={airportMapStops}
          selectedStopId={pickedCode}
          fitStops
          caption={activeAirport ? activeAirport.name : "Your airport shuttle route"}
          detail={activeAirport ? `Mombasa Terminus ⇄ ${activeAirport.name} · ${activeAirport.durationMinutes} min` : "Mombasa Terminus · Miritini"}
          heightClassName="h-[180px] sm:h-[220px]"
        />
        {!compact && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <div className="flex items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">Airports</h1>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Choose a destination for scheduled shuttles, or expand private transfers for a direct pickup.
                </p>
              </div>
              <label className="shrink-0 text-[11px] font-medium text-muted-foreground">
                Travel date
                <input
                  type="date"
                  min={nairobiToday()}
                  value={travelDate}
                  onChange={(event) => {
                    setSelectedVehicle(null);
                    setCharter(false);
                    setSeats(1);
                    setTravelDate(event.target.value);
                  }}
                  className="mt-1 block h-9 w-[132px] rounded-lg border border-input bg-background px-2 text-xs text-foreground"
                />
              </label>
            </div>

            {/* Journey progress: pick shuttle -> choose vehicle -> book, mirrors the trains side. */}
            {activeAirport && activeSlot && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs" aria-label="Booking progress">
                <span className={cn("flex items-center gap-1.5 font-medium", activeAirport ? "text-primary" : "text-muted-foreground")}>
                  <Plane className="h-3.5 w-3.5" aria-hidden /> {activeAirport.code} · {fmtTime(`${travelDate}T${activeSlot.departTime}:00+03:00`)}
                </span>
                <span className="text-muted-foreground/50">→</span>
                <span className={cn("font-medium", selectedVehicle ? "text-primary" : "text-muted-foreground")}>
                  {selectedVehicle ? VEHICLE_CATEGORY_LABELS[selectedVehicle] : "Choose vehicle"}
                </span>
                <span className="text-muted-foreground/50">→</span>
                <span className={cn("font-medium", draft ? "text-primary" : "text-muted-foreground")}>Book</span>
              </div>
            )}
          </motion.div>
        )}
        {compact && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Airport shuttles</p>
            <label className="shrink-0 text-[11px] font-medium text-muted-foreground">
              Travel date
              <input
                type="date"
                min={nairobiToday()}
                value={travelDate}
                onChange={(event) => {
                  setSelectedVehicle(null);
                  setCharter(false);
                  setSeats(1);
                  setTravelDate(event.target.value);
                }}
                className="mt-1 block h-9 w-[132px] rounded-lg border border-input bg-background px-2 text-xs text-foreground"
              />
            </label>
          </div>
        )}

        <Accordion type="single" collapsible className="mt-3">
          <AccordionItem value="private-transfer" className="overflow-hidden rounded-xl border bg-card">
            <AccordionTrigger className="px-4 py-3 text-left hover:no-underline">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Private airport transfer</span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Request a direct ride to or from Moi or Ukunda</span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="border-t px-4 pb-4 pt-3">
              <AirportRequestForm />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {error && (
          <Card className="mt-4 border-destructive/40">
            <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {!airports && !error && (
          <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading airports…
          </div>
        )}

        {pickedCode === null ? (
          /* Step 1: Where to? One tap per airport, then the normal booking flow. */
          <div className="mt-4 space-y-2" role="group" aria-label="Choose your airport">
            <p className="text-sm font-semibold">Where to?</p>
            {(airports ?? []).map((airport) => (
              <button
                key={airport.code}
                type="button"
                onClick={() => pickAirport(airport)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3 text-left transition-colors active:scale-[0.98] hover:border-primary/40"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10">
                    <Plane className="h-4.5 w-4.5 text-primary" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{airport.name}</span>
                    <span className="block text-xs text-muted-foreground">{airport.durationMinutes} min · from {ksh(airport.fare)}/seat</span>
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-primary">Book →</span>
              </button>
            ))}
          </div>
        ) : (
          (() => {
            const airport = (airports ?? []).find((item) => item.code === pickedCode) ?? null;
            if (!airport) return null;
            const fromSlots = airport.slots.filter((slot) => slot.direction === "FROM_AIRPORT");
            const toSlots = airport.slots.filter((slot) => slot.direction === "TO_AIRPORT");
            return (
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={() => { setPickedCode(null); setSelection(null); }}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
                >
                  ← Change airport
                </button>
                <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">Airport selected</p>
                    <p className="truncate text-sm font-semibold">{airport.name}</p>
                    <p className="text-xs text-muted-foreground">{airport.durationMinutes} min · from {ksh(airport.fare)}/seat</p>
                  </div>
                  <Plane className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <SlotColumn
                    label="Arrivals · airport to terminus"
                    icon={<PlaneLanding className="h-3.5 w-3.5" aria-hidden />}
                    slots={fromSlots}
                    selectedSlotId={activeSlot?.id ?? null}
                    onSelect={(slot) => chooseSlot(airport, slot)}
                  />
                  <SlotColumn
                    label="Departures · terminus to airport"
                    icon={<PlaneTakeoff className="h-3.5 w-3.5" aria-hidden />}
                    slots={toSlots}
                    selectedSlotId={activeSlot?.id ?? null}
                    onSelect={(slot) => chooseSlot(airport, slot)}
                  />
                </div>

                {activeSlot && (
                  <section className="space-y-3 rounded-xl border bg-muted/20 p-3" aria-live="polite">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold">{airport.name} · {fmtTime(`${travelDate}T${activeSlot.departTime}:00+03:00`)}</h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {DIRECTION_LABEL[activeSlot.direction]} · choose a vehicle to see its quote
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
                      <div className="space-y-1.5 rounded-lg border bg-card p-3">
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
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Choose a vehicle">
                          {vehicleChoices.map(({ category, count, minFare }) => (
                            <button
                              key={category}
                              type="button"
                              aria-pressed={selectedVehicle === category}
                              onClick={() => setSelectedVehicle(category)}
                              className={cn(
                                "flex min-h-16 items-center gap-2 rounded-xl border bg-card px-2.5 py-2 text-left transition-colors active:scale-[0.97]",
                                selectedVehicle === category ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "hover:border-primary/40",
                              )}
                            >
                              <VehicleTypeIcon category={category} className="h-6 w-8 text-primary" />
                              <span className="min-w-0">
                                <span className="block text-xs font-semibold">{VEHICLE_CATEGORY_LABELS[category]}</span>
                                <span className="block text-[10px] text-muted-foreground">
                                  {count} available · from {ksh(minFare)}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>

                        {selectedVehicle && (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2.5">
                              <div>
                                <p className="text-xs font-semibold">{VEHICLE_CATEGORY_LABELS[selectedVehicle]} fare</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {charter ? "Whole cab · 16% VAT added on top" : "Per-seat stage fare plus Mi-Reli fee"}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                                <button type="button" aria-pressed={!charter} onClick={() => setCharter(false)} className={cn("rounded-md px-2.5 py-1.5 text-[11px]", !charter && "bg-background font-semibold shadow-sm")}>Shared</button>
                                <button type="button" aria-pressed={charter} onClick={() => setCharter(true)} className={cn("rounded-md px-2.5 py-1.5 text-[11px]", charter && "bg-background font-semibold shadow-sm")}>Charter</button>
                              </div>
                            </div>
                            {!charter && (
                              <label className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-xs">
                                <span>Seats</span>
                                <span className="flex items-center gap-2">
                                  <button type="button" aria-label="Remove one seat" disabled={seats <= 1} onClick={() => setSeats((value) => Math.max(1, value - 1))} className="h-8 w-8 rounded-md border disabled:opacity-40">−</button>
                                  <span className="min-w-4 text-center font-semibold tabular-nums">{seats}</span>
                                  <button type="button" aria-label="Add one seat" disabled={seats >= maxSeats} onClick={() => setSeats((value) => Math.min(maxSeats, value + 1))} className="h-8 w-8 rounded-md border disabled:opacity-40">+</button>
                                </span>
                              </label>
                            )}

                            {visibleTrips.length === 0 ? (
                              <p className="rounded-lg border bg-card p-3 text-center text-xs text-muted-foreground">
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
            );
          })()
        )}
      </main>
      {!compact && <SiteFooter airportTransfers />}
      <InstallPrompt />
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
    <Card className="overflow-hidden">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
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
          <Button size="sm" className="h-9" disabled={!enoughSeats} onClick={onBook}>
            {charter ? "Charter" : "Book"}
          </Button>
        </div>
      </CardContent>
    </Card>
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
    <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      {slots.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">Slots published shortly.</p>
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
                  "inline-flex min-h-9 items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors active:scale-[0.97]",
                  selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:border-primary/40",
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


