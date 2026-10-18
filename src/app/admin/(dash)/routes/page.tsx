"use client";

import type { FormEvent } from "react";
import { useAdminData } from "@/components/admin/use-admin-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/client";
import { ksh } from "@/lib/format";
import { ArrowDown, ArrowUp, Check, MapPin, Pause, Play, Plus } from "lucide-react";
import { useState } from "react";

type RouteStage = {
  id: string;
  name: string;
  order: number;
  lat: number;
  lng: number;
  fare: number;
  homeSurcharge: number;
};

type RouteRow = {
  id: string;
  name: string;
  active: boolean;
  durationMinutes: number;
  stages: RouteStage[];
};

type RouteData = { routes: RouteRow[] };

function numeric(form: HTMLFormElement, name: string): number {
  return Number(new FormData(form).get(name));
}

export default function AdminRoutes() {
  const { toast } = useToast();
  const { data, loading, error, refresh } = useAdminData<RouteData>("/api/admin/routes");
  const [busy, setBusy] = useState(false);

  async function mutate(method: "POST" | "PUT", body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api("/api/admin/routes", { method, body });
      await refresh();
      return true;
    } catch (cause) {
      toast({ title: "Could not save", description: cause instanceof Error ? cause.message : "Please try again.", variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const ok = await mutate("POST", {
      action: "create_route",
      name: String(values.get("name") ?? ""),
      durationMinutes: numeric(form, "durationMinutes"),
    });
    if (ok) {
      form.reset();
      toast({ title: "Draft route created", description: "Add and review its stops before publishing it." });
    }
  }

  if (loading && !data) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (!data) {
    return (
      <Card>
        <CardContent className="space-y-3 p-5 text-sm">
          <p>{error ?? "Route catalogue could not load."}</p>
          <Button type="button" variant="outline" onClick={() => void refresh()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Routes & stops</h1>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Enter only the approved route catalogue. Stops stay hidden from customers until the route is published. Publishing stops does not create or imply cab availability.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add a route</CardTitle>
          <CardDescription>New routes start as drafts and are never seeded with sample stops.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={createRoute}>
            <div className="space-y-1.5">
              <Label htmlFor="route-name">Route name</Label>
              <Input id="route-name" name="name" placeholder="e.g. Mombasa Terminus ↔ North Coast" minLength={2} maxLength={100} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="route-duration">Typical journey time (minutes)</Label>
              <Input id="route-duration" name="durationMinutes" type="number" min={1} max={1440} step={1} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              <Plus className="mr-1.5 h-4 w-4" /> Create draft route
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && <p role="status" className="text-xs text-amber-800">Latest refresh failed. Showing the last loaded catalogue. <button type="button" className="underline" onClick={() => void refresh()}>Retry</button></p>}

      {data.routes.length === 0 ? (
        <Card>
          <CardContent className="p-5 text-center text-sm text-muted-foreground">
            No routes are configured. Customers will continue to see the honest empty-stop state.
          </CardContent>
        </Card>
      ) : data.routes.map((route) => (
        <RouteCard key={route.id} route={route} busy={busy} mutate={mutate} />
      ))}
    </div>
  );
}

function RouteCard({
  route,
  busy,
  mutate,
}: {
  route: RouteRow;
  busy: boolean;
  mutate: (method: "POST" | "PUT", body: Record<string, unknown>) => Promise<boolean>;
}) {
  const { toast } = useToast();
  const stages = [...route.stages].filter((stage) => stage.order > 0).sort((a, b) => a.order - b.order);

  async function saveForm(event: FormEvent<HTMLFormElement>, action: "add_stage" | "update_route" | "update_stage", stageId?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body: Record<string, unknown> = { action, routeId: route.id };
    if (action === "update_route") {
      body.name = String(values.get("name") ?? "");
      body.durationMinutes = numeric(form, "durationMinutes");
    } else {
      body.name = String(values.get("name") ?? "");
      body.lat = numeric(form, "lat");
      body.lng = numeric(form, "lng");
      body.fare = numeric(form, "fare");
      body.homeSurcharge = numeric(form, "homeSurcharge");
      if (stageId) body.stageId = stageId;
    }
    if (await mutate(action === "add_stage" ? "POST" : "PUT", body)) {
      if (action === "add_stage") {
        form.reset();
        toast({ title: "Stop added", description: "Its order is appended to the draft route. Reorder the list if needed." });
      } else {
        toast({ title: action === "update_route" ? "Route saved" : "Stop saved" });
      }
    }
  }

  async function moveStage(index: number, direction: -1 | 1) {
    const next = [...stages];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await mutate("PUT", { action: "reorder_stages", routeId: route.id, stageIds: next.map((stage) => stage.id) });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{route.name}</CardTitle>
            <CardDescription className="mt-1">
              {route.durationMinutes} min · {stages.length} {stages.length === 1 ? "stop" : "stops"} · {route.active ? "Published" : "Draft"}
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant={route.active ? "outline" : "default"}
            disabled={busy || (!route.active && stages.length === 0)}
            onClick={() => void mutate("PUT", { action: "set_route_active", routeId: route.id, active: !route.active })}
            title={!route.active && stages.length === 0 ? "Add stops before publishing" : undefined}
          >
            {route.active ? <><Pause className="mr-1 h-3.5 w-3.5" /> Pause</> : <><Play className="mr-1 h-3.5 w-3.5" /> Publish</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {route.active ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            Customers can search these stops. Pause the route before changing fares or stop details.
          </p>
        ) : (
          <>
            <details>
              <summary className="cursor-pointer text-xs font-medium text-primary">Edit route details</summary>
              <form className="mt-3 space-y-2.5" onSubmit={(event) => void saveForm(event, "update_route")}>
                <div className="space-y-1">
                  <Label htmlFor={`route-name-${route.id}`}>Route name</Label>
                  <Input id={`route-name-${route.id}`} name="name" defaultValue={route.name} minLength={2} maxLength={100} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`route-duration-${route.id}`}>Journey time (minutes)</Label>
                  <Input id={`route-duration-${route.id}`} name="durationMinutes" type="number" min={1} max={1440} step={1} defaultValue={route.durationMinutes} required />
                </div>
                <Button type="submit" size="sm" variant="outline" disabled={busy}>Save route details</Button>
              </form>
            </details>

            <form className="space-y-2.5 rounded-xl border bg-muted/20 p-3" onSubmit={(event) => void saveForm(event, "add_stage")}>
              <h3 className="flex items-center gap-1.5 text-sm font-medium"><Plus className="h-4 w-4" /> Add a customer stop</h3>
              <div className="space-y-1">
                <Label htmlFor={`stage-name-${route.id}`}>Stop name</Label>
                <Input id={`stage-name-${route.id}`} name="name" placeholder="Approved stage name" minLength={2} maxLength={100} required />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`stage-lat-${route.id}`}>Latitude</Label>
                  <Input id={`stage-lat-${route.id}`} name="lat" type="number" min={-90} max={90} step="any" placeholder="-4.05" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`stage-lng-${route.id}`}>Longitude</Label>
                  <Input id={`stage-lng-${route.id}`} name="lng" type="number" min={-180} max={180} step="any" placeholder="39.67" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`stage-fare-${route.id}`}>Fare per seat (KSh)</Label>
                  <Input id={`stage-fare-${route.id}`} name="fare" type="number" min={1} max={100000} step={1} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`stage-surcharge-${route.id}`}>Door surcharge (KSh)</Label>
                  <Input id={`stage-surcharge-${route.id}`} name="homeSurcharge" type="number" min={0} max={50000} step={1} required />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">Coordinates are required for the approved pickup/drop-off stop. The full door surcharge is passed to the driver.</p>
              <Button type="submit" size="sm" className="w-full" disabled={busy}>Add stop</Button>
            </form>
          </>
        )}

        {stages.length > 0 ? (
          <ol className="space-y-2" aria-label={`${route.name} stops in travel order`}>
            {stages.map((stage, index) => (
              <li key={stage.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-start gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{stage.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <MapPin className="h-3 w-3" /> {stage.lat.toFixed(5)}, {stage.lng.toFixed(5)} · {ksh(stage.fare)} / seat · {ksh(stage.homeSurcharge)} door
                    </p>
                  </div>
                  {!route.active && (
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Move ${stage.name} up`} disabled={busy || index === 0} onClick={() => void moveStage(index, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Move ${stage.name} down`} disabled={busy || index === stages.length - 1} onClick={() => void moveStage(index, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </div>
                {!route.active && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                    <details className="flex-1">
                      <summary className="w-fit cursor-pointer text-xs font-medium text-primary">Edit stop</summary>
                      <form className="mt-2 space-y-2" onSubmit={(event) => void saveForm(event, "update_stage", stage.id)}>
                        <div className="space-y-1"><Label htmlFor={`edit-name-${stage.id}`}>Stop name</Label><Input id={`edit-name-${stage.id}`} name="name" defaultValue={stage.name} minLength={2} maxLength={100} required /></div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1"><Label htmlFor={`edit-lat-${stage.id}`}>Latitude</Label><Input id={`edit-lat-${stage.id}`} name="lat" type="number" min={-90} max={90} step="any" defaultValue={stage.lat} required /></div>
                          <div className="space-y-1"><Label htmlFor={`edit-lng-${stage.id}`}>Longitude</Label><Input id={`edit-lng-${stage.id}`} name="lng" type="number" min={-180} max={180} step="any" defaultValue={stage.lng} required /></div>
                          <div className="space-y-1"><Label htmlFor={`edit-fare-${stage.id}`}>Fare per seat</Label><Input id={`edit-fare-${stage.id}`} name="fare" type="number" min={1} max={100000} step={1} defaultValue={stage.fare} required /></div>
                          <div className="space-y-1"><Label htmlFor={`edit-surcharge-${stage.id}`}>Door surcharge</Label><Input id={`edit-surcharge-${stage.id}`} name="homeSurcharge" type="number" min={0} max={50000} step={1} defaultValue={stage.homeSurcharge} required /></div>
                        </div>
                        <Button type="submit" size="sm" variant="outline" disabled={busy}>Save stop</Button>
                      </form>
                    </details>
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-xl border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            No customer stops in this draft. Add the approved stops in order; the route cannot be published before it has valid priced stops.
          </div>
        )}

        {route.active && (
          <p className="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
            Route stops are published. Customer cabs remain at zero until approved active drivers and scheduled departures are available.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
