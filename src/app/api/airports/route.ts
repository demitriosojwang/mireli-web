import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AIRPORT_DESTINATIONS, AIRPORT_SHUTTLE_SLOTS } from "@/lib/airport-catalogue";

/** Public airport destinations catalogue: the five coastal airports and the
 *  fixed daily shuttle slots that anchor driver-assigned trips. */
export async function GET() {
  try {
    const slots = await db.airportShuttleSlot.findMany({
      where: { active: true },
      orderBy: [{ airportCode: "asc" }, { departTime: "asc" }],
    });
    return NextResponse.json({
      airports: AIRPORT_DESTINATIONS.map((airport) => ({
        code: airport.code,
        name: airport.name,
        durationMinutes: airport.durationMinutes,
        fare: airport.fare,
        homeSurcharge: airport.homeSurcharge,
        lat: airport.lat,
        lng: airport.lng,
        slots: slots
          .filter((slot) => slot.airportCode === airport.code)
          .map((slot) => ({ id: slot.id, direction: slot.direction, departTime: slot.departTime })),
      })),
      slotCount: slots.length,
    });
  } catch {
    // Catalogue unavailable (e.g. slots not yet seeded) — still advertise the
    // destinations so the page can render; slots appear once configured.
    return NextResponse.json({
      airports: AIRPORT_DESTINATIONS.map((airport) => ({
        code: airport.code,
        name: airport.name,
        durationMinutes: airport.durationMinutes,
        fare: airport.fare,
        homeSurcharge: airport.homeSurcharge,
        lat: airport.lat,
        lng: airport.lng,
        slots: AIRPORT_SHUTTLE_SLOTS
          .filter((slot) => slot.airportCode === airport.code)
          .map((slot, index) => ({
            id: `${airport.code}-${slot.direction}-${index}`,
            direction: slot.direction,
            departTime: slot.departTime,
          })),
      })),
      slotCount: AIRPORT_SHUTTLE_SLOTS.length,
    });
  }
}
