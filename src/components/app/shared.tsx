"use client";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon, ChevronDown, Minus, Plus, Users } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { nairobiToday } from "@/lib/nairobi-time";

/* ─── Date helpers ─────────────────────────────────────────────────────────── */

export function todayStr(offset = 0): string {
  return nairobiToday(offset);
}

export function isToday(v: string): boolean {
  return v === todayStr();
}

export function isTomorrow(v: string): boolean {
  return v === todayStr(1);
}

export function fmtDateShort(v: string): string {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/* ─── Status badge with the pulsing dot ────────────────────────────────────── */

const BADGE_STYLES: Record<string, { label: string; cls: string; dotCls: string }> = {
  scheduled: { label: "Scheduled", cls: "bg-accent/15 text-accent border-accent/30", dotCls: "bg-accent mireli-live-dot" },
  filling: { label: "Filling", cls: "bg-accent/15 text-accent border-accent/30", dotCls: "bg-accent mireli-live-dot" },
  locked: { label: "Locked", cls: "bg-emerald-100 text-emerald-800 border-emerald-200", dotCls: "bg-emerald-500" },
  departed: { label: "On the road", cls: "bg-sky-100 text-sky-800 border-sky-200", dotCls: "bg-sky-500" },
  completed: { label: "Completed", cls: "bg-violet-100 text-violet-800 border-violet-200", dotCls: "bg-violet-500" },
  cancelled: { label: "Cancelled", cls: "bg-stone-100 text-stone-700 border-stone-200", dotCls: "bg-stone-400" },
  awaiting_payment: { label: "Payment due", cls: "bg-amber-100 text-amber-900 border-amber-200", dotCls: "bg-amber-500" },
  confirmed: { label: "Confirmed", cls: "bg-emerald-100 text-emerald-800 border-emerald-200", dotCls: "bg-emerald-500" },
  boarded: { label: "Boarded", cls: "bg-sky-100 text-sky-800 border-sky-200", dotCls: "bg-sky-500" },
  no_show: { label: "No-show", cls: "bg-red-100 text-red-900 border-red-200", dotCls: "bg-red-500" },
};

export function DotBadge({ status }: { status: string }) {
  const s = BADGE_STYLES[status] || { label: status, cls: "bg-muted text-muted-foreground border-border", dotCls: "bg-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", s.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dotCls)} />
      {s.label}
    </span>
  );
}

/* ─── Seat meter ───────────────────────────────────────────────────────────── */

export function SeatMeter({ booked, capacity }: { booked: number; capacity: number }) {
  const pct = Math.min(100, Math.round((booked / capacity) * 100));
  const remaining = Math.max(capacity - booked, 0);
  return (
    <div className="flex min-w-[80px] flex-col gap-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">Seats</span>
        <span className="font-semibold tabular-nums">{booked}/{capacity}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">{remaining} left</span>
    </div>
  );
}

/* ─── Stars ────────────────────────────────────────────────────────────────── */

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-700">
      <span aria-hidden>★</span>
      <span className="font-medium tabular-nums">{rating.toFixed(1)}</span>
    </span>
  );
}

/* ─── Train pill — big time, service name (train selector) ─────────────────── */

export function TrainPill({ time, label, name, active, gone, onClick }: {
  time: string;
  label: string;
  name?: string;
  active: boolean;
  gone?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={gone ? undefined : onClick}
      disabled={gone}
      aria-disabled={gone || undefined}
      aria-pressed={active}
      className={cn(
        "min-w-[110px] flex-1 rounded-2xl border px-3.5 py-2.5 text-left transition-all duration-200",
        gone
          ? "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-500"
          : active
            ? "mireli-pill-active"
            : "border-border bg-card hover:border-accent/30 hover:bg-accent/10 hover:shadow-sm",
      )}
    >
      <div className={cn("text-[9px] font-medium uppercase tracking-wider", active && !gone ? "opacity-80" : gone ? "text-stone-400" : "text-muted-foreground")}>
        {label}
      </div>
      <div className={cn("mt-0.5 text-xl font-bold leading-tight tabular-nums", gone && "text-stone-400")}>{time}</div>
      <div className={cn("mt-0.5 flex items-center gap-1 truncate text-[10px] font-semibold", active && !gone ? "opacity-90" : gone ? "text-stone-500" : "text-muted-foreground")}>
        {gone ? (
          <>
            <span className="h-1 w-1 shrink-0 rounded-full bg-stone-400" />
            Cab departed
          </>
        ) : (
          name || ""
        )}
      </div>
    </button>
  );
}

/* ─── Charter badge ────────────────────────────────────────────────────────── */

export function CharterBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-900 border-violet-300">
      <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
      Charter
    </span>
  );
}

/* ─── Date picker — Today / Tomorrow / pick (original pills) ───────────────── */

export function DatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);

  const selectedDate = (() => {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  })();

  const [todayYear, todayMonth, todayDay] = todayStr().split("-").map(Number);
  const today = new Date(todayYear, todayMonth - 1, todayDay);
  today.setHours(0, 0, 0, 0);

  function handleSelect(d: Date | undefined) {
    if (!d) return;
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    setOpen(false);
  }

  const pill = (active: boolean) =>
    cn(
      "flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-all",
      active ? "border-primary bg-primary shadow-sm text-primary-foreground" : "border-border bg-card hover:bg-accent hover:text-accent-foreground",
    );

  return (
    <div className="flex gap-2">
      <button onClick={() => onChange(todayStr())} className={pill(isToday(value))}>
        Today
      </button>
      <button onClick={() => onChange(todayStr(1))} className={pill(isTomorrow(value))}>
        Tomorrow
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className={cn(pill(!isToday(value) && !isTomorrow(value)), "flex items-center justify-center gap-1.5")}>
            <CalendarIcon className="h-3.5 w-3.5" />
            {!isToday(value) && !isTomorrow(value) ? fmtDateShort(value) : "Pick date"}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <Calendar mode="single" selected={selectedDate} onSelect={handleSelect} disabled={[{ before: today }]} initialFocus />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ─── Seat stepper (original style) ────────────────────────────────────────── */

export function SeatStepper({ value, min = 1, max = 14, onChange }: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const canDec = value > min;
  const canInc = value < max;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Users className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">Passengers</div>
          <div className="text-[11px] text-muted-foreground">How many seats do you need?</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => onChange(value - 1)}
          disabled={!canDec}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full border transition-all",
            canDec ? "border-border bg-background hover:bg-accent active:scale-95 hover:text-accent-foreground" : "cursor-not-allowed border-muted bg-muted opacity-40",
          )}
          aria-label="Decrease"
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="w-10 text-center">
          <div className="text-xl font-bold leading-none tabular-nums">{value}</div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{value === 1 ? "seat" : "seats"}</div>
        </div>
        <button
          onClick={() => onChange(value + 1)}
          disabled={!canInc}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full border transition-all",
            canInc ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95" : "cursor-not-allowed border-muted bg-muted opacity-40",
          )}
          aria-label="Increase"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
