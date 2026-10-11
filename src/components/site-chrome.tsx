"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlarmClock, Anchor, Info, MapPin, Train as TrainIcon, User, Wallet, X } from "lucide-react";
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
        Mi-Reli · Mombasa Terminus · every shilling tracked in the platform ledger
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
            Reliable shared-ride shuttles connecting Mombasa Terminus (MTM) with the North &amp;
            South Coast — every cab timed to a Madaraka Express departure or arrival.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6 text-sm">
          <section className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-base font-semibold">
              <TrainIcon className="h-4 w-4" /> Trains we meet
            </h3>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Departures</span> (MTM → Nairobi): 08:00
              Inter-County, 15:00 Express, 22:00 Night Train
              <br />
              <span className="font-medium text-foreground">Arrivals</span> (Nairobi → MTM): 04:00
              (+1d Night Train), 14:00 Inter-County, 20:30 Express
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-base font-semibold">
              <AlarmClock className="h-4 w-4" /> Pickup rules
            </h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>
                Every cab leaves its stage exactly <span className="font-medium text-foreground">2 hours before the train departs</span>{" "}
                (e.g. cabs for the 08:00 train pull out at 06:00) — be at your stage by then.
              </li>
              <li>
                The driver waits at most <span className="font-medium text-foreground">15 minutes</span> past
                departure if you haven&apos;t arrived and haven&apos;t notified them — after that the cab
                leaves and the no-show policy applies.
              </li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-base font-semibold">
              <MapPin className="h-4 w-4" /> Points &amp; fares
            </h3>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">North Coast (KSh 400):</span> Kiembeni
              Mwisho · Kiembeni Police · Ananda Marga · San Sera · Green Estate · Kona Kiembeni ·
              Bamburi Mwisho · Naivas Bamburi · Total Bamburi · Fisheries · Mwembeni · JCC Junction ·
              Nyali Center · VOK · Bombolulu · Lights · Mtwapa —{" "}
              <span className="font-medium text-foreground">Malindi KSh 700</span>
              <br />
              <span className="font-medium text-foreground">South Coast:</span> Likoni Ferry
              Container · Kona Mpya (Fayaz) · ShikaAdabu Checkpoint (KSh 400) —{" "}
              <span className="font-medium text-foreground">Diani Naivas KSh 500</span>
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-base font-semibold">How fares work</h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>
                Per-seat fare by point — KSh 400 flat upcountry, Malindi 700, Diani Naivas 500.
              </li>
              <li>
                Door-to-door pickup adds the point&apos;s surcharge, which passes to your driver in
                full.
              </li>
              <li>Private charter: the whole cab to your group at a fixed route price.</li>
              <li>
                Cancel before lock for a full refund; cancel after lock and your fare becomes travel
                credit, valid 30 days.
              </li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-base font-semibold">Your money is safe</h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Fares are collected by Mi-Reli via M-Pesa — never paid to a driver directly.</li>
              <li>Every shilling sits in the platform ledger until your ride is delivered.</li>
              <li>Refunds go back to your M-Pesa; credits stay spendable on any future ride.</li>
            </ul>
          </section>

          <Button className="w-full" onClick={() => onOpenChange(false)}>
            <X className="mr-1 h-4 w-4" /> Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
