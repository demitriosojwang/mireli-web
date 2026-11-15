"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import { LogoTile } from "@/components/site-chrome";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/routes", label: "Routes" },
  { href: "/admin/timetable", label: "Timetable" },
  { href: "/admin/trips", label: "Trips" },
  { href: "/admin/drivers", label: "Drivers" },
  { href: "/admin/driver-onboarding", label: "Compliance" },
  { href: "/admin/driver-support", label: "Support" },
  { href: "/admin/driver-payout-destinations", label: "Beneficiaries" },
  { href: "/admin/money", label: "Ledger" },
  { href: "/admin/reconciliation", label: "Recon" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/config", label: "Config" },
  { href: "/admin/audit", label: "Audit" },
];

/** Workspace chrome: identity header + underline tab bar (desktop-first, brand theme). */
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
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto w-full max-w-md px-4 sm:max-w-3xl sm:px-6 lg:max-w-5xl xl:max-w-6xl">
        <div className="flex items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-2.5">
            <Link href="/admin" aria-label="Mi-Reli admin">
              <LogoTile />
            </Link>
            <div className="leading-tight">
              <div className="text-base font-bold tracking-tight text-foreground">Mi-Reli</div>
              <div className="-mt-0.5 flex items-center gap-1 text-[10px] tracking-wide text-muted-foreground">
                <ShieldCheck className="h-2.5 w-2.5 text-accent" /> Admin Console · oversight only
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden text-right leading-tight md:block">
              <p className="text-xs font-medium text-foreground">{adminName}</p>
              <p className="text-[10px] text-muted-foreground">{adminEmail} · private workspace</p>
            </div>
            <Link href="/" className="hidden items-center gap-0.5 text-xs font-medium text-accent hover:underline sm:inline-flex">
              Passenger site <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <Button variant="outline" size="sm" onClick={logout} disabled={busy}>
              Logout
            </Button>
          </div>
        </div>
      </div>

      {/* Underline tab bar — scrollable on small screens */}
      <nav className="border-t border-border/70" aria-label="Admin sections">
        <div className="mx-auto flex w-full max-w-md gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:max-w-3xl sm:px-6 lg:max-w-5xl xl:max-w-6xl">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
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
