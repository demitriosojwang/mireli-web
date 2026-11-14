"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LogoTile } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client";
import { ArrowRight, KeyRound, Lock, Mail, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [twofa, setTwofa] = useState("");
  const [step, setStep] = useState<"email" | "verify">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Verified staff sign-in: the request step issues a challengeId that the verify
  // step must echo back, and a first sign-in additionally needs the one-time staff
  // setup code and authenticator enrollment (the server returns the setup key).
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [needsSetup, setNeedsSetup] = useState(false);
  const [enrollSecret, setEnrollSecret] = useState<string | null>(null);

  // Already signed in? straight to the console.
  useEffect(() => {
    api("/api/admin/overview").then(() => router.replace("/admin")).catch(() => {});
  }, [router]);

  async function requestOtp() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ challengeId?: string }>("/api/admin/auth", { body: { step: "request", email } });
      setChallengeId(res?.challengeId ?? null);
      setCode("");
      setTwofa("");
      setSetupCode("");
      setNeedsSetup(false);
      setEnrollSecret(null);
      setStep("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Access denied");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ enrollmentRequired?: boolean; totpSecret?: string; landingPage?: string }>(
        "/api/admin/auth",
        {
          body: {
            step: "verify",
            challengeId,
            code,
            ...(twofa ? { twofa } : {}),
            ...(setupCode.trim() ? { setupCode: setupCode.trim() } : {}),
          },
        }
      );
      // First sign-in: no session yet — the server hands back the authenticator
      // setup key. The same emailed code + challenge stay valid for the retry.
      if (res?.enrollmentRequired && res.totpSecret) {
        setEnrollSecret(res.totpSecret);
        return;
      }
      router.replace(res?.landingPage ?? "/admin");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Access denied";
      if (message.toLowerCase().includes("setup code")) setNeedsSetup(true);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function resetToEmail() {
    setStep("email");
    setChallengeId(null);
    setCode("");
    setTwofa("");
    setSetupCode("");
    setNeedsSetup(false);
    setEnrollSecret(null);
    setError(null);
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <LogoTile size="lg" />
        </motion.div>
        <h1 className="mb-1 mt-4 text-2xl font-bold tracking-tight">Mi-Reli</h1>
        <p className="mb-8 text-sm text-muted-foreground">Admin Console · oversight only</p>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm space-y-4">
          {step === "email" ? (
            <>
              <div className="mb-2 text-center">
                <h2 className="text-lg font-semibold">Restricted access</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sign in with your admin email — non-admin emails are rejected here.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1 text-xs">
                  <Mail className="h-3 w-3" /> Work email
                </Label>
                <Input
                  id="admin-email"
                  type="email"
                  placeholder="you@mireli.co.ke"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && email && requestOtp()}
                  className="h-11"
                  autoFocus
                  disabled={busy}
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button className="h-11 w-full" onClick={requestOtp} disabled={busy || !email}>
                Continue <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <div className="mb-2 text-center">
                <h2 className="text-lg font-semibold">Verify</h2>
                <p className="mt-1 text-xs text-muted-foreground">Enter the code sent to {email}</p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Verification code</Label>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  className={cn("h-11 text-center text-lg tracking-[0.5em]", error && "border-destructive")}
                  autoFocus
                  disabled={busy}
                />
              </div>

              {/* Admin 2FA — second factor, original style box */}
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3"
              >
                <Label className="flex items-center gap-1 text-xs text-primary">
                  <Lock className="h-3 w-3" /> Admin verification (2FA)
                </Label>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={twofa}
                  onChange={(e) => setTwofa(e.target.value.replace(/\D/g, ""))}
                  placeholder="Authenticator code"
                  className="h-11"
                  onKeyDown={(e) => e.key === "Enter" && verify()}
                />
                <p className="text-[10px] text-muted-foreground">
                  The 6-digit code from your authenticator app. First sign-in? Leave this
                  blank and verify — you will set up your authenticator in the next step.
                </p>
              </motion.div>

              {needsSetup && !enrollSecret && (
                <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                  <Label className="flex items-center gap-1 text-xs text-amber-700">
                    <Lock className="h-3 w-3" /> Staff setup code (one-time)
                  </Label>
                  <Input
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value)}
                    placeholder="Setup code from your administrator"
                    className="h-11 font-mono text-xs"
                    onKeyDown={(e) => e.key === "Enter" && verify()}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Your administrator issues this code separately (it is never emailed and
                    stays valid 30 minutes). Paste it, then verify again with the same
                    emailed code.
                  </p>
                </div>
              )}

              {enrollSecret && (
                <div className="space-y-2 rounded-xl border border-emerald-600/30 bg-emerald-500/5 p-3">
                  <Label className="flex items-center gap-1 text-xs text-emerald-700">
                    <ShieldCheck className="h-3 w-3" /> Set up your authenticator
                  </Label>
                  <ol className="list-decimal space-y-1 pl-4 text-[11px] text-muted-foreground">
                    <li>Open your authenticator app and choose “Enter a setup key”.</li>
                    <li>Account: {email} · Issuer: Mi-Reli · Key:</li>
                  </ol>
                  <code className="block select-all break-all rounded-md bg-background px-2 py-2 text-center font-mono text-xs tracking-widest">
                    {enrollSecret}
                  </code>
                  <p className="text-[10px] text-muted-foreground">
                    Then type the 6-digit code the app now shows into the 2FA box above and
                    verify again — same emailed code, within its 5 minutes.
                  </p>
                </div>
              )}

              {error && (
                <div className="space-y-1">
                  <p className="text-xs text-destructive">{error}</p>
                  {!needsSetup && !enrollSecret && (
                    <p className="text-[10px] text-muted-foreground">
                      Use the newest emailed code — it expires 5 minutes after sending and
                      allows only a few attempts. If it keeps failing, go back and request
                      a fresh one.
                    </p>
                  )}
                </div>
              )}
              <Button
                className="h-11 w-full"
                onClick={verify}
                disabled={busy || code.length !== 6 || (enrollSecret != null && twofa.length !== 6)}
              >
                Verify &amp; unlock console <KeyRound className="ml-1 h-4 w-4" />
              </Button>
              <button
                onClick={resetToEmail}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                ← Use a different email
              </button>
            </>
          )}
        </motion.div>

        {/* Trust indicators */}
        <div className="mt-8 w-full max-w-sm space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>Admin access is granted by identity — never by a button on the passenger site.</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>Every sign-in attempt and admin action is audit-logged.</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span>The engine runs the money — admins touch config, disputes and spot-checks only.</span>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 text-center text-[10px] text-muted-foreground">Mi-Reli · Mombasa Terminus · Kenya Coast</div>
    </div>
  );
}
