import { getApprovedStageFare } from "@/lib/fare-catalogue";
import { vehicleCategoryFromCabType, type VehicleCategory } from "@/lib/vehicle-types";
import { calculateBookingFeeAmount } from "@/lib/pricing";

export const PER_RIDE_BOOKING_FEE = 100;

type BikeFare = { name: string; fare: number; aliases?: string[] };

/** Owner-supplied per-ride fares, including motorbike and tuk-tuk rides. */
export const APPROVED_MOTORBIKE_FARES: BikeFare[] = [
  { name: "Kiembeni Mwisho", fare: 1000 },
  { name: "Kiembeni Police", fare: 1000 },
  { name: "Ananda Marga", fare: 1000 },
  { name: "San Sera", fare: 1000 },
  { name: "Green Estate", fare: 1000 },
  { name: "Kona Kiembeni", fare: 1000, aliases: ["Kora Kiembeni"] },
  { name: "Bamburi Mwisho", fare: 1000 },
  { name: "Bamburi Naivas", fare: 1000 },
  { name: "Total Bamburi", fare: 1000 },
  { name: "Bamburi Fisheries", fare: 1000, aliases: ["Fisheries"] },
  { name: "Mwembeni", fare: 1000, aliases: ["Mwambeni"] },
  { name: "JCC Junction", fare: 1000, aliases: ["ICC Junction"] },
  { name: "Nyali Centre", fare: 1000 },
  { name: "VOK", fare: 1000 },
  { name: "Bombolulu", fare: 1000, aliases: ["Bambolulu"] },
  { name: "Lights", fare: 1000 },
  { name: "Mtwapa", fare: 1500 },
  { name: "Malindi", fare: 2500 },
  { name: "Changamwe", fare: 400 },
  { name: "Mikindani", fare: 400 },
  { name: "Miritini", fare: 350 },
  { name: "Town (CBD) / Mwembe Tayari", fare: 500, aliases: ["Town CBD", "Mwembe Tayari"] },
  { name: "Likoni Ferry Container", fare: 800 },
  { name: "Kona Mpya (Fayaz)", fare: 800 },
  { name: "Shika Adabu (Checkpoint)", fare: 800 },
  { name: "Diani Naivas", fare: 1400 },
];

export const APPROVED_TUKTUK_FARES: BikeFare[] = [
  { name: "Kiembeni Mwisho", fare: 1500 },
  { name: "Kiembeni Police", fare: 1500 },
  { name: "Ananda Marga", fare: 1500 },
  { name: "San Sera", fare: 1500 },
  { name: "Green Estate", fare: 1500 },
  { name: "Kona Kiembeni", fare: 1500, aliases: ["Kora Kiembeni"] },
  { name: "Bamburi Mwisho", fare: 1500 },
  { name: "Bamburi Naivas", fare: 1500 },
  { name: "Total Bamburi", fare: 1500 },
  { name: "Bamburi Fisheries", fare: 1500, aliases: ["Fisheries"] },
  { name: "Mwembeni", fare: 1500, aliases: ["Mwambeni"] },
  { name: "JCC Junction", fare: 1500, aliases: ["ICC Junction"] },
  { name: "Nyali Centre", fare: 1500 },
  { name: "VOK", fare: 1500 },
  { name: "Bombolulu", fare: 1500, aliases: ["Bambolulu"] },
  { name: "Lights", fare: 1500 },
  { name: "Mtwapa", fare: 2000 },
  { name: "Malindi", fare: 3500 },
  { name: "Changamwe", fare: 900 },
  { name: "Mikindani", fare: 900 },
  { name: "Miritini", fare: 900 },
  { name: "Town (CBD) / Mwembe Tayari", fare: 900, aliases: ["Town CBD", "Mwembe Tayari"] },
  { name: "Likoni Ferry Container", fare: 1500 },
  { name: "Kona Mpya (Fayaz)", fare: 1500 },
  { name: "Shika Adabu (Checkpoint)", fare: 1500 },
  { name: "Diani Naivas", fare: 2000 },
];

function normalizeStageName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function createStageFareMap(rows: BikeFare[]): Map<string, number> {
  const fares = new Map<string, number>();
  for (const row of rows) {
    fares.set(normalizeStageName(row.name), row.fare);
    for (const alias of row.aliases ?? []) fares.set(normalizeStageName(alias), row.fare);
  }
  return fares;
}

const motorbikeFareByStage = createStageFareMap(APPROVED_MOTORBIKE_FARES);
const tuktukFareByStage = createStageFareMap(APPROVED_TUKTUK_FARES);

export function getApprovedMotorbikeFare(stageName: string): number | null {
  return motorbikeFareByStage.get(normalizeStageName(stageName)) ?? null;
}

export function getApprovedTuktukFare(stageName: string): number | null {
  return tuktukFareByStage.get(normalizeStageName(stageName)) ?? null;
}

export function isPerRideVehicle(category: VehicleCategory): boolean {
  return category === "motorbike" || category === "tuk-tuk";
}

/**
 * Returns a fare only when the owner-provided schedule covers this vehicle.
 * Airport shuttle fares come from their own published airport route.
 */
export function getStageFareForVehicle(params: {
  stageName: string;
  cabType: string | null | undefined;
  capacity: number;
  fallbackFare: number;
  airportShuttle?: boolean;
}): number | null {
  if (params.airportShuttle) return params.fallbackFare;
  const category = vehicleCategoryFromCabType(params.cabType);
  if (category === "motorbike") return getApprovedMotorbikeFare(params.stageName);
  if (category === "tuk-tuk") return getApprovedTuktukFare(params.stageName);
  if (category === "other") return null;
  const approvedFare = getApprovedStageFare(params.stageName) ?? params.fallbackFare;
  if (params.capacity === 10 || params.capacity === 11) return approvedFare > 50 ? approvedFare - 50 : null;
  if (params.capacity !== 4 && params.capacity !== 7) return null;
  return approvedFare;
}

export function bookingFeePerUnit(category: VehicleCategory, configuredPerSeatFee: number): number {
  return isPerRideVehicle(category) ? PER_RIDE_BOOKING_FEE : configuredPerSeatFee;
}

export function bookingFeeUnits(category: VehicleCategory, seats: number, charter: boolean): number {
  return charter || isPerRideVehicle(category) ? 1 : seats;
}

export function calculateVehicleBookingFee(params: {
  cabType: string | null | undefined;
  configuredPerSeatFee: number;
  seats: number;
  charter: boolean;
}): number {
  const category = vehicleCategoryFromCabType(params.cabType);
  return calculateBookingFeeAmount(
    bookingFeePerUnit(category, params.configuredPerSeatFee),
    bookingFeeUnits(category, params.seats, params.charter),
    params.charter,
  );
}
