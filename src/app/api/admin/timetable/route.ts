import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";

type TrainInput = {
  name: string;
  direction: "MBA_TO_NBO" | "NBO_TO_MBA";
  originCode: "MTM" | "NTM";
  destCode: "MTM" | "NTM";
  originTime: string;
  destTime: string;
  destDayOffset: number;
  serviceDays: number[];
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length >= 2 && result.length <= max ? result : null;
}

function time(value: unknown): string | null {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function weekdays(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 7) return null;
  if (value.some((day) => typeof day !== "number" || !Number.isSafeInteger(day) || day < 0 || day > 6)) return null;
  const result = [...new Set(value as number[])].sort((a, b) => a - b);
  return result.length === value.length ? result : null;
}

function trainInput(body: Record<string, unknown>): TrainInput | null {
  const name = text(body.name, 60);
  const direction = body.direction;
  const originTime = time(body.originTime);
  const destTime = time(body.destTime);
  const destDayOffset = body.destDayOffset;
  const serviceDays = weekdays(body.serviceDays);
  if (!name || (direction !== "MBA_TO_NBO" && direction !== "NBO_TO_MBA") || !originTime || !destTime ||
      typeof destDayOffset !== "number" || !Number.isSafeInteger(destDayOffset) || ![0, 1].includes(destDayOffset) || !serviceDays) return null;
  const originMinutes = Number(originTime.slice(0, 2)) * 60 + Number(originTime.slice(3));
  const destMinutes = Number(destTime.slice(0, 2)) * 60 + Number(destTime.slice(3));
  if ((destDayOffset === 0 && destMinutes <= originMinutes) || (destDayOffset === 1 && destMinutes >= originMinutes)) return null;

  const outboundFromMombasa = direction === "MBA_TO_NBO";
  return {
    name,
    direction,
    originCode: outboundFromMombasa ? "MTM" : "NTM",
    destCode: outboundFromMombasa ? "NTM" : "MTM",
    originTime,
    destTime,
    destDayOffset,
    serviceDays,
  };
}

function isValidTrainRecord(train: {
  name: string;
  direction: string;
  originCode: string;
  destCode: string;
  originTime: string;
  destTime: string;
  destDayOffset: number;
  serviceDays: number[];
}) {
  const normalized = trainInput({
    name: train.name,
    direction: train.direction,
    originTime: train.originTime,
    destTime: train.destTime,
    destDayOffset: train.destDayOffset,
    serviceDays: train.serviceDays,
  });
  return !!normalized && normalized.originCode === train.originCode && normalized.destCode === train.destCode;
}

function logDatabaseError(operation: string, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
  console.error(`admin timetable ${operation} failed`, { code });
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
    const trains = await db.train.findMany({
      orderBy: [{ direction: "asc" }, { originTime: "asc" }, { name: "asc" }],
      include: { _count: { select: { trips: true } } },
    });
    return NextResponse.json({
      trains: trains.map((train) => ({
        id: train.id,
        name: train.name,
        direction: train.direction,
        originCode: train.originCode,
        destCode: train.destCode,
        originTime: train.originTime,
        destTime: train.destTime,
        destDayOffset: train.destDayOffset,
        serviceDays: train.serviceDays,
        active: train.active,
        linkedTrips: train._count.trips,
      })),
    });
  } catch (error) {
    logDatabaseError("list", error);
    return NextResponse.json({ error: "Timetable is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });
  if (body.action !== "create_train") return NextResponse.json({ error: "Unknown timetable action." }, { status: 400 });

  const train = trainInput(body);
  if (!train) return NextResponse.json({ error: "Enter a train, direction, valid 24-hour times, and a destination-day offset of 0 or 1." }, { status: 400 });
  try {
    const duplicate = await db.train.findFirst({
      where: { direction: train.direction, name: { equals: train.name, mode: "insensitive" }, originTime: train.originTime },
      select: { id: true },
    });
    if (duplicate) return NextResponse.json({ error: "That train and departure time already exist." }, { status: 409 });
    const created = await db.train.create({
      data: { ...train, active: false },
      select: { id: true, name: true, direction: true, originCode: true, destCode: true, originTime: true, destTime: true, destDayOffset: true, serviceDays: true, active: true },
    });
    await audit({
      actorId: session.id, actorName: session.name, actorRole: "admin",
      action: "timetable.train.create", entity: "train", entityId: created.id,
      metadata: { ...train, active: false },
    });
    return NextResponse.json({ train: created }, { status: 201 });
  } catch (error) {
    logDatabaseError("create train", error);
    return NextResponse.json({ error: "Could not create the timetable entry." }, { status: 503 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });
  const trainId = text(body.trainId, 64);
  if (!trainId) return NextResponse.json({ error: "Choose a train." }, { status: 400 });

  if (body.action === "set_train_active") {
    if (typeof body.active !== "boolean") return NextResponse.json({ error: "Choose a valid timetable publication state." }, { status: 400 });
    try {
      const existing = await db.train.findUnique({
        where: { id: trainId },
        select: { id: true, active: true, name: true, direction: true, originCode: true, destCode: true, originTime: true, destTime: true, destDayOffset: true, serviceDays: true },
      });
      if (!existing) return NextResponse.json({ error: "Train not found." }, { status: 404 });
      if (body.active && !isValidTrainRecord(existing)) {
        return NextResponse.json({ error: "This timetable entry has invalid route codes or times and cannot be published." }, { status: 409 });
      }
      const updated = await db.train.update({ where: { id: trainId }, data: { active: body.active }, select: { id: true, name: true, active: true } });
      await audit({
        actorId: session.id, actorName: session.name, actorRole: "admin",
        action: body.active ? "timetable.train.publish" : "timetable.train.unpublish",
        entity: "train", entityId: trainId,
        metadata: { active: body.active, name: existing.name },
      });
      return NextResponse.json({ train: updated });
    } catch (error) {
      logDatabaseError("publish train", error);
      return NextResponse.json({ error: "Could not update timetable publication." }, { status: 503 });
    }
  }

  if (body.action === "update_train") {
    const train = trainInput(body);
    if (!train) return NextResponse.json({ error: "Enter a train, direction, valid 24-hour times, and a destination-day offset of 0 or 1." }, { status: 400 });
    try {
      const existing = await db.train.findUnique({ where: { id: trainId }, select: { id: true, active: true } });
      if (!existing) return NextResponse.json({ error: "Train not found." }, { status: 404 });
      if (existing.active) return NextResponse.json({ error: "Pause this timetable entry before editing it." }, { status: 409 });
      const linkedTrips = await db.trip.count({ where: { trainId } });
      if (linkedTrips > 0) return NextResponse.json({ error: "This entry is part of trip history and is read-only. Add a corrected timetable entry instead." }, { status: 409 });
      const duplicate = await db.train.findFirst({
        where: { id: { not: trainId }, direction: train.direction, name: { equals: train.name, mode: "insensitive" }, originTime: train.originTime },
        select: { id: true },
      });
      if (duplicate) return NextResponse.json({ error: "That train and departure time already exist." }, { status: 409 });
      const updated = await db.train.update({ where: { id: trainId }, data: train, select: { id: true, name: true, direction: true, originCode: true, destCode: true, originTime: true, destTime: true, destDayOffset: true, serviceDays: true, active: true } });
      await audit({
        actorId: session.id, actorName: session.name, actorRole: "admin",
        action: "timetable.train.update", entity: "train", entityId: trainId,
        metadata: train,
      });
      return NextResponse.json({ train: updated });
    } catch (error) {
      logDatabaseError("update train", error);
      return NextResponse.json({ error: "Could not update the timetable entry." }, { status: 503 });
    }
  }

  return NextResponse.json({ error: "Unknown timetable action." }, { status: 400 });
}
