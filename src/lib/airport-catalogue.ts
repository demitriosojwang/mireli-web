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

/** Fixed daily shuttle slots per airport and direction. Times are Kenya time.
 *  FROM_AIRPORT meets arrivals; TO_AIRPORT serves departures with enough lead
 *  to clear check-in. */
export const AIRPORT_SHUTTLE_SLOTS: Array<{
  airportCode: AirportCode;
  direction: "FROM_AIRPORT" | "TO_AIRPORT";
  departTime: string;
}> = [
  // Moi International — the high-frequency hub.
  { airportCode: "MBA", direction: "FROM_AIRPORT", departTime: "06:30" },
  { airportCode: "MBA", direction: "FROM_AIRPORT", departTime: "09:30" },
  { airportCode: "MBA", direction: "FROM_AIRPORT", departTime: "12:30" },
  { airportCode: "MBA", direction: "FROM_AIRPORT", departTime: "15:30" },
  { airportCode: "MBA", direction: "FROM_AIRPORT", departTime: "18:30" },
  { airportCode: "MBA", direction: "TO_AIRPORT", departTime: "05:00" },
  { airportCode: "MBA", direction: "TO_AIRPORT", departTime: "08:00" },
  { airportCode: "MBA", direction: "TO_AIRPORT", departTime: "11:00" },
  { airportCode: "MBA", direction: "TO_AIRPORT", departTime: "14:00" },
  { airportCode: "MBA", direction: "TO_AIRPORT", departTime: "17:00" },
  // Ukunda / Diani.
  { airportCode: "UKA", direction: "FROM_AIRPORT", departTime: "08:30" },
  { airportCode: "UKA", direction: "FROM_AIRPORT", departTime: "16:30" },
  { airportCode: "UKA", direction: "TO_AIRPORT", departTime: "06:00" },
  { airportCode: "UKA", direction: "TO_AIRPORT", departTime: "14:00" },
  // Malindi.
  { airportCode: "MYD", direction: "FROM_AIRPORT", departTime: "09:00" },
  { airportCode: "MYD", direction: "FROM_AIRPORT", departTime: "17:00" },
  { airportCode: "MYD", direction: "TO_AIRPORT", departTime: "05:30" },
  { airportCode: "MYD", direction: "TO_AIRPORT", departTime: "13:30" },
  // Lamu (Manda).
  { airportCode: "LAU", direction: "FROM_AIRPORT", departTime: "10:00" },
  { airportCode: "LAU", direction: "TO_AIRPORT", departTime: "04:30" },
  // Vipingo Ridge.
  { airportCode: "VPG", direction: "FROM_AIRPORT", departTime: "08:00" },
  { airportCode: "VPG", direction: "FROM_AIRPORT", departTime: "15:00" },
  { airportCode: "VPG", direction: "TO_AIRPORT", departTime: "05:30" },
  { airportCode: "VPG", direction: "TO_AIRPORT", departTime: "12:30" },
];

export const AIRPORT_DIRECTIONS = ["FROM_AIRPORT", "TO_AIRPORT"] as const;
export type AirportDirection = (typeof AIRPORT_DIRECTIONS)[number];
