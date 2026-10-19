"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import { LogoTile } from "@/components/site-chrome";
import {
  AlertTriangle,
  BarChart3,
  CalendarCog,
  Car,
  ClipboardList,
  Coins,
  MapPin,
  Radar,
  Receipt,
  Train,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: BarChart3 },
  { href: "/admin/bookings", label: "Bookings", icon: ClipboardList },
  { href: "/admin/routes", label: "Routes", icon: MapPin },
  { href: "/admin/timetable", label: "Timetable", icon: Train },
  { href: "/admin/trips", label: "Trips", icon: Car },
  { href: "/admin/drivers", label: "Drivers", icon: Users },
  { href: "/admin/driver-onboarding", label: "Compliance", icon: ClipboardList },
  { href: "/admin/driver-support", label: "Support", icon: Users },
  { href: "/admin/driver-payout-destinations", label: "Beneficiaries", icon: Users },
  { href: "/admin/money", label: "Ledger", icon: Coins },
  { href: "/admin/reconciliation", label: "Recon", icon: Radar },
  { href: "/admin/payments", label: "Payments", icon: Wallet },
  { href: "/admin/config", label: "Config", icon: CalendarCog },
  { href: "/admin/audit", label: "Audit", icon: Receipt },
];

/** Original-style admin chrome: app header ("Admin Console") + pill tab nav. */
export function AdminChrome({ adminName, adminEmail }: { adminName: string; adminEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await api("/api/admin/auth", { body: { step: "logout" } });
      router.push("/admin/login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <Link href="/admin" aria-label="Mi-Reli admin">
              <LogoTile />
            </Link>
            <div className="leading-tight">
              <div className="text-base font-bold tracking-tight text-foreground">Mi-Reli</div>
              <div className="-mt-0.5 flex items-center gap-1 text-[10px] tracking-wide text-muted-foreground">
                <AlertTriangle className="h-2.5 w-2.5 text-accent" /> Admin Console · oversight only
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={logout} disabled={busy} className="text-[10px] text-muted-foreground hover:text-foreground">
              Logout
            </button>
          </div>
        </div>

        {/* Pill tab nav — horizontally scrollable, original text-[10px] style */}
        <div className="mx-auto max-w-md px-4 pb-2.5">
          <div className="flex gap-1 overflow-x-auto rounded-2xl bg-secondary/50 p-1 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-2 text-[10px] font-semibold transition-all duration-200",
                    active
                      ? "mireli-pill-active"
                      : "text-muted-foreground hover:bg-accent/10 hover:text-foreground",
                  )}
                >
                  <item.icon className="h-3 w-3" /> {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      {/* Account strip */}
      <div className="mx-auto w-full max-w-md px-4 pt-3">
        <p className="text-[10px] text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{adminName}</span> · {adminEmail}
        </p>
      </div>
    </>
  );
}

export function AdminSignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await api("/api/admin/auth", { body: { step: "logout" } });
      router.push("/admin/login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={logout} disabled={busy}>
      Sign out
    </Button>
  );
}
