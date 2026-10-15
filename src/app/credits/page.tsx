"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteFooter, SiteHeader, SiteNav } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, useMe } from "@/lib/client";
import { daysUntil, fmtDate, ksh } from "@/lib/format";
import { Ticket, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreditRow {
  id: string;
  amount: number;
  initialAmount: number;
  status: string;
  note: string | null;
  issuedAt: string;
  expiresAt: string;
}

export default function CreditsPage() {
  const { me, loading: meLoading, error: identityError, refresh: retryIdentity } = useMe();
  const [credits, setCredits] = useState<CreditRow[] | null>(null);
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    if (!me?.session) return;
    api<{ balance: number; credits: CreditRow[] }>("/api/credits")
      .then((res) => {
        setBalance(res.balance);
        setCredits(res.credits);
      })
      .catch(() => setCredits([]));
  }, [me]);

  if (meLoading) return null;

  if (!me?.session) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
          <Wallet className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">Couldn&apos;t load your credits</p>
          <p className="text-sm text-muted-foreground">
            {identityError || "Your booking session is unavailable. Please try again."}
          </p>
          <Button variant="outline" onClick={() => void retryIdentity()} disabled={meLoading}>
            {meLoading ? "Retrying…" : "Try again"}
          </Button>
          <Button asChild>
            <Link href="/">Book a ride</Link>
          </Button>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const styles: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-900 border-emerald-200",
    redeemed: "bg-teal-100 text-teal-900 border-teal-200",
    expired: "bg-stone-100 text-stone-600 border-stone-200",
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader subtitle="Travel credits" />
      <SiteNav />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-8">
        {/* Balance card with the gradient accent bar */}
        <Card className="overflow-hidden">
          <div className="mireli-accent-bar h-1.5 w-full" />
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Available balance</p>
              <p className="text-3xl font-bold tabular-nums text-primary">{ksh(balance)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Partial use supported · valid 30 days · never expires into cash
              </p>
            </div>
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10">
              <Wallet className="h-7 w-7 text-primary" />
            </div>
          </CardContent>
        </Card>

        <section className="mt-6">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Credit history</h2>
          {credits === null && <Skeleton className="h-24 w-full" />}
          {credits && credits.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <Ticket className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-medium">No credits yet</p>
                <p className="text-xs text-muted-foreground">
                  If you ever cancel after the trip locks, your fare lands here automatically.
                </p>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-2">
            {(credits || []).map((c) => (
              <Card key={c.id}>
                <CardContent className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                          styles[c.status] || "",
                        )}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                        {c.status}
                      </span>
                      {c.status === "active" && (
                        <span className="text-xs text-muted-foreground">
                          expires in {daysUntil(c.expiresAt)} days ({fmtDate(c.expiresAt)})
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm">{c.note || "Travel credit"}</p>
                    <p className="text-xs text-muted-foreground">Issued {fmtDate(c.issuedAt)}</p>
                    {c.amount < c.initialAmount && c.status === "active" && (
                      <p className="mt-1 text-xs text-emerald-800">
                        {ksh(c.initialAmount - c.amount)} already used · {ksh(c.amount)} remaining
                      </p>
                    )}
                  </div>
                  <p
                    className={cn(
                      "shrink-0 text-lg font-bold tabular-nums",
                      c.status === "active" ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {ksh(c.amount)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
