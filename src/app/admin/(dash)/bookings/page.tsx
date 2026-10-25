"use client";

import { useState } from "react";
import { useAdminData } from "@/components/admin/use-admin-data";
import { BookingStatusBadge, LedgerStatusBadge, TripStatusBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/client";
import { fmtDate, fmtDateTime, ksh, TIER_LABELS } from "@/lib/format";
import { Ban, ClipboardCheck, Mail, Search, Undo2 } from "lucide-react";

interface AdminBooking {
  id: string;
  code: string;
  passenger: { name: string | null; phone: string };
  guest: { name: string; phone: string | null } | null;
  routeName: string | null;
  direction: string;
  stageName: string | null;
  homePickup: boolean;
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
  driver: { name: string; plate: string } | null;
  allocationNote: string | null;
  ticketEmail: { status: string; attempts: number; sentAt: string | null; lastErrorCode: string | null } | null;
  ledger: { status: string; cash: number; credit: number; homeSurcharge: number; receipt: string | null } | null;
}

const STATUSES = ["", "awaiting_payment", "confirmed", "boarded", "cancelled", "completed", "no_show"];

export default function AdminBookings() {
  const { toast } = useToast();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const url = `/api/admin/bookings?${status ? `status=${status}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`;
  const { data, refresh } = useAdminData<{ bookings: AdminBooking[] }>(url);
  const [overrideFor, setOverrideFor] = useState<AdminBooking | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function platformCancel(b: AdminBooking) {
    setBusy(true);
    try {
      const res = await api<{ outcome: string }>("/api/admin/bookings", {
        body: { bookingId: b.id, action: "platform_cancel" },
      });
      toast({
        title: `Platform cancelled ${b.code}`,
        description:
          res.outcome === "refunded"
            ? "Full cash refund issued regardless of timing."
            : res.outcome === "voided_unpaid"
              ? "Nothing was collected — booking voided."
              : res.outcome,
      });
      refresh();
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function processPassengerCancellation(b: AdminBooking) {
    setBusy(true);
    try {
      const result = await api<{ outcome: string; tier: string | null }>("/api/admin/bookings", {
        body: { bookingId: b.id, action: "process_passenger_cancel" },
      });
      const outcomeLabel = result.outcome === "refunded"
        ? "Full refund requested. Check the refund status for completion."
        : result.outcome === "partially_converted_to_credit"
          ? "75% credit issued for 30 days; 25% forfeited."
          : result.outcome === "voided_unpaid"
            ? "Unpaid booking voided."
            : result.outcome.replaceAll("_", " ");
      toast({ title: `Cancellation processed · ${b.code}`, description: outcomeLabel });
      refresh();
    } catch (e) {
      toast({ title: "Could not process cancellation", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function submitOverride() {
    if (!overrideFor) return;
    setBusy(true);
    try {
      await api("/api/admin/bookings", {
        body: { bookingId: overrideFor.id, action: "override_refund", amount: parseInt(amount, 10) },
      });
      toast({ title: "Override refund executed", description: "Commission reversed proportionally where applicable." });
      setOverrideFor(null);
      setAmount("");
      refresh();
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function retryTicketEmail(b: AdminBooking) {
    setBusy(true);
    try {
      const result = await api<{ ok: boolean; ticketEmail: { status: string; lastErrorCode?: string | null } }>("/api/admin/bookings", {
        body: { bookingId: b.id, action: "retry_ticket_email" },
      });
      toast({
        title: result.ticketEmail.status === "sent" ? "Ticket email accepted" : "Ticket email needs attention",
        description:
          result.ticketEmail.status === "sent"
            ? "The email provider accepted the ticket. Check its delivery log if the passenger does not receive it."
            : `${result.ticketEmail.status.replaceAll("_", " ")}${result.ticketEmail.lastErrorCode ? ` · ${result.ticketEmail.lastErrorCode}` : ""}`,
        variant: result.ticketEmail.status === "sent" ? "default" : "destructive",
      });
      refresh();
    } catch (e) {
      toast({ title: "Ticket email not sent", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Bookings</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Every booking with its allocation and ledger state. Cancellations you trigger here are
          always fully refunded — the passenger is never at fault when the platform cancels.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search code / name / phone" className="w-64 pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s || "All statuses"}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        {(data?.bookings || []).map((b) => (
          <Card key={b.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{b.code}</span>
                    <BookingStatusBadge status={b.status} />
                    {b.isCharter && <Badge variant="outline" className="bg-accent text-accent-foreground">Charter</Badge>}
                    {b.cancelTier && <Badge variant="outline">{TIER_LABELS[b.cancelTier]}</Badge>}
                  </div>
                  <p className="mt-1 text-sm">
                    {b.passenger.name || b.passenger.phone} · {b.routeName || "—"} · {b.stageName}
                    {b.homePickup ? " (door)" : ""} · {b.isCharter ? "whole cab" : `${b.seats} seat(s)`}
                  </p>
                  {b.guest && (
                    <p className="text-xs text-muted-foreground">
                      Traveller: {b.guest.name}
                      {b.guest.phone ? ` · +${b.guest.phone.replace(/^(254)/, "")}` : ""}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Departure {fmtDateTime(b.departureAt)} · trip {b.tripStatus || "unallocated"}
                    {b.driver ? ` · ${b.driver.name} (${b.driver.plate})` : ""}
                  </p>
                  {b.cancellationRequestedAt && (
                    <p className="text-xs font-medium text-amber-800">
                      Passenger cancellation requested {fmtDateTime(b.cancellationRequestedAt)}
                    </p>
                  )}
                  {b.allocationNote && <p className="text-xs text-muted-foreground">{b.allocationNote}</p>}
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold">{ksh(b.fareAmount)}</p>
                  {b.creditApplied > 0 && <p className="text-xs text-emerald-700">credit −{ksh(b.creditApplied)}</p>}
                  {b.ledger ? (
                    <div className="mt-1 flex flex-col items-end gap-1">
                      <LedgerStatusBadge status={b.ledger.status} />
                      {b.ledger.receipt && <span className="font-mono text-[10px] text-muted-foreground">{b.ledger.receipt}</span>}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">no ledger entry</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {b.cancellationRequestedAt && !["cancelled", "completed", "no_show"].includes(b.status) && (
                  <Button size="sm" onClick={() => void processPassengerCancellation(b)} disabled={busy}>
                    <ClipboardCheck className="h-4 w-4" /> Process passenger request
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => platformCancel(b)} disabled={busy || ["cancelled", "completed", "no_show"].includes(b.status)}>
                  <Ban className="h-4 w-4" /> Platform cancel (full refund)
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOverrideFor(b);
                    setAmount(String(b.ledger?.cash || 0));
                  }}
                  disabled={!b.ledger || b.ledger.cash <= 0 || ["cancelled"].includes(b.status)}
                >
                  <Undo2 className="h-4 w-4" /> Override refund (dispute)
                </Button>
                {b.ticketEmail && (
                  <span className="self-center text-xs text-muted-foreground" role="status">
                    Ticket email: {b.ticketEmail.status.replaceAll("_", " ")}
                    {b.ticketEmail.sentAt ? ` · ${fmtDateTime(b.ticketEmail.sentAt)}` : ""}
                  </span>
                )}
                {["confirmed", "boarded", "completed"].includes(b.status) &&
                  b.ticketEmail?.status !== "sent" && b.ticketEmail?.status !== "uncertain" && (
                    <Button size="sm" variant="outline" onClick={() => retryTicketEmail(b)} disabled={busy}>
                      <Mail className="h-4 w-4" /> {b.ticketEmail ? "Retry ticket email" : "Send ticket email"}
                    </Button>
                  )}
                {b.ticketEmail?.status === "uncertain" && (
                  <span className="self-center text-xs text-amber-800">
                    Check Brevo’s delivery log before retrying to avoid a duplicate.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {data && data.bookings.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">No bookings match.</CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!overrideFor} onOpenChange={(v) => !v && setOverrideFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Override refund · {overrideFor?.code}</DialogTitle>
            <DialogDescription>
              Discretionary cash refund on a collected fare (disputes). The platform&apos;s
              commission is reversed proportionally — it never keeps a commission on a refunded
              fare. This action is audit-logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="refund-amount">Refund amount (max {ksh(overrideFor?.ledger?.cash || 0)})</Label>
              <Input id="refund-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </div>
            <Button className="w-full" onClick={submitOverride} disabled={busy || !parseInt(amount, 10)}>
              Execute refund
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
