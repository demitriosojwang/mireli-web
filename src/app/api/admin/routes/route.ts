import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getApprovedStageFare } from "@/lib/fare-catalogue";
import { getAdminSession } from "@/lib/session";

type RouteStageInput = {
  name: string;
  lat: number;
  lng: number;
  fare: number;
  homeSurcharge: number;
};

function stringField(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 2 && normalized.length <= max ? normalized : null;
}
function integerField(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function coordinateField(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function stageInput(body: Record<string, unknown>): RouteStageInput | null {
  const name = stringField(body.name, 100);
  const lat = coordinateField(body.lat, -90, 90);
  const lng = coordinateField(body.lng, -180, 180);
  const fare = integerField(body.fare, 1, 100_000);
  const homeSurcharge = integerField(body.homeSurcharge, 0, 50_000);
  if (!name || lat === null || lng === null || fare === null || homeSurcharge === null) return null;
  return { name, lat, lng, fare, homeSurcharge };
}

function validForPublication(stages: Array<{
  order: number;
  lat: number;
  lng: number;
  fare: number;
  homeSurcharge: number;
}>) {
  const stops = stages.filter((stage) => stage.order > 0).sort((a, b) => a.order - b.order);
  return stages.every((stage) => Number.isSafeInteger(stage.order) && stage.order >= 0) &&
    stops.length > 0 && stops.every((stage, index) =>
    stage.order === index + 1 &&
    Number.isFinite(stage.lat) && stage.lat >= -90 && stage.lat <= 90 &&
    Number.isFinite(stage.lng) && stage.lng >= -180 && stage.lng <= 180 &&
    Number.isSafeInteger(stage.fare) && stage.fare > 0 &&
    Number.isSafeInteger(stage.homeSurcharge) && stage.homeSurcharge >= 0,
  );
}

function logDatabaseError(operation: string, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
  console.error(`admin route catalogue ${operation} failed`, { code });
}

async function readJsonObject(req: NextRequest): Promise<Record<string, unknown> | null> {
  const value = await req.json().catch(() => null);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const routes = await db.route.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        active: true,
        durationMinutes: true,
        stages: {
          orderBy: { order: "asc" },
          select: { id: true, name: true, order: true, lat: true, lng: true, fare: true, homeSurcharge: true },
        },
      },
    });
    return NextResponse.json({
      routes: routes.map((route) => ({
        ...route,
        stages: route.stages.map((stage) => ({
          ...stage,
          fare: getApprovedStageFare(stage.name) ?? stage.fare,
        })),
      })),
    });
  } catch (error) {
    logDatabaseError("list", error);
    return NextResponse.json({ error: "Route catalogue is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });

  if (body.action === "create_route") {
    const name = stringField(body.name, 100);
    const durationMinutes = integerField(body.durationMinutes, 1, 1_440);
    if (!name || durationMinutes === null) {
      return NextResponse.json({ error: "Enter a route name and a journey time from 1 to 1,440 minutes." }, { status: 400 });
    }
    try {
      const duplicate = await db.route.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
      if (duplicate) return NextResponse.json({ error: "A route with that name already exists." }, { status: 409 });
      const route = await db.route.create({
        data: { name, durationMinutes, charterPrice: 0, active: false },
        select: { id: true, name: true, active: true, durationMinutes: true },
      });
      await audit({
        actorId: session.id, actorName: session.name, actorRole: "admin",
        action: "route.create", entity: "route", entityId: route.id,
        metadata: { name, durationMinutes, active: false },
      });
      return NextResponse.json({ route }, { status: 201 });
    } catch (error) {
      logDatabaseError("create route", error);
      return NextResponse.json({ error: "Could not create the route." }, { status: 503 });
    }
  }

  if (body.action === "add_stage") {
    const routeId = stringField(body.routeId, 64);
    const stage = stageInput(body);
    if (!routeId || !stage) {
      return NextResponse.json({ error: "Enter a stop name, valid coordinates, a positive fare, and a non-negative surcharge." }, { status: 400 });
    }
    try {
      const route = await db.route.findUnique({ where: { id: routeId }, select: { id: true, active: true } });
      if (!route) return NextResponse.json({ error: "Route not found." }, { status: 404 });
      if (route.active) return NextResponse.json({ error: "Pause the route before editing its stops." }, { status: 409 });
      const duplicate = await db.routeStage.findFirst({
        where: { routeId, name: { equals: stage.name, mode: "insensitive" } },
        select: { id: true },
      });
      if (duplicate) return NextResponse.json({ error: "That stop already exists on this route." }, { status: 409 });
      const last = await db.routeStage.findFirst({ where: { routeId }, orderBy: { order: "desc" }, select: { order: true } });
      const point = await db.routeStage.create({ data: { ...stage, routeId, order: Math.max(last?.order ?? 0, 0) + 1 } });
      await audit({
        actorId: session.id, actorName: session.name, actorRole: "admin",
        action: "route.stage.create", entity: "route_stage", entityId: point.id,
        metadata: { routeId, name: point.name, order: point.order, fare: point.fare, homeSurcharge: point.homeSurcharge },
      });
      return NextResponse.json({ point }, { status: 201 });
    } catch (error) {
      logDatabaseError("add stop", error);
      return NextResponse.json({ error: "Could not add the stop." }, { status: 503 });
    }
  }

  return NextResponse.json({ error: "Unknown route catalogue action." }, { status: 400 });
}

export async function PUT(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });

  if (body.action === "set_route_active") {
    const routeId = stringField(body.routeId, 64);
    if (!routeId || typeof body.active !== "boolean") {
      return NextResponse.json({ error: "Choose a route and a valid publication state." }, { status: 400 });
    }
    try {
      const route = await db.route.findUnique({ where: { id: routeId }, include: { stages: true } });
      if (!route) return NextResponse.json({ error: "Route not found." }, { status: 404 });
      if (body.active && !validForPublication(route.stages)) {
        return NextResponse.json({ error: "Add every stop in order with valid coordinates and fares before publishing this route." }, { status: 409 });
      }
      const updated = await db.route.update({ where: { id: routeId }, data: { active: body.active }, select: { id: true, name: true, active: true } });
      await audit({
        actorId: session.id, actorName: session.name, actorRole: "admin",
        action: body.active ? "route.publish" : "route.unpublish", entity: "route", entityId: routeId,
        metadata: { active: body.active, stageCount: route.stages.filter((stage) => stage.order > 0).length },
      });
      return NextResponse.json({ route: updated });
    } catch (error) {
      logDatabaseError("publish route", error);
      return NextResponse.json({ error: "Could not update route publication." }, { status: 503 });
    }
  }

  if (body.action === "update_route") {
    const routeId = stringField(body.routeId, 64);
    const name = stringField(body.name, 100);
    const durationMinutes = integerField(body.durationMinutes, 1, 1_440);
    if (!routeId || !name || durationMinutes === null) {
      return NextResponse.json({ error: "Enter a route name and journey time from 1 to 1,440 minutes." }, { status: 400 });
    }
    try {
      const route = await db.route.findUnique({ where: { id: routeId }, select: { id: true, active: true } });
      if (!route) return NextResponse.json({ error: "Route not found." }, { status: 404 });
      if (route.active) return NextResponse.json({ error: "Pause the route before editing it." }, { status: 409 });
      const duplicate = await db.route.findFirst({
        where: { id: { not: routeId }, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (duplicate) return NextResponse.json({ error: "A route with that name already exists." }, { status: 409 });
      const updated = await db.route.update({ where: { id: routeId }, data: { name, durationMinutes }, select: { id: true, name: true, active: true, durationMinutes: true } });
      await audit({
        actorId: session.id, actorName: session.name, actorRole: "admin",
        action: "route.update", entity: "route", entityId: routeId,
        metadata: { name, durationMinutes },
      });
      return NextResponse.json({ route: updated });
    } catch (error) {
      logDatabaseError("update route", error);
      return NextResponse.json({ error: "Could not update the route." }, { status: 503 });
    }
  }

  if (body.action === "update_stage") {
    const stageId = stringField(body.stageId, 64);
    const stage = stageInput(body);
    if (!stageId || !stage) {
      return NextResponse.json({ error: "Enter a stop name, valid coordinates, a positive fare, and a non-negative surcharge." }, { status: 400 });
    }
    try {
      const current = await db.routeStage.findUnique({ where: { id: stageId }, include: { route: { select: { active: true } } } });
      if (!current) return NextResponse.json({ error: "Stop not found." }, { status: 404 });
      if (current.route.active) return NextResponse.json({ error: "Pause the route before editing its stops." }, { status: 409 });
      const duplicate = await db.routeStage.findFirst({
        where: { id: { not: stageId }, routeId: current.routeId, name: { equals: stage.name, mode: "insensitive" } },
        select: { id: true },
      });
      if (duplicate) return NextResponse.json({ error: "That stop already exists on this route." }, { status: 409 });
      const updated = await db.routeStage.update({ where: { id: stageId }, data: stage });
      await audit({
        actorId: session.id, actorName: session.name, actorRole: "admin",
        action: "route.stage.update", entity: "route_stage", entityId: stageId,
        metadata: { routeId: current.routeId, name: stage.name, order: current.order, fare: stage.fare, homeSurcharge: stage.homeSurcharge },
      });
      return NextResponse.json({ point: updated });
    } catch (error) {
      logDatabaseError("update stop", error);
      return NextResponse.json({ error: "Could not update the stop." }, { status: 503 });
    }
  }

  if (body.action === "reorder_stages") {
    const routeId = stringField(body.routeId, 64);
    const stageIds = body.stageIds;
    if (!routeId || !Array.isArray(stageIds) || stageIds.some((id) => typeof id !== "string") || new Set(stageIds).size !== stageIds.length) {
      return NextResponse.json({ error: "Provide the complete ordered stop list for this route." }, { status: 400 });
    }
    try {
      const route = await db.route.findUnique({ where: { id: routeId }, include: { stages: { where: { order: { gt: 0 } }, orderBy: { order: "asc" } } } });
      if (!route) return NextResponse.json({ error: "Route not found." }, { status: 404 });
      if (route.active) return NextResponse.json({ error: "Pause the route before reordering its stops." }, { status: 409 });
      const existing = new Set(route.stages.map((stage) => stage.id));
      if (stageIds.length !== existing.size || stageIds.some((id) => !existing.has(id))) {
        return NextResponse.json({ error: "The stop list changed. Refresh the route and try again." }, { status: 409 });
      }
      await db.$transaction(async (tx) => {
        await Promise.all(stageIds.map((id, index) => tx.routeStage.update({ where: { id }, data: { order: index + 1 } })));
      });
      await audit({
        actorId: session.id, actorName: session.name, actorRole: "admin",
        action: "route.stages.reorder", entity: "route", entityId: routeId,
        metadata: { stageIds },
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      logDatabaseError("reorder stops", error);
      return NextResponse.json({ error: "Could not reorder the stops." }, { status: 503 });
    }
  }

  return NextResponse.json({ error: "Unknown route catalogue action." }, { status: 400 });
}
