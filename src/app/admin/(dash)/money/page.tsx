"use client";

import { useState } from "react";
import { useAdminData } from "@/components/admin/use-admin-data";
import { MoneyStatusBadge } from "@/components/status-badges";
import { StatCard } from "@/components/admin/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/client";
import { fmtDate, fmtDateTime, ksh, LEDGER_LABELS } from "@/lib/format";
import { AlertTriangle, Banknote, Coins, CreditCard, Send, TrendingUp, Wallet } from "lucide-react";

// ── Ledger tab ───────────────────────────────────────────────────────────────

interface LedgerEntryRow {
  id: string;
  bookingCode: string;
  passenger: string | null;
  phone: string;
  route: string | null;
  driver: string | null;
  totalAmount: number;
  cashAmount: number;
  creditApplied: number;
  homeSurchargeAmount: number;
  platformFeeAmount: number;
  mpesaReceipt: string | null;
  collectedAt: string | null;
  status: string;
  statusChangedAt: string;
}

function LedgerTab() {
  const [filter, setFilter] = useState("");
  const { data } = useAdminData<{
    totals: Record<string, { count: number; total: number; cash: number }>;
    entries: LedgerEntryRow[];
  }>(`/api/admin/ledger${filter ? `?status=${filter}` : ""}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilter("")}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${!filter ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        >
          All
        </button>
        {Object.keys(LEDGER_LABELS).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === s ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {LEDGER_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">Booking</th>
              <th className="p-3">Passenger</th>
              <th className="p-3">Route / driver</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3 text-right">Cash</th>
              <th className="p-3 text-right">Credit</th>
              <th className="p-3 text-right">Home surch.</th>
              <th className="p-3 text-right">Booking fee</th>
              <th className="p-3">M-Pesa</th>
              <th className="p-3">Bucket</th>
            </tr>
          </thead>
          <tbody>
            {(data?.entries || []).map((e) => (
              <tr key={e.id} className="border-t">
                <td className="p-3 font-mono text-xs font-medium">{e.bookingCode}</td>
                <td className="p-3">{e.passenger}<span className="block text-xs text-muted-foreground">{e.phone}</span></td>
                <td className="p-3 text-xs">
                  {e.route || "—"}
                  <span className="block text-muted-foreground">{e.driver || "unallocated"}</span>
                </td>
                <td className="p-3 text-right font-medium">{ksh(e.totalAmount)}</td>
                <td className="p-3 text-right">{ksh(e.cashAmount)}</td>
                <td className="p-3 text-right text-emerald-700">{e.creditApplied > 0 ? ksh(e.creditApplied) : "—"}</td>
                <td className="p-3 text-right text-teal-700">{e.homeSurchargeAmount > 0 ? ksh(e.homeSurchargeAmount) : "—"}</td>
                <td className="p-3 text-right">{e.platformFeeAmount > 0 ? ksh(e.platformFeeAmount) : "—"}</td>
                <td className="p-3 font-mono text-xs">{e.mpesaReceipt || "—"}</td>
                <td className="p-3">
                  <Badge variant="outline" className="whitespace-nowrap">{LEDGER_LABELS[e.status] || e.status}</Badge>
                </td>
              </tr>
            ))}
            {data && data.entries.length === 0 && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-muted-foreground">No ledger entries here.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Read-only by design: the admin inspects the ledger; the engine moves it. Home surcharge is
        passed to the driver in full. The flat booking fee is retained by Mi-Reli and is excluded
        from driver payout and charter commission.
      </p>
    </div>
  );
}

// ── Refunds tab ──────────────────────────────────────────────────────────────

interface RefundRow {
  id: string;
  code: string;
  passenger: string | null;
  amount: number;
  creditRestored: number;
  commissionReversed: number;
  driverClawback: number;
  reason: string;
  method: string;
  status: string;
  stuck: boolean;
  attemptState: string | null;
  result: string | null;
  failureReason: string | null;
  initiatedAt: string;
  completedAt: string | null;
}

function RefundsTab() {
  const { toast } = useToast();
  const { data, refresh } = useAdminData<{ refunds: RefundRow[] }>("/api/admin/refunds");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function retry(id: string) {
    setBusyId(id);
    try {
      const res = await api<{ ok: boolean; state: string; result: string }>("/api/admin/refunds", { body: { id } });
      toast({
        title: res.state === "completed" ? "Refund completed" : res.state === "failed" ? "Refund failed" : "Refund submitted",
        description: res.result,
        variant: res.state === "failed" ? "destructive" : "default",
      });
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  const reasonLabels: Record<string, string> = {
    cancelled_early: "Cancelled early",
    cancelled_late: "Cancelled late",
    no_show_partial: "No-show partial",
    admin_override: "Admin override (dispute)",
    platform_cancelled: "Platform cancelled",
  };

  return (
    <div className="space-y-3">
      {(data?.refunds || []).map((r) => (
        <Card key={r.id} className={r.stuck ? "border-amber-300" : r.status === "failed" ? "border-red-200" : ""}>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{r.code}</span>
                <MoneyStatusBadge status={r.status} />
                {r.stuck && (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                    <AlertTriangle className="h-3 w-3" /> stuck — flagged for review
                  </Badge>
                )}
              {r.status === "pending" && r.attemptState && (
                <p className="mt-1 text-xs text-amber-800">Provider outcome is unknown. Reconcile this attempt before sending again.</p>
              )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {reasonLabels[r.reason] || r.reason} · {r.method.toUpperCase()} · initiated {fmtDateTime(r.initiatedAt)}
                {r.completedAt ? ` · completed ${fmtDateTime(r.completedAt)}` : ""}
              </p>
              {(r.commissionReversed > 0 || r.driverClawback > 0) && (
                <p className="text-xs text-teal-800">
                  Commission reversed {ksh(r.commissionReversed)} · driver clawback {ksh(r.driverClawback)}
                </p>
              )}
              {r.failureReason && <p className="text-xs text-red-800">{r.failureReason}</p>}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="font-semibold">{ksh(r.amount)}</p>
                {r.creditRestored > 0 && <p className="text-xs text-violet-700">+{ksh(r.creditRestored)} credit restored</p>}
              </div>
              {(r.status === "failed" || (r.status === "pending" && !r.attemptState)) && (
                <Button size="sm" variant="outline" onClick={() => retry(r.id)} disabled={busyId === r.id}>
                  {r.status === "failed" ? "Retry refund" : "Submit refund"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      {data && data.refunds.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No refunds yet. Early and platform cancellations will appear here while the payment
            provider confirms the refund.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Payouts tab ──────────────────────────────────────────────────────────────

interface PayoutRow {
  id: string;
  driver: string;
  plate: string;
  mpesaNumber: string;
  route: string | null;
  gross: number;
  commission: number;
  homeSurcharge: number;
  platformFee: number;
  net: number;
  method: string;
  status: string;
  result: string | null;
  failureReason: string | null;
  batchId: string | null;
  initiatedAt: string;
  completedAt: string | null;
}

function PayoutsTab() {
  const { toast } = useToast();
  const { data, refresh } = useAdminData<{
    payoutMode: string;
    payoutDay: number;
    lastPayoutRunAt: string | null;
    batch: { due: boolean; mode: string; note: string };
    totals: { queued: number; paid: number; commission: number; platformFees: number; failed: number };
    payouts: PayoutRow[];
  }>("/api/admin/payouts");
  const [busy, setBusy] = useState(false);

  async function runBatch() {
    setBusy(true);
    try {
      const res = await api<{ drivers: number; completed: number; failed: number; processing:number; ambiguous:number; deferred:number }>("/api/admin/payouts", {
        body: { action: "run_batch" },
      });
      toast({
        title: "Payout batch executed",
        description: `${res.drivers} driver(s) · ${res.completed} confirmed · ${res.processing} processing · ${res.ambiguous} need reconciliation · ${res.failed} failed · ${res.deferred} deferred`,
        variant: res.failed > 0 ? "destructive" : "default",
      });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function retry(id: string) {
    setBusy(true);
    try {
      await api("/api/admin/payouts", { body: { action: "retry", id } });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Queued" value={ksh(data?.totals.queued || 0)} tone="warn" />
        <StatCard label="Paid out" value={ksh(data?.totals.paid || 0)} tone="good" />
        <StatCard label="Commission realised" value={ksh(data?.totals.commission || 0)} tone="info" />
        <StatCard label="Booking fees" value={ksh(data?.totals.platformFees || 0)} tone="info" />
        <StatCard label="Failed" value={ksh(data?.totals.failed || 0)} tone={(data?.totals.failed || 0) > 0 ? "bad" : "default"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">
            {data?.payoutMode === "instant_per_trip" ? "After-trip payout dispatch" : "Payout timing needs review"}
          </p>
          <p className="text-xs text-muted-foreground">
            Dispatch begins when a trip completes. Provider confirmation is still required. {data?.batch.note}
          </p>
        </div>
        <Button onClick={runBatch} disabled={busy || !data?.payouts.some((p) => p.status === "queued")}>
          <Send className="h-4 w-4" /> Process queued payouts
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">Driver</th>
              <th className="p-3">Trip route</th>
              <th className="p-3 text-right">Gross</th>
              <th className="p-3 text-right">Booking fee</th>
              <th className="p-3 text-right">Commission</th>
              <th className="p-3 text-right">Home surch.</th>
              <th className="p-3 text-right">Net payout</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.payouts || []).map((p) => (
              <tr key={p.id} className={p.status === "failed" ? "border-t bg-red-50/50" : "border-t"}>
                <td className="p-3">
                  {p.driver} <span className="block text-xs text-muted-foreground">{p.mpesaNumber}</span>
                </td>
                <td className="p-3 text-xs">{p.route || "—"}</td>
                <td className="p-3 text-right">{ksh(p.gross)}</td>
                <td className="p-3 text-right">{p.platformFee > 0 ? ksh(p.platformFee) : "—"}</td>
                <td className="p-3 text-right">{ksh(p.commission)}</td>
                <td className="p-3 text-right">{p.homeSurcharge > 0 ? ksh(p.homeSurcharge) : "—"}</td>
                <td className="p-3 text-right font-semibold">{ksh(p.net)}</td>
                <td className="p-3">
                  <MoneyStatusBadge status={p.status} />
                  {p.failureReason && <span className="mt-1 block max-w-48 text-xs text-red-800">{p.failureReason}</span>}
                </td>
                <td className="p-3">
                  {p.status === "failed" && (
                    <Button size="sm" variant="outline" onClick={() => retry(p.id)} disabled={busy}>
                      Retry
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {data && data.payouts.length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  Payout records are born when a trip completes — none yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        A failed payout is never silently retried — retrying against a bad number is a compliance
        risk. Fix the driver&apos;s M-Pesa number in Drivers, then retry here.
      </p>
    </div>
  );
}

// ── Credits tab ──────────────────────────────────────────────────────────────

interface CreditRow {
  id: string;
  passenger: string | null;
  phone: string;
  amount: number;
  initialAmount: number;
  status: string;
  note: string | null;
  issuedAt: string;
  expiresAt: string;
}

function CreditsTab() {
  const { data } = useAdminData<{
    liability: number;
    counts: { active: number; redeemed: number; expired: number };
    credits: CreditRow[];
  }>("/api/admin/credits");

  const styles: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-900 border-emerald-200",
    redeemed: "bg-teal-100 text-teal-900 border-teal-200",
    expired: "bg-stone-100 text-stone-600 border-stone-200",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Outstanding liability" value={ksh(data?.liability || 0)} sub="active credits, never cashed out" tone="info" />
        <StatCard label="Active" value={String(data?.counts.active || 0)} tone="good" />
        <StatCard label="Redeemed" value={String(data?.counts.redeemed || 0)} />
        <StatCard label="Expired" value={String(data?.counts.expired || 0)} tone="warn" />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">Passenger</th>
              <th className="p-3">Note</th>
              <th className="p-3 text-right">Remaining</th>
              <th className="p-3 text-right">Issued</th>
              <th className="p-3">Expires</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.credits || []).map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-3">
                  {c.passenger}
                  <span className="block text-xs text-muted-foreground">{c.phone}</span>
                </td>
                <td className="p-3 text-xs">{c.note || "Travel credit"}</td>
                <td className="p-3 text-right font-semibold">
                  {ksh(c.amount)}
                  {c.amount < c.initialAmount && (
                    <span className="block text-xs font-normal text-muted-foreground">of {ksh(c.initialAmount)}</span>
                  )}
                </td>
                <td className="p-3 text-right text-xs">{fmtDate(c.issuedAt)}</td>
                <td className="p-3 text-xs">{fmtDate(c.expiresAt)}</td>
                <td className="p-3">
                  <Badge variant="outline" className={styles[c.status] || ""}>{c.status}</Badge>
                </td>
              </tr>
            ))}
            {data && data.credits.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No credits issued yet — late cancellations create them automatically.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page shell ───────────────────────────────────────────────────────────────

export default function AdminMoney() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Money & ledger</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Collected into the Mi-Reli M-Pesa shortcode first — never straight to a driver. Every
          shilling sits in exactly one bucket before it moves again.
        </p>
      </div>
      <Tabs defaultValue="ledger">
        <TabsList className="flex w-full flex-wrap gap-1 sm:w-fit">
          <TabsTrigger value="ledger" className="gap-1.5"><Coins className="h-4 w-4" /> Ledger</TabsTrigger>
          <TabsTrigger value="refunds" className="gap-1.5"><Banknote className="h-4 w-4" /> Refunds</TabsTrigger>
          <TabsTrigger value="payouts" className="gap-1.5"><TrendingUp className="h-4 w-4" /> Payouts</TabsTrigger>
          <TabsTrigger value="credits" className="gap-1.5"><Wallet className="h-4 w-4" /> Credits</TabsTrigger>
        </TabsList>
        <TabsContent value="ledger" className="mt-4"><LedgerTab /></TabsContent>
        <TabsContent value="refunds" className="mt-4"><RefundsTab /></TabsContent>
        <TabsContent value="payouts" className="mt-4"><PayoutsTab /></TabsContent>
        <TabsContent value="credits" className="mt-4"><CreditsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
