import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPassengerSession } from "@/lib/session";
import { PASSENGER_TERMINUS } from "@/lib/passenger-terminus";
import { passengerTrackingRoute } from "@/lib/passenger-pickup-eta";
import { isPublishedStagePin } from "@/lib/stage-pin";

type Params = { params: Promise<{ id: string }> };
const FIX_MAX_AGE_MS = 60_000;
const ACTIVE_TRIPS = ["scheduled", "locked", "departed"];
const ACTIVE_BOOKINGS = ["confirmed", "boarded"];

function response(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(req: Request, { params }: Params) {
  const session = await getPassengerSession();
  if (!session) return response({ error: "Sign in to track your ride." }, 401);
  const { id } = await params;
  const booking = await db.booking.findFirst({
    where: { id, passengerId: session.id },
    select: {
      status: true, code: true, stageId: true, routeId: true, homePickup: true, direction: true,
      trip: {
        select: {
          id: true, status: true, departureAt: true, driverId: true,
          driver: { select: { status: true } },
          driverProgress: { where: { phase: "at_pickup" }, select: { driverId: true } },
          driverPosition: { select: { driverId: true, lat: true, lng: true, bearingDeg: true, recordedAt: true } },
        },
      },
    },
  });
  if (!booking) return response({ error: "Booking not found." }, 404);

  const summary = { bookingCode: booking.code, bookingStatus: booking.status };
  const blank = { departureAt: null, pickup: null, target: null, cab: null, canEstimatePickup: false, etaSeconds: null, route: null };
  const trip = booking.trip;
  if (!ACTIVE_BOOKINGS.includes(booking.status) || (trip && !ACTIVE_TRIPS.includes(trip.status))) {
    return response({ ...summary, ...blank, phase: "unavailable" });
  }
  if (!trip?.driverId || trip.driver?.status !== "active") {
    return response({ ...summary, ...blank, phase: "no_trip" });
  }
  const fromTerminus = booking.direction === "FROM_TERMINUS";
  const approaching = booking.status === "confirmed" && !(fromTerminus && trip.status === "departed");
  const stageRow = (!fromTerminus || !approaching) && !booking.homePickup && booking.stageId
      ? await db.routeStage.findFirst({
          where: { id: booking.stageId, routeId: booking.routeId },
          select: { id: true, name: true, lat: true, lng: true },
        })
      : null;
  const stage = stageRow && isPublishedStagePin(stageRow)
    ? { name: stageRow.name, lat: stageRow.lat, lng: stageRow.lng } : null;
  const terminus = { name: PASSENGER_TERMINUS.name, lat: PASSENGER_TERMINUS.lat, lng: PASSENGER_TERMINUS.lng };
  const pickup = fromTerminus ? terminus : stage;
  const target = approaching ? pickup : fromTerminus ? stage : terminus;
  const position = trip.driverPosition;
  const fixAge = position ? Date.now() - position.recordedAt.getTime() : Infinity;
  const cab = position && position.driverId === trip.driverId && fixAge >= -15_000 && fixAge <= FIX_MAX_AGE_MS
    ? { lat: position.lat, lng: position.lng, bearingDeg: position.bearingDeg, recordedAt: position.recordedAt.toISOString() }
    : null;
  const routed = cab && target && new URL(req.url).searchParams.has("eta")
    ? await passengerTrackingRoute(trip.id, cab, target)
    : null;
  const boarding = trip.driverProgress.some(progress => progress.driverId === trip.driverId);
  return response({
    ...summary, departureAt: trip.departureAt.toISOString(), pickup, target, cab,
    etaSeconds: approaching ? routed?.durationSeconds ?? null : null,
    route: routed && routed.coordinates.length >= 2 ? routed.coordinates : null,
    canEstimatePickup: Boolean(approaching && cab && pickup),
    phase: trip.status === "departed" ? "on_the_road" : boarding ? "boarding" : "scheduled",
  });
}
