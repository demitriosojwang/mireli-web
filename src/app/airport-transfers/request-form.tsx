"use client";

import { PassengerPlaceLookup, type PassengerPlace } from "@/components/passenger/PassengerPlaceLookup";
import { getAirportByCode } from "@/lib/airport-catalogue";
import { ArrowLeft, ArrowRight, Plane, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { nairobiToday } from "@/lib/nairobi-time";
import { api, useMe } from "@/lib/client";

const AIRPORTS = {
  mba: "Moi International Airport",
  uka: "Ukunda Airstrip",
} as const;

export type TransferAirport = keyof typeof AIRPORTS;
export const AIRPORT_TRANSFER_OPTIONS = (["mba", "uka"] as const).map((id) => {
  const airport = getAirportByCode(id.toUpperCase())!;
  return { id, label: AIRPORTS[id], area: id === "mba" ? "Mombasa" : "Diani",
    point: { id: airport.code, name: AIRPORTS[id], lat: airport.lat, lng: airport.lng } };
});

type TransferDraft = {
  airport: TransferAirport;
  direction: "from" | "to";
  address: string;
  date: string;
  time: string;
  passengers: number;
  flight: string;
  bags: string;
};
const TRANSFER_DRAFT_KEY = "mireli:airport-transfer-draft";

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

export default function AirportRequestForm({
  airport, onAirportChange, direction, onDirectionChange, onPlaceChange,
}: {
  airport: TransferAirport | null;
  onAirportChange: (airport: TransferAirport | null) => void;
  direction: "from" | "to";
  onDirectionChange: (direction: "from" | "to") => void;
  onPlaceChange: (place: PassengerPlace | null) => void;
}) {
  const { me, loading } = useMe();
  const passengerId = me?.passenger && !me.passenger.isGuest ? me.passenger.id : undefined;
  const [address, setAddress] = useState("");
  const [search, setSearch] = useState("");
  const [review, setReview] = useState<TransferDraft | null>(null);
  const [editing, setEditing] = useState(true);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [requests, setRequests] = useState<AirportRequest[]>([]);
  const [saving, setSaving] = useState(false);
  const [hasAirportDrivers, setHasAirportDrivers] = useState<boolean | null>(null);
  const requestKey = useRef<string | null>(null);
  const requestRevision = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const fromAirport = direction === "from";
  const airportName = airport ? AIRPORTS[airport] : "";
  const query = search.trim().toLowerCase();
  const airportMatches = query ? AIRPORT_TRANSFER_OPTIONS.filter(({ label, area, point }) =>
    `${label} ${area} ${point.id}`.toLowerCase().includes(query)
  ) : [];
  const shownReview = !editing && review && review.airport === airport && review.direction === direction ? review : null;

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(TRANSFER_DRAFT_KEY);
        if (!raw) return;
        sessionStorage.removeItem(TRANSFER_DRAFT_KEY);
        const saved = JSON.parse(raw) as TransferDraft;
        if ((saved.airport !== "mba" && saved.airport !== "uka") ||
            (saved.direction !== "from" && saved.direction !== "to") ||
            typeof saved.address !== "string" || typeof saved.date !== "string" ||
            typeof saved.time !== "string" || !Number.isInteger(saved.passengers) ||
            saved.passengers < 1 || saved.passengers > 99 || typeof saved.flight !== "string" ||
            typeof saved.bags !== "string" || !Number.isFinite(Date.parse(`${saved.date}T${saved.time}:00+03:00`))) return;
        onAirportChange(saved.airport);
        onDirectionChange(saved.direction);
        setAddress(saved.address);
        setReview(saved);
        setEditing(false);
      } catch { /* Draft storage is optional. */ }
    }, 0);
    return () => window.clearTimeout(restore);
  }, [onAirportChange, onDirectionChange]);

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
    if (saving || !airport) return;
    const fields = new FormData(event.currentTarget);
    if (!shownReview) {
      const date = String(fields.get("date") ?? "");
      const time = String(fields.get("time") ?? "");
      const pickupTime = new Date(`${date}T${time}:00+03:00`);
      if (address.trim().length < 3 || !Number.isFinite(pickupTime.getTime()) || pickupTime.getTime() <= Date.now()) {
        setError("Add an address and choose a pickup date and time in the future.");
        return;
      }
      setError("");
      requestKey.current = null;
      setReview({
        airport, direction, address: address.trim(), date, time,
        passengers: Number(fields.get("passengers")),
        flight: String(fields.get("flight") ?? "").trim(),
        bags: String(fields.get("bags") ?? "").trim(),
      });
      setEditing(false);
      requestAnimationFrame(() => heading.current?.focus());
      return;
    }
    if (!passengerId) return;
    setError("");
    setSaving(true);
    try {
      requestKey.current ??= crypto.randomUUID();
      const { bags, ...details } = shownReview;
      const { transfer } = await api<{ transfer: AirportRequest }>("/api/airport-transfers", {
        method: "POST", timeoutMs: 10_000,
        body: { ...details, requestKey: requestKey.current, luggage: bags,
          contactPhone: String(fields.get("contactPhone") ?? "") },
      });
      requestKey.current = null;
      requestRevision.current++;
      setRequests(previous => [transfer, ...previous.filter(item => item.id !== transfer.id)]);
      setReview(null);
      setEditing(true);
      setAddress("");
      onPlaceChange(null);
      formRef.current?.reset();
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
    <form ref={formRef} onSubmit={requestTransfer} onChange={() => { if (error) setError(""); }} className="grid min-w-0 gap-4">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">
        {shownReview ? "Confirm your transfer" : "Where to?"}
      </h1>
      {shownReview ? (
        <>
          <dl className="grid gap-3 rounded-2xl bg-muted/60 p-4 text-sm">
            <div><dt className="text-xs text-muted-foreground">Pickup</dt><dd>{fromAirport ? airportName : shownReview.address}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Drop-off</dt><dd>{fromAirport ? shownReview.address : airportName}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Pickup time</dt>
              <dd>{pickupFormat.format(new Date(`${shownReview.date}T${shownReview.time}:00+03:00`))} EAT · {shownReview.passengers} {shownReview.passengers === 1 ? "passenger" : "passengers"}</dd>
            </div>
          </dl>
          <button type="button" disabled={saving} className="inline-flex min-h-11 items-center gap-2 justify-self-start text-sm font-semibold text-primary disabled:opacity-50" onClick={() => {
            setEditing(true);
            setError("");
            requestKey.current = null;
            requestAnimationFrame(() => heading.current?.focus());
          }}>
            <ArrowLeft className="size-4" aria-hidden /> Edit transfer
          </button>
          {passengerId && hasAirportDrivers === false && (
            <p role="status" className="text-sm text-muted-foreground">There are no approved airport drivers available to take requests right now.</p>
          )}
          {passengerId && <label className="text-sm font-medium">Contact number
            <input name="contactPhone" type="tel" required maxLength={30} className={input} autoComplete="tel" />
          </label>}
          {loading || passengerId
            ? <Button type="submit" disabled={loading || saving || hasAirportDrivers === false} className="min-h-12 w-full rounded-full">{saving ? "Sending…" : "Request transfer"}</Button>
            : <Button asChild className="min-h-12 w-full rounded-full">
              <Link href="/login?next=%2F%3Ftype%3Dairport" onNavigate={() => {
                try { sessionStorage.setItem(TRANSFER_DRAFT_KEY, JSON.stringify(shownReview)); } catch { /* Draft storage is optional. */ }
              }}>Sign in to request transfer</Link>
            </Button>}
          <p className="text-sm text-muted-foreground">You can see your request and its acceptance status here.</p>
        </>
      ) : (
        <>
          <div role="group" aria-label="Transfer direction" className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
            {(["from", "to"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={direction === value}
                className={`min-h-11 rounded-full px-2 text-sm ${direction === value ? "bg-card font-semibold shadow-xs" : ""}`}
                onClick={() => { setEditing(true); onDirectionChange(value); }}>
                {value === "from" ? "From airport" : "To airport"}
              </button>
            ))}
          </div>
          {airport ? (
            <div className="flex items-center gap-3 border-b pb-2">
              <Plane aria-hidden className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{fromAirport ? "Pickup" : "Drop-off"}</p>
                <p className="text-sm font-semibold">{airportName}</p>
              </div>
              <button type="button" className="min-h-11 shrink-0 text-sm font-semibold text-primary" onClick={() => {
                setEditing(true);
                onAirportChange(null);
                setSearch("");
              }}>Change</button>
            </div>
          ) : (
            <div className="grid gap-2">
              <label className="text-sm font-medium">Search for an airport
                <span className="relative block">
                  <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
                  <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
                    className={`${input} rounded-full ps-9`} placeholder="Try Moi, MBA, Ukunda or Diani" autoComplete="off" />
                </span>
              </label>
              {query && (
                <ul className="divide-y" aria-label="Matching airports">
                  {airportMatches.map((option) => (
                    <li key={option.id}>
                      <button type="button" onClick={() => { onAirportChange(option.id); setSearch(""); }}
                        className="flex min-h-12 w-full items-center gap-3 text-start text-sm hover:bg-primary/5">
                        <Plane aria-hidden className="size-4 shrink-0 text-primary" />
                        <span className="flex-1 font-semibold">{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.point.id}</span>
                      </button>
                    </li>
                  ))}
                  {!airportMatches.length && <li className="py-2 text-sm text-muted-foreground">No matching airport. Try Moi or Ukunda.</li>}
                </ul>
              )}
              {!query && <p className="text-xs text-muted-foreground">Search or tap a pin on the map.</p>}
            </div>
          )}
          {airport && (
            <>
              <label className="text-sm font-medium">
                {fromAirport ? "Drop-off hotel or address" : "Pickup hotel or address"}
                <input name="address" className={input} required maxLength={160} value={address} onChange={(event) => {
                  setAddress(event.target.value);
                  onPlaceChange(null);
                }} placeholder="Hotel, estate or street address" />
              </label>
              <PassengerPlaceLookup address={address} onSelect={(result) => {
                setAddress(result.address);
                onPlaceChange(result);
              }} />
              <div className="grid grid-cols-2 gap-3">
                <label className="min-w-0 text-sm font-medium">Pickup date<input name="date" type="date" min={nairobiToday()} required defaultValue={review?.date} className={input} /></label>
                <label className="min-w-0 text-sm font-medium">Pickup time (EAT)<input name="time" type="time" required defaultValue={review?.time} className={input} /></label>
                <label className="min-w-0 text-sm font-medium">Passengers<input name="passengers" type="number" required min={1} max={99} defaultValue={review?.passengers ?? 1} className={input} /></label>
              </div>
              <details className="border-y py-3">
                <summary className="cursor-pointer text-sm font-medium">Add flight or luggage details</summary>
                <div className="mt-3 grid gap-3">
                  <label className="text-sm font-medium">Flight number<input name="flight" maxLength={20} defaultValue={review?.flight} placeholder="e.g. KQ 612" className={input} /></label>
                  <label className="text-sm font-medium">Luggage<input name="bags" maxLength={100} defaultValue={review?.bags} placeholder="e.g. 2 large suitcases" className={input} /></label>
                </div>
              </details>
              <Button type="submit" className="min-h-12 w-full rounded-full">Review transfer <ArrowRight className="size-4" aria-hidden /></Button>
            </>
          )}
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
    </div>
  );
}
