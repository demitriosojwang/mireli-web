"use client";

import { useState, type FormEvent } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nairobiToday } from "@/lib/nairobi-time";
import { MIRELI_SUPPORT_WHATSAPP_NUMBER } from "@/lib/support";

const AIRPORTS = {
  mba: "Moi International Airport (MBA), Mombasa",
  uka: "Ukunda Airstrip (UKA), Diani",
};

export default function AirportRequestForm() {
  const [direction, setDirection] = useState<"from" | "to">("from");
  const [error, setError] = useState("");
  const fromAirport = direction === "from";

  function requestTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const airport = AIRPORTS[String(form.get("airport")) as keyof typeof AIRPORTS];
    const address = String(form.get("address") ?? "").trim();
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    if (!airport || !address) {
      setError("Choose an airport and enter a hotel or address.");
      return;
    }
    const pickupTime = new Date(`${date}T${time}:00+03:00`);
    if (!Number.isFinite(pickupTime.getTime()) || pickupTime.getTime() <= Date.now()) {
      setError("Choose a pickup date and time in the future, using Kenya time.");
      return;
    }
    setError("");
    const flight = String(form.get("flight") ?? "").trim();
    const bags = String(form.get("bags") ?? "").trim();
    const message = [
      "Hello Mi-Reli, I’d like to request a private airport transfer.",
      `Pickup: ${fromAirport ? airport : address}`,
      `Drop-off: ${fromAirport ? address : airport}`,
      `Pickup date and time: ${date} at ${time} EAT`,
      `Passengers: ${form.get("passengers")}`,
      ...(flight ? [`Flight: ${flight}`] : []),
      ...(bags ? [`Luggage: ${bags}`] : []),
      "Please confirm availability and the total fare.",
    ].join("\n");
    window.location.assign(`https://wa.me/${MIRELI_SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`);
  }

  const input = "mt-1 block h-11 min-w-0 w-full rounded-lg border border-input bg-background px-3 text-base";

  return (
    <form onSubmit={requestTransfer} onChange={() => { if (error) setError(""); }} className="grid min-w-0 gap-4 rounded-3xl border bg-card p-5 sm:p-6">
      <h2 className="text-xl font-semibold">Request a transfer</h2>
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
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="min-h-11 w-full bg-[#176548] text-white hover:bg-[#124c38]">
        <MessageCircle aria-hidden="true" className="size-4" /> Continue on WhatsApp
      </Button>
      <p className="text-sm leading-relaxed text-muted-foreground">Send the prefilled message so Mi-Reli can confirm your fare and cab availability.</p>
    </form>
  );
}
