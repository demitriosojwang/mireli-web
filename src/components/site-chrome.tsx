"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Anchor, Info, User, Wallet, X } from "lucide-react";
import { useMe } from "@/lib/client";
import { cn } from "@/lib/utils";

/** Rounded brand tile — the logo image itself, like the app icon. */
export function LogoTile({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-20 w-20 rounded-2xl" : size === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl";
  return (
    <div className={cn(dims, "relative shrink-0 select-none overflow-hidden bg-white shadow-sm transition-transform hover:scale-105")}>
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

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex max-w-md items-center justify-between px-4 py-2.5">
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
    { href: "/bookings", label: "My rides", icon: User, active: pathname === "/bookings" },
    {
      href: "/credits",
      label: me?.creditBalance ? `Credit · KSh ${me.creditBalance}` : "Credits",
      icon: Wallet,
      active: pathname === "/credits",
    },
  ];

  return (
    <div className="mx-auto max-w-md px-4 pb-2.5">
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-secondary/50 p-1 backdrop-blur-sm">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all duration-200",
              item.active
                ? "mireli-pill-active"
                : "text-muted-foreground hover:bg-accent/10 hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4" /> {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-background/95 backdrop-blur">
      <div className="mx-auto max-w-md px-4 py-2 text-center text-[10px] text-muted-foreground">
        Mi-Reli · Mombasa Terminus · availability is confirmed before checkout
        <div className="mt-1"><a href="mailto:mirelisgr001@gmail.com" className="underline underline-offset-2">mirelisgr001@gmail.com</a></div>
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
              <li>Shared rides include a KSh 50 Mireli fee for each booked seat; 10/11-seat shared cabs are KSh 50 cheaper per seat. Private charters use Mireli&apos;s 10% share.</li>
              <li>Charter total is vehicle seat capacity × (the approved per-seat fare + KSh 100 per seat). The KSh 50 fee is included, not added again.</li>
              <li>Mireli keeps 10% of the charter total; the remaining 90% goes to the driver. Door-to-door surcharge goes to the driver in full.</li>
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
            <X className="mr-1 h-4 w-4" /> Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
