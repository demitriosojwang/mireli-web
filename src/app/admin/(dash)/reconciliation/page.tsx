"use client";

import { useState } from "react";
import { useAdminData } from "@/components/admin/use-admin-data";
import { StatCard } from "@/components/admin/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/client";
import { fmtDateTime, ksh } from "@/lib/format";
import {
  AlertTriangle,
  FlaskConical,
  Radio,
  RefreshCw,
  ShieldQuestion,
  Smartphone,
} from "lucide-react";

interface ReconData {
  simulation: boolean;
  lastReconciliationAt: string | null;
  counts: { ambiguous: number; stuckRefunds: number; pendingRefunds: number; failedPayouts: number; failedRefunds: number; failedTx: number };
  daily: { date: string; commission: number; paidOut: number }[];
  ambiguous: { id: string; code: string; passenger: string | null; phone: string; amount: number; status: string; ageMinutes: number }[];
  failedTransactions: { id: string; code: string; passenger: string | null; amount: number; result: string | null; desc: string | null }[];
  recentConfirmed: { id: string; code: string; passenger: string | null; amount: number; receipt: string | null; confirmedAt: string | null }[];
}

export default function AdminReconciliation() {
  const { toast } = useToast();
  const { data, refresh } = useAdminData<ReconData>("/api/admin/reconciliation");
  const [busy, setBusy] = useState(false);

  async function doAction(action: string, successTitle: string) {
    setBusy(true);
    try {
      const res = await api<{ message?: string; summary?: Record<string, number> }>("/api/admin/reconciliation", {
        body: { action },
      });
      toast({
        title: successTitle,
        description: res.message || (res.summary ? JSON.stringify(res.summary) : undefined),
      });
      refresh();
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const maxPaid = Math.max(1, ...(data?.daily || []).map((d) => d.commission + d.paidOut));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Reconciliation</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Daraja callbacks can be missed — the nightly sweep queries the Transaction Status API for
          anything ambiguous, so a lost webhook never silently loses a passenger&apos;s paid seat or a
          driver&apos;s payout. Last sweep: {data?.lastReconciliationAt ? fmtDateTime(data.lastReconciliationAt) : "never"}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Ambiguous payments" value={String(data?.counts.ambiguous || 0)} tone={(data?.counts.ambiguous || 0) > 0 ? "warn" : "good"} sub="awaiting status query" />
        <StatCard label="Pending refunds" value={String(data?.counts.pendingRefunds || 0)} sub={`${data?.counts.stuckRefunds || 0} flagged stuck`} tone={(data?.counts.stuckRefunds || 0) > 0 ? "bad" : "default"} />
        <StatCard label="Failed payouts" value={String(data?.counts.failedPayouts || 0)} tone={(data?.counts.failedPayouts || 0) > 0 ? "bad" : "good"} />
        <StatCard label="Failed refunds" value={String(data?.counts.failedRefunds || 0)} tone={(data?.counts.failedRefunds || 0) > 0 ? "bad" : "good"} />
        <StatCard label="Failed STK txns" value={String(data?.counts.failedTx || 0)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => doAction("sweep", "Sweep complete")} disabled={busy}>
          <RefreshCw className="h-4 w-4" /> Run reconciliation sweep now
        </Button>
      </div>

      {/* Daily bookkeeping */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily bookkeeping — commission vs payouts (last 7 days)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(data?.daily || []).map((d) => (
              <div key={d.date} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{d.date.slice(5)}</span>
                <div className="flex h-5 flex-1 gap-px overflow-hidden rounded">
                  <div
                    className="bg-emerald-500/80"
                    style={{ width: `${((d.commission) / maxPaid) * 100}%` }}
                    title={`Commission ${ksh(d.commission)}`}
                  />
                  <div
                    className="bg-teal-400/70"
                    style={{ width: `${((d.paidOut) / maxPaid) * 100}%` }}
                    title={`Paid out ${ksh(d.paidOut)}`}
                  />
                </div>
                <span className="w-40 shrink-0 text-right text-xs text-muted-foreground">
                  comm {ksh(d.commission)} · paid {ksh(d.paidOut)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Ambiguous */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldQuestion className="h-4 w-4 text-amber-600" /> Ambiguous payments (missed-callback candidates)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.ambiguous || []).length === 0 && (
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">Nothing ambiguous — every prompt has a terminal state.</p>
          )}
          {(data?.ambiguous || []).map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <div>
                <p className="font-medium">{t.code} · {t.passenger}</p>
                <p className="text-xs text-amber-900/80">
                  {ksh(t.amount)} to {t.phone} · status {t.status} · {t.ageMinutes} min old
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => doAction("sweep", "Sweep complete")} disabled={busy}>
                Resolve via status query
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Failed transactions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-red-600" /> Failed Daraja transactions (manual retry surface)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.failedTransactions || []).length === 0 && (
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">No failed collections.</p>
          )}
          {(data?.failedTransactions || []).map((t) => (
            <div key={t.id} className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
              <p className="font-medium">{t.code} · {t.passenger} · {ksh(t.amount)}</p>
              <p className="text-xs text-red-900/80">
                result {t.result} — {t.desc}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent confirmations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-primary" /> Recently confirmed collections
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-1.5 pr-3">Booking</th>
                  <th className="py-1.5 pr-3">Passenger</th>
                  <th className="py-1.5 pr-3 text-right">Amount</th>
                  <th className="py-1.5 pr-3">Receipt</th>
                  <th className="py-1.5">Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recentConfirmed || []).map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-xs">{t.code}</td>
                    <td className="py-1.5 pr-3">{t.passenger}</td>
                    <td className="py-1.5 pr-3 text-right">{ksh(t.amount)}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{t.receipt}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{fmtDateTime(t.confirmedAt)}</td>
                  </tr>
                ))}
                {(data?.recentConfirmed || []).length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No collections yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Simulation tools */}
      {data?.simulation && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4 text-muted-foreground" /> Local demo simulation tools
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => doAction("simulate_missed_callback", "Missed callback simulated")} disabled={busy}>
              <Radio className="h-4 w-4" /> Simulate missed callback
            </Button>
            <Button variant="outline" size="sm" onClick={() => doAction("inject_refund_failure", "Failure armed")} disabled={busy}>
              <Badge variant="outline" className="mr-1">next</Badge> Refund fails
            </Button>
            <Button variant="outline" size="sm" onClick={() => doAction("inject_payout_failure", "Failure armed")} disabled={busy}>
              <Badge variant="outline" className="mr-1">next</Badge> Payout fails
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
