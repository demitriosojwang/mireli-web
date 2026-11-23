"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LogOut, User, Wallet, CarFront } from "lucide-react";
import { api, useMe, type Me } from "@/lib/client";
import { cn } from "@/lib/utils";

/** Initials avatar for the signed-in passenger. */
function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "M";
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

/**
 * Signed-in profile chip in the header. Opens the account sheet, which holds
 * My rides and Credits — keeping the main nav to Book / Airports / Account.
 */
export function ProfileChip({
  me,
  onRefresh,
  showTrigger = true,
  open: controlledOpen,
  onOpenChange,
}: {
  me: Me;
  onRefresh: () => void;
  /** When false, only the sheet renders (the nav hosts its own trigger). */
  showTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (v: boolean) => {
    setUncontrolledOpen(v);
    onOpenChange?.(v);
  };
  const [busy, setBusy] = useState(false);
  const passenger = me.passenger;
  const name = passenger?.name || me.session?.name || "My account";
  const email = passenger?.email || me.session?.identifier || "";

  async function signOut() {
    setBusy(true);
    try {
      await api("/api/auth", { body: { step: "logout" } });
      setOpen(false);
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            "flex min-h-9 items-center gap-1.5 rounded-full border bg-card py-1 pl-1 pr-2.5 text-left transition-colors hover:border-primary/40",
            open && "border-primary/50",
          )}
          aria-label="Your account"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {initials(name)}
          </span>
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <span className="max-w-[120px] truncate text-[11px] font-semibold text-foreground">{name}</span>
            <span className="max-w-[120px] truncate text-[9px] text-muted-foreground">{email}</span>
          </span>
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-3 text-xl">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {initials(name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate">{name}</span>
                <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{email}</span>
              </span>
            </SheetTitle>
            <SheetDescription>Your Mi-Reli account, rides and credits in one place.</SheetDescription>
          </SheetHeader>

          <div className="space-y-2 px-4 pb-6">
            {me.creditBalance != null && (
              <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Wallet className="h-4 w-4 text-primary" /> Credit balance
                </span>
                <span className="text-sm font-bold tabular-nums text-primary">KSh {me.creditBalance.toLocaleString()}</span>
              </div>
            )}

            <Link
              href="/bookings"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center justify-between rounded-xl border bg-card px-3 py-2.5 transition-colors hover:border-primary/40"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <CarFront className="h-4 w-4 text-primary" /> My rides
              </span>
              <span className="text-xs text-muted-foreground">Bookings &amp; history</span>
            </Link>

            <Link
              href="/credits"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center justify-between rounded-xl border bg-card px-3 py-2.5 transition-colors hover:border-primary/40"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Wallet className="h-4 w-4 text-primary" /> Credits
              </span>
              <span className="text-xs text-muted-foreground">Balance &amp; history</span>
            </Link>

            <Button variant="outline" className="mt-2 w-full" onClick={signOut} disabled={busy}>
              <LogOut className="mr-1 h-4 w-4" /> {busy ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Header sign-in link for guests (kept for parity with the old header). */
export function SignInLink() {
  return (
    <Link
      href="/login"
      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      Sign in
    </Link>
  );
}

export { initials };
