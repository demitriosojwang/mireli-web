/** Airport shuttle destinations — the Kenyan coastal airports Mi-Reli serves.
 *  Each airport is a destination whose shuttle slots anchor driver-assigned
 *  trips through the same scheduler used for SGR feeder shuttles. */

export type AirportCode = "MBA" | "UKA" | "MYD" | "LAU" | "VPG";

export interface AirportDestination {
  code: AirportCode;
  name: string;
  /** Shuttle travel time between Mombasa Terminus (Miritini) and the airport. */
  durationMinutes: number;
  /** Per-seat shared shuttle fare from the terminus (KSh). */
  fare: number;
  /** Door pickup surcharge per seat (KSh) — passes to the driver in full. */
  homeSurcharge: number;
  lat: number;
  lng: number;
}

/** The five coastal airports from the service map: Moi International (Mombasa),
 *  Diani/Ukunda, Malindi, Manda (Lamu), and Vipingo Ridge. */
export const AIRPORT_DESTINATIONS: AirportDestination[] = [
  {
    code: "MBA",
    name: "Moi International Airport (Mombasa)",
    durationMinutes: 25,
    fare: 500,
    homeSurcharge: 100,
    lat: -4.0348,
    lng: 39.5942,
  },
  {
    code: "UKA",
    name: "Diani/Ukunda Airport",
    durationMinutes: 75,
    fare: 800,
    homeSurcharge: 150,
    lat: -4.2855,
    lng: 39.5860,
  },
  {
    code: "MYD",
    name: "Malindi International Airport",
    durationMinutes: 120,
    fare: 900,
    homeSurcharge: 150,
    lat: -3.2279,
    lng: 40.1019,
  },
  {
    code: "LAU",
    name: "Manda Airport (Lamu)",
    durationMinutes: 180,
    fare: 1200,
    homeSurcharge: 200,
    lat: -2.2585,
    lng: 40.9019,
  },
  {
    code: "VPG",
    name: "Vipingo Ridge Airport",
    durationMinutes: 55,
    fare: 600,
    homeSurcharge: 100,
    lat: -3.8102,
    lng: 39.8569,
  },
];

export function getAirportByCode(code: string): AirportDestination | null {
  return AIRPORT_DESTINATIONS.find((airport) => airport.code === code) ?? null;
}
