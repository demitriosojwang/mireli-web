"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { SiteFooter, SiteHeader, SiteNav } from "@/components/site-chrome";
import { BookingSheet, BookableTrip, BookingDraft } from "@/components/booking-sheet";
import { PaySheet } from "@/components/pay-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { api, useMe } from "@/lib/client";
import { fmtTime, ksh } from "@/lib/format";
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
  Clock,
  Crown,
  Home as HomeIcon,
  Info,
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

function coastOf(routeName: string): "north" | "south" {
  return routeName.toLowerCase().includes("south") ? "south" : "north";
}

export default function Home() {
  const { me } = useMe();
  const router = useRouter();
  const splashSeen = useSplashOnce();
  const [splashDone, setSplashDone] = useState(false);

  const showSplash = splashSeen && !splashDone;

  const [direction, setDirection] = useState<"FROM_TERMINUS" | "TO_TERMINUS">("FROM_TERMINUS");
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [trips, setTrips] = useState<BookableTrip[] | null>(null);
  const [hasEligibleDrivers, setHasEligibleDrivers] = useState<boolean | null>(null);
  const [timetable, setTimetable] = useState<TrainRow[]>([]);
  const [myBookings, setMyBookings] = useState<BookingRow[]>([]);
  const [isRefreshing, setLoading] = useState(false);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
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

  const loadTrips = useCallback(async (dir: string, d: string) => {
    setLoading(true);
    try {
      const res = await api<{ trips: BookableTrip[]; hasEligibleDrivers: boolean }>(`/api/trips?date=${d}&direction=${dir}`);
      setTrips(res.trips);
      setHasEligibleDrivers(res.hasEligibleDrivers);
    } catch {
      setTrips([]);
      setHasEligibleDrivers(null);
    } finally {
      setLoading(false);
      setLoadedQuery(`${dir}|${d}`);
    }
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
    api<{ routes: RouteInfo[] }>("/api/routes")
      .then((r) => setRoutes(r.routes))
      .catch(() => {});
    api<{ trains: TrainRow[] }>("/api/trains")
      .then((r) => setTimetable(r.trains))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    api<{ bookings: BookingRow[] }>("/api/bookings")
      .then((res) => { if (active) setMyBookings(res.bookings.filter((b) => ["awaiting_payment", "confirmed", "boarded"].includes(b.status))); })
      .catch(() => { if (active) setMyBookings([]); });
    return () => { active = false; };
  }, [isAuthed]);

  useEffect(() => {
    if (showSplash) return;
    let active = true;
    api<{ trips: BookableTrip[]; hasEligibleDrivers: boolean }>(`/api/trips?date=${date}&direction=${direction}`)
      .then((res) => {
        if (!active) return;
        setTrips(res.trips);
        setHasEligibleDrivers(res.hasEligibleDrivers);
      })
      .catch(() => {
        if (!active) return;
        setTrips([]);
        setHasEligibleDrivers(null);
      })
      .finally(() => { if (active) setLoadedQuery(queryKey); });
    return () => { active = false; };
  }, [showSplash, direction, date, queryKey]);

  function openBooking(trip: BookableTrip) {
    const fallbackStage =
      direction === "FROM_TERMINUS"
        ? trip.stages.filter((s) => s.order > 0).slice(-1)[0]
        : trip.stages.filter((s) => s.order > 0)[0];
    setDraft({
      trip,
      stageId: pointId && trip.stages.some((s) => s.id === pointId) ? pointId : fallbackStage?.id || "",
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
    if (pointId) list = list.filter((t) => t.stages.some((s) => s.id === pointId));
    return list;
  }, [trips, trainKey, pointId, charter]);

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
    return { base, surcharge, total: base + surcharge };
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
              {trainOptions.length === 0 && !loading && (
                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Timetable unavailable right now — cabs run to the Madaraka Express schedule (08:00 Inter-County · 15:00 Express · 22:00 Night Train).
                </p>
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
              {pointGroups.length === 0 ? (
                <Skeleton className="h-11 w-full" />
              ) : (
                <div className="space-y-1.5">
                  <select
                    id="booking-point"
                    aria-label={`${pointLabelCap} point`}
                    value={pointId ?? ""}
                    onChange={(event) => setPointId(event.target.value || null)}
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Choose a {pointLabelCap.toLowerCase()} point</option>
                    {pointGroups.map(({ route, coast, points }) => (
                      <optgroup
                        key={route.id}
                        label={`${coast === "south" ? "South Coast" : "North Coast"} · ${route.name.replace("Mombasa Terminus ↔ ", "").replace(" (Mtwapa · Malindi)", "")}`}
                      >
                        {points.map((point) => (
                          <option key={point.id} value={point.id}>
                            {point.name} · KSh {point.fare} · door +KSh {point.homeSurcharge}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {selectedPoint && (
                    <p className="text-[11px] text-muted-foreground">
                      {selectedPoint.point.name} · KSh {selectedPoint.point.fare} per seat · door surcharge +KSh {selectedPoint.point.homeSurcharge}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Options: door-to-door + charter + live fare preview */}
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Car className="h-4 w-4" /> {pointLabelCap} options
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {/* Door-to-door toggle */}
                <div className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3">
                  <div className="flex-1">
                    <Label className="flex items-center gap-1 text-sm font-medium">
                      <HomeIcon className="h-4 w-4" /> Door-to-door {direction === "FROM_TERMINUS" ? "drop-off" : "pickup"}
                    </Label>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {selectedPoint
                        ? `+${ksh(selectedPoint.point.homeSurcharge)}/seat — passes to your driver in full.`
                        : "Pick a point first to see its door surcharge."}
                    </p>
                  </div>
                  <Switch checked={homePickup} onCheckedChange={setHomePickup} aria-label="Door-to-door" />
                </div>

                {/* Charter toggle */}
                <div className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3">
                  <div className="flex-1">
                    <Label className="flex items-center gap-1 text-sm font-medium">
                      <Crown className="h-4 w-4 text-violet-600" /> Book the whole vehicle (private)
                    </Label>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Reserve the entire cab for your family or group — no other passengers join.
                    </p>
                  </div>
                  <Switch
                    checked={charter}
                    onCheckedChange={(c) => {
                      setCharter(c);
                      if (c) setHomePickup(false);
                    }}
                    aria-label="Charter"
                  />
                </div>

                {/* Live fare preview */}
                <div className="space-y-1.5 rounded-lg border bg-card p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Live fare preview</div>
                  <div className="space-y-1 text-xs">
                    <Row
                      label={charter ? "Charter (whole cab)" : `Base (per seat${selectedPoint ? ` · ${selectedPoint.point.name}` : ""})`}
                      value={selectedPoint || charter ? ksh(charter ? (selectedPoint?.route.charterPrice ?? 0) : (previewStage?.fare || 0)) : "—"}
                    />
                    {homePickup && selectedPoint && (
                      <Row label={`Door-to-door surcharge${charter ? "" : ` × ${seats}`}`} value={`+${ksh(previewStage?.homeSurcharge || 0)}${charter ? "" : ` × ${seats}`}`} />
                    )}
                    {!charter && seats > 1 && selectedPoint && <Row label={`Seats × ${seats}`} value={`${ksh(previewStage?.fare || 0)} × ${seats}`} />}
                  </div>
                  <div className="flex items-center justify-between border-t pt-1.5">
                    <span className="text-sm font-medium">
                      Total {charter ? "(whole cab)" : seats > 1 ? `(${seats} seats)` : ""}
                    </span>
                    <span className="text-lg font-bold tabular-nums text-primary">
                      {selectedPoint || charter ? ksh(farePreview.total) : "—"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

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
                <div className="space-y-2">
                  <Skeleton className="h-36 w-full" />
                  <Skeleton className="h-36 w-full" />
                </div>
              )}

              {!loading && visibleTrips.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
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
                      seats={seats}
                      charter={charter}
                      onBook={() => openBooking(trip)}
                    />
                  </motion.div>
                ))}
            </div>

            {/* How it works */}
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-xs">
                  <Info className="h-3.5 w-3.5" /> How points &amp; fares work
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0 text-xs text-muted-foreground">
                <p>
                  Cabs meet every Madaraka Express at Mombasa Terminus. {direction === "FROM_TERMINUS" ? "Choose your drop-off point — the cab drops you there on the way from the terminus." : "Choose your pickup point and be there 10 minutes before the cab leaves for the terminus."}
                </p>
                <p>
                  Shared-ride fare is <span className="font-medium text-foreground">KSh 400</span> per seat upcountry (Malindi 700, Diani Naivas 500). Door-to-door adds the point&apos;s surcharge, which goes to your driver in full.
                </p>
                <p>Private charter = the whole cab. Cancel before lock for a full refund; after lock, fares become 30-day travel credit.</p>
              </CardContent>
            </Card>

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
          loadTrips(direction, date);
          loadMyBookings();
        }}
        draft={draft}
        onBooked={() => {
          loadTrips(direction, date);
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function CabCard({
  trip,
  pointName,
  pointFare,
  seats,
  charter,
  onBook,
}: {
  trip: BookableTrip;
  pointName?: string;
  pointFare?: number;
  seats: number;
  charter: boolean;
  onBook: () => void;
}) {
  const booked = trip.capacity - trip.seatsLeft;
  const fare = charter ? trip.charterPrice : (pointFare ?? trip.minFare) * seats;
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

        <Button className="h-9 w-full" size="sm" disabled={full} onClick={onBook}>
          {full
            ? trip.seatsLeft <= 0
              ? "Not enough seats"
              : "Unavailable"
            : charter
              ? `Book charter · ${ksh(trip.charterPrice)}`
              : `Reserve ${seats > 1 ? `${seats} seats` : "seat"} · ${ksh(fare)}`}
        </Button>
      </CardContent>
    </Card>
  );
}
