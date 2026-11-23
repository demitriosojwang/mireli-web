import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEligibleDriverIds } from "@/lib/driver/availability";

/** Public boolean only; driver identities and personal data never leave the backend. */
export async function GET() {
  try {
    const eligibleDriverIds = await getEligibleDriverIds();
    // Vehicle types actually registered on the platform, for the Uber/Bolt-style
    // cab-type filter on the booking page. Counts only; no driver identities.
    const cabTypeRows = await db.driver.groupBy({
      by: ["cabType"],
      where: { id: { in: eligibleDriverIds } },
      _count: { _all: true },
      orderBy: { cabType: "asc" },
    });
    return NextResponse.json({
      hasEligibleDrivers: eligibleDriverIds.length > 0,
      eligibleDriverCount: eligibleDriverIds.length,
      cabTypes: cabTypeRows.map((row) => ({ cabType: row.cabType, count: row._count._all })),
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
    console.error("driver supply check failed", { code });
    return NextResponse.json({ error: "Driver availability is temporarily unavailable." }, { status: 503 });
  }
}
