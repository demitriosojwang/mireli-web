"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

type Step = "welcome" | "identifier" | "otp" | "profile";
type Mode = "signin" | "signup";

const primaryButton = "h-13 w-full rounded-full bg-[#69dfb4] text-base font-semibold text-[#102635] hover:bg-[#87eac6] focus-visible:ring-[#b3f6df]";
const field = "h-12 rounded-xl border-[#4e6b7e] bg-[#1e394b] text-base text-white placeholder:text-[#a9bfcc] focus-visible:ring-[#69dfb4]";
const secondaryAction = "inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-[#b7ebd9] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#69dfb4]";

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [mode, setMode] = useState<Mode>("signin");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [needsPhone, setNeedsPhone] = useState(false);
  const [resendUntil, setResendUntil] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedStep = useRef<Step>("welcome");

  const welcome = step === "welcome";
  const isEmail = identifier.includes("@");
  const title = step === "identifier"
    ? mode === "signin" ? "Sign in" : "Create an account"
    : step === "otp" ? `Check your ${isEmail ? "email" : "phone"}` : "Finish setting up your account";

  useEffect(() => {
    if (step === focusedStep.current) return;
    focusedStep.current = step;
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    if (!resendUntil) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
      setResendSeconds(remaining);
      if (!remaining) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [resendUntil]);

  function chooseMode(nextMode: Mode) {
    setMode(nextMode);
    setStep("identifier");
    setError("");
  }

  function goBack() {
    setError("");
    setStep(step === "identifier" ? "welcome" : "identifier");
  }

  async function sendCode() {
    const contact = identifier.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    const phoneOk = /^\+?[0-9][0-9\s-]{7,17}$/.test(contact);
    if (!emailOk && !phoneOk) {
      setError("Enter a valid email address or mobile number.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result = await api<{ challengeId: string; cooldownSeconds: number; demoCode?: string; simulation?: boolean }>("/api/auth", {
        body: { step: "request", identifier: contact },
      });
      setIdentifier(contact);
      setChallengeId(result.challengeId);
      setDemoCode(result.simulation ? result.demoCode ?? "" : "");
      setCode("");
      setName("");
      setPhone("");
      setResendSeconds(result.cooldownSeconds);
      setResendUntil(Date.now() + result.cooldownSeconds * 1000);
      setStep("otp");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The code could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (code.length !== 6 || !challengeId) {
      setError("Enter your six-digit code.");
      return;
    }
    if (step === "profile" && name.trim().length < 2) {
      setError("Enter your name.");
      return;
    }
    if (step === "profile" && needsPhone && phone.replace(/\D/g, "").length < 9) {
      setError("Enter your mobile number.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result = await api<{ ok?: boolean; needsName?: boolean; needsPhone?: boolean }>("/api/auth", {
        body: { step: "verify", challengeId, code, name, phone },
      });
      if (result.needsName) {
        setNeedsPhone(Boolean(result.needsPhone));
        setStep("profile");
        return;
      }
      if (!result.ok) throw new Error("Sign-in could not be completed. Try again.");
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed. Check your code and try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step === "identifier") void sendCode();
    else void verifyCode();
  }

  return (
    <main className="relative isolate flex min-h-dvh flex-1 flex-col bg-[#102635] text-white md:flex-row">
      <div className={cn(
        "relative shrink-0 overflow-hidden bg-[#244456] md:flex-1",
        welcome ? "h-[52svh] min-h-64 md:h-auto" : "h-[30svh] min-h-44 md:h-auto",
      )}>
        <Image
          key={welcome ? "welcome" : "sign-in"}
          src={welcome ? "/passenger-welcome.webp" : "/passenger-sign-in.webp"}
          alt=""
          fill
          sizes="(min-width: 768px) 60vw, 100vw"
          loading="eager"
          className={cn("object-cover", welcome ? "object-[50%_39%] md:object-center" : "object-[50%_62%]")}
        />
        <div aria-hidden className="absolute inset-0 bg-linear-to-b from-[#102635]/55 via-transparent to-[#102635]/20" />
        <Link
          href="/"
          className="absolute left-5 top-[calc(env(safe-area-inset-top)+1rem)] inline-flex min-h-11 items-center gap-2 rounded-full bg-[#102635] px-4 text-sm font-medium text-white hover:bg-[#244456] focus-visible:outline-2 focus-visible:outline-[#69dfb4]"
        >
          <ArrowLeft className="size-4" aria-hidden /> Book a ride
        </Link>
      </div>

      <div className="relative -mt-6 flex flex-1 flex-col justify-center rounded-t-[2rem] bg-[#102635] px-6 pt-8 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] md:mt-0 md:w-[min(46%,36rem)] md:flex-none md:rounded-none md:px-10 md:py-12">
        <div className={cn("mx-auto w-full max-w-sm", welcome && "text-center")}>
          {welcome ? (
            <>
              <h1 ref={heading} tabIndex={-1} className="text-4xl font-bold tracking-tight outline-none sm:text-5xl">
                <span className="text-[#69dfb4]">Mireli</span> Passenger
              </h1>
              <p className="mx-auto mt-3 max-w-[29ch] text-base leading-relaxed text-[#c1d1dc]">
                Book and track your SGR and airport rides on the Kenya coast.
              </p>
              <div className="mt-7 grid gap-3">
                <Button type="button" className={primaryButton} onClick={() => chooseMode("signin")}>Sign in</Button>
                <Button type="button" className="h-13 w-full rounded-full bg-[#203d50] text-base font-semibold text-white hover:bg-[#2c4d61] focus-visible:ring-[#69dfb4]" onClick={() => chooseMode("signup")}>Create an account</Button>
              </div>
            </>
          ) : (
            <>
              <button type="button" onClick={goBack} disabled={busy} className={secondaryAction}>
                <ArrowLeft className="size-4" aria-hidden />
                {step === "identifier" ? "Back" : step === "otp" ? "Change contact" : "Use a different contact"}
              </button>
              <h1 ref={heading} tabIndex={-1} className="mt-2 text-3xl font-bold tracking-tight outline-none">{title}</h1>
              <p className="mt-2 break-words text-sm leading-relaxed text-[#c1d1dc]">
                {step === "identifier" && "Enter your email or mobile number to get a verification code."}
                {step === "otp" && <>Enter the six-digit code we sent to <strong className="font-semibold text-white">{identifier}</strong>.</>}
                {step === "profile" && (needsPhone ? "Add your name and mobile number for ride updates." : "Add your name for your ride bookings.")}
              </p>

              <form key={step} className="mt-6 space-y-4" onSubmit={submit} aria-busy={busy}>
                {step === "identifier" && (
                  <div className="space-y-2">
                    <label htmlFor="login-identifier" className="block text-sm font-medium">Email or mobile number</label>
                    <Input id="login-identifier" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="you@example.com or 07XX XXX XXX" className={field} value={identifier} onChange={(event) => { setIdentifier(event.target.value); setError(""); }} disabled={busy} />
                  </div>
                )}
                {step === "otp" && (
                  <div className="space-y-2">
                    <label htmlFor="login-code" className="block text-sm font-medium">Verification code</label>
                    <Input id="login-code" inputMode="numeric" autoComplete="one-time-code" maxLength={12} placeholder="000000" className={cn(field, "font-mono text-lg tracking-[0.35em]")} value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} disabled={busy} />
                    {demoCode && <p className="text-sm text-amber-200">Local demo code <strong>{demoCode}</strong></p>}
                  </div>
                )}
                {step === "profile" && (
                  <>
                    <div className="space-y-2">
                      <label htmlFor="login-name" className="block text-sm font-medium">Your name</label>
                      <Input id="login-name" autoComplete="name" maxLength={80} className={field} value={name} onChange={(event) => { setName(event.target.value); setError(""); }} disabled={busy} />
                    </div>
                    {needsPhone && (
                      <div className="space-y-2">
                        <label htmlFor="login-phone" className="block text-sm font-medium">Mobile number</label>
                        <Input id="login-phone" type="tel" autoComplete="tel" placeholder="07XX XXX XXX" className={field} value={phone} onChange={(event) => { setPhone(event.target.value); setError(""); }} disabled={busy} />
                      </div>
                    )}
                  </>
                )}
                {error && <p className="text-sm font-medium text-[#ffb9b9]" role="alert">{error}</p>}
                <Button type="submit" className={primaryButton} disabled={busy || (step === "otp" && code.length !== 6)}>
                  {busy && <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />}
                  {step === "identifier" ? "Send code" : step === "otp" ? "Verify code" : "Finish setup"}
                  {!busy && <ArrowRight className="size-4" aria-hidden />}
                </Button>
              </form>

              {step === "otp" && (
                <button type="button" disabled={busy || resendSeconds > 0} onClick={sendCode} className={cn(secondaryAction, "mt-2 disabled:text-[#a9bfcc]")}>
                  {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
