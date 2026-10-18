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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { api, useMe } from "@/lib/client";
import { getBookingCatalogueView, hasPublishedCustomerPoints, shouldLoadTrainTimetable, type CatalogueStatus } from "@/lib/booking-catalogue";
import { fmtTime, ksh } from "@/lib/format";
import { DEFAULT_BOOKING_FEE_AMOUNT } from "@/lib/pricing";
import { addNairobiDays, nairobiWeekday } from "@/lib/nairobi-time";
import { calculateCharterFare } from "@/lib/charter-pricing";
import { MAX_STAGE_SEARCH_LENGTH, MIN_STAGE_SEARCH_LENGTH, isStageSearchReady, shouldSearchStagePoints } from "@/lib/stage-search";
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
  todayStr,
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
  charterPrice: number;
}

interface StagePoint {
  id: string;
  name: string;
  order: number;
  fare: number;
  homeSurcharge: number;
}

interface PointSearchResult extends StagePoint {
  routeId: string;
  route: RouteInfo;
}

interface SelectedPoint {
  point: StagePoint;
  route: RouteInfo;
  coast: "north" | "south";
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
  destDayOffset: number;
  serviceDays: number[];
}

const CATALOGUE_TIMEOUT_MS = 8_000;
const STAGE_SEARCH_TIMEOUT_MS = 8_000;
const TRIP_AVAILABILITY_TIMEOUT_MS = 12_000;

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
  const [date, setDate] = useState(() => todayStr());
  const [pointCount, setPointCount] = useState(0);
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
  const [pointSearch, setPointSearch] = useState("");
  const [pointMatches, setPointMatches] = useState<PointSearchResult[]>([]);
  const [pointSearchStatus, setPointSearchStatus] = useState<CatalogueStatus | "idle">("idle");
  const [pointSearchHasMore, setPointSearchHasMore] = useState(false);
  const [pointSearchRetry, setPointSearchRetry] = useState(0);
  const [journeyCollapsed, setJourneyCollapsed] = useState(false);
  // selection state (original store equivalents)
  const [trainKey, setTrainKey] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);
  const [homePickup, setHomePickup] = useState(false);
  const [charter, setCharter] = useState(false);
  const [requestedSeats, setSeats] = useState(1);
  const bookingCatalogueView = getBookingCatalogueView(routesStatus, pointCount);

  // Availability is route-specific and is fetched only after a passenger
  // chooses a stop. This keeps the initial booking form free of broad trip
  // queries and lets the stop choice drive the next compact step.
  const queryKey = selectedPoint ? `${direction}|${date}|${selectedPoint.route.id}` : null;
  const loading = Boolean(queryKey) && (isRefreshing || loadedQuery !== queryKey);

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

  const changeDirection = useCallback((nextDirection: "FROM_TERMINUS" | "TO_TERMINUS") => {
    if (nextDirection === direction) return;
    setDirection(nextDirection);
    setTrainKey(null);
    setSelectedPoint(null);
    setHomePickup(false);
    setJourneyCollapsed(false);
    setPointPickerOpen(false);
    setPointSearch("");
    setPointMatches([]);
    setPointSearchStatus("idle");
    setPointSearchHasMore(false);
    setTrips(null);
    setLoadedQuery(null);
    setTripsStatus("loading");
  }, [direction]);

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
    api<{ pointCount: number }>("/api/routes", {
      signal: controller.signal,
      timeoutMs: CATALOGUE_TIMEOUT_MS,
    })
      .then((response) => {
        const nextPointCount = hasPublishedCustomerPoints(response.pointCount) ? response.pointCount : 0;
        setPointCount(nextPointCount);
        setRoutesStatus(nextPointCount ? "ready" : "empty");
        if (!nextPointCount) {
          setTimetable([]);
          setTimetableStatus("empty");
          setTrainKey(null);
          setSelectedPoint(null);
          setHomePickup(false);
          setJourneyCollapsed(false);
          setTrips(null);
          setLoadedQuery(null);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPointCount(0);
        setRoutesStatus("error");
      });
    api<{ bookingFeeAmount: number }>("/api/booking-fee", {
      signal: controller.signal,
      timeoutMs: CATALOGUE_TIMEOUT_MS,
    })
      .then((response) => setBookingFeeAmount(response.bookingFeeAmount))
      .catch(() => {
        if (!controller.signal.aborted) setBookingFeeAmount(DEFAULT_BOOKING_FEE_AMOUNT);
      });
    api<{ hasEligibleDrivers: boolean }>("/api/driver-supply", {
      signal: controller.signal,
      timeoutMs: CATALOGUE_TIMEOUT_MS,
    })
      .then((response) => setHasEligibleDrivers(response.hasEligibleDrivers))
      .catch(() => {
        if (!controller.signal.aborted) setHasEligibleDrivers(null);
      });
    return () => controller.abort();
  }, [catalogueRetry]);

  useEffect(() => {
    if (!shouldLoadTrainTimetable(routesStatus, pointCount)) return;

    const controller = new AbortController();
    api<{ trains: TrainRow[] }>("/api/trains", {
      signal: controller.signal,
      timeoutMs: CATALOGUE_TIMEOUT_MS,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        setTimetable(response.trains);
        setTimetableStatus(response.trains.length ? "ready" : "empty");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setTimetable([]);
        setTimetableStatus("error");
      });
    return () => controller.abort();
  }, [routesStatus, pointCount]);

  useEffect(() => {
    const query = pointSearch.trim();
    // The public search endpoint deliberately requires at least two
    // characters and caps its response. Never request the full catalogue when
    // the picker opens with an empty query.
    if (!shouldSearchStagePoints(query, pointPickerOpen)) return;

    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => {
      setPointSearchStatus("loading");
      api<{ points: PointSearchResult[]; hasMore: boolean }>(
        `/api/stages?q=${encodeURIComponent(query)}`,
        { signal: controller.signal, timeoutMs: STAGE_SEARCH_TIMEOUT_MS },
      )
        .then((response) => {
          if (!active) return;
          setPointMatches(response.points);
          setPointSearchHasMore(response.hasMore);
          setPointSearchStatus(response.points.length ? "ready" : "empty");
        })
        .catch(() => {
          if (!active || controller.signal.aborted) return;
          setPointMatches([]);
          setPointSearchHasMore(false);
          setPointSearchStatus("error");
        });
    }, query.length >= 2 ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [pointPickerOpen, pointSearch, pointSearchRetry]);

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    api<{ bookings: BookingRow[] }>("/api/bookings")
      .then((res) => { if (active) setMyBookings(res.bookings.filter((b) => ["awaiting_payment", "confirmed", "boarded"].includes(b.status))); })
      .catch(() => { if (active) setMyBookings([]); });
    return () => { active = false; };
  }, [isAuthed]);

  useEffect(() => {
    if (!splashReady || showSplash || !selectedPoint || !queryKey) return;
    const requestedQueryKey = queryKey;
    const controller = new AbortController();
    let active = true;
    api<{ trips: BookableTrip[]; hasEligibleDrivers: boolean }>(
      `/api/trips?date=${date}&direction=${direction}&routeId=${encodeURIComponent(selectedPoint.route.id)}`,
      { signal: controller.signal, timeoutMs: TRIP_AVAILABILITY_TIMEOUT_MS },
    )
      .then((res) => {
        if (!active) return;
        setTrips(res.trips);
        setHasEligibleDrivers(res.hasEligibleDrivers);
        setTripsStatus(res.trips.length ? "ready" : "empty");
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setTrips([]);
        setTripsStatus("error");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setLoadedQuery(requestedQueryKey);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [splashReady, showSplash, direction, date, selectedPoint?.route.id, queryKey, tripRefreshKey]);

  function openBooking(trip: BookableTrip) {
    if (!selectedPoint || selectedPoint.route.id !== trip.routeId) return;
    setDraft({
      trip: { ...trip, stages: [selectedPoint.point] },
      stageId: selectedPoint.point.id,
      travelDate: date,
      seats,
      charter,
      homePickup,
      homeAddress: "",
      useCredit: false,
    });
    setSheetOpen(true);
  }

  /* ─── Derived data (all hooks run before any early return) ──────────────── */

  // Show only trains operating on the selected Kenya service date. A train
  // arriving at MTM after midnight belongs to its previous origin date.
  const trainOptions = useMemo(() => {
    const wantDir = direction === "FROM_TERMINUS" ? "NBO_TO_MBA" : "MBA_TO_NBO";
    return timetable
      .filter((t) => {
        if (t.direction !== wantDir) return false;
        const serviceDate = direction === "FROM_TERMINUS" ? addNairobiDays(date, -t.destDayOffset) : date;
        return t.serviceDays.includes(nairobiWeekday(serviceDate));
      })
      .map((t) => {
        const mtmTime = t.direction === "MBA_TO_NBO" ? t.originTime : t.destTime;
        const key = `${t.name}-${mtmTime}`;
        return {
          key,
          time: mtmTime,
          name: t.name,
          label: direction === "FROM_TERMINUS" ? "Arrives MTM" : "Departs MTM",
          gone: !!selectedPoint && loadedQuery === queryKey && trips !== null && hasEligibleDrivers === true && !(trips || []).some((x) => x.train && `${x.train.name}-${x.train.mtmTime}` === key),
        };
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [timetable, direction, date, trips, hasEligibleDrivers, selectedPoint, loadedQuery, queryKey]);

  const selectedTrainGone = trainKey ? (trainOptions.find((o) => o.key === trainKey)?.gone ?? false) : false;
  const selectedTrain = trainKey ? trainOptions.find((option) => option.key === trainKey) ?? null : null;
  const journeyStepDone = Boolean(selectedPoint && journeyCollapsed);

  const pointLabelCap = direction === "FROM_TERMINUS" ? "Drop-off" : "Pickup";

  // The search response is already bounded; group only the small matching set.
  const pointGroups = useMemo(() => {
    const groups = new Map<string, { route: RouteInfo; coast: "north" | "south"; points: PointSearchResult[] }>();
    for (const point of pointMatches) {
      const route = point.route;
      const group = groups.get(route.id);
      if (group) {
        group.points.push(point);
      } else {
        groups.set(route.id, { route, coast: coastOf(route.name), points: [point] });
      }
    }
    return Array.from(groups.values());
  }, [pointMatches]);

  // Trips after train + point filters
  const visibleTrips = useMemo(() => {
    if (!selectedPoint) return [];
    let list = (trips || []).filter((trip) =>
      trip.bookable && (charter ? trip.seatsLeft === trip.capacity : trip.seatsLeft > 0),
    );
    if (trainKey) list = list.filter((t) => t.train && `${t.train.name}-${t.train.mtmTime}` === trainKey);
    if (selectedPoint) list = list.filter((t) => t.routeId === selectedPoint.route.id);
    return list;
  }, [trips, trainKey, selectedPoint, charter]);

  // How many seats can actually be booked on the cabs currently listed?
  const seatCap = useMemo(() => {
    if (loading) return 1;
    if (!visibleTrips.length) return 1;
    const maxLeft = Math.max(...visibleTrips.map((t) => Math.max(t.seatsLeft, 0)));
    return Math.max(1, Math.min(6, maxLeft));
  }, [loading, visibleTrips]);

  const seats = Math.min(requestedSeats, seatCap);

  // Live fare preview
  const previewStage = selectedPoint?.point;
  const farePreview = (() => {
    const charterFares = charter && previewStage
      ? visibleTrips
          .filter((trip) => trip.routeId === selectedPoint?.route.id)
          .map((trip) => calculateCharterFare(trip.capacity, previewStage.fare))
      : [];
    const base = charter
      ? charterFares.length > 0 ? Math.min(...charterFares) : 0
      : (previewStage?.fare || 0) * seats;
    const surcharge = homePickup
      ? (charter ? previewStage?.homeSurcharge || 0 : (previewStage?.homeSurcharge || 0) * seats)
      : 0;
    return {
      base,
      surcharge,
      platformFee: selectedPoint ? bookingFeeAmount : 0,
      hasCharterCab: charterFares.length > 0,
      total: base + surcharge + (selectedPoint && !charter ? bookingFeeAmount : 0),
    };
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
        <Tabs value={direction} onValueChange={(v) => changeDirection(v as "FROM_TERMINUS" | "TO_TERMINUS")}>
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
            {bookingCatalogueView === "booking" && <ol aria-label="Booking steps" className="flex items-center gap-2 text-[11px]">
              <li aria-current={journeyStepDone ? undefined : "step"} className={cn("flex items-center gap-1.5", journeyStepDone ? "text-emerald-700" : "font-semibold text-primary")}>
                <span className={cn("grid h-5 w-5 place-items-center rounded-full border text-[10px]", journeyStepDone ? "border-emerald-600 bg-emerald-600 text-white" : "border-primary bg-primary text-primary-foreground")}>
                  {journeyStepDone ? <Check className="h-3 w-3" /> : "1"}
                </span>
                Your journey
              </li>
              <li aria-hidden="true" className="h-px flex-1 bg-border" />
              <li aria-current={journeyStepDone ? "step" : undefined} className={cn("flex items-center gap-1.5", journeyStepDone ? "font-semibold text-primary" : "text-muted-foreground")}>
                <span className={cn("grid h-5 w-5 place-items-center rounded-full border text-[10px]", journeyStepDone ? "border-primary bg-primary text-primary-foreground" : "border-border")}>2</span>
                Ride and cabs
              </li>
            </ol>}

            {bookingCatalogueView === "booking" && selectedPoint && journeyCollapsed && (
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3" aria-label="Selected journey">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">Journey selected</p>
                  <p className="truncate text-sm font-semibold">
                    {direction === "FROM_TERMINUS" ? "Mombasa Terminus →" : "→ Mombasa Terminus"} {selectedPoint.point.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDateShort(date)}{selectedTrain ? ` · ${selectedTrain.name} ${selectedTrain.time}` : ""}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" className="h-9 shrink-0" onClick={() => setJourneyCollapsed(false)}>
                  Change
                </Button>
              </div>
            )}

            {bookingCatalogueView === "checking" ? (
              <div role="status" className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking approved stops…
              </div>
            ) : bookingCatalogueView === "closed" ? (
              <section className="rounded-2xl border bg-card p-4" aria-labelledby="catalogue-empty-title">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <MapPin className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 id="catalogue-empty-title" className="text-sm font-semibold">Bookings aren’t open yet</h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Approved {pointLabelCap.toLowerCase()} stops haven’t been published for this direction. We’ll open bookings when the route is ready.
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={retryCatalogues}>Refresh availability</Button>
                  {hasEligibleDrivers === false && (
                    <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">0 pooled cabs</span> · no approved drivers yet</p>
                  )}
                </div>
              </section>
            ) : (
            <div className="space-y-4" hidden={journeyStepDone}>
            {/* Date */}
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                {direction === "FROM_TERMINUS" ? "Travelling on which date?" : "Catching the train on which date?"}
              </div>
              <DatePicker value={date} onChange={(nextDate) => { setDate(nextDate); setTrainKey(null); }} />
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
                {selectedPoint && (
                  <button onClick={() => {
                    setSelectedPoint(null);
                    setHomePickup(false);
                    setTrips(null);
                    setLoadedQuery(null);
                    setTripsStatus("loading");
                    setJourneyCollapsed(false);
                  }} className="text-[11px] text-primary hover:underline">
                    Clear selection
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {routesStatus === "error" && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950" role="status">
                    <span>We couldn’t check the full point list. Search to see whether your stop is available.</span>
                    <button type="button" className="shrink-0 font-medium underline underline-offset-2" onClick={retryCatalogues}>Retry</button>
                  </div>
                )}
                <Popover
                    open={pointPickerOpen}
                    onOpenChange={(open) => {
                      setPointPickerOpen(open);
                      setPointSearchStatus("idle");
                      if (!open) {
                        setPointSearch("");
                        setPointMatches([]);
                        setPointSearchHasMore(false);
                      }
                    }}
                  >
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
                      <Command shouldFilter={false}>
                        <CommandInput
                          value={pointSearch}
                          maxLength={MAX_STAGE_SEARCH_LENGTH}
                          onValueChange={(value) => {
                            setPointSearch(value);
                            setPointMatches([]);
                            setPointSearchStatus(isStageSearchReady(value) ? "loading" : "idle");
                            setPointSearchHasMore(false);
                          }}
                          placeholder={`Search ${pointLabelCap.toLowerCase()} stops by name or area`}
                        />
                        <CommandList className="max-h-60">
                          {pointSearch.trim().length === 0 && (
                            <p className="px-3 py-5 text-center text-sm text-muted-foreground" role="status">
                              Type at least two letters to find a stop.
                            </p>
                          )}
                          {pointSearch.trim().length > 0 && pointSearch.trim().length < MIN_STAGE_SEARCH_LENGTH && (
                            <p className="px-3 py-5 text-center text-sm text-muted-foreground" role="status">
                              Type one more letter to search.
                            </p>
                          )}
                          {pointSearchStatus === "loading" && pointSearch.trim().length >= MIN_STAGE_SEARCH_LENGTH && (
                            <p className="px-3 py-5 text-center text-sm text-muted-foreground">Searching points…</p>
                          )}
                          {pointSearchStatus === "error" && (
                            <p className="px-3 py-5 text-center text-sm text-muted-foreground" role="alert">
                              Points could not load. <button type="button" className="font-medium text-primary underline" onClick={() => { setPointSearchStatus("loading"); setPointSearchRetry((attempt) => attempt + 1); }}>Try again</button>
                            </p>
                          )}
                          {pointSearchStatus === "empty" && (
                            <p className="px-3 py-5 text-center text-sm text-muted-foreground">
                              No matching stop. Try another area or stop name.
                            </p>
                          )}
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
                                    setSelectedPoint({
                                      point: {
                                        id: point.id,
                                        name: point.name,
                                        order: point.order,
                                        fare: point.fare,
                                        homeSurcharge: point.homeSurcharge,
                                      },
                                      route,
                                      coast,
                                    });
                                    setJourneyCollapsed(true);
                                    setPointPickerOpen(false);
                                  }}
                                  className="min-h-11"
                                >
                                  <Check className={cn("h-4 w-4", selectedPoint?.point.id === point.id ? "opacity-100" : "opacity-0")} />
                                  <span className="min-w-0 flex-1 truncate">{point.name}</span>
                                  <span className="text-xs tabular-nums text-muted-foreground">KSh {point.fare}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          ))}
                        </CommandList>
                        {pointSearchHasMore && pointSearchStatus === "ready" && (
                          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                            Showing 12 stops. Search by name to find another stop.
                          </p>
                        )}
                      </Command>
                    </PopoverContent>
                </Popover>
                {selectedPoint && (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    {selectedPoint.coast === "south" ? "South Coast" : "North Coast"} · {ksh(selectedPoint.point.fare)} per seat
                  </p>
                )}
                {!selectedPoint && routesStatus === "ready" && pointCount > 0 && (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    Choose a stop to see ride options and cabs for that route.
                  </p>
                )}
              </div>
            </div>
            </div>
            )}

            {/* Ride type and door service: compact choices with explicit states. */}
            {bookingCatalogueView === "booking" && selectedPoint && <section className="space-y-2.5" aria-labelledby="ride-options-title">
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

              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-muted-foreground">
                  {direction === "FROM_TERMINUS" ? "Where should we drop you?" : "Where should we pick you up?"}
                </legend>
                <div role="group" aria-label={`${pointLabelCap} preference`} className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    aria-pressed={!homePickup}
                    onClick={() => setHomePickup(false)}
                    className={cn("min-h-[76px] rounded-xl border bg-card p-3 text-left transition-colors", !homePickup ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "hover:border-primary/40")}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" /> At the stage
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                      {selectedPoint?.point.name ?? "Choose a stop first"}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={homePickup}
                    disabled={!selectedPoint}
                    onClick={() => setHomePickup(true)}
                    className={cn("min-h-[76px] rounded-xl border bg-card p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55", homePickup ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "hover:border-primary/40")}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <HomeIcon className="h-3.5 w-3.5 shrink-0 text-primary" /> Door-to-door
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {selectedPoint
                        ? (selectedPoint.point.homeSurcharge > 0
                          ? `+${ksh(selectedPoint.point.homeSurcharge * (charter ? 1 : seats))} · paid to driver`
                          : "No extra charge")
                        : "Choose a stop first"}
                    </span>
                  </button>
                </div>
              </fieldset>

              <div className="flex items-center justify-between rounded-xl border bg-card px-3.5 py-3">
                <span>
                  <span className="block text-xs text-muted-foreground">Estimated total{charter ? " · whole cab" : seats > 1 ? ` · ${seats} seats` : ""}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {selectedPoint
                      ? charter
                        ? `${ksh(bookingFeeAmount)} booking fee included in Mireli's 10% share`
                        : `Includes ${ksh(bookingFeeAmount)} booking fee`
                      : "Final amount shown before payment"}
                  </span>
                </span>
                <span className="text-lg font-bold tabular-nums text-primary">
                  {!selectedPoint
                    ? "Choose a point"
                    : charter && !farePreview.hasCharterCab
                      ? "No cabs available"
                      : charter && visibleTrips.some((trip) => trip.capacity !== visibleTrips[0]?.capacity)
                        ? `From ${ksh(farePreview.total)}`
                        : ksh(farePreview.total)}
                </span>
              </div>
            </section>}

            {/* Seats (pooled only) */}
            {bookingCatalogueView === "booking" && selectedPoint && !charter && (
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
            {bookingCatalogueView === "booking" && (selectedPoint || (hasEligibleDrivers === false && routesStatus !== "loading" && routesStatus !== "empty")) && <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {charter ? "Available for charter" : "Available pooled cabs"}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {loading ? "…" : hasEligibleDrivers === false ? "0 cabs" : selectedPoint ? `${visibleTrips.length} cabs` : "Choose a stop"}
                </span>
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
                        : !selectedPoint
                        ? `Choose a ${pointLabelCap.toLowerCase()} point to see cabs serving that stop.`
                        : "No available cabs serve this point for that train. Try another point or date."}
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
            </div>}

            {bookingCatalogueView === "booking" && (routesStatus === "ready" || routesStatus === "error") && <details className="rounded-xl border bg-card px-3.5 py-3 text-sm">
              <summary className="cursor-pointer font-medium">Fare and service details</summary>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                The fare is based on your selected point and ride type. Door-to-door surcharges go to your driver in full. A private cab reserves the whole vehicle. Review the complete amount and cancellation terms before you pay.
              </p>
            </details>}

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
  const baseFare = charter
    ? calculateCharterFare(trip.capacity, pointFare ?? trip.minFare)
    : (pointFare ?? trip.minFare) * seats;
  const surcharge = homePickup ? (pointSurcharge ?? 0) * (charter ? 1 : seats) : 0;
  const fare = baseFare + surcharge + (hasPoint && !charter ? trip.platformFeeAmount : 0);
  const insufficientSeats = charter ? trip.seatsLeft !== trip.capacity : trip.seatsLeft < seats;
  const full = insufficientSeats || !trip.bookable;

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
            {hasPoint && (
              <div className="text-[10px] text-muted-foreground">
                {charter ? `${ksh(trip.platformFeeAmount)} fee included` : `includes ${ksh(trip.platformFeeAmount)} fee`}
              </div>
            )}
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
            ? insufficientSeats
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
