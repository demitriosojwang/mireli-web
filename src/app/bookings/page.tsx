"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SiteFooter, SiteHeader, SiteNav } from "@/components/site-chrome";
import { PaySheet } from "@/components/pay-sheet";
import { DotBadge } from "@/components/app/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { api, useMe } from "@/lib/client";
import { fmtDateTime, fmtPhone, fmtTime, ksh, TIER_LABELS } from "@/lib/format";
import { cancellationWhatsAppUrl, MIRELI_SUPPORT_PHONE_E164, MIRELI_SUPPORT_PHONE_LOCAL } from "@/lib/support";
import { calculateLateCancellationCredit } from "@/lib/cancellation-policy";
import {
  Banknote,
  CalendarClock,
  Car,
  CheckCircle2,
  CreditCard,
  Crown,
  Home,
  Loader2,
  MapPin,
  Ticket,
  TicketX,
  UserRound,
} from "lucide-react";

interface BookingRow {
  id: string;
  code: string;
  routeName: string | null;
  direction: string;
  stageName: string | null;
  homePickup: boolean;
  homeAddress: string | null;
  seats: number;
  isCharter: boolean;
  fareAmount: number;
  homeSurcharge: number;
  creditApplied: number;
  cashDue: number;
  status: string;
  cancelTier: string | null;
  cancellationRequestedAt: string | null;
  createdAt: string;
  departureAt: string | null;
  tripStatus: string | null;
  driver: { name: string; plate: string; cabType: string; phone?: string | null } | null;
  allocationNote: string | null;
  passengerName: string | null;
  passengerPhone: string | null;
  checkedInAt: string | null;
  ledger: { status: string; cash: number; credit: number; receipt: string | null } | null;
  canPay: boolean;
  canCancel: boolean;
  canCheckIn: boolean;
  refund: { amount: number; status: string; reason: string } | null;
}

interface TierQuote {
  code: string;
  tier: string | null;
  detail: string;
  cashDue: number;
  creditApplied: number;
  creditValidityDays: number;
  policy: Record<string, string>;
}

export default function BookingsPage() {
  const { me, loading: meLoading, error: identityError, refresh: retryIdentity } = useMe();
  const { toast } = useToast();
  const [loadedBookings, setBookings] = useState<BookingRow[] | null>(null);
  const bookings = me?.session ? loadedBookings : meLoading ? null : [];
  const [payFor, setPayFor] = useState<BookingRow | null>(null);
  const [cancelFor, setCancelFor] = useState<BookingRow | null>(null);
  const [quote, setQuote] = useState<TierQuote | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ bookings: BookingRow[] }>("/api/bookings");
      setBookings(res.bookings);
    } catch {
      setBookings([]);
    }
  }, []);

  useEffect(() => {
    if (!me?.session) return;
    let active = true;
    api<{ bookings: BookingRow[] }>("/api/bookings")
      .then((res) => { if (active) setBookings(res.bookings); })
      .catch(() => { if (active) setBookings([]); });
    return () => { active = false; };
  }, [me?.session?.id]);

  async function openCancel(b: BookingRow) {
    setCancelFor(b);
    setQuote(null);
    try {
      const q = await api<TierQuote>(`/api/bookings/${b.id}`);
      setQuote(q);
    } catch {
      setQuote(null);
    }
  }

  async function contactSupport(method: "whatsapp" | "phone") {
    if (!cancelFor) return;
    setCancelling(true);
    try {
      const request = await api<{ ok: boolean; requestedAt: string }>(`/api/bookings/${cancelFor.id}`, {
        body: { action: "request_cancellation" },
      });
      setBookings((current) => current?.map((booking) => booking.id === cancelFor.id
        ? { ...booking, cancellationRequestedAt: request.requestedAt }
        : booking) ?? current);
      toast({
        title: "Cancellation request recorded",
        description: "Your booking stays active until Mireli confirms the cancellation.",
      });
      const destination = method === "whatsapp"
        ? cancellationWhatsAppUrl(cancelFor.code)
        : `tel:${MIRELI_SUPPORT_PHONE_E164}`;
      setCancelFor(null);
      window.location.assign(destination);
    } catch (e) {
      toast({ title: "Could not contact Mireli", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setCancelling(false);
    }
  }

  async function checkIn(b: BookingRow) {
    setCheckingIn(b.id);
    try {
      await api(`/api/bookings/${b.id}`, { body: { action: "checkin" } });
      toast({ title: "Checked in", description: "The driver will meet you at your point." });
      await load();
    } catch (e) {
      toast({ title: "Check-in failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setCheckingIn(null);
    }
  }

  if (meLoading) return null;

  if (!me?.session) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
          <Ticket className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">Couldn&apos;t load your session</p>
          <p className="text-sm text-muted-foreground">
            {identityError || "Your booking session is unavailable. Please try again."}
          </p>
          <Button variant="outline" onClick={() => void retryIdentity()} disabled={meLoading}>
            {meLoading ? "Retrying…" : "Try again"}
          </Button>
          <Button asChild>
            <Link href="/">Book a ride</Link>
          </Button>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const upcoming = (bookings || []).filter((b) => ["awaiting_payment", "confirmed", "boarded"].includes(b.status));
  const past = (bookings || []).filter((b) => ["cancelled", "completed", "no_show"].includes(b.status));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader subtitle="My rides" />
      <SiteNav />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-8">
        <p className="mb-4 text-xs text-muted-foreground">
          Your fare is held by the platform until your ride is delivered — never paid directly to a
          driver.
        </p>

        {bookings === null && (
          <div className="grid gap-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {bookings !== null && bookings.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
              <Ticket className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No bookings yet</p>
              <p className="text-sm text-muted-foreground">Find a departure and book your first seat.</p>
              <Button asChild>
                <Link href="/">Book a ride</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {upcoming.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Upcoming</h2>
            <div className="grid gap-2">
              {upcoming.map((b) => (
                <BookingCard
                  key={b.id}
                  b={b}
                  onPay={() => setPayFor(b)}
                  onCancel={() => openCancel(b)}
                  onCheckIn={() => checkIn(b)}
                  checkingIn={checkingIn === b.id}
                />
              ))}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">History</h2>
            <div className="grid gap-2">
              {past.map((b) => (
                <PastCard key={b.id} b={b} />
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter />

      {payFor && (
        <PaySheet
          open={!!payFor}
          onClose={() => {
            setPayFor(null);
            load();
          }}
          booking={{
            id: payFor.id,
            code: payFor.code,
            cashDue: payFor.cashDue,
            routeName: payFor.routeName,
            departureAt: payFor.departureAt,
            stageName: payFor.stageName,
            passengerName: payFor.passengerName,
            passengerPhone: payFor.passengerPhone,
            driver: payFor.driver
              ? { name: payFor.driver.name, plate: payFor.driver.plate, phone: payFor.driver.phone }
              : null,
          }}
          onPaid={load}
        />
      )}

      <AlertDialog open={!!cancelFor} onOpenChange={(v) => !v && setCancelFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {cancelFor?.code}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {!quote && <Loader2 className="h-4 w-4 animate-spin" />}
                {quote && (
                  <>
                    <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                      <span className="font-semibold text-foreground">
                        {quote.tier ? TIER_LABELS[quote.tier] : quote.detail}
                      </span>
                      {quote.tier && (
                        <span className="mt-1 block text-muted-foreground">{quote.policy[quote.tier]}</span>
                      )}
                    </p>
                    {quote.tier === "late" && (
                      <p className="text-sm">
                        <strong>75%</strong> of the fare ({ksh(calculateLateCancellationCredit(quote.cashDue + quote.creditApplied))})
                        becomes travel credit for <strong>30 days</strong>. The remaining 25% is forfeited.
                      </p>
                    )}
                  </>
                )}
                <p className="text-sm text-muted-foreground">
                  Mireli handles cancellation requests. Your booking remains active until support confirms it.
                </p>
                {cancelFor?.cancellationRequestedAt && (
                  <p className="text-sm font-medium text-amber-800">Your request was already recorded. Contact Mireli to continue.</p>
                )}
                <p className="text-sm">Support number: <span className="font-medium">{MIRELI_SUPPORT_PHONE_LOCAL}</span></p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my seat</AlertDialogCancel>
            <Button onClick={() => void contactSupport("phone")} disabled={cancelling || !quote} variant="outline">
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : `Call ${MIRELI_SUPPORT_PHONE_LOCAL}`}
            </Button>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void contactSupport("whatsapp");
              }}
              disabled={cancelling || !quote}
            >
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue on WhatsApp"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BookingCard({
  b,
  onPay,
  onCancel,
  onCheckIn,
  checkingIn,
}: {
  b: BookingRow;
  onPay: () => void;
  onCancel: () => void;
  onCheckIn: () => void;
  checkingIn: boolean;
}) {
  return (
    <Card className="mireli-card-tap">
      <CardContent className="space-y-2 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{b.code}</span>
              <DotBadge status={b.status} />
              {b.isCharter && (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-900">
                  <Crown className="h-2.5 w-2.5" /> Charter
                </span>
              )}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm">
              <CalendarClock className="h-4 w-4 text-primary" />
              {fmtDateTime(b.departureAt)}
              {b.tripStatus && <span className="text-muted-foreground">· trip {b.tripStatus}</span>}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" /> {b.stageName}
              {b.homePickup && <Home className="h-3.5 w-3.5" />}
            </p>
            {b.driver && (
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                <Car className="h-4 w-4" /> {b.driver.name} · {b.driver.plate}
                {b.driver.phone && (
                  <a href={`tel:${b.driver.phone}`} className="font-mono text-xs text-primary underline-offset-2 hover:underline">
                    {fmtPhone(b.driver.phone)}
                  </a>
                )}
              </p>
            )}
            {b.allocationNote && !b.driver && (
              <p className="mt-0.5 text-xs text-muted-foreground">{b.allocationNote}</p>
            )}
            {b.passengerName && (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <UserRound className="h-4 w-4" /> {b.passengerName}
                {b.passengerPhone && (
                  <span className="font-mono text-xs">· +{b.passengerPhone.replace(/^(254)/, "")}</span>
                )}
              </p>
            )}
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{ksh(b.fareAmount)}</p>
            {b.creditApplied > 0 && <p className="text-xs text-emerald-700">credit −{ksh(b.creditApplied)}</p>}
            {b.cashDue > 0 && b.status === "awaiting_payment" && (
              <p className="text-xs text-amber-700">{ksh(b.cashDue)} by M-Pesa</p>
            )}
          </div>
        </div>

        {b.cancellationRequestedAt && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Cancellation requested {fmtDateTime(b.cancellationRequestedAt)}. Mireli must confirm before this booking is cancelled.
          </p>
        )}

        {b.direction === "TO_TERMINUS" && b.departureAt &&
          ["awaiting_payment", "confirmed", "boarded"].includes(b.status) && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <b>Be at the stage by {fmtTime(b.departureAt)}</b> — cabs leave 2h before the train and
            wait at most 15 minutes if you haven&apos;t notified the driver.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {b.canPay && (
            <Button size="sm" className="h-8" onClick={onPay}>
              <CreditCard className="h-3.5 w-3.5" /> Pay {ksh(b.cashDue)} now
            </Button>
          )}
          {b.canCheckIn && (
            <Button size="sm" variant="outline" className="h-8" onClick={onCheckIn} disabled={checkingIn}>
              {checkingIn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              I&apos;m at the point
            </Button>
          )}
          {b.canCancel && (
            <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" onClick={onCancel}>
              <TicketX className="h-3.5 w-3.5" /> {b.cancellationRequestedAt ? "Continue request" : "Request cancellation"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PastCard({ b }: { b: BookingRow }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{b.code}</span>
              <DotBadge status={b.status} />
              {b.cancelTier && (
                <span className="text-xs text-muted-foreground">{TIER_LABELS[b.cancelTier]}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {fmtDateTime(b.departureAt || b.createdAt)} · {b.stageName}
            </p>
            {b.ledger?.receipt && (
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">M-Pesa {b.ledger.receipt}</p>
            )}
            {b.refund && (
              <p className="mt-1 flex items-center gap-1 text-xs text-sky-900">
                <Banknote className="h-3.5 w-3.5" />
                Refund {ksh(b.refund.amount)} · {b.refund.status}
              </p>
            )}
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{ksh(b.fareAmount)}</p>
            {b.creditApplied > 0 && <p className="text-xs text-emerald-700">credit −{ksh(b.creditApplied)}</p>}
          </div>
        </div>
        {b.status === "no_show" && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-900">
            The seat was held and the driver went to the point for it — the fare was forfeited per
            the cancellation policy.
          </p>
        )}
        {b.status === "cancelled" && b.cancelTier === "late" && (
          <p className="rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-900">
            75% of the fare became travel credit for 30 days; the remaining 25% was forfeited. See the Credits page.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
