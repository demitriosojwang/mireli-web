"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { DURATION, EASE_OUT, STAGGER_MS, pressClass, rowVariants, staggeredList } from "@/lib/motion";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { InstallPrompt } from "@/components/install-prompt";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import { ksh } from "@/lib/format";
import { Plane, PlaneLanding, PlaneTakeoff, Clock, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShuttleSlot {
  id: string;
  direction: "FROM_AIRPORT" | "TO_AIRPORT";
  departTime: string;
}

interface AirportRow {
  code: string;
  name: string;
  durationMinutes: number;
  fare: number;
  homeSurcharge: number;
  slots: ShuttleSlot[];
}

export default function AirportsPage() {
  const [airports, setAirports] = useState<AirportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ airports: AirportRow[] }>("/api/airports")
      .then((data) => {
        if (!cancelled) setAirports(data.airports);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load airport shuttles. Check your connection and retry.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, { from: ShuttleSlot[]; to: ShuttleSlot[] }>();
    for (const airport of airports ?? []) {
      map.set(
        airport.code,
        airport.slots.reduce(
          (acc, slot) => {
            (slot.direction === "FROM_AIRPORT" ? acc.from : acc.to).push(slot);
            return acc;
          },
          { from: [] as ShuttleSlot[], to: [] as ShuttleSlot[] },
        ),
      );
    }
    return map;
  }, [airports]);

  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader subtitle="Airport Shuttles" />
      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-4 sm:max-w-2xl sm:px-6 lg:max-w-4xl xl:max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.move, ease: EASE_OUT }}
        >
          <h1 className="text-xl font-bold tracking-tight text-foreground">Airport shuttles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scheduled shuttle service between Mombasa Terminus (Miritini) and Kenya&apos;s coastal
            airports. Every departure is driver-assigned like our train feeder cabs.
          </p>
        </motion.div>

        {error && (
          <Card className="mt-4 border-destructive/40">
            <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {!airports && !error && (
          <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading airports…
          </div>
        )}

        <motion.div variants={staggeredList} initial="hidden" animate="show" className="mt-4 space-y-3">
          {(airports ?? []).map((airport, index) => {
            const slots = grouped.get(airport.code) ?? { from: [], to: [] };
            return (
              <motion.div
                key={airport.code}
                variants={rowVariants}
                transition={{ delay: index * STAGGER_MS }}
                layout
              >
                <Card className={cn("overflow-hidden", pressClass)}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-primary">
                            {airport.code}
                          </span>
                          <h2 className="truncate text-sm font-semibold text-foreground">{airport.name}</h2>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {airport.durationMinutes} min ride · from {ksh(airport.fare)} per seat
                          {airport.homeSurcharge > 0 && <> · door pickup +{ksh(airport.homeSurcharge)}</>}
                        </p>
                      </div>
                      <Plane className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <SlotColumn
                        label="Arrivals — airport to terminus"
                        icon={<PlaneLanding className="h-3.5 w-3.5" aria-hidden />}
                        slots={slots.from}
                      />
                      <SlotColumn
                        label="Departures — terminus to airport"
                        icon={<PlaneTakeoff className="h-3.5 w-3.5" aria-hidden />}
                        slots={slots.to}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        Charters available — whole cab, VAT added at checkout
                      </span>
                      <Link href="/">
                        <Button size="sm" variant="outline" className={cn("h-8 gap-1 text-xs", pressClass)}>
                          Book <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      </main>
      <SiteFooter />
      <InstallPrompt />
    </div>
  );
}

function SlotColumn({ label, icon, slots }: { label: string; icon: React.ReactNode; slots: ShuttleSlot[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      {slots.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">Slots published shortly.</p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {slots.map((slot) => (
            <motion.span
              key={slot.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: DURATION.dropdown, ease: EASE_OUT }}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground"
            >
              <Clock className="h-3 w-3 text-muted-foreground" aria-hidden />
              {slot.departTime}
            </motion.span>
          ))}
        </div>
      )}
    </div>
  );
}
