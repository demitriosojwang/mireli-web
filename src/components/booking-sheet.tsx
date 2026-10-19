"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PaySheet } from "@/components/pay-sheet";
import { AuthSheet } from "@/components/auth-sheet";
import { api, useMe, detailsComplete, type PassengerDetails } from "@/lib/client";
import { ksh, fmtTime } from "@/lib/format";
import { NATIONALITIES, DEFAULT_NATIONALITY } from "@/lib/nationalities";
import { calculateBookingFeeAmount, calculateSharedFare, calculateSharedSeatFare, DEFAULT_BOOKING_FEE_AMOUNT } from "@/lib/pricing";
import { calculateCharterFare } from "@/lib/charter-pricing";
import { Crown, Home, Loader2, MapPin, Ticket as TicketIcon, TrainFront, UserRound, AlarmClock, LogIn } from "lucide-react";
import { DotBadge, Stars } from "@/components/app/shared";

export interface Stage {
  id: string;
  name: string;
  order: number;
  fare: number;
  homeSurcharge: number;
}

export interface TrainInfo {
  name: string;
  mtmTime: string;
  ntmTime: string;
  eventKind: "departs_mtm" | "arrives_mtm";
}

export interface BookableTrip {
  id: string;
  routeId: string;
  routeName: string;
  durationMinutes: number;
  charterPrice: number;
  platformFeeAmount: number;
  direction: string;
  departureAt: string;
  terminusAt: string;
  train: TrainInfo | null;
  status: string;
  capacity: number;
  seatsLeft: number;
  bookable: boolean;
  lockNote?: string | null;
  pointsLabel: "drop-off" | "pickup";
  driver: { name: string; plate: string; cabType: string; rating: number } | null;
}

export interface BookableTripWithStages extends BookableTrip {
  stages: Stage[];
}

/** Everything the main view collected before the sheet opens. */
export interface BookingDraft {
  trip: BookableTripWithStages;
  stageId: string;
  travelDate: string;
  seats: number;
  charter: boolean;
  homePickup: boolean;
  homeAddress: string;
  useCredit: boolean;
}

interface CreateResponse {
  booking: {
    id: string;
    code: string;
    status: string;
    fareAmount: number;
    isCharter: boolean;
    platformFeeAmount: number;
    creditApplied: number;
    cashDue: number;
    stageName: string;
    allocationNote: string | null;
    passengerName: string | null;
    passengerPhone: string | null;
    trip: {
      departureAt: string;
      routeName: string;
      driver: { name: string; plate?: string | null; phone?: string | null } | null;
    } | null;
  };
}

const GUEST_LIMIT_COPY =
  "You can only book up to 1 seat without logging in. Login to book more seats.";

/** Primary-passenger details typed on this device prefill the next booking —
 *  convenience only, never an account. */
const GUEST_KEY = "mireli.guest";

const EMPTY_DETAILS: PassengerDetails = {
  fullName: "",
  idType: "id",
  idNumber: "",
  nationality: DEFAULT_NATIONALITY,
  gender: "",
  email: "",
  phone: "",
};

function loadGuestDetails(): PassengerDetails {
  if (typeof window === "undefined") return { ...EMPTY_DETAILS };
  try {
    const raw = window.localStorage.getItem(GUEST_KEY);
    if (raw) return { ...EMPTY_DETAILS, ...JSON.parse(raw) };
  } catch {}
  return { ...EMPTY_DETAILS };
}

function blankToDefault(d: PassengerDetails): PassengerDetails {
  return { ...d, nationality: d.nationality || DEFAULT_NATIONALITY };
}

export function BookingSheet(props: Omit<Parameters<typeof BookingSheetContent>[0], "identity">) {
  const identity = useMe();
  return props.open && props.draft && !identity.loading
    ? <BookingSheetContent key={props.draft.trip.id} {...props} identity={identity} /> : null;
}

function BookingSheetContent({
  open,
  onClose,
  draft,
  onBooked,
  identity,
}: {
  open: boolean;
  onClose: () => void;
  draft: BookingDraft | null;
  onBooked: () => void;
  identity: ReturnType<typeof useMe>;
}) {
  const { me, refresh } = identity;
  const creditBalance = me?.creditBalance || 0;
  const [homeAddress, setHomeAddress] = useState(draft?.homeAddress || "");
  const [useCredit, setUseCredit] = useState(draft?.useCredit || false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateResponse["booking"] | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [details, setDetails] = useState<PassengerDetails>(() => {
    const p = me?.passenger;
    if (p && !p.isGuest) {
      return {
        fullName: p.name || "",
        idType: p.idType === "passport" ? "passport" : "id",
        idNumber: p.idNumber || "",
        nationality: p.nationality || DEFAULT_NATIONALITY,
        gender: p.gender || "",
        email: p.email || "",
        phone: p.phone || "",
      };
    }
    return blankToDefault(loadGuestDetails());
  });

  const trip = draft?.trip;
  const stage = useMemo(() => trip?.stages.find((s) => s.id === draft?.stageId), [trip, draft?.stageId]);

  const isGuest = me?.passenger?.isGuest ?? true;
  const guestUsed = me?.passenger?.guestUsed ?? false;

  const fare = trip && stage
    ? (draft?.charter
      ? calculateCharterFare(trip.capacity, stage.fare)
      : calculateSharedFare(stage.fare, trip.capacity, draft?.seats || 1))
    : 0;
  const surcharge = draft?.homePickup ? (draft?.charter ? stage?.homeSurcharge || 0 : (stage?.homeSurcharge || 0) * (draft?.seats || 1)) : 0;
  const bookingFeePerSeat = trip?.platformFeeAmount ?? DEFAULT_BOOKING_FEE_AMOUNT;
  const platformFeeAmount = calculateBookingFeeAmount(bookingFeePerSeat, draft?.seats || 1, !!draft?.charter);
  const total = fare + surcharge + (draft?.charter ? 0 : platformFeeAmount);
  const creditApplied = useCredit ? Math.min(creditBalance, total) : 0;
  const cashDue = total - creditApplied;
  const detailsOk = detailsComplete(details);

  /** Guests: 1 seat, 1 booking — anything more needs a Mi-Reli account. */
  const guestBlocked = isGuest && (guestUsed || (draft?.seats ?? 1) > 1 || draft?.charter);

  function set<K extends keyof PassengerDetails>(key: K, value: PassengerDetails[K]) {
    setDetails((d) => ({ ...d, [key]: value }));
  }

  async function confirm() {
    if (!trip || !draft || !detailsOk) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<CreateResponse>("/api/bookings", {
        body: {
          routeId: trip.routeId,
          tripId: trip.id,
          direction: trip.direction,
          stageId: draft.stageId,
          homePickup: draft.homePickup,
          homeAddress: draft.homePickup ? homeAddress : undefined,
          seats: draft.charter ? 1 : draft.seats,
          isCharter: draft.charter,
          applyCredit: useCredit && creditBalance > 0,
          travelDate: draft.travelDate,
          passengerName: details.fullName.trim(),
          passengerPhone: details.phone,
          passengerEmail: details.email.trim(),
          passengerIdType: details.idType,
          passengerIdNumber: details.idNumber.trim(),
          passengerNationality: details.nationality,
          passengerGender: details.gender,
        },
      });
      try {
        window.localStorage.setItem(GUEST_KEY, JSON.stringify({ ...details, fullName: details.fullName.trim(), email: details.email.trim() }));
      } catch {}
      setCreated(res.booking);
      await refresh();
      onBooked();
      if (res.booking.cashDue > 0) {
        setPayOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAuthed() {
    setAuthOpen(false);
    await refresh();
    setError(null);
  }

  if (!trip || !draft) return null;

  const isCharter = draft.charter;

  return (
    <>
      <Sheet open={open && !payOpen} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <SheetTitle className="flex flex-wrap items-center gap-2 text-xl">
                  {trip.driver ? `${trip.driver.name}'s ${trip.driver.cabType}` : trip.routeName}
                  {isCharter && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-900">
                      <Crown className="h-3 w-3" /> Private charter
                    </span>
                  )}
                </SheetTitle>
                <SheetDescription className="mt-1 flex flex-wrap items-center gap-2">
                  {trip.driver && <Stars rating={trip.driver.rating} />}
                  {trip.driver && <span className="text-muted-foreground/50">•</span>}
                  {trip.driver && <span className="font-mono text-xs">{trip.driver.plate}</span>}
                  {trip.driver && <span className="text-muted-foreground/50">•</span>}
                  <DotBadge status={trip.status} />
                </SheetDescription>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {isCharter ? "Total fare" : draft.seats > 1 ? `${draft.seats} seats` : "Fare"}
                </div>
                <div className="text-2xl font-bold tabular-nums text-primary">{ksh(total)}</div>
                <div className="text-[10px] text-muted-foreground">
                  {isCharter
                    ? `${ksh(platformFeeAmount)} fee included in Mireli's 10% share`
                    : `${ksh(bookingFeePerSeat)} × ${draft.seats} seat${draft.seats === 1 ? "" : "s"} Mireli fee`}
                </div>
                {surcharge > 0 && <div className="text-[10px] text-muted-foreground">Includes {ksh(surcharge)} door-to-door surcharge</div>}
                {isCharter && (
                  <div className="text-[10px] text-muted-foreground">
                    {trip.capacity} seats × ({ksh(stage?.fare || 0)} stage fare + KSh 100 per seat)
                  </div>
                )}
                {!isCharter && draft.seats > 1 && (
                  <div className="text-[10px] text-muted-foreground">
                    {draft.seats} × {ksh(stage ? calculateSharedSeatFare(stage.fare, trip.capacity) : 0)}
                  </div>
                )}
              </div>
            </div>
          </SheetHeader>

          {created ? (
            <div className="space-y-4 px-4 pb-2">
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                  <TicketIcon className="h-7 w-7 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold">Booking {created.code} placed!</h3>
                <p className="max-w-xs text-sm text-muted-foreground">
                  {created.cashDue > 0
                    ? `Karibu ${created.passengerName?.split(" ")[0] || ""} — complete the M-Pesa payment to confirm your seat.`
                    : `Karibu ${created.passengerName?.split(" ")[0] || ""} — fully covered by your travel credit, your seat is confirmed.`}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total fare</span>
                  <span className="font-medium">{ksh(created.fareAmount)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{created.isCharter ? "Mireli fee (inside 10%)" : "Mireli fee"}</span>
                  <span>{ksh(created.platformFeeAmount)}</span>
                </div>
                {created.creditApplied > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Paid with credit</span>
                    <span>−{ksh(created.creditApplied)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">M-Pesa</span>
                  <span className="font-medium">{ksh(created.cashDue)}</span>
                </div>
                {created.allocationNote && (
                  <p className="mt-2 text-xs text-muted-foreground">{created.allocationNote}</p>
                )}
              </div>
              {created.cashDue > 0 ? (
                <Button className="w-full" onClick={() => setPayOpen(true)}>
                  Pay {ksh(created.cashDue)} with M-Pesa
                </Button>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                  Mireli handles driver settlement after the trip; you do not pay the driver directly.
                </div>
              )}
              <Button variant="outline" className="w-full" onClick={onClose}>
                {created.cashDue > 0 ? "Pay later from My rides" : "Done"}
              </Button>
            </div>
          ) : identity.error || !me?.session ? (
            <div className="space-y-3 px-4 pb-2" role="alert">
              <p className="text-sm text-destructive">
                We couldn&apos;t start a secure booking session, so this booking has not been submitted.
              </p>
              <Button variant="outline" className="w-full" onClick={() => void refresh()}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="space-y-4 px-4 pb-2">
              {/* Route info */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-secondary/60 p-3">
                  <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <MapPin className="h-3 w-3" />{" "}
                    {draft.homePickup
                      ? trip.direction === "FROM_TERMINUS"
                        ? "Drop-off near"
                        : "Pickup near"
                      : trip.direction === "FROM_TERMINUS"
                        ? "Drop-off point"
                        : "Pickup point"}
                  </div>
                  <div className="font-medium">{stage?.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {draft.homePickup ? "door-to-door" : "shared stage"} · {trip.routeName.includes("North") ? "North" : "South"} Coast
                  </div>
                </div>
                <div className="rounded-lg bg-secondary/60 p-3">
                  <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <TrainFront className="h-3 w-3" /> Train
                  </div>
                  <div className="font-medium">{trip.train?.name ?? "Shuttle"}</div>
                  <div className="text-xs text-muted-foreground">
                    {trip.direction === "FROM_TERMINUS"
                      ? `Meets · MTM ${trip.train?.mtmTime ?? fmtTime(trip.departureAt)}`
                      : `Catches · MTM ${trip.train?.mtmTime ?? fmtTime(trip.departureAt)}`}
                  </div>
                  <div className="text-xs text-muted-foreground">Cab departs {fmtTime(trip.departureAt)}</div>
                </div>
              </div>

              {/* Stage arrival rule — cabs leave stages 2h before the train,
                  waiting at most 15 min for a silent passenger. */}
              {trip.direction === "TO_TERMINUS" && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                  <AlarmClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span>
                    Be at <b>{stage?.name || "your stage"}</b> by <b>{fmtTime(trip.departureAt)}</b> — cabs leave exactly 2 hours before the train. The driver waits at most 15 minutes if you haven&apos;t arrived and haven&apos;t notified them; after that the seat travels without you.
                  </span>
                </div>
              )}

              {draft.homePickup && (
                <div className="space-y-1.5">
                  <Label htmlFor="draft-address" className="flex items-center gap-1 text-xs">
                    <Home className="h-3 w-3" /> Door-to-door address
                  </Label>
                  <Input
                    id="draft-address"
                    value={homeAddress}
                    onChange={(e) => setHomeAddress(e.target.value)}
                    placeholder="e.g. Near Naivas Bamburi, gate 2"
                    className="h-9"
                  />
                </div>
              )}

              {/* Primary passenger — personal details + contact info. */}
              <div className="space-y-3 rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1 text-xs">
                    <UserRound className="h-3 w-3" /> Primary passenger
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    {isGuest ? "book as a guest — no account needed" : "details from your account"}
                  </span>
                </div>

                {guestBlocked && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <p className="font-medium">{GUEST_LIMIT_COPY}</p>
                    <p className="mt-1 text-amber-800">
                      Create your Mi-Reli account with the exact same details you booked with — your rides and credit carry over.
                    </p>
                    <Button size="sm" className="mt-2 h-8 w-full" onClick={() => setAuthOpen(true)}>
                      <LogIn className="mr-1 h-3.5 w-3.5" /> Login to book more seats
                    </Button>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Personal details</Label>
                  <Input
                    value={details.fullName}
                    onChange={(e) => set("fullName", e.target.value)}
                    placeholder="Full name (as on your ID)"
                    className="h-9"
                    autoComplete="name"
                  />
                  <div className="grid grid-cols-[110px_1fr] gap-2">
                    <Select value={details.idType} onValueChange={(v) => set("idType", v as PassengerDetails["idType"])}>
                      <SelectTrigger className="h-9 w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="id">National ID</SelectItem>
                        <SelectItem value="passport">Passport</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={details.idNumber}
                      onChange={(e) => set("idNumber", e.target.value)}
                      placeholder={details.idType === "passport" ? "Passport number" : "ID number"}
                      className="h-9"
                      inputMode="text"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Nationality</Label>
                      <Select value={details.nationality || DEFAULT_NATIONALITY} onValueChange={(v) => set("nationality", v)}>
                        <SelectTrigger className="h-9 w-full text-xs">
                          <SelectValue placeholder="Select nationality" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {NATIONALITIES.map((n) => (
                            <SelectItem key={n} value={n} className="text-xs">
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Gender</Label>
                      <Select value={details.gender || undefined} onValueChange={(v) => set("gender", v)}>
                        <SelectTrigger className="h-9 w-full text-xs">
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="female" className="text-xs">Female</SelectItem>
                          <SelectItem value="male" className="text-xs">Male</SelectItem>
                          <SelectItem value="other" className="text-xs">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <Separator className="my-0.5" />

                <div className="space-y-2">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Contact info</Label>
                  <Input
                    type="email"
                    value={details.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="Email address"
                    className="h-9"
                    autoComplete="email"
                  />
                  <Input
                    value={details.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="M-Pesa number · 07XX XXX XXX"
                    inputMode="tel"
                    className="h-9"
                    autoComplete="tel"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    We reach this number with the M-Pesa prompt and pickup updates. Your name goes on the seat list the driver sees.
                  </p>
                </div>
              </div>

              {/* Fare breakdown */}
              <div className="space-y-1.5 rounded-lg border bg-card p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{isCharter ? "Charter fare" : `Fare × ${draft.seats}`}</span>
                  <span className="font-medium tabular-nums">{ksh(fare)}</span>
                </div>
                {surcharge > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Door-to-door surcharge (to driver in full)</span>
                    <span className="font-medium tabular-nums">+{ksh(surcharge)}</span>
                  </div>
                )}
                {creditBalance > 0 && (
                  <label className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                    <Checkbox checked={useCredit} onCheckedChange={(v) => setUseCredit(v === true)} className="mt-0.5" />
                    <span className="text-emerald-900">
                      Use travel credit — {ksh(creditBalance)} available
                      <span className="block text-[10px] text-emerald-800">
                        Partial use supported — leftover stays as credit, valid 30 days.
                      </span>
                    </span>
                  </label>
                )}
                {creditApplied > 0 && (
                  <div className="flex items-center justify-between text-emerald-700">
                    <span>Travel credit applied</span>
                    <span className="font-medium tabular-nums">−{ksh(creditApplied)}</span>
                  </div>
                )}
                <Separator className="my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">To pay now</span>
                  <span className="text-sm font-bold tabular-nums text-primary">
                    {cashDue > 0 ? ksh(cashDue) : "Nothing — credit covers it"}
                  </span>
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          {!created && !identity.error && me?.session && (
            <SheetFooter className="px-4 pb-4">
              {guestBlocked ? (
                <p className="text-center text-[11px] text-muted-foreground">
                  Fill in your details, then login or sign up to complete this booking.
                </p>
              ) : (
                <Button className="h-11 w-full" disabled={busy || !draft.stageId || !detailsOk} onClick={confirm}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isCharter ? (
                    `Book charter · ${ksh(total)}`
                  ) : (
                    `Reserve ${draft.seats > 1 ? `${draft.seats} seats` : "seat"} · ${ksh(total)}`
                  )}
                </Button>
              )}
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      <AuthSheet
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        initialDetails={details}
        onAuthed={onAuthed}
      />

      {created && (
        <PaySheet
          open={payOpen}
          onClose={() => {
            setPayOpen(false);
            onClose();
          }}
          booking={{
            id: created.id,
            code: created.code,
            cashDue: created.cashDue,
            routeName: created.trip?.routeName,
            departureAt: created.trip?.departureAt,
            stageName: created.stageName,
            passengerName: created.passengerName,
            passengerPhone: created.passengerPhone,
            driver: created.trip?.driver
              ? { name: created.trip.driver.name, plate: created.trip.driver.plate, phone: created.trip.driver.phone }
              : null,
          }}
          onPaid={onBooked}
        />
      )}
    </>
  );
}
