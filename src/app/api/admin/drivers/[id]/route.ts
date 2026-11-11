import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { casUpdateMany, DRIVER_MACHINE } from "@/lib/state-machines";

type Params = { params: Promise<{ id: string }> };

/** Update a driver (details, M-Pesa number, status). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const driver = await db.driver.findUnique({ where: { id } });
  if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (body.name) data.name = String(body.name).trim().slice(0, 80);
  if (body.mpesaNumber) data.mpesaNumber = String(body.mpesaNumber).trim();
  if (body.plate) data.plate = String(body.plate).trim().slice(0, 20);
  if (body.cabType) data.cabType = String(body.cabType).trim().slice(0, 40);
  if (body.capacity) data.capacity = Math.max(1, Math.min(parseInt(body.capacity, 10) || 13, 30));
  if (body.status && ["active", "inactive", "suspended"].includes(body.status)) data.status = body.status;

  const updated = await db.driver.update({ where: { id }, data });
  await audit({
    actorId: session.id,
    actorName: session.name,
    actorRole: "admin",
    action: "driver.update",
    entity: "driver",
    entityId: id,
    metadata: data,
  });
  return NextResponse.json({ ok: true, driver: updated });
}

/** Remove a driver (soft: only if no trips reference them — otherwise suspend). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const tripCount = await db.trip.count({ where: { driverId: id } });
  if (tripCount > 0) {
    const deactivated = await casUpdateMany(
      "driver",
      { id },
      DRIVER_MACHINE,
      ["active", "suspended"],
      "inactive",
    );
    if (deactivated === 0) {
      return NextResponse.json({ ok: true, deactivated: false, message: "Driver already inactive." });
    }
    await audit({
      actorId: session.id,
      actorName: session.name,
      actorRole: "admin",
      action: "driver.deactivated",
      entity: "driver",
      entityId: id,
      metadata: { reason: "has trip history — deactivated instead of deleted" },
    });
    return NextResponse.json({ ok: true, deactivated: true, message: "Driver has trip history — deactivated instead." });
  }
  await db.driver.delete({ where: { id } });
  await audit({
    actorId: session.id,
    actorName: session.name,
    actorRole: "admin",
    action: "driver.delete",
    entity: "driver",
    entityId: id,
  });
  return NextResponse.json({ ok: true, deleted: true });
}
