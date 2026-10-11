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

  // Already signed in? straight to the console.
  useEffect(() => {
    api("/api/admin/overview").then(() => router.replace("/admin")).catch(() => {});
  }, [router]);

  async function requestOtp() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/auth", { body: { step: "request", email } });
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
      await api("/api/admin/auth", { body: { step: "verify", email, code, twofa } });
      router.replace("/admin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Access denied");
    } finally {
      setBusy(false);
    }
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
                  maxLength={4}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
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
                  type="password"
                  value={twofa}
                  onChange={(e) => setTwofa(e.target.value)}
                  placeholder="Enter admin access code"
                  className="h-11"
                  onKeyDown={(e) => e.key === "Enter" && verify()}
                />
                <p className="text-[10px] text-muted-foreground">
                  Admin access requires verified staff sign-in and a separate access code.
                </p>
              </motion.div>

              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button className="h-11 w-full" onClick={verify} disabled={busy || code.length !== 4 || !twofa}>
                Verify &amp; unlock console <KeyRound className="ml-1 h-4 w-4" />
              </Button>
              <button
                onClick={() => setStep("email")}
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
