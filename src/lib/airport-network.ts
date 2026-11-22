/** Idempotent provisioning of the airport shuttle network: one Route per
 *  airport + direction (serviceKind "airport_shuttle") and one
 *  AirportShuttleSlot per catalogue departure. Safe to call on every tick;
 *  it only creates what is missing and never mutates existing rows. */
import { db } from "@/lib/db";
import { AIRPORT_DESTINATIONS, AIRPORT_SHUTTLE_SLOTS } from "@/lib/airport-catalogue";

let provisioned = false;

export async function provisionAirportNetwork(): Promise<void> {
  if (provisioned) return;
  provisioned = true;
  try {
    const existingSlots = await db.airportShuttleSlot.findMany({ select: { airportCode: true, direction: true, departTime: true } });
    const slotKey = (slot: { airportCode: string; direction: string; departTime: string }) =>
      `${slot.airportCode}:${slot.direction}:${slot.departTime}`;
    const existingKeys = new Set(existingSlots.map(slotKey));
    const missingSlots = AIRPORT_SHUTTLE_SLOTS.filter((slot) => !existingKeys.has(slotKey(slot)));
    if (missingSlots.length) {
      await db.airportShuttleSlot.createMany({
        data: missingSlots.map((slot) => ({
          airportCode: slot.airportCode,
          airportName: AIRPORT_DESTINATIONS.find((airport) => airport.code === slot.airportCode)?.name ?? slot.airportCode,
          direction: slot.direction,
          departTime: slot.departTime,
        })),
      });
    }

    const existingRoutes = await db.route.findMany({
      where: { serviceKind: "airport_shuttle" },
      select: { id: true, name: true },
    });
    // Retire any earlier airport routes whose names predate the machine-readable
    // naming contract (they can never match a slot and only add clutter).
    const legacyRoutes = existingRoutes.filter((route) => !/\[(MBA|UKA|MYD|LAU|VPG)\].*(FROM_AIRPORT|TO_AIRPORT)/.test(route.name));
    if (legacyRoutes.length) {
      await db.route.updateMany({
        where: { id: { in: legacyRoutes.map((route) => route.id) } },
        data: { active: false },
      });
    }
    const existingRouteNames = new Set(existingRoutes.map((route) => route.name));
    const missingRoutes = AIRPORT_DESTINATIONS.flatMap((airport) =>
      (["FROM_AIRPORT", "TO_AIRPORT"] as const).map((direction) => {
        // The scheduler matches routes to slots by the literal tokens in the
        // name: `[<CODE>]` and the direction. Keep both in the display name.
        const name = `[${airport.code}] ${airport.name} | ${direction}`;
        if (existingRouteNames.has(name)) return null;
        return db.route.create({
          data: {
            name,
            durationMinutes: airport.durationMinutes,
            charterPrice: 0, // charter pricing is computed from stage fare + seats, not the legacy field
            serviceKind: "airport_shuttle",
            stages: {
              create: [
                {
                  name: direction === "FROM_AIRPORT" ? airport.name : "Mombasa Terminus (Miritini)",
                  order: 0,
                  lat: direction === "FROM_AIRPORT" ? airport.lat : -4.009,
                  lng: direction === "FROM_AIRPORT" ? airport.lng : 39.601,
                  fare: 0,
                  homeSurcharge: 0,
                },
                {
                  name: direction === "FROM_AIRPORT" ? "Mombasa Terminus (Miritini)" : airport.name,
                  order: 1,
                  lat: direction === "FROM_AIRPORT" ? -4.009 : airport.lat,
                  lng: direction === "FROM_AIRPORT" ? 39.601 : airport.lng,
                  fare: airport.fare,
                  homeSurcharge: airport.homeSurcharge,
                },
              ],
            },
          },
        });
      }).filter(Boolean),
    );
    await Promise.all(missingRoutes);
  } catch (error) {
    // Provisioning is best-effort: a transient database hiccup must not take
    // down the scheduler. Reset the latch so the next tick retries.
    provisioned = false;
    throw error;
  }
}
