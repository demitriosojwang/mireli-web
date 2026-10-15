"use client";

import { useState } from "react";
import { useAdminData } from "@/components/admin/use-admin-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import { Save } from "lucide-react";

interface ConfigData {
  config: {
    commissionRate: number;
    bookingFeeAmount: number;
    fullRefundCutoffMinutes: number;
    seatFillThresholdPercent: number;
    creditValidityDays: number;
    payoutMode: string;
    payoutDay: number;
    stuckRefundHours: number;
    stuckPayoutHours: number;
    sweepPendingMinutes: number;
    tripHorizonDays: number;
    bookingWindowMinutes: number;
    terminusArrivalBufferMinutes: number;
    trainMeetBufferMinutes: number;
    adminEmails: string[];
    admin2faCode: string;
  };
  ntsaCap: number;
  lastPayoutRunAt: string | null;
  lastReconciliationAt: string | null;
}

export default function AdminConfig() {
  const { toast } = useToast();
  const { data, refresh } = useAdminData<ConfigData>("/api/admin/config");
  const [draft, setForm] = useState<ConfigData["config"] | null>(null);
  const form = draft ?? data?.config;
  const [busy, setBusy] = useState(false);

  if (!form) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  async function save() {
    setBusy(true);
    try {
      await api("/api/admin/config", { method: "PUT", body: form });
      toast({ title: "Config saved", description: "Changes apply to every new booking, cancellation and payout batch immediately." });
      await refresh();
      setForm(null);
    } catch (e) {
      toast({ title: "Rejected", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const num = (v: string) => (v === "" ? 0 : parseInt(v, 10) || 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Config</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          These levers drive every money decision — refund tiers, credit validity, commission and
          payout timing. Policy is config-driven, never hardcoded per transaction.
        </p>
      </div>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Commission & refunds</CardTitle>
            <CardDescription>
              The commission rate must stay under the NTSA {((data?.ntsaCap ?? 0) * 100).toFixed(0)}% cap —
              the API rejects anything higher.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="c-rate">Commission rate (0–0.18)</Label>
              <Input
                id="c-rate"
                type="number"
                step="0.01"
                min="0"
                max="0.18"
                value={form.commissionRate}
                onChange={(e) => setForm({ ...form, commissionRate: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">
                Applied only to private charter fare. Door surcharges and the booking fee are excluded.
                Current: {(form.commissionRate * 100).toFixed(1)}%
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-booking-fee">Flat booking fee (KSh per booking)</Label>
              <Input
                id="c-booking-fee"
                type="number"
                step="1"
                min="0"
                max="10000"
                value={form.bookingFeeAmount}
                onChange={(e) => setForm({ ...form, bookingFeeAmount: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">
                Charged once on every shared or private booking. It is included in the total shown before payment.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-cutoff">Full-refund cutoff (min before departure)</Label>
                <Input id="c-cutoff" inputMode="numeric" value={form.fullRefundCutoffMinutes} onChange={(e) => setForm({ ...form, fullRefundCutoffMinutes: num(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-fill">Seat-fill lock threshold (%)</Label>
                <Input id="c-fill" inputMode="numeric" value={form.seatFillThresholdPercent} onChange={(e) => setForm({ ...form, seatFillThresholdPercent: num(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-credit">Credit validity (days)</Label>
              <Input
                id="c-credit"
                inputMode="numeric"
                value={form.creditValidityDays}
                onChange={(e) => setForm({ ...form, creditValidityDays: num(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">
                Late-cancellation credits stay redeemable this long (currently {form.creditValidityDays} days).
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payouts</CardTitle>
            <CardDescription>
              Driver payout dispatch starts after the trip is completed. Only approved payout
              destinations can receive money; provider confirmation is still required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Payout timing</Label>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">After each completed trip</div>
              <p className="text-xs text-muted-foreground">Last payout activity: {data?.lastPayoutRunAt ? fmtDateTime(data.lastPayoutRunAt) : "none yet"}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-stuck-r">Stuck-refund alert (hours)</Label>
                <Input id="c-stuck-r" inputMode="numeric" value={form.stuckRefundHours} onChange={(e) => setForm({ ...form, stuckRefundHours: num(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-stuck-p">Stuck-payout alert (hours)</Label>
                <Input id="c-stuck-p" inputMode="numeric" value={form.stuckPayoutHours} onChange={(e) => setForm({ ...form, stuckPayoutHours: num(e.target.value) })} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operations</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-sweep">Sweep threshold (min)</Label>
              <Input id="c-sweep" inputMode="numeric" value={form.sweepPendingMinutes} onChange={(e) => setForm({ ...form, sweepPendingMinutes: num(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-horizon">Trip horizon (days)</Label>
              <Input id="c-horizon" inputMode="numeric" value={form.tripHorizonDays} onChange={(e) => setForm({ ...form, tripHorizonDays: num(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-window">Booking window (min before departure)</Label>
              <Input id="c-window" inputMode="numeric" value={form.bookingWindowMinutes} onChange={(e) => setForm({ ...form, bookingWindowMinutes: num(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-arr-buffer">Terminus arrival buffer (min before train)</Label>
              <Input
                id="c-arr-buffer"
                inputMode="numeric"
                value={form.terminusArrivalBufferMinutes}
                onChange={(e) => setForm({ ...form, terminusArrivalBufferMinutes: num(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">TO_TERMINUS cabs reach MTM this early before the train departs.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-meet-buffer">Train meet buffer (min after arrival)</Label>
              <Input
                id="c-meet-buffer"
                inputMode="numeric"
                value={form.trainMeetBufferMinutes}
                onChange={(e) => setForm({ ...form, trainMeetBufferMinutes: num(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">Return cabs leave MTM this long after the train arrives.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-2fa">Admin access code (2nd factor)</Label>
              <Input id="c-2fa" value={form.admin2faCode} onChange={(e) => setForm({ ...form, admin2faCode: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Admin identities</CardTitle>
            <CardDescription>
              Emails recognised as admin at the ops console login. Admin access is granted by
              identity, never by a signup flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {form.adminEmails.map((email, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={email}
                  onChange={(e) => {
                    const next = [...form.adminEmails];
                    next[i] = e.target.value;
                    setForm({ ...form, adminEmails: next });
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setForm({ ...form, adminEmails: form.adminEmails.filter((_, j) => j !== i) })}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForm({ ...form, adminEmails: [...form.adminEmails, ""] })}
            >
              Add admin email
            </Button>
          </CardContent>
        </Card>
      </div>

      <Button onClick={save} disabled={busy} size="lg">
        <Save className="h-4 w-4" /> Save config
      </Button>
    </div>
  );
}
