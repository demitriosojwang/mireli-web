import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MAX_STAGE_SEARCH_LENGTH, isStageSearchReady } from "@/lib/stage-search";

const SEARCH_LIMIT = 12;

/** Search active route stops on demand instead of sending the whole network to every customer. */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length > MAX_STAGE_SEARCH_LENGTH) {
    return NextResponse.json({ error: "Point search is too long." }, { status: 400 });
  }
  if (!isStageSearchReady(query)) {
    return NextResponse.json({ points: [], hasMore: false });
  }

  try {
    const matches = await db.routeStage.findMany({
      where: {
        order: { gt: 0 },
        route: { is: { active: true } },
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { route: { is: { name: { contains: query, mode: "insensitive" } } } },
        ],
      },
      orderBy: [{ name: "asc" }, { routeId: "asc" }, { order: "asc" }],
      take: SEARCH_LIMIT + 1,
      select: {
        id: true,
        name: true,
        order: true,
        fare: true,
        homeSurcharge: true,
        routeId: true,
        route: {
          select: { id: true, name: true, charterPrice: true },
        },
      },
    });

    return NextResponse.json({
      points: matches.slice(0, SEARCH_LIMIT),
      hasMore: matches.length > SEARCH_LIMIT,
    });
  } catch {
    return NextResponse.json({ error: "Point search is temporarily unavailable." }, { status: 503 });
  }
}

