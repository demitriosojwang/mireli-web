"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { Mail, Phone, ArrowRight, ArrowLeft, ShieldCheck, CheckCircle2, Loader2 } from "lucide-react";
import { LogoTile } from "@/components/site-chrome";
import { cn } from "@/lib/utils";

/**
 * Mi-Reli passenger sign-in / sign-up.
 *
 * A single identifier field routes both returning passengers and first-time
 * signups through the same OTP machine:
 *   identifier -> OTP -> (first-time: name + mobile capture) -> done.
 * Each step is its own screen with its own heading, back navigation and
 * validation, so the customer always knows where they are and what is next.
 */

type Step = "identifier" | "otp" | "profile";

const TRUST_POINTS = [
  "New passengers can book one seat before creating an account.",
  "Fares are held by the platform — never paid to a driver directly.",
  "Verification codes expire after 5 minutes. Sign-in sessions expire after 7 days.",
];

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>("identifier");

  const isEmail = identifier.includes("@");
  const codeValue = useMemo(() => code.join(""), [code]);
  const otpRefs = useRef<Array<HTMLInputElement | null>>(Array(6).fill(null));

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  // Paste a full code straight into the first box.
  function setCodeDigit(index: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      setCode((prev) => prev.map((c, i) => (i === index ? "" : c)));
      return;
    }
    setCode((prev) => {
      const next = [...prev];
      for (let i = 0; i < digits.length && index + i < 6; i += 1) next[index + i] = digits[i];
      const fillTo = Math.min(index + digits.length, 5);
      otpRefs.current[fillTo]?.focus();
      return next;
    });
    setError(null);
  }

  async function handleSendOtp() {
    const trimmed = identifier.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    const phoneOk = /^\+?[0-9][0-9\s-]{7,17}$/.test(trimmed);
    if (!emailOk && !phoneOk) {
      setError("Enter a valid email address or phone number, e.g. +254 7XX XXX XXX");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ challengeId: string; cooldownSeconds: number; demoCode?: string; simulation?: boolean }>("/api/auth", {
        body: { step: "request", identifier: trimmed },
      });
      setChallengeId(result.challengeId);
      setDemoCode(result.simulation ? result.demoCode || null : null);
      setCode(Array(6).fill(""));
      setResendSeconds(result.cooldownSeconds);
      setStep("otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp() {
    if (codeValue.length !== 6 || !challengeId) {
      setError("Enter the 6-digit code from your " + (isEmail ? "email" : "messages") + ".");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ok?: boolean; needsName?: boolean; needsPhone?: boolean }>("/api/auth", {
        body: { step: "verify", challengeId, code: codeValue, name, phone: signupPhone },
      });
      if (res.needsName) {
        setStep("profile");
        setError(null);
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed. Check the code and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleProfileSubmit() {
    if (name.trim().length < 2) {
      setError("Enter the name we should greet you with.");
      return;
    }
    const digits = signupPhone.replace(/\D/g, "");
    if (digits.length < 9) {
      setError("Enter a mobile number so we can reach you about rides and M-Pesa.");
      return;
    }
    await handleVerifyOtp();
  }

  function reset() {
    setIdentifier("");
    setCode(Array(6).fill(""));
    setName("");
    setSignupPhone("");
    setChallengeId(null);
    setDemoCode(null);
    setResendSeconds(0);
    setStep("identifier");
    setError(null);
  }

  const stepIndex = step === "identifier" ? 0 : step === "otp" ? 1 : 2;

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-background">
      <div className="flex flex-1 flex-col">
        {/* Brand header */}
        <div className="flex flex-col items-center px-6 pt-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: DURATION.brand, ease: EASE_OUT }}
          >
            <LogoTile size="lg" />
          </motion.div>
          <h1 className="mb-0.5 mt-4 text-2xl font-bold tracking-tight">Mi-Reli</h1>
          <p className="text-sm text-muted-foreground">Ride · Connect · Journey</p>
        </div>

        {/* Step progress */}
        <div className="mx-auto mt-6 flex w-full max-w-sm items-center gap-1.5 px-6" aria-hidden>
          {["Sign in", "Verify", "Details"].map((label, index) => (
            <div key={label} className="flex flex-1 flex-col gap-1">
              <div
                className={cn(
                  "h-1 rounded-full transition-colors",
                  index < stepIndex ? "bg-primary" : index === stepIndex ? "bg-primary/60" : "bg-muted",
                )}
              />
              <span className={cn("text-[9px] font-medium uppercase tracking-wide", index <= stepIndex ? "text-primary" : "text-muted-foreground/60")}>
                {label}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-1 flex-col items-center px-6 py-6">
          <div className="w-full max-w-sm">
            <AnimatePresence mode="wait">
              {step === "identifier" && (
                <motion.div
                  key="identifier"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                  className="space-y-4"
                >
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Welcome</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Log in or create an account with your email or phone number.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="login-identifier" className="flex items-center gap-1.5 text-xs font-medium">
                      {isEmail ? <Mail className="h-3.5 w-3.5 text-primary" /> : <Phone className="h-3.5 w-3.5 text-primary" />}
                      Email or phone
                    </label>
                    <Input
                      id="login-identifier"
                      type="text"
                      value={identifier}
                      onChange={(e) => {
                        setIdentifier(e.target.value);
                        setError(null);
                      }}
                      placeholder="you@example.com or +254 7XX XXX XXX"
                      className="h-12 text-base"
                      autoComplete="username"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && !busy && handleSendOtp()}
                      disabled={busy}
                      aria-invalid={Boolean(error)}
                    />
                  </div>

                  {error && <p className="text-xs font-medium text-destructive" role="alert">{error}</p>}

                  <Button className="h-12 w-full text-base" onClick={handleSendOtp} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="ml-1 h-4 w-4" /></>}
                  </Button>

                  <p className="text-center text-[11px] text-muted-foreground">
                    New here? This creates your account — no separate signup form.
                  </p>
                </motion.div>
              )}

              {step === "otp" && (
                <motion.div
                  key="otp"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                  className="space-y-4"
                >
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Check your {isEmail ? "email" : "phone"}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      We sent a 6-digit code to <span className="font-medium text-foreground">{identifier}</span>.
                    </p>
                  </div>

                  <div className="flex justify-between gap-1.5" role="group" aria-label="6-digit verification code">
                    {code.map((digit, index) => (
                      <input
                        key={index}
                        ref={(el) => { otpRefs.current[index] = el; }}
                        type="text"
                        inputMode="numeric"
                        autoComplete={index === 0 ? "one-time-code" : "off"}
                        maxLength={6}
                        value={digit}
                        onChange={(e) => setCodeDigit(index, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" && !code[index] && index > 0) otpRefs.current[index - 1]?.focus();
                          if (e.key === "Enter" && codeValue.length === 6 && !busy) handleVerifyOtp();
                        }}
                        onFocus={(e) => e.currentTarget.select()}
                        className={cn(
                          "h-13 w-full min-w-0 rounded-xl border bg-card text-center text-xl font-semibold tabular-nums transition-colors outline-none",
                          "focus:border-primary focus:ring-2 focus:ring-primary/20",
                          digit && "border-primary/50",
                          error && "border-destructive",
                        )}
                        disabled={busy}
                        aria-label={`Digit ${index + 1}`}
                      />
                    ))}
                  </div>

                  {demoCode && (
                    <p className="rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-900">
                      Local demo code: <span className="font-bold tabular-nums">{demoCode}</span>
                    </p>
                  )}

                  {error && <p className="text-xs font-medium text-destructive" role="alert">{error}</p>}

                  <Button className="h-12 w-full text-base" onClick={handleVerifyOtp} disabled={busy || codeValue.length !== 6}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Verify &amp; continue <ArrowRight className="ml-1 h-4 w-4" /></>}
                  </Button>

                  <div className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => { setStep("identifier"); setError(null); }}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeft className="h-3 w-3" /> Change {isEmail ? "email" : "number"}
                    </button>
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={busy || resendSeconds > 0}
                      className="font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline [font-variant-numeric:tabular-nums]"
                    >
                      {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
                    </button>
                  </div>
                </motion.div>
              )}

              {step === "profile" && (
                <motion.div
                  key="profile"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                  className="space-y-4"
                >
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Almost done</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      First time here — tell us who you are and we&apos;ll set up your account.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="login-name" className="flex items-center gap-1.5 text-xs font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Your name
                    </label>
                    <Input
                      id="login-name"
                      type="text"
                      value={name}
                      onChange={(e) => { setName(e.target.value); setError(null); }}
                      placeholder="e.g. Amina Wanjiru"
                      className="h-12 text-base"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && !busy && handleProfileSubmit()}
                      disabled={busy}
                      aria-invalid={Boolean(error)}
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="login-phone" className="flex items-center gap-1.5 text-xs font-medium">
                      <Phone className="h-3.5 w-3.5 text-primary" /> Mobile number
                    </label>
                    <Input
                      id="login-phone"
                      type="tel"
                      inputMode="tel"
                      value={signupPhone}
                      onChange={(e) => { setSignupPhone(e.target.value); setError(null); }}
                      placeholder="07XX XXX XXX"
                      className="h-12 text-base"
                      onKeyDown={(e) => e.key === "Enter" && !busy && handleProfileSubmit()}
                      disabled={busy}
                      aria-invalid={Boolean(error)}
                    />
                    <p className="text-[11px] text-muted-foreground">For M-Pesa receipts and ride updates. Never shared with drivers before pickup.</p>
                  </div>

                  {error && <p className="text-xs font-medium text-destructive" role="alert">{error}</p>}

                  <Button className="h-12 w-full text-base" onClick={handleProfileSubmit} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create my account <ArrowRight className="ml-1 h-4 w-4" /></>}
                  </Button>

                  <button
                    type="button"
                    onClick={reset}
                    className="mx-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-3 w-3" /> Start over
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Trust indicators */}
      <div className="mx-auto w-full max-w-sm space-y-2 px-6 pb-2">
        {TRUST_POINTS.map((point) => (
          <div key={point} className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>{point}</span>
          </div>
        ))}
      </div>

      <div className="px-6 py-4 text-center text-[10px] text-muted-foreground">Mi-Reli · Mombasa Terminus · Kenya Coast</div>
    </div>
  );
}
