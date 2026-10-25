"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useAdminData } from "@/components/admin/use-admin-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/client";
import { CalendarClock, Pause, Play, Plus, Train as TrainIcon } from "lucide-react";

type TrainRow = {
  id: string;
  name: string;
  direction: "MBA_TO_NBO" | "NBO_TO_MBA";
  originCode: "MTM" | "NTM";
  destCode: "MTM" | "NTM";
  originTime: string;
  destTime: string;
  destDayOffset: number;
  serviceDays: number[];
  active: boolean;
  linkedTrips: number;
};

type TimetableData = { trains: TrainRow[] };

const SERVICE_DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

function payload(form: HTMLFormElement) {
  const values = new FormData(form);
  return {
    name: String(values.get("name") ?? ""),
    direction: String(values.get("direction") ?? ""),
    originTime: String(values.get("originTime") ?? ""),
    destTime: String(values.get("destTime") ?? ""),
    destDayOffset: Number(values.get("destDayOffset")),
    serviceDays: values.getAll("serviceDays").map(Number),
  };
}

export default function AdminTimetable() {
  const { toast } = useToast();
  const { data, loading, error, refresh } = useAdminData<TimetableData>("/api/admin/timetable");
  const [busy, setBusy] = useState(false);

  async function mutate(method: "POST" | "PUT", body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api("/api/admin/timetable", { method, body });
      await refresh();
      return true;
    } catch (cause) {
      toast({ title: "Could not save", description: cause instanceof Error ? cause.message : "Please try again.", variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createTrain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await mutate("POST", { action: "create_train", ...payload(form) })) {
      form.reset();
      toast({ title: "Draft timetable entry created", description: "Review its train times, then publish it when confirmed." });
    }
  }

  if (loading && !data) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (!data) {
    return <Card><CardContent className="space-y-3 p-5 text-sm"><p>{error ?? "Timetable could not load."}</p><Button type="button" variant="outline" onClick={() => void refresh()}>Retry</Button></CardContent></Card>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">SGR timetable</h1>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Review times against the current Kenya Railways timetable. New entries stay unpublished until you activate them.
        </p>
      </div>

      <div role="note" className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
        The timetable baseline follows the Kenya Railways 2026 schedule: 08:00, 15:00 and 22:00 departures in both directions. The night train arrives the following day. The scheduler uses origin-departure weekdays in Kenya time; verify the current times and publication state before launch.
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add a train</CardTitle>
          <CardDescription>Departures and arrivals use local Kenya time. Destination-day offset is for an arrival after midnight.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={createTrain}>
            <div className="space-y-1.5">
              <Label htmlFor="train-name">Train name</Label>
              <Input id="train-name" name="name" placeholder="e.g. Inter-County" minLength={2} maxLength={60} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="train-direction">Direction</Label>
              <select id="train-direction" name="direction" defaultValue="NBO_TO_MBA" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required>
                <option value="NBO_TO_MBA">Nairobi Terminus → Mombasa Terminus</option>
                <option value="MBA_TO_NBO">Mombasa Terminus → Nairobi Terminus</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label htmlFor="train-origin-time">Departure time</Label><Input id="train-origin-time" name="originTime" type="time" required /></div>
              <div className="space-y-1.5"><Label htmlFor="train-dest-time">Arrival time</Label><Input id="train-dest-time" name="destTime" type="time" required /></div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="train-day-offset">Arrival day</Label>
              <select id="train-day-offset" name="destDayOffset" defaultValue="0" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required>
                <option value="0">Same day</option>
                <option value="1">Following day</option>
              </select>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Runs on (origin departure day)</legend>
              <div className="grid grid-cols-4 gap-2">
                {SERVICE_DAYS.map((day) => (
                  <label key={day.value} className="flex min-h-9 items-center gap-2 rounded-lg border px-2 text-xs">
                    <input type="checkbox" name="serviceDays" value={day.value} defaultChecked className="accent-primary" /> {day.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-[11px] leading-relaxed text-muted-foreground">Terminus codes are assigned from direction automatically: NTM (Nairobi) and MTM (Mombasa).</p>
            <Button type="submit" className="w-full" disabled={busy}><Plus className="mr-1.5 h-4 w-4" /> Create draft train</Button>
          </form>
        </CardContent>
      </Card>

      {error && <p role="status" className="text-xs text-amber-800">Latest refresh failed. Showing the last loaded timetable. <button type="button" className="underline" onClick={() => void refresh()}>Retry</button></p>}

      {data.trains.length === 0 ? (
        <Card><CardContent className="p-5 text-center text-sm text-muted-foreground">No trains are configured. Customers will see the schedule setup notice.</CardContent></Card>
      ) : data.trains.map((train) => <TrainCard key={train.id} train={train} busy={busy} mutate={mutate} />)}
    </div>
  );
}

function TrainCard({
  train,
  busy,
  mutate,
}: {
  train: TrainRow;
  busy: boolean;
  mutate: (method: "POST" | "PUT", body: Record<string, unknown>) => Promise<boolean>;
}) {
  const { toast } = useToast();
  const directionName = train.direction === "NBO_TO_MBA" ? "Nairobi → Mombasa" : "Mombasa → Nairobi";
  const offsetText = train.destDayOffset === 1 ? "next day" : "same day";
  const serviceDaysText = SERVICE_DAYS.filter((day) => train.serviceDays.includes(day.value)).map((day) => day.label).join(", ");

  async function updateTrain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate("PUT", { action: "update_train", trainId: train.id, ...payload(event.currentTarget) })) {
      toast({ title: "Timetable entry saved" });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base"><TrainIcon className="h-4 w-4 shrink-0 text-primary" /> <span className="truncate">{train.name}</span></CardTitle>
            <CardDescription className="mt-1">{directionName} · {train.originCode} {train.originTime} → {train.destCode} {train.destTime} ({offsetText})</CardDescription>
            <p className="mt-1 text-[11px] text-muted-foreground">{train.linkedTrips} linked {train.linkedTrips === 1 ? "trip" : "trips"} · {train.active ? `Published · ${serviceDaysText}` : "Draft"}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={train.active ? "outline" : "default"}
            disabled={busy}
            onClick={() => void mutate("PUT", { action: "set_train_active", trainId: train.id, active: !train.active })}
          >
            {train.active ? <><Pause className="mr-1 h-3.5 w-3.5" /> Pause</> : <><Play className="mr-1 h-3.5 w-3.5" /> Publish</>}
          </Button>
        </div>
      </CardHeader>
      {!train.active && train.linkedTrips === 0 && (
        <CardContent className="pt-0">
          <details>
            <summary className="cursor-pointer text-xs font-medium text-primary">Edit timetable entry</summary>
            <form className="mt-3 space-y-3" onSubmit={(event) => void updateTrain(event)}>
              <div className="space-y-1.5"><Label htmlFor={`edit-train-name-${train.id}`}>Train name</Label><Input id={`edit-train-name-${train.id}`} name="name" defaultValue={train.name} minLength={2} maxLength={60} required /></div>
              <div className="space-y-1.5">
                <Label htmlFor={`edit-train-direction-${train.id}`}>Direction</Label>
                <select id={`edit-train-direction-${train.id}`} name="direction" defaultValue={train.direction} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required>
                  <option value="NBO_TO_MBA">Nairobi Terminus → Mombasa Terminus</option>
                  <option value="MBA_TO_NBO">Mombasa Terminus → Nairobi Terminus</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label htmlFor={`edit-origin-time-${train.id}`}>Departure time</Label><Input id={`edit-origin-time-${train.id}`} name="originTime" type="time" defaultValue={train.originTime} required /></div>
                <div className="space-y-1.5"><Label htmlFor={`edit-dest-time-${train.id}`}>Arrival time</Label><Input id={`edit-dest-time-${train.id}`} name="destTime" type="time" defaultValue={train.destTime} required /></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`edit-day-offset-${train.id}`}>Arrival day</Label>
                <select id={`edit-day-offset-${train.id}`} name="destDayOffset" defaultValue={String(train.destDayOffset)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required>
                  <option value="0">Same day</option>
                  <option value="1">Following day</option>
                </select>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Runs on (origin departure day)</legend>
                <div className="grid grid-cols-4 gap-2">
                  {SERVICE_DAYS.map((day) => (
                    <label key={day.value} className="flex min-h-9 items-center gap-2 rounded-lg border px-2 text-xs">
                      <input type="checkbox" name="serviceDays" value={day.value} defaultChecked={train.serviceDays.includes(day.value)} className="accent-primary" /> {day.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" size="sm" variant="outline" disabled={busy}>Save timetable</Button>
            </form>
          </details>
        </CardContent>
      )}
      {train.active && (
        <CardContent className="pt-0 text-xs leading-relaxed text-muted-foreground">
          New trips may be generated on {serviceDaysText || "no days"}. Pause it before changing its schedule.
        </CardContent>
      )}
      {!train.active && train.linkedTrips > 0 && (
        <CardContent className="pt-0 text-xs leading-relaxed text-muted-foreground">
          This timetable is preserved for trip history. Add a corrected entry rather than rewriting linked service records.
        </CardContent>
      )}
    </Card>
  );
}
