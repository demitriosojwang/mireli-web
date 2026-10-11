"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { SiteFooter, SiteHeader, SiteNav } from "@/components/site-chrome";
import { BookingSheet, BookableTrip, BookingDraft } from "@/components/booking-sheet";
import { PaySheet } from "@/components/pay-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { api, useMe } from "@/lib/client";
import { fmtTime, ksh } from "@/lib/format";
import { DEFAULT_BOOKING_FEE_AMOUNT } from "@/lib/pricing";
import { SplashScreen, useSplashOnce } from "@/components/app/splash-screen";
import {
  DatePicker,
  DotBadge,
  SeatMeter,
  SeatStepper,
  Stars,
  TrainPill,
  CharterBadge,
  fmtDateShort,
} from "@/components/app/shared";
import {
  Anchor,
  CalendarDays,
  Car,
  Check,
  ChevronsUpDown,
  Clock,
  Crown,
  Home as HomeIcon,
  Loader2,
  MapPin,
  Navigation,
  Sparkles,
  Ticket as TicketIcon,
  Train as TrainIcon,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RouteInfo {
  id: string;
  name: string;
  durationMinutes: number;
  charterPrice: number;
  stages: { id: string; name: string; order: number; fare: number; homeSurcharge: number }[];
}

interface BookingRow {
  id: string;
  code: string;
  stageName: string | null;
  status: string;
  cashDue: number;
  isCharter: boolean;
  departureAt: string | null;
  driver: { name: string; plate: string; phone?: string | null } | null;
}

interface TrainRow {
  id: string;
  name: string;
  direction: "MBA_TO_NBO" | "NBO_TO_MBA";
  originTime: string;
  destTime: string;
}

type CatalogueStatus = "loading" | "ready" | "empty" | "error";

function coastOf(routeName: string): "north" | "south" {
  return routeName.toLowerCase().includes("south") ? "south" : "north";
}

export default function Home() {
  const { me } = useMe();
  const router = useRouter();
  const { show: splashSeen, ready: splashReady } = useSplashOnce();
  const [splashDone, setSplashDone] = useState(false);

  const showSplash = splashSeen && !splashDone;

  const [direction, setDirection] = useState<"FROM_TERMINUS" | "TO_TERMINUS">("FROM_TERMINUS");
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [bookingFeeAmount, setBookingFeeAmount] = useState(DEFAULT_BOOKING_FEE_AMOUNT);
  const [routesStatus, setRoutesStatus] = useState<CatalogueStatus>("loading");
  const [trips, setTrips] = useState<BookableTrip[] | null>(null);
  const [tripsStatus, setTripsStatus] = useState<CatalogueStatus>("loading");
  const [hasEligibleDrivers, setHasEligibleDrivers] = useState<boolean | null>(null);
  const [timetable, setTimetable] = useState<TrainRow[]>([]);
  const [timetableStatus, setTimetableStatus] = useState<CatalogueStatus>("loading");
  const [catalogueRetry, setCatalogueRetry] = useState(0);
  const [myBookings, setMyBookings] = useState<BookingRow[]>([]);
  const [isRefreshing, setLoading] = useState(false);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [tripRefreshKey, setTripRefreshKey] = useState(0);
  const [pointPickerOpen, setPointPickerOpen] = useState(false);
  const queryKey = `${direction}|${date}`;
  const loading = isRefreshing || loadedQuery !== queryKey;

  // selection state (original store equivalents)
  const [trainKey, setTrainKey] = useState<string | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const [homePickup, setHomePickup] = useState(false);
  const [charter, setCharter] = useState(false);
  const [requestedSeats, setSeats] = useState(1);

  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [payFor, setPayFor] = useState<BookingRow | null>(null);

  const isAuthed = !!me?.session;

  const refreshTrips = useCallback(() => {
    setLoading(true);
    setTripRefreshKey((key) => key + 1);
  }, []);

  const retryCatalogues = useCallback(() => {
    setRoutesStatus("loading");
    setTimetableStatus("loading");
    setCatalogueRetry((attempt) => attempt + 1);
  }, []);

  const loadMyBookings = useCallback(async () => {
    try {
      const res = await api<{ bookings: BookingRow[] }>("/api/bookings");
      setMyBookings(res.bookings.filter((b) => ["awaiting_payment", "confirmed", "boarded"].includes(b.status)));
    } catch {
      setMyBookings([]);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api<{ routes: RouteInfo[]; bookingFeeAmount: number }>("/api/routes", { signal: controller.signal })
      .then((response) => {
        setRoutes(response.routes);
        setBookingFeeAmount(response.bookingFeeAmount);
        setRoutesStatus(response.routes.length ? "ready" : "empty");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setRoutes([]);
        setRoutesStatus("error");
      });
    api<{ trains: TrainRow[] }>("/api/trains", { signal: controller.signal })
      .then((response) => {
        setTimetable(response.trains);
        setTimetableStatus(response.trains.length ? "ready" : "empty");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setTimetable([]);
        setTimetableStatus("error");
      });
    return () => controller.abort();
  }, [catalogueRetry]);

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    api<{ bookings: BookingRow[] }>("/api/bookings")
      .then((res) => { if (active) setMyBookings(res.bookings.filter((b) => ["awaiting_payment", "confirmed", "boarded"].includes(b.status))); })
      .catch(() => { if (active) setMyBookings([]); });
    return () => { active = false; };
  }, [isAuthed]);

  useEffect(() => {
    if (!splashReady || showSplash) return;
    const controller = new AbortController();
    let active = true;
    api<{ trips: BookableTrip[]; hasEligibleDrivers: boolean }>(`/api/trips?date=${date}&direction=${direction}`, { signal: controller.signal })
      .then((res) => {
        if (!active) return;
        setTrips(res.trips);
        setHasEligibleDrivers(res.hasEligibleDrivers);
        setTripsStatus(res.trips.length ? "ready" : "empty");
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setTrips([]);
        setHasEligibleDrivers(null);
        setTripsStatus("error");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setLoadedQuery(queryKey);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [splashReady, showSplash, direction, date, queryKey, tripRefreshKey]);

  function openBooking(trip: BookableTrip) {
    const routeStages = routes.find((route) => route.id === trip.routeId)?.stages ?? [];
    const fallbackStage =
      direction === "FROM_TERMINUS"
        ? routeStages.filter((s) => s.order > 0).slice(-1)[0]
        : routeStages.filter((s) => s.order > 0)[0];
    setDraft({
      trip: { ...trip, stages: routeStages },
      stageId: pointId && routeStages.some((s) => s.id === pointId) ? pointId : fallbackStage?.id || "",
      seats,
      charter,
      homePickup,
      homeAddress: "",
      useCredit: false,
    });
    setSheetOpen(true);
  }

  /* ─── Derived data (all hooks run before any early return) ──────────────── */

  // Train pills — always the full Madaraka timetable for this direction
  // (08:00 Inter-County · 15:00 Express · 22:00 Night Train), each marked
  // "gone" when its meet-cab for the selected day has already left.
  const trainOptions = useMemo(() => {
    const wantDir = direction === "FROM_TERMINUS" ? "NBO_TO_MBA" : "MBA_TO_NBO";
    return timetable
      .filter((t) => t.direction === wantDir)
      .map((t) => {
        const mtmTime = t.direction === "MBA_TO_NBO" ? t.originTime : t.destTime;
        const key = `${t.name}-${mtmTime}`;
        return {
          key,
          time: mtmTime,
          name: t.name,
          label: direction === "FROM_TERMINUS" ? "Arrives MTM" : "Departs MTM",
          gone: trips !== null && hasEligibleDrivers === true && !(trips || []).some((x) => x.train && `${x.train.name}-${x.train.mtmTime}` === key),
        };
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [timetable, direction, trips, hasEligibleDrivers]);

  const selectedTrainGone = trainKey ? (trainOptions.find((o) => o.key === trainKey)?.gone ?? false) : false;

  const pointLabelCap = direction === "FROM_TERMINUS" ? "Drop-off" : "Pickup";

  // Points grid grouped by route (coast), from the stable routes network
  const pointGroups = useMemo(() => {
    return routes
      .map((r) => ({
        route: r,
        coast: coastOf(r.name),
        points: r.stages.filter((s) => s.order > 0),
      }))
      .filter((g) => g.points.length > 0);
  }, [routes]);

  const selectedPoint = (() => {
    for (const g of pointGroups) {
      const p = g.points.find((s) => s.id === pointId);
      if (p) return { point: p, route: g.route, coast: g.coast };
    }
    return null;
  })();

  // Trips after train + point filters
  const visibleTrips = useMemo(() => {
    let list = (trips || []).filter((trip) =>
      trip.bookable && (charter ? trip.seatsLeft === trip.capacity : trip.seatsLeft > 0),
    );
    if (trainKey) list = list.filter((t) => t.train && `${t.train.name}-${t.train.mtmTime}` === trainKey);
    if (pointId) {
      const routeId = routes.find((route) => route.stages.some((stage) => stage.id === pointId))?.id;
      if (routeId) list = list.filter((t) => t.routeId === routeId);
    }
    return list;
  }, [trips, trainKey, pointId, routes, charter]);

  // How many seats can actually be booked on the cabs currently listed?
  const seatCap = useMemo(() => {
    if (loading) return 14;
    if (!visibleTrips.length) return 1;
    const maxLeft = Math.max(...visibleTrips.map((t) => Math.max(t.seatsLeft, 0)));
    return Math.max(1, Math.min(14, maxLeft));
  }, [loading, visibleTrips]);

  const seats = Math.min(requestedSeats, seatCap);

  // Live fare preview
  const previewStage = selectedPoint?.point;
  const farePreview = (() => {
    const base = charter
      ? selectedPoint?.route.charterPrice ?? 0
      : (previewStage?.fare || 0) * seats;
    const surcharge = homePickup
      ? (charter ? previewStage?.homeSurcharge || 0 : (previewStage?.homeSurcharge || 0) * seats)
      : 0;
    return { base, surcharge, platformFee: selectedPoint ? bookingFeeAmount : 0, total: base + surcharge + (selectedPoint ? bookingFeeAmount : 0) };
  })();

  /* ─── Splash (after all hooks) ───────────────────────────────────────────── */

  if (showSplash) {
    return <SplashScreen onDone={() => setSplashDone(true)} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />

      {/* Direction switcher — the signature pill row */}
      <div className="mx-auto max-w-md w-full px-4 pt-3">
        <Tabs value={direction} onValueChange={(v) => {
          setDirection(v as "FROM_TERMINUS" | "TO_TERMINUS");
          setTrainKey(null);
        }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="FROM_TERMINUS" className="flex items-center gap-1.5">
              <Anchor className="h-3.5 w-3.5" /> From Terminus
            </TabsTrigger>
            <TabsTrigger value="TO_TERMINUS" className="flex items-center gap-1.5">
              <Navigation className="h-3.5 w-3.5" /> To Terminus
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <SiteNav />

      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={direction}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="space-y-4"
          >
            {/* Date */}
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                {direction === "FROM_TERMINUS" ? "Travelling on which date?" : "Catching the train on which date?"}
              </div>
              <DatePicker value={date} onChange={setDate} />
              <div className="mt-1.5 text-xs text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{fmtDateShort(date)}</span>
              </div>
            </div>

            {/* Train selector */}
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <TrainIcon className="h-3.5 w-3.5" />
                {direction === "FROM_TERMINUS" ? "Arriving on which train?" : "Catching which train?"}
              </div>
              {timetableStatus === "loading" && <p className="text-xs text-muted-foreground">Loading train times…</p>}
              {timetableStatus === "error" && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-muted-foreground">
                  Train times could not load. <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={retryCatalogues}>Try again</button>
                </p>
              )}
              {timetableStatus === "empty" && (
                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  The train timetable is being configured. Booking will open when the schedule is published.
                </p>
              )}
              {timetableStatus === "ready" && trainOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">No trains are configured for this direction yet.</p>
              )}
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {trainOptions.map((t) => (
                  <TrainPill
                    key={t.key}
                    time={t.time}
                    label={t.label}
                    name={t.name}
                    gone={t.gone}
                    active={trainKey === t.key}
                    onClick={() => setTrainKey(trainKey === t.key ? null : t.key)}
                  />
                ))}
              </div>
            </div>

            {/* Point picker */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> {pointLabelCap} point
                </div>
                {pointId && (
                  <button onClick={() => setPointId(null)} className="text-[11px] text-primary hover:underline">
                    Clear selection
                  </button>
                )}
              </div>
              {routesStatus === "loading" ? (
                <Skeleton className="h-11 w-full" />
              ) : routesStatus === "error" ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-muted-foreground">
                  {pointLabelCap} points could not load. <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={retryCatalogues}>Try again</button>
                </div>
              ) : routesStatus === "empty" || pointGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-card px-4 py-3 text-sm text-muted-foreground">
                  {pointLabelCap} points are being set up. Bookings open when the route list is published.
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Popover open={pointPickerOpen} onOpenChange={setPointPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="booking-point"
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={pointPickerOpen}
                        aria-label={`${pointLabelCap} point`}
                        className="h-12 w-full justify-between rounded-xl bg-card px-4 text-left font-normal shadow-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <MapPin className="h-4 w-4 shrink-0 text-primary" />
                          <span className={cn("truncate", !selectedPoint && "text-muted-foreground")}>
                            {selectedPoint?.point.name ?? `Choose a ${pointLabelCap.toLowerCase()} point`}
                          </span>
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder={`Search ${pointLabelCap.toLowerCase()} points…`} />
                        <CommandList>
                          <CommandEmpty>No matching point found.</CommandEmpty>
                          {pointGroups.map(({ route, coast, points }) => (
                            <CommandGroup
                              key={route.id}
                              heading={`${coast === "south" ? "South Coast" : "North Coast"} · ${route.name.replace("Mombasa Terminus ↔ ", "").replace(" (Mtwapa · Malindi)", "")}`}
                            >
                              {points.map((point) => (
                                <CommandItem
                                  key={point.id}
                                  value={`${coast} ${route.name} ${point.name}`}
                                  onSelect={() => {
                                    setPointId(point.id);
                                    setPointPickerOpen(false);
                                  }}
                                  className="min-h-11"
                                >
                                  <Check className={cn("h-4 w-4", pointId === point.id ? "opacity-100" : "opacity-0")} />
                                  <span className="min-w-0 flex-1 truncate">{point.name}</span>
                                  <span className="text-xs tabular-nums text-muted-foreground">KSh {point.fare}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedPoint && (
                    <p className="px-1 text-[11px] text-muted-foreground">
                      {selectedPoint.coast === "south" ? "South Coast" : "North Coast"} · {ksh(selectedPoint.point.fare)} per seat
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Ride type and door service: a single compact choice step. */}
            <section className="space-y-2.5" aria-labelledby="ride-options-title">
              <div className="flex items-baseline justify-between">
                <h2 id="ride-options-title" className="text-sm font-semibold">Choose your ride</h2>
                <span className="text-[11px] text-muted-foreground">You can review the fare next</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={!charter}
                  onClick={() => setCharter(false)}
                  className={cn("rounded-xl border bg-card p-3 text-left transition-colors", !charter ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "hover:border-primary/40")}
                >
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">Shared ride</span>
                      <span className="block text-[11px] text-muted-foreground">Pay per seat</span>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={charter}
                  onClick={() => setCharter(true)}
                  className={cn("rounded-xl border bg-card p-3 text-left transition-colors", charter ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "hover:border-primary/40")}
                >
                  <span className="flex items-center gap-2">
                    <Crown className="h-4 w-4 shrink-0 text-violet-600" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">Private cab</span>
                      <span className="block text-[11px] text-muted-foreground">Reserve the vehicle</span>
                    </span>
                  </span>
                </button>
              </div>

              <button
                type="button"
                aria-pressed={homePickup}
                disabled={!selectedPoint}
                onClick={() => setHomePickup((selected) => !selected)}
                className={cn("flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60", homePickup && "border-primary/50 bg-primary/5")}
              >
                <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border", homePickup ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background")}>
                  {homePickup && <Check className="h-3.5 w-3.5" />}
                </span>
                <HomeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Door-to-door {direction === "FROM_TERMINUS" ? "drop-off" : "pickup"}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {selectedPoint
                      ? `Add ${ksh((selectedPoint.point.homeSurcharge || 0) * (charter ? 1 : seats))} · paid to your driver`
                      : "Choose a point to see this option"}
                  </span>
                </span>
                <span className="sr-only">{homePickup ? "Selected" : "Not selected"}</span>
              </button>

              <div className="flex items-center justify-between rounded-xl border bg-card px-3.5 py-3">
                <span>
                  <span className="block text-xs text-muted-foreground">Estimated total{charter ? " · whole cab" : seats > 1 ? ` · ${seats} seats` : ""}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {selectedPoint ? `Includes ${ksh(bookingFeeAmount)} booking fee` : "Final amount shown before payment"}
                  </span>
                </span>
                <span className="text-lg font-bold tabular-nums text-primary">
                  {selectedPoint ? ksh(farePreview.total) : "Choose a point"}
                </span>
              </div>
            </section>

            {/* Seats (pooled only) */}
            {!charter && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> How many seats?
                </div>
                <SeatStepper value={seats} onChange={setSeats} min={1} max={seatCap} />
                {!loading && visibleTrips.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Up to {seatCap} {seatCap === 1 ? "seat" : "seats"} can be booked on the cabs listed below.
                  </p>
                )}
                {me?.passenger?.isGuest && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    You can only book up to 1 seat without logging in. Login to book more seats.
                  </p>
                )}
              </div>
            )}

            {/* Available cabs */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {charter ? "Available for charter" : "Available pooled cabs"}
                </h3>
                <span className="text-xs text-muted-foreground">{loading ? "…" : `${visibleTrips.length} cabs`}</span>
              </div>

              {loading && (
                <div role="status" className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking available cabs…
                </div>
              )}

              {!loading && tripsStatus === "error" && (
                <Card>
                  <CardContent className="flex items-center justify-between gap-3 p-4 text-sm text-muted-foreground">
                    <span>Cab availability could not load.</span>
                    <Button type="button" size="sm" variant="outline" onClick={refreshTrips}>Try again</Button>
                  </CardContent>
                </Card>
              )}

              {!loading && tripsStatus !== "error" && visibleTrips.length === 0 && (
                <Card>
                  <CardContent className="py-5 text-center text-sm text-muted-foreground">
                    {selectedTrainGone
                      ? "This train’s meet-cab has already left for the selected day — pick a later train or another date."
                      : hasEligibleDrivers === false
                        ? "No bookable cabs are available yet. Drivers will appear here after onboarding and approval."
                        : pointId
                        ? "No available cabs serve this point for that train. Try another point or clear your selection."
                        : "No available cabs are listed for this train yet."}
                  </CardContent>
                </Card>
              )}

              {!loading &&
                visibleTrips.map((trip) => (
                  <motion.div key={trip.id} layout whileTap={{ scale: 0.99 }}>
                    <CabCard
                      trip={trip}
                      pointName={selectedPoint?.point.name}
                      pointFare={selectedPoint?.point.fare}
                      pointSurcharge={selectedPoint?.point.homeSurcharge}
                      seats={seats}
                      charter={charter}
                      homePickup={homePickup}
                      hasPoint={!!selectedPoint}
                      onBook={() => openBooking(trip)}
                    />
                  </motion.div>
                ))}
            </div>

            <details className="rounded-xl border bg-card px-3.5 py-3 text-sm">
              <summary className="cursor-pointer font-medium">Fare and service details</summary>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                The fare is based on your selected point and ride type. Door-to-door surcharges go to your driver in full. A private cab reserves the whole vehicle. Review the complete amount and cancellation terms before you pay.
              </p>
            </details>

            {/* My bookings */}
            {myBookings.length > 0 && (
              <div className="space-y-2 pt-2">
                <h3 className="flex items-center gap-1.5 text-sm font-medium">
                  <TicketIcon className="h-4 w-4" /> My bookings
                </h3>
                {myBookings.map((b) => (
                  <Card key={b.id} className={cn(b.isCharter && "border-violet-300 bg-violet-50/30", b.status === "awaiting_payment" && "border-amber-300 bg-amber-50/30")}>
                    <CardContent className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span>{b.stageName ?? b.code}</span>
                          {b.isCharter && <CharterBadge />}
                          <DotBadge status={b.status} />
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {b.departureAt ? fmtTime(b.departureAt) : "awaiting allocation"}
                          {b.driver ? ` · ${b.driver.name} · ${b.driver.plate}` : ""}
                        </div>
                        <div className="mt-0.5 text-xs font-medium">
                          {ksh(b.cashDue)}
                          {b.status === "awaiting_payment" && <span className="font-normal text-muted-foreground"> by M-Pesa</span>}
                        </div>
                      </div>
                      {b.status === "awaiting_payment" ? (
                        <Button size="sm" className="h-8 shrink-0" onClick={() => setPayFor(b)}>
                          Pay now
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => router.push("/bookings")}>
                          Manage
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <SiteFooter />

      <BookingSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          refreshTrips();
          loadMyBookings();
        }}
        draft={draft}
        onBooked={() => {
          refreshTrips();
          loadMyBookings();
        }}
      />

      {payFor && (
        <PaySheet
          open={!!payFor}
          onClose={() => {
            setPayFor(null);
            loadMyBookings();
          }}
          booking={{
            id: payFor.id,
            code: payFor.code,
            cashDue: payFor.cashDue,
            stageName: payFor.stageName,
            departureAt: payFor.departureAt,
          }}
          onPaid={loadMyBookings}
        />
      )}
    </div>
  );
}

function CabCard({
  trip,
  pointName,
  pointFare,
  pointSurcharge,
  seats,
  charter,
  homePickup,
  hasPoint,
  onBook,
}: {
  trip: BookableTrip;
  pointName?: string;
  pointFare?: number;
  pointSurcharge?: number;
  seats: number;
  charter: boolean;
  homePickup: boolean;
  hasPoint: boolean;
  onBook: () => void;
}) {
  const booked = trip.capacity - trip.seatsLeft;
  const baseFare = charter ? trip.charterPrice : (pointFare ?? trip.minFare) * seats;
  const surcharge = homePickup ? (pointSurcharge ?? 0) * (charter ? 1 : seats) : 0;
  const fare = baseFare + surcharge + (hasPoint ? trip.platformFeeAmount : 0);
  const full = trip.seatsLeft <= 0 || !trip.bookable;

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-2.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{pointName ?? trip.routeName}</span>
              <DotBadge status={trip.status} />
              {trip.status === "locked" && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
                  <Sparkles className="h-2.5 w-2.5" /> credits only
                </span>
              )}
            </div>
            {trip.driver && (
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{trip.driver.name}</span>
                <Stars rating={trip.driver.rating} />
                <span className="text-muted-foreground/50">•</span>
                <span className="font-mono">{trip.driver.plate}</span>
              </div>
            )}
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {trip.direction === "TO_TERMINUS"
                ? `Leaves the stage ${fmtTime(trip.departureAt)} · be there by then`
                : `Cab departs ${fmtTime(trip.departureAt)}`}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {charter ? "Charter" : seats > 1 ? `${seats} seats` : "Fare"}
            </div>
            <div className="font-bold tabular-nums text-primary">{ksh(fare)}</div>
            {hasPoint && <div className="text-[10px] text-muted-foreground">includes {ksh(trip.platformFeeAmount)} fee</div>}
            {!charter && seats === 1 && pointFare != null && pointFare !== trip.minFare && (
              <div className="text-[10px] text-muted-foreground">from {ksh(trip.minFare)}</div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
            {trip.train && (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                <TrainIcon className="h-3 w-3" />
                {trip.direction === "FROM_TERMINUS"
                  ? `Meets the ${trip.train.name} · MTM ${trip.train.mtmTime}`
                  : `Catches the ${trip.train.name} · MTM ${trip.train.mtmTime}`}
              </span>
            )}
            {trip.direction === "TO_TERMINUS" && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Navigation className="h-3 w-3" /> reaches MTM {fmtTime(trip.terminusAt)}
              </span>
            )}
          </div>
          <SeatMeter booked={booked} capacity={trip.capacity} />
        </div>

        <Button className="h-9 w-full" size="sm" disabled={full || !hasPoint} onClick={onBook}>
          {!hasPoint
            ? `Choose a ${trip.pointsLabel} point first`
            : full
            ? trip.seatsLeft <= 0
              ? "Not enough seats"
              : "Unavailable"
            : charter
              ? `Book charter · ${ksh(fare)}`
              : `Reserve ${seats > 1 ? `${seats} seats` : "seat"} · ${ksh(fare)}`}
        </Button>
      </CardContent>
    </Card>
  );
}
