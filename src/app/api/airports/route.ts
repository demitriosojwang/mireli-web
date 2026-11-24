import { NextResponse } from "next/server";
import { getAirportByCode } from "@/lib/airport-catalogue";

export function GET() {
  const airports = ["MBA", "UKA"].map(getAirportByCode).filter((airport) => airport !== null)
    .map(({ code, name, lat, lng }) => ({ code, name, lat, lng, slots: [] }));
  return NextResponse.json({ airports, slotCount: 0, bookingMode: "private_transfer", bookingPath: "/airport-transfers" });
}
