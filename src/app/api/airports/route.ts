import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AIRPORT_DESTINATIONS, AIRPORT_SHUTTLE_SLOTS } from "@/lib/airport-catalogue";

/** Public airport destinations catalogue: the five coastal airports and the
 *  fixed daily shuttle slots that anchor driver-assigned trips. */
export async function GET() {
  try {
    const [slots, routes] = await Promise.all([
      db.airportShuttleSlot.findMany({
        where: { active: true },
        orderBy: [{ airportCode: "asc" }, { departTime: "asc" }],
      }),
      db.route.findMany({
        where: { serviceKind: "airport_shuttle", active: true },
        select: {
          id: true,
          name: true,
          stages: {
            where: { order: { gt: 0 } },
            orderBy: { order: "asc" },
            take: 1,
            select: { id: true, name: true, order: true, fare: true, homeSurcharge: true },
          },
        },
      }),
    ]);

    const airportRows = AIRPORT_DESTINATIONS.map((airport) => {
      const journey = (direction: "FROM_AIRPORT" | "TO_AIRPORT") => {
        const route = routes.find((candidate) =>
          candidate.name.includes(`[${airport.code}]`) && candidate.name.includes(direction),
        );
        const stage = route?.stages[0];
        return route && stage ? {
          routeId: route.id,
          stage: { id: stage.id, name: stage.name, order: stage.order, fare: stage.fare, homeSurcharge: stage.homeSurcharge },
        } : null;
      };
      const fromAirport = journey("FROM_AIRPORT");
      const toAirport = journey("TO_AIRPORT");
      return {
        code: airport.code,
        name: airport.name,
        durationMinutes: airport.durationMinutes,
        fare: fromAirport?.stage.fare ?? toAirport?.stage.fare ?? airport.fare,
        homeSurcharge: airport.homeSurcharge,
        journeys: { FROM_AIRPORT: fromAirport, TO_AIRPORT: toAirport },
        slots: slots
          .filter((slot) => slot.airportCode === airport.code)
          .map((slot) => ({ id: slot.id, direction: slot.direction, departTime: slot.departTime })),
      };
    });
    return NextResponse.json({
      airports: airportRows,
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
        journeys: { FROM_AIRPORT: null, TO_AIRPORT: null },
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
