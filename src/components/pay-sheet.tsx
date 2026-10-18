"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ksh, fmtPhone } from "@/lib/format";
import { api } from "@/lib/client";
import {
  Check,
  Copy,
  Landmark,
  Loader2,
  MessageSquareText,
  Phone,
  ReceiptText,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

interface DriverContact {
  name: string;
  plate?: string | null;
  phone?: string | null;
}

interface PaySheetProps {
  open: boolean;
  onClose: () => void;
  booking: {
    id: string;
    code: string;
    cashDue: number;
    routeName?: string | null;
    departureAt?: string | null;
    stageName?: string | null;
    passengerName?: string | null; // guest checkout details
    passengerPhone?: string | null;
    driver?: DriverContact | null; // phone present only when already settled
  };
  onPaid: () => void;
}

type PayMethod = "stk" | "paybill";
type PayStep = "phone" | "stk" | "paybill" | "verifying" | "done";

export function PaySheet({ open, onClose, booking, onPaid }: PaySheetProps) {
  return open ? <PaySheetContent key={booking.id} open={open} onClose={onClose} booking={booking} onPaid={onPaid} /> : null;
}

function PaySheetContent({ open, onClose, booking, onPaid }: PaySheetProps) {
  const [method, setMethod] = useState<PayMethod>("stk");
  const [paybill, setPaybill] = useState<string | null>(null);
  const [paymentOptionsStatus, setPaymentOptionsStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [paymentOptionsRetry, setPaymentOptionsRetry] = useState(0);
  const [step, setStep] = useState<PayStep>("phone");
  const [phone, setPhone] = useState(booking.passengerPhone || "");
  const [paymentPending, setPaymentPending] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ receipt: string; amount: number } | null>(null);
  const [driver, setDriver] = useState<DriverContact | null>(booking.driver ?? null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    // Do not present an STK form when the server cannot confirm that a real
    // payment method is configured. Paybill is optional; STK is required.
    api<{ paybill: string | null; methods: string[] }>("/api/pay/options", {
      signal: controller.signal,
      timeoutMs: 8_000,
    })
      .then((res) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(res.methods) || !res.methods.includes("mpesa_stk")) {
          setPaymentOptionsStatus("unavailable");
          return;
        }
        setPaybill(res.methods.includes("mpesa_paybill") && typeof res.paybill === "string" ? res.paybill : null);
        setPaymentOptionsStatus("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPaybill(null);
        setPaymentOptionsStatus("unavailable");
      });

    return () => controller.abort();
  }, [open, booking.id, paymentOptionsRetry]);

  function copy(label: string, value: string) {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  async function sendPrompt() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ paymentPending?: boolean; message?: string; phone?: string }>(`/api/bookings/${booking.id}`, {
        body: { action: "pay", phone },
      });
      setPaymentPending(Boolean(result.paymentPending));
      setPaymentMessage(result.message || null);
      if (result.phone) setPhone(result.phone);
      setStep("stk");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send prompt");
    } finally {
      setBusy(false);
    }
  }

  /** Verify works for both options: STK polls the push result; Paybill checks
   *  for the landing payment (demo mode confirms, live waits for the webhook).
   *  The verify response unlocks the driver's contact for the receipt. */
  async function verify() {
    setStep("verifying");
    try {
      const res = await api<{ receipt: string; amount: number; driver?: DriverContact | null }>(
        `/api/bookings/${booking.id}`,
        { body: { action: "verify" } },
      );
      setReceipt({ receipt: res.receipt, amount: res.amount });
      if (res.driver) setDriver(res.driver);
      setStep("done");
      onPaid();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
      setStep(method === "stk" ? "stk" : "paybill");
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        {step !== "verifying" && step !== "done" && !paymentPending && paybill && (
          <div className="px-4 pt-1">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/60 p-1">
              <button
                onClick={() => {
                  setMethod("stk");
                  setStep("phone");
                  setError(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                  method === "stk" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" /> STK push
              </button>
              <button
                onClick={() => {
                  setMethod("paybill");
                  setStep("paybill");
                  setError(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                  method === "paybill" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                <Landmark className="h-3.5 w-3.5" /> Pay bill
              </button>
            </div>
          </div>
        )}

        {/* ── STK: enter number ─────────────────────────────────────────────── */}
        {step === "phone" && paymentOptionsStatus === "loading" && (
          <>
            <SheetHeader>
              <SheetTitle>Checking payment options</SheetTitle>
              <SheetDescription>We&apos;re checking that M-Pesa is ready before you pay.</SheetDescription>
            </SheetHeader>
            <div role="status" className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking M-Pesa…
            </div>
          </>
        )}

        {step === "phone" && paymentOptionsStatus === "unavailable" && (
          <>
            <SheetHeader>
              <SheetTitle>Payment is temporarily unavailable</SheetTitle>
              <SheetDescription>
                Your booking is not confirmed and no payment has been requested. You can try again later from My rides.
              </SheetDescription>
            </SheetHeader>
            <div role="alert" className="space-y-3 px-4 pb-5">
              <p className="text-sm text-muted-foreground">
                Keep the booking reference handy. If M-Pesa becomes available, you can reopen this booking and continue payment.
              </p>
              <Button className="w-full" variant="outline" onClick={() => {
                setError(null);
                setPaybill(null);
                setPaymentOptionsStatus("loading");
                setPaymentOptionsRetry((attempt) => attempt + 1);
              }}>
                Try again
              </Button>
              <Button className="w-full" onClick={onClose}>Pay later from My rides</Button>
            </div>
          </>
        )}

        {step === "phone" && paymentOptionsStatus === "ready" && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-primary" /> Pay with M-Pesa
              </SheetTitle>
              <SheetDescription id="pay-desc">
                {booking.code} · {ksh(booking.cashDue)} via Lipa na M-Pesa (STK push). Your money is
                held by the platform until your ride is delivered.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-4">
              <div className="space-y-2">
                <Label htmlFor="mpesa-phone">M-Pesa number {booking.passengerName ? `· ${booking.passengerName}` : ""}</Label>
                <Input
                  id="mpesa-phone"
                  placeholder="07XX XXX XXX or 2547XX XXX XXX"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="h-11 w-full" onClick={sendPrompt} disabled={busy || phone.length < 9 || paymentOptionsStatus !== "ready"}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Send M-Pesa prompt · ${ksh(booking.cashDue)}`}
              </Button>
            </div>
          </>
        )}

        {/* ── STK: waiting for the PIN ──────────────────────────────────────── */}
        {step === "stk" && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-primary" /> {paymentPending ? "Checking payment" : "Check your phone"}
              </SheetTitle>
              <SheetDescription id="pay-desc">
                {paymentPending
                  ? paymentMessage || "Your M-Pesa request may still be processing. Do not send another payment request."
                  : `An M-Pesa prompt has been sent to ${phone}. Enter your PIN on the prompt, then confirm below.`}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col items-center gap-4 px-4 pb-6 pt-2">
              <span className="relative grid h-20 w-20 place-items-center rounded-full bg-accent/15">
                <MessageSquareText className="h-9 w-9 text-accent" />
                <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-accent/20" />
              </span>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="h-11 w-full" onClick={verify}>
                {paymentPending ? "Check payment status" : "I've paid — verify"}
              </Button>
              {!paymentPending && (
                <Button variant="ghost" size="sm" onClick={() => setStep("phone")}>
                  Use a different number
                </Button>
              )}
            </div>
          </>
        )}

        {/* ── Paybill: manual instructions ──────────────────────────────────── */}
        {step === "paybill" && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-primary" /> Pay via M-Pesa Pay Bill
              </SheetTitle>
              <SheetDescription id="pay-desc">
                {booking.code} · {ksh(booking.cashDue)} goes straight into the Mi-Reli paybill — the
                platform holds it until your ride is delivered.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-4">
              <div className="rounded-xl border bg-muted/40 p-4">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pay Bill number</p>
                      <p className="font-mono text-base font-semibold">{paybill}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => copy("paybill", paybill || "")}>
                      {copied === "paybill" ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied === "paybill" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Account number</p>
                      <p className="font-mono text-base font-semibold">{booking.code}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => copy("account", booking.code)}>
                      {copied === "account" ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied === "account" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount</p>
                    <p className="text-base font-semibold">{ksh(booking.cashDue)}</p>
                  </div>
                </div>
              </div>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                <li>Open M-Pesa → Lipa na M-Pesa → Pay Bill.</li>
                <li>Enter the Pay Bill number, then the account number above.</li>
                <li>Enter the exact amount and your PIN.</li>
              </ol>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="h-11 w-full" onClick={verify}>
                I&apos;ve paid — verify
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">
                Confirmation usually lands within a minute of paying.
              </p>
            </div>
          </>
        )}

        {step === "verifying" && (
          <div className="flex flex-col items-center gap-4 px-4 py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Verifying payment…</p>
          </div>
        )}

        {step === "done" && receipt && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-primary">
                <ShieldCheck className="h-5 w-5" /> Payment received
              </SheetTitle>
              <SheetDescription id="pay-desc">
                Your seat is confirmed. The money sits in the Mi-Reli ledger until your ride is
                delivered — never with the driver directly.
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  <ReceiptText className="h-4 w-4 text-primary" /> Receipt {booking.code}
                </p>
                <Separator className="my-3" />
                <div className="grid grid-cols-2 gap-2">
                  {booking.passengerName && (
                    <>
                      <span className="text-muted-foreground">Passenger</span>
                      <span className="text-right font-medium">{booking.passengerName}</span>
                    </>
                  )}
                  {driver && (
                    <>
                      <span className="text-muted-foreground">Your driver</span>
                      <span className="text-right font-medium">
                        {driver.name}
                        {driver.phone && (
                          <a
                            href={`tel:${driver.phone}`}
                            className="block font-mono text-xs text-primary underline-offset-2 hover:underline"
                          >
                            {fmtPhone(driver.phone)}
                          </a>
                        )}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground">M-Pesa code</span>
                  <span className="text-right font-mono font-medium">{receipt.receipt}</span>
                  <span className="text-muted-foreground">Amount paid</span>
                  <span className="text-right font-medium">{ksh(receipt.amount)}</span>
                  {booking.routeName && (
                    <>
                      <span className="text-muted-foreground">Route</span>
                      <span className="text-right font-medium">{booking.routeName}</span>
                    </>
                  )}
                  {booking.stageName && (
                    <>
                      <span className="text-muted-foreground">Point</span>
                      <span className="text-right font-medium">{booking.stageName}</span>
                    </>
                  )}
                </div>
              </div>
              <Button className="mt-4 w-full" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
