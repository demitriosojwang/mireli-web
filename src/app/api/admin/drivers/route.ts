import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { INVALID_B2C_NUMBERS } from "@/lib/daraja";

/** Drivers — the admin manages anything to do with drivers (CRUD + payouts view). */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const drivers = await db.driver.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      trips: { where: { status: "completed" }, select: { id: true } },
      payouts: { orderBy: { initiatedAt: "desc" } },
      application: { select: { status: true } },
    },
  });

  return NextResponse.json({
    drivers: drivers.map((d) => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      mpesaNumber: d.mpesaNumber,
      mpesaAtRisk: INVALID_B2C_NUMBERS.has(d.mpesaNumber),
      plate: d.plate,
      cabType: d.cabType,
      capacity: d.capacity,
      status: d.status,
      // Verified = compliance approved the onboarding application (blue check).
      verified: d.application?.status === "approved",
      rating: d.rating,
      completedTrips: d.trips.length,
      earnings: {
        lifetimeGross: d.payouts.filter((p) => p.status !== "failed").reduce((s, p) => s + p.grossFareTotal, 0),
        queued: d.payouts.filter((p) => p.status === "queued").reduce((s, p) => s + p.netPayoutAmount, 0),
        paid: d.payouts.filter((p) => p.status === "completed" && p.settlementVerified).reduce((s, p) => s + p.netPayoutAmount, 0),
        failed: d.payouts.filter((p) => p.status === "failed").reduce((s, p) => s + p.netPayoutAmount, 0),
      },
      recentPayouts: d.payouts.slice(0, 5).map((p) => ({
        id: p.id,
        gross: p.grossFareTotal,
        commission: p.commissionAmount,
        net: p.netPayoutAmount,
        status: p.status==="completed"&&!p.settlementVerified?"needs_review":p.status,
        result: p.mpesaResultCode,
        initiatedAt: p.initiatedAt,
      })),
    })),
  });
}

/** Create a driver. */
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const mpesaNumber = String(body.mpesaNumber || phone).trim();
  const plate = String(body.plate || "").trim();
  const cabType = String(body.cabType || "14-seater matatu").trim();
  const capacity = Math.max(1, Math.min(parseInt(body.capacity, 10) || 13, 30));
  if (!name || name.length < 2) return NextResponse.json({ error: "Driver name required" }, { status: 400 });
  if (!/^\+254[17]\d{8}$/.test(phone)) return NextResponse.json({ error: "Phone must be a Kenyan number e.g. +254712345678" }, { status: 400 });
  if (!plate) return NextResponse.json({ error: "Vehicle plate required" }, { status: 400 });

  const exists = await db.driver.findUnique({ where: { phone } });
  if (exists) return NextResponse.json({ error: "A driver with that phone already exists" }, { status: 400 });

  const driver = await db.driver.create({
    data: { name, phone, mpesaNumber, plate, cabType, capacity },
  });
  await audit({
    actorId: session.id,
    actorName: session.name,
    actorRole: "admin",
    action: "driver.create",
    entity: "driver",
    entityId: driver.id,
    metadata: { name, phone, plate },
  });
  return NextResponse.json({ ok: true, driver });
}
