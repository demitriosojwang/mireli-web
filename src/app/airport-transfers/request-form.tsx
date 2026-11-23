"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { nairobiToday } from "@/lib/nairobi-time";
import { api, useMe } from "@/lib/client";

const AIRPORTS = {
  mba: "Moi International Airport (MBA), Mombasa",
  uka: "Ukunda Airstrip (UKA), Diani",
};

type AirportRequest = {
  id: string;
  airport: keyof typeof AIRPORTS;
  direction: "from" | "to";
  address: string;
  pickupAt: string;
  status: string;
  driver: { name: string; plate: string; phone: string | null } | null;
};

const REQUEST_STATUS: Record<string, string> = {
  requested: "Awaiting driver acceptance",
  confirmed: "Confirmed",
  in_progress: "On the road",
  completed: "Completed",
  cancelled: "Cancelled",
};
const pickupFormat = new Intl.DateTimeFormat("en-KE", {
  timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

export default function AirportRequestForm() {
  const { me, loading } = useMe();
  const passengerId = me?.passenger && !me.passenger.isGuest ? me.passenger.id : undefined;
  const [direction, setDirection] = useState<"from" | "to">("from");
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [requests, setRequests] = useState<AirportRequest[]>([]);
  const [saving, setSaving] = useState(false);
  const [hasAirportDrivers, setHasAirportDrivers] = useState<boolean | null>(null);
  const requestKey = useRef<string | null>(null);
  const requestRevision = useRef(0);
  const fromAirport = direction === "from";

  const refreshRequests = useCallback(async (signal?: AbortSignal) => {
    const revision = requestRevision.current;
    const { requests, hasAirportDrivers } = await api<{ requests: AirportRequest[]; hasAirportDrivers: boolean }>(
      "/api/airport-transfers", { signal, timeoutMs: 8_000 },
    );
    if (!signal?.aborted && revision === requestRevision.current) {
      setRequests(requests);
      setHasAirportDrivers(hasAirportDrivers);
      setStatusError("");
    }
  }, []);

  useEffect(() => {
    if (!passengerId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (!document.hidden) await refreshRequests(controller.signal);
      } catch {
        if (!controller.signal.aborted) setStatusError("Could not refresh transfers. Retrying…");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 15_000);
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [passengerId, refreshRequests]);

  async function requestTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !passengerId) return;
    const form = new FormData(event.currentTarget);
    const airport = String(form.get("airport"));
    const address = String(form.get("address") ?? "").trim();
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    if (!(airport in AIRPORTS) || !address) {
      setError("Choose an airport and enter a hotel or address.");
      return;
    }
    const pickupTime = new Date(`${date}T${time}:00+03:00`);
    if (!Number.isFinite(pickupTime.getTime()) || pickupTime.getTime() <= Date.now()) {
      setError("Choose a pickup date and time in the future, using Kenya time.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      requestKey.current ??= crypto.randomUUID();
      const { transfer } = await api<{ transfer: AirportRequest }>("/api/airport-transfers", {
        method: "POST", timeoutMs: 10_000,
        body: {
          requestKey: requestKey.current, airport, direction, address, date, time,
          passengers: Number(form.get("passengers")), contactPhone: String(form.get("contactPhone") ?? ""),
          flight: String(form.get("flight") ?? "").trim(), luggage: String(form.get("bags") ?? "").trim(),
        },
      });
      requestKey.current = null;
      requestRevision.current++;
      setRequests(previous => [transfer, ...previous.filter(item => item.id !== transfer.id)]);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not send your transfer request.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelRequest(request: AirportRequest) {
    setSaving(true);
    setStatusError("");
    try {
      const { requests, hasAirportDrivers } = await api<{ requests: AirportRequest[]; hasAirportDrivers: boolean }>("/api/airport-transfers", {
        method: "PUT", timeoutMs: 10_000,
        body: { id: request.id, action: "cancel" },
      });
      requestRevision.current++;
      setRequests(requests);
      setHasAirportDrivers(hasAirportDrivers);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "Could not update your transfer.");
    } finally {
      setSaving(false);
    }
  }
  const input = "mt-1 block h-11 min-w-0 w-full rounded-lg border border-input bg-background px-3 text-base";

  return (
    <div className="grid min-w-0 gap-4">
    {passengerId && (statusError || requests.length > 0) && (
      <section className="grid gap-3 rounded-3xl border bg-card p-5">
        <h2 className="text-xl font-semibold">Your airport transfers</h2>
        {statusError && <p role="status" className="text-sm text-destructive">{statusError}</p>}
        {requests.map(request => {
          const missed = request.status === "requested" && Date.parse(request.pickupAt) <= Date.now();
          return (
            <article key={request.id} className="grid gap-2 rounded-xl border p-3 text-sm">
              <h3 className="font-semibold">{request.direction === "from" ? "From " : "To "}{AIRPORTS[request.airport]}</h3>
              <p>{request.address} · {pickupFormat.format(new Date(request.pickupAt))} EAT</p>
              <p role="status" className="text-muted-foreground">{missed ? "Pickup time passed" : REQUEST_STATUS[request.status]}</p>
              {request.driver && <p>{request.driver.name} · {request.driver.plate}
                {request.driver.phone && <> · <a className="underline" href={`tel:${request.driver.phone}`}>Call driver</a></>}
              </p>}
              {["requested", "confirmed"].includes(request.status) && (
                <Button variant="outline" className="justify-self-start" disabled={saving} onClick={() => void cancelRequest(request)}>Cancel transfer</Button>
              )}
            </article>
          );
        })}
      </section>
    )}
    <form onSubmit={requestTransfer} onChange={() => { if (error) setError(""); }} className="grid min-w-0 gap-4 rounded-3xl border bg-card p-5 sm:p-6">
      <h2 className="text-xl font-semibold">Request a transfer</h2>
      {passengerId && hasAirportDrivers === false &&
        <p role="status" className="text-sm text-muted-foreground">Airport requests open when an approved driver enables airport rides.</p>}
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-1 text-sm font-medium">Direction</legend>
        {(["from", "to"] as const).map(value => (
          <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm has-checked:border-primary has-checked:bg-primary/5">
            <input type="radio" name="direction" value={value} checked={direction === value} onChange={() => setDirection(value)} />
            {value === "from" ? "From airport" : "To airport"}
          </label>
        ))}
      </fieldset>
      <div className="text-sm font-medium">
        <label htmlFor="airport-select">Airport</label>
        <select id="airport-select" name="airport" className={input} required>
          <option value="">Select an airport</option>
          {Object.entries(AIRPORTS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </div>
      <label className="text-sm font-medium">
        {fromAirport ? "Drop-off hotel or address" : "Pickup hotel or address"}
        <input name="address" className={input} required maxLength={160} placeholder="Hotel, estate or street address" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="min-w-0 text-sm font-medium">Pickup date<input name="date" type="date" min={nairobiToday()} required className={input} /></label>
        <label className="min-w-0 text-sm font-medium">Pickup time (EAT)<input name="time" type="time" required className={input} /></label>
        <label className="min-w-0 text-sm font-medium">Passengers<input name="passengers" type="number" required min={1} max={99} defaultValue={1} className={input} /></label>
        <label className="min-w-0 text-sm font-medium">Flight no. (optional)<input name="flight" maxLength={20} placeholder="e.g. KQ 612" className={input} /></label>
      </div>
      <label className="text-sm font-medium">Luggage (optional)<input name="bags" maxLength={100} placeholder="e.g. 2 large suitcases" className={input} /></label>
      <label className="text-sm font-medium">Contact number<input name="contactPhone" type="tel" required maxLength={30} className={input} autoComplete="tel" /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading || passengerId
        ? <Button type="submit" disabled={loading || saving || hasAirportDrivers === false} className="min-h-11 w-full">{saving ? "Sending…" : "Request airport transfer"}</Button>
        : <Button asChild><Link href="/login?next=%2F%3Ftype%3Dairport%26transfer%3D1">Sign in to request a transfer</Link></Button>}
      <p className="text-sm leading-relaxed text-muted-foreground">Return here to see when an approved airport driver accepts your request.</p>
    </form>
    </div>
  );
}
