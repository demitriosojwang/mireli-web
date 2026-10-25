import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MAX_STAGE_SEARCH_LENGTH, isStageSearchReady } from "@/lib/stage-search";
import { getApprovedStageFare } from "@/lib/fare-catalogue";

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
    const usableStop = {
      order: { gt: 0 },
      fare: { gt: 0 },
      homeSurcharge: { gte: 0 },
    } as const;
    const select = {
      id: true,
      name: true,
      order: true,
      fare: true,
      homeSurcharge: true,
      routeId: true,
      route: {
        select: { id: true, name: true, charterPrice: true },
      },
    } as const;

    // Search stop names first. Route names include area labels (for example,
    // "Mtwapa · Malindi"), so combining both fields in one OR can make a
    // precise stop query return every stop on that route and hide the match
    // behind the result cap.
    const nameMatches = await db.routeStage.findMany({
      where: {
        ...usableStop,
        route: { is: { active: true } },
        name: { contains: query, mode: "insensitive" },
      },
      orderBy: [{ route: { name: "asc" } }, { order: "asc" }, { name: "asc" }],
      take: SEARCH_LIMIT + 1,
      select,
    });

    // Keep area/route search useful when the typed phrase is not itself a
    // stop name, while still bounding its result set.
    const matches = nameMatches.length > 0 ? nameMatches : await db.routeStage.findMany({
      where: {
        ...usableStop,
        route: { is: { active: true, name: { contains: query, mode: "insensitive" } } },
      },
      orderBy: [{ route: { name: "asc" } }, { order: "asc" }, { name: "asc" }],
      take: SEARCH_LIMIT + 1,
      select,
    });

    return NextResponse.json({
      // The supplied owner-approved fare sheet is authoritative over older
      // stage rows that may still exist in a local or restored database.
      points: matches.slice(0, SEARCH_LIMIT).map((point) => ({
        ...point,
        fare: getApprovedStageFare(point.name) ?? point.fare,
      })),
      hasMore: matches.length > SEARCH_LIMIT,
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
    // Keep database failures diagnosable without logging connection details or
    // the user's search text.
    console.error("route point search failed", { code });
    return NextResponse.json({ error: "Point search is temporarily unavailable." }, { status: 503 });
  }
}

