"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Anchor, Info, Plane, PlaneTakeoff, User, Wallet } from "lucide-react";
import { useMe } from "@/lib/client";
import { cn } from "@/lib/utils";

/** Rounded brand tile — the logo image itself, like the app icon. */
export function LogoTile({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-20 w-20 rounded-2xl" : size === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl";
  return (
    <div className={cn(dims, "relative shrink-0 select-none overflow-hidden bg-white shadow-sm")}>
      <img
        src="/mireli-logo.jpeg"
        alt="Mi-Reli logo"
        className="absolute left-1/2 top-0 h-[150%] max-w-none -translate-x-1/2"
      />
    </div>
  );
}

/**
 * App header — sticky, blurred, phone-width. Logo tile + wordmark + subtitle
 * + Info button. Matches the original app chrome. No auth in the flow —
 * the platform starts a guest session silently on first visit.
 */
export function SiteHeader({ subtitle = "Mombasa Terminus" }: { subtitle?: string }) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const { me } = useMe();
  // Login is optional: the link appears only for guests who have not claimed
  // an account. Signed-in passengers never see it.
  const showSignIn = !!me && (!me.passenger || me.passenger.isGuest);

  return (
    <header
      className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-2.5 sm:max-w-2xl sm:px-6 lg:max-w-4xl xl:max-w-5xl">
        <div className="flex items-center gap-2.5">
          <Link href="/" aria-label="Mi-Reli home">
            <LogoTile />
          </Link>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight text-foreground">Mi-Reli</div>
            <div className="-mt-0.5 text-[10px] tracking-wide text-muted-foreground">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showSignIn && (
            <Link
              href="/login"
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              Sign in
            </Link>
          )}
          <button
            onClick={() => setAboutOpen(true)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="About Mi-Reli"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
      </div>
      <AboutSheet open={aboutOpen} onOpenChange={setAboutOpen} />
    </header>
  );
}

/** Passenger nav — the signature pill switcher (Book / My rides / Credits). */
export function SiteNav() {
  const pathname = usePathname();
  const { me } = useMe();

  const items = [
    { href: "/", label: "Book", icon: Anchor, active: pathname === "/" },
    { href: "/airport-transfers", label: "Airports", icon: Plane, active: pathname === "/airport-transfers" },
    { href: "/airports", label: "Shuttles", icon: PlaneTakeoff, active: pathname === "/airports" },
    { href: "/bookings", label: "My rides", icon: User, active: pathname === "/bookings" },
    {
      href: "/credits",
      label: me?.creditBalance ? `Credit · KSh ${me.creditBalance}` : "Credits",
      icon: Wallet,
      active: pathname === "/credits",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-2.5 sm:max-w-2xl sm:px-6 lg:max-w-4xl xl:max-w-5xl">
      <nav aria-label="Passenger" className="grid grid-cols-5 gap-1 rounded-2xl bg-secondary/50 p-1 backdrop-blur-sm">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-2 text-center text-[11px] font-semibold transition-all duration-200 sm:flex-row sm:gap-1.5 sm:text-xs",
              item.active
                ? "mireli-pill-active"
                : "text-muted-foreground hover:bg-accent/10 hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4" /> {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function SiteFooter({ airportTransfers = false }: { airportTransfers?: boolean } = {}) {
  return (
    <footer
      className="mt-auto border-t bg-background/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto w-full max-w-md px-4 py-2 text-center text-[10px] text-muted-foreground sm:max-w-2xl sm:px-6 lg:max-w-4xl xl:max-w-5xl">
        {airportTransfers ? "Mi-Reli · Mombasa & Diani" : "Mi-Reli · Mombasa Terminus · availability is confirmed before checkout"}
        <div className="mt-1 flex items-center justify-center gap-3">
          <a href="mailto:mirelisgr001@gmail.com" className="underline underline-offset-2">mirelisgr001@gmail.com</a>
          <Link href="/terms" className="underline underline-offset-2">Terms</Link>
          <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}

function AboutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-xl">Mi-Reli — about</SheetTitle>
          <SheetDescription>
            Plan a ground ride from Mombasa Terminus. Approved stops, published train times, and
            current cab availability appear in the booking flow when service is open.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6 text-sm">
          <section className="space-y-1.5">
            <h3 className="text-base font-semibold">How booking works</h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Choose a direction and date, then select an approved stop. Current train times and bookable cabs are shown for that route.</li>
              <li>Select a shared ride or private cab, then review the full fare and pickup or drop-off option.</li>
              <li>We show a cab only when an approved driver and bookable departure are available.</li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-base font-semibold">How fares and driver pay work</h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Shared rides charge the listed stage fare plus a KSh 50 Mireli fee for each booked seat. Private charters use Mireli&apos;s 10% share.</li>
              <li>Charter total is vehicle seat capacity × (the approved per-seat fare + KSh 100 per seat). The KSh 50 fee is included, not added again.</li>
              <li>Mireli keeps 10% of the charter total; the remaining 90% goes to the driver. Charters have no extra-distance surcharge.</li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-base font-semibold">Payment and cancellations</h3>
            <p className="text-xs text-muted-foreground">
              The available payment method, total, and cancellation terms are shown before you confirm.
              A booking is confirmed only after the payment provider confirms it. Never send payment
              directly to a driver outside checkout.
            </p>
          </section>

          <Button className="w-full" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
