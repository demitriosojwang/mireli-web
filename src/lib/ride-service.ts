import type { Prisma } from "@prisma/client";

export const RIDE_SERVICES = ["sgr", "airport", "both"] as const;
export const SGR_SERVICES = ["sgr", "both"];
export const AIRPORT_SERVICES = ["airport", "both"];
const AIRPORT_LEAD_MS = 30 * 60_000;
const AIRPORT_DURATION_MS = 4 * 60 * 60_000;

/** Called with the driver's row locked by the shared dispatch paths. */
export async function airportConflict(tx: Prisma.TransactionClient, driverId: string, start: Date, end: Date, exceptId?: string) {
  return Boolean(await tx.airportTransfer.findFirst({
    where: {
      driverId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      OR: [
        { status: "in_progress" },
        {
          pickupAt: { gt: new Date(start.getTime() - AIRPORT_DURATION_MS), lt: new Date(end.getTime() + AIRPORT_LEAD_MS) },
          status: "confirmed",
        },
      ],
    },
    select: { id: true },
  }));
}

export function airportWindow(pickup: Date) {
  return {
    start: new Date(pickup.getTime() - AIRPORT_LEAD_MS),
    end: new Date(pickup.getTime() + AIRPORT_DURATION_MS),
  };
}
