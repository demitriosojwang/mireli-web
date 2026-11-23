"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Anchor, Info, Plane, User, Wallet } from "lucide-react";
import { api, useMe, type Me } from "@/lib/client";
import { ProfileChip, SignInLink } from "@/components/app/profile-chip";
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
  const { me, refresh } = useMe();
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
          {me?.passenger && !me.passenger.isGuest ? (
            <ProfileChip me={me} onRefresh={refresh} />
          ) : (
            showSignIn && <SignInLink />
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

/**
 * Passenger nav — the signature pill switcher. Signed-in passengers get
 * Book / Airports / Account (rides + credits live in the account sheet);
 * guests keep Book / Airports / My rides / Credits.
 */
export function SiteNav() {
  const pathname = usePathname();
  const { me, refresh } = useMe();
  const [accountOpen, setAccountOpen] = useState(false);
  const signedIn = !!me?.passenger && !me.passenger.isGuest;

  if (!signedIn) {
    const guestItems = [
      { href: "/", label: "Book", icon: Anchor, active: pathname === "/" },
      { href: "/airports", label: "Airports", icon: Plane, active: pathname === "/airports" || pathname === "/airport-transfers" },
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
        <nav aria-label="Passenger" className="grid grid-cols-4 gap-1 rounded-2xl bg-secondary/50 p-1 backdrop-blur-sm">
          {guestItems.map((item) => (
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

  const items = [
    { href: "/", label: "Book", icon: Anchor, active: pathname === "/" },
    { href: "/airports", label: "Airports", icon: Plane, active: pathname === "/airports" || pathname === "/airport-transfers" },
  ];

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-2.5 sm:max-w-2xl sm:px-6 lg:max-w-4xl xl:max-w-5xl">
      <nav aria-label="Passenger" className="grid grid-cols-3 gap-1 rounded-2xl bg-secondary/50 p-1 backdrop-blur-sm">
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
        <button
          type="button"
          onClick={() => setAccountOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={accountOpen}
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-2 text-center text-[11px] font-semibold transition-all duration-200 sm:flex-row sm:gap-1.5 sm:text-xs",
            pathname === "/bookings" || pathname === "/credits"
              ? "mireli-pill-active"
              : "text-muted-foreground hover:bg-accent/10 hover:text-foreground",
          )}
        >
          <User className="h-4 w-4" /> Account
        </button>
      </nav>

      {me && (
        <AccountSheetHost open={accountOpen} onOpenChange={setAccountOpen} me={me} onRefresh={refresh} />
      )}
    </div>
  );
}

/** Reuses the profile sheet content for the nav Account pill. */
function AccountSheetHost({ open, onOpenChange, me, onRefresh }: { open: boolean; onOpenChange: (v: boolean) => void; me: Me; onRefresh: () => void }) {
  return <ProfileChip me={me} onRefresh={onRefresh} open={open} onOpenChange={onOpenChange} />;
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
          <SupportEmailLink />
          <Link href="/terms" className="underline underline-offset-2">Terms</Link>
          <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}

const SUPPORT_EMAIL = "mirelisgr001@gmail.com";
const SUPPORT_EMAIL_CLASS = {
  footer: "underline underline-offset-2",
  help: "mt-2 inline-block text-xs font-medium text-primary underline",
} as const;

/** Cloudflare's email rewriting changes SSR markup before React can hydrate it. */
export function SupportEmailLink({ variant = "footer" }: { variant?: keyof typeof SUPPORT_EMAIL_CLASS }) {
  const className = SUPPORT_EMAIL_CLASS[variant];
  return (
    <span
      className="contents"
      dangerouslySetInnerHTML={{
        __html: `<!--email_off--><a href="mailto:${SUPPORT_EMAIL}" class="${className}">${SUPPORT_EMAIL}</a><!--/email_off-->`,
      }}
    />
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
              <li>Shared hailed rides charge the listed stage fare plus a KSh 60 Mi-Reli fee for each booked seat. Motorbike rides use their listed per-ride fare plus a KSh 100 fee.</li>
              <li>Charter total is vehicle seat capacity × (the approved per-seat fare + KSh 100 per seat), with 16% VAT added on top. Mi-Reli keeps 10% of the charter fare.</li>
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
