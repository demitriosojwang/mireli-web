import { NextResponse } from "next/server";
import { getEligibleDriverIds } from "@/lib/driver/availability";

/** Public boolean only; driver identities and personal data never leave the backend. */
export async function GET() {
  try {
    const eligibleDriverIds = await getEligibleDriverIds();
    return NextResponse.json({ hasEligibleDrivers: eligibleDriverIds.length > 0 });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
    console.error("driver supply check failed", { code });
    return NextResponse.json({ error: "Driver availability is temporarily unavailable." }, { status: 503 });
  }
}
