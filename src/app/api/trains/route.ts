import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** The Madaraka Express timetable Mi-Reli synchronizes with.
 *  MTM = Mombasa Terminus · NTM = Nairobi Terminus. */
export async function GET() {
  try {
    const trains = await db.train.findMany({
      where: { active: true },
      orderBy: [{ originTime: "asc" }],
    });
    return NextResponse.json({
      trains: trains.map((t) => ({
        id: t.id,
        name: t.name,
        direction: t.direction,
        originCode: t.originCode,
        destCode: t.destCode,
        originTime: t.originTime,
        destTime: t.destTime,
        destDayOffset: t.destDayOffset,
        serviceDays: t.serviceDays,
      })),
    });
  } catch {
    return NextResponse.json({ error: "The timetable is temporarily unavailable." }, { status: 503 });
  }
}
