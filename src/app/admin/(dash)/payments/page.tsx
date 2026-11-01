"use client";

import { useState } from "react";
import { useAdminData } from "@/components/admin/use-admin-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  KeyRound,
  Loader2,
  PlugZap,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";

interface PaymentsData {
  status: {
    mode: "mock" | "live";
    environment: string;
    source: "environment" | "database" | "none";
    paybill: string | null;
    callbacks: { base: string; stkResult: string; stkTimeout: string; c2bConfirmation: string; b2cResult: string };
    hasCallbackBase: boolean;
    liveRefundsEnabled: boolean;
    livePayoutsEnabled: boolean;
  };
  saved: {
    environment: string;
    consumerKey: string;
    hasConsumerSecret: boolean;
    shortcode: string;
    hasPasskey: boolean;
    callbackBaseUrl: string;
    b2cShortcode: string;
    initiatorName: string;
    hasInitiatorPassword: boolean;
    hasSecurityCredential: boolean;
    cert: string;
  };
  lastTest: { at: string; ok: boolean; message: string } | null;
}

const emptyForm = {
  environment: "sandbox",
  consumerKey: "",
  consumerSecret: "",
  shortcode: "",
  passkey: "",
  callbackBaseUrl: "",
  b2cShortcode: "",
  initiatorName: "",
  initiatorPassword: "",
  securityCredential: "",
  cert: "",
};

export default function AdminPayments() {
  const { toast } = useToast();
  const { data, refresh } = useAdminData<PaymentsData>("/api/admin/payments");
  const [draft, setForm] = useState<typeof emptyForm | null>(null);
  const form = draft ?? {
    ...emptyForm,
    environment: data?.saved.environment || "sandbox",
    callbackBaseUrl: data?.saved.callbackBaseUrl || "",
    shortcode: data?.saved.shortcode || "",
    b2cShortcode: data?.saved.b2cShortcode || "",
    initiatorName: data?.saved.initiatorName || "",
  };
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (!data) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  const { status, saved, lastTest } = data;
  const live = status.mode === "live";

  async function save() {
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/admin/payments", { method: "PUT", body: form });
      toast({ title: "Payments updated", description: res.message });
      setTestResult(null);
      await refresh();
      setForm(null);
    } catch (e) {
      toast({ title: "Rejected", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await api<{ ok: boolean; message: string }>("/api/admin/payments", {
        body: { action: "test_connection" },
      });
      setTestResult(res);
      refresh();
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function clearAll() {
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/admin/payments", {
        method: "DELETE",
        body: { action: "clear_all" },
      });
      toast({ title: "Credentials cleared", description: res.message });
      await refresh();
      setForm(null);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof emptyForm) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const hint = (savedValue: string | boolean) =>
    typeof savedValue === "string"
      ? savedValue
        ? `Saved · ${savedValue} — leave blank to keep`
        : "Not set yet"
      : savedValue
        ? "Saved — leave blank to keep"
        : "Not set yet";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Payments · M-Pesa Daraja</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Fare collection, refunds and driver payouts all run through Daraja. Paste the API
          credentials here when your Safaricom account is ready — no code changes needed.
        </p>
      </div>

      {/* ── Status ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <PlugZap className="h-4 w-4 text-primary" /> Gateway status
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                live ? "bg-primary text-primary-foreground" : "bg-accent/15 text-accent"
              }`}
            >
              {live ? `Live · ${status.environment}` : "Demo simulation"}
            </span>
          </CardTitle>
          <CardDescription>
            {status.source === "environment"
              ? "Credentials come from environment variables — values saved below are overridden."
              : status.source === "database"
                ? "Credentials are the ones saved on this page."
                : "No credentials yet — every STK prompt auto-confirms, no real money moves."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border bg-muted/30 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Paybill (shortcode)</p>
              <p className="font-mono text-sm font-semibold">{status.paybill || "—"}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Passenger options</p>
              <p className="text-sm font-semibold">{status.paybill ? "STK push + Pay bill" : "STK push"}</p>
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Callback base {status.hasCallbackBase ? "" : "· not set"}
            </p>
            <p className="truncate font-mono text-[11px]">{status.callbacks.base || "—"}</p>
            {status.hasCallbackBase && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Safaricom will POST payment results to /api/pay/mpesa/callback · /timeout · /c2b. Refund and payout results use private per-attempt callback URLs.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-2.5">
            <p>Live refunds · <strong>{status.liveRefundsEnabled ? "enabled" : "disabled"}</strong></p>
            <p>Live driver payouts · <strong>{status.livePayoutsEnabled ? "enabled" : "disabled"}</strong></p>
          </div>
          {lastTest && (
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2.5">
              {lastTest.ok ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              ) : (
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <div>
                <p className="font-medium">
                  Last test · {fmtDateTime(lastTest.at)} · {lastTest.ok ? "passed" : "failed"}
                </p>
                <p className="text-[11px] text-muted-foreground">{lastTest.message}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Test connection ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test connection</CardTitle>
          <CardDescription>
            Calls Daraja&apos;s OAuth endpoint with the current credentials. Save first if you just
            edited anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={test} disabled={testing} className="w-full">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Test Daraja connection
          </Button>
          {testResult && (
            <p className={`text-xs leading-relaxed ${testResult.ok ? "text-primary" : "text-destructive"}`}>
              {testResult.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Credentials ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" /> Daraja credentials
          </CardTitle>
          <CardDescription>
            From your app on developer.safaricom.co.ke. Blank secret fields keep the saved value.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Environment</Label>
            <Select value={form.environment} onValueChange={(v) => setForm({ ...form, environment: v })}>
              <SelectTrigger aria-label="Environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox (test)</SelectItem>
                <SelectItem value="production">Production (Go Live)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-key">Consumer key</Label>
            <Input id="p-key" value={form.consumerKey} onChange={set("consumerKey")} placeholder={hint(saved.consumerKey)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-secret">Consumer secret</Label>
            <Input id="p-secret" type="password" value={form.consumerSecret} onChange={set("consumerSecret")} placeholder={hint(saved.hasConsumerSecret)} autoComplete="new-password" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-code">Shortcode (Paybill)</Label>
              <Input id="p-code" inputMode="numeric" value={form.shortcode} onChange={set("shortcode")} placeholder={hint(saved.shortcode) || "e.g. 4123844"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-passkey">Passkey (Lipa na M-Pesa)</Label>
              <Input id="p-passkey" type="password" value={form.passkey} onChange={set("passkey")} placeholder={hint(saved.hasPasskey)} autoComplete="new-password" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-callback">Callback base URL</Label>
            <Input id="p-callback" value={form.callbackBaseUrl} onChange={set("callbackBaseUrl")} placeholder="https://mireli.co.ke" />
            <p className="text-xs text-muted-foreground">
              Public https address of this site — Daraja POSTs payment results here.
            </p>
          </div>

          <Separator />

          <p className="text-xs font-semibold text-muted-foreground">
            B2C / Reversal initiator — needed for driver payouts and cash refunds
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-init">Initiator name</Label>
              <Input id="p-init" value={form.initiatorName} onChange={set("initiatorName")} placeholder={hint(saved.initiatorName)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-b2c">B2C shortcode</Label>
              <Input id="p-b2c" inputMode="numeric" value={form.b2cShortcode} onChange={set("b2cShortcode")} placeholder={hint(saved.b2cShortcode) || "same as Paybill"} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-init-pass">Initiator password</Label>
            <Input id="p-init-pass" type="password" value={form.initiatorPassword} onChange={set("initiatorPassword")} placeholder={hint(saved.hasInitiatorPassword)} autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-cred">…or pre-encrypted security credential</Label>
            <Input id="p-cred" type="password" value={form.securityCredential} onChange={set("securityCredential")} placeholder={hint(saved.hasSecurityCredential)} autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-cert">Safaricom public certificate (PEM)</Label>
            <Textarea id="p-cert" rows={3} value={form.cert} onChange={set("cert")} placeholder={saved.cert ? `Saved · ${saved.cert} — leave blank to keep` : "-----BEGIN CERTIFICATE-----"} className="font-mono text-[11px]" />
            <p className="text-xs text-muted-foreground">
              Encrypts the initiator password at call time. Skip if you pasted a security credential.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={save} disabled={busy} className="flex-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save & apply
            </Button>
            <Button variant="outline" className="text-destructive" onClick={clearAll} disabled={busy}>
              <Trash2 className="h-4 w-4" /> Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Onboarding checklist ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ExternalLink className="h-4 w-4 text-primary" /> Getting live — what Safaricom gives you
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>
              Create an app on <span className="font-medium text-foreground">developer.safaricom.co.ke</span> — it
              issues the Consumer Key + Secret.
            </li>
            <li>
              Lipa na M-Pesa (STK) test credentials give you the <span className="font-medium text-foreground">Passkey</span> and
              sandbox shortcode. Paste all four and test.
            </li>
            <li>
              For Go Live: production shortcode, passkey, and an API operator (initiator) approved for
              B2C + Reversal, plus the public certificate for encryption.
            </li>
            <li>
              Register this site&apos;s callback base URL so payment results reach the ledger automatically
              — the nightly sweep recovers any that slip through.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
