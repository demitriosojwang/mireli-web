"use client";

import Link from "next/link";
import { useAdminData } from "@/components/admin/use-admin-data";
import { StatCard } from "@/components/admin/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ksh, fmtDateTime, LEDGER_LABELS } from "@/lib/format";
import { AlertTriangle, BadgeAlert, Radio, Wallet } from "lucide-react";

interface Overview {
  config: {
    commissionRate: number;
    payoutMode: string;
    payoutDay: number;
    creditValidityDays: number;
    lastReconciliationAt: string | null;
    lastPayoutRunAt: string | null;
  };
  buckets: Record<string, { count: number; total: number }>;
  today: { collected: number; bookings: number; commission: number; paidOut: number };
  payoutsQueued: number;
  alerts: {
    stuckRefunds: { id: string; code: string; amount: number }[];
    failedPayouts: { id: string; driver: string; amount: number; reason: string | null }[];
    failedRefunds: { id: string; code: string; amount: number; reason: string | null }[];
    ambiguousPayments: number;
    unallocatedBookings: number;
    creditLiability: number;
    activeCredits: number;
  };
  batch: { due: boolean; mode: string; note: string };
  recentAudit: { id: string; actorName: string; actorRole: string; action: string; entity: string; entityId: string; createdAt: string }[];
}

export default function AdminOverview() {
  const { data } = useAdminData<Overview>("/api/admin/overview");
  if (!data) return <Loading />;

  const alertCount =
    data.alerts.stuckRefunds.length +
    data.alerts.failedPayouts.length +
    data.alerts.failedRefunds.length +
    (data.alerts.ambiguousPayments > 0 ? 1 : 0) +
    (data.alerts.unallocatedBookings > 0 ? 1 : 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Your oversight surface: totals and exceptions. The engine moves the money — you watch the
          buckets and step in when something flags.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Collected today" value={ksh(data.today.collected)} sub={`${data.today.bookings} bookings placed`} tone="good" />
        <StatCard label="Commission today" value={ksh(data.today.commission)} sub={`charter rate ${(data.config.commissionRate * 100).toFixed(1)}% (NTSA cap 18%)`} tone="info" />
        <StatCard label="Paid out today" value={ksh(data.today.paidOut)} sub={`${data.config.payoutMode} mode`} />
        <StatCard
          label="Queued payouts"
          value={ksh(data.payoutsQueued)}
          sub={data.batch.note}
          tone={data.payoutsQueued > 0 ? "warn" : "default"}
        />
      </div>

      {/* Ledger buckets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-primary" /> Where every shilling sits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(data.buckets).map(([bucket, v]) => (
              <div key={bucket} className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">{LEDGER_LABELS[bucket] || bucket}</p>
                <p className="mt-0.5 text-lg font-bold">{ksh(v.total)}</p>
                <p className="text-xs text-muted-foreground">{v.count} entr{v.count === 1 ? "y" : "ies"}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className={`h-4 w-4 ${alertCount > 0 ? "text-amber-600" : "text-emerald-600"}`} />
            Exceptions needing a look
            {alertCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{alertCount}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {alertCount === 0 && (
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
              All clear — no stuck refunds, failed transfers, ambiguous payments or unallocated
              bookings.
            </p>
          )}
          {data.alerts.stuckRefunds.length > 0 && (
            <AlertRow
              title={`${data.alerts.stuckRefunds.length} refund(s) stuck in pending`}
              detail={data.alerts.stuckRefunds.map((r) => `${r.code} (${ksh(r.amount)})`).join(", ")}
              href="/admin/money"
              cta="Open refunds"
            />
          )}
          {data.alerts.failedPayouts.length > 0 && (
            <AlertRow
              title={`${data.alerts.failedPayouts.length} failed payout(s)`}
              detail={data.alerts.failedPayouts.map((p) => `${p.driver}: ${ksh(p.amount)} — ${p.reason || "failed"}`).join(" | ")}
              href="/admin/money"
              cta="Review payouts"
            />
          )}
          {data.alerts.failedRefunds.length > 0 && (
            <AlertRow
              title={`${data.alerts.failedRefunds.length} failed refund(s)`}
              detail={data.alerts.failedRefunds.map((r) => `${r.code}: ${ksh(r.amount)}`).join(", ")}
              href="/admin/money"
              cta="Retry refunds"
            />
          )}
          {data.alerts.ambiguousPayments > 0 && (
            <AlertRow
              title={`${data.alerts.ambiguousPayments} M-Pesa prompt(s) unconfirmed`}
              detail="A webhook may have been missed — run the reconciliation sweep to resolve via Transaction Status."
              href="/admin/reconciliation"
              cta="Open reconciliation"
            />
          )}
          {data.alerts.unallocatedBookings > 0 && (
            <AlertRow
              title={`${data.alerts.unallocatedBookings} booking(s) without capacity`}
              detail="Auto-allocation could not place these — add a driver or free up a trip."
              href="/admin/bookings"
              cta="See bookings"
            />
          )}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">Credit liability</p>
              <p className="text-muted-foreground">
                {ksh(data.alerts.creditLiability)} across {data.alerts.activeCredits} active
                credit(s) · validity {data.config.creditValidityDays} days
              </p>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">Last reconciliation</p>
              <p className="text-muted-foreground">
                {data.config.lastReconciliationAt ? fmtDateTime(data.config.lastReconciliationAt) : "Never — run a sweep"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {data.recentAudit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 last:border-0">
                <span>
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · {a.actorName} ({a.actorRole})</span>
                </span>
                <span className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
              </li>
            ))}
            {data.recentAudit.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function AlertRow({ title, detail, href, cta }: { title: string; detail: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium text-amber-950">
          <BadgeAlert className="h-4 w-4" /> {title}
        </p>
        <p className="mt-0.5 text-xs text-amber-900/80">{detail}</p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link href={href}>{cta}</Link>
      </Button>
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
