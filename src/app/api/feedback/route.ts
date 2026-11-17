import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPassengerSession } from "@/lib/session";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const CATEGORIES = ["problem", "complaint", "idea", "compliment"] as const;
const MAX_MESSAGE = 2000;

/**
 * Floating feedback panel: any passenger — guest or signed-in — can report a
 * problem or raise a concern without logging in. Rate limited per session so
 * one browser cannot flood the queue.
 */
export async function POST(req: NextRequest) {
  const session = await getPassengerSession();
  if (!session) return NextResponse.json({ error: "Session unavailable" }, { status: 401, headers: NO_STORE });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON object is required." }, { status: 400, headers: NO_STORE });
  }
  const { category, message, page, bookingId } = body as Record<string, unknown>;
  if (typeof category !== "string" || !(CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: "Choose what kind of feedback this is." }, { status: 400, headers: NO_STORE });
  }
  if (typeof message !== "string" || message.trim().length < 5 || message.trim().length > MAX_MESSAGE) {
    return NextResponse.json(
      { error: `Write between 5 and ${MAX_MESSAGE} characters.` },
      { status: 400, headers: NO_STORE },
    );
  }
  if (bookingId !== undefined && bookingId !== null && typeof bookingId !== "string") {
    return NextResponse.json({ error: "Invalid booking reference." }, { status: 400, headers: NO_STORE });
  }
  const pagePath = typeof page === "string" && page.startsWith("/") ? page.slice(0, 200) : null;

  // Per-session flood guard: 5 messages per 10 minutes, stored in the same
  // rate-limit table the off-stage quote guard uses.
  const now = Date.now();
  const windowMs = 10 * 60_000;
  const bucket = Math.floor(now / windowMs);
  const key = `feedback:${session.id}:${bucket}`;
  try {
    const entry = await db.driverRateLimit.upsert({
      where: { key },
      create: { key, expiresAt: new Date(now + windowMs) },
      update: { count: { increment: 1 } },
    });
    if (entry.count > 5) {
      return NextResponse.json(
        { error: "You've sent several messages already. Please wait a little before sending more." },
        { status: 429, headers: NO_STORE },
      );
    }
    const feedback = await db.feedback.create({
      data: {
        sessionId: session.id,
        bookingId: typeof bookingId === "string" && bookingId.length <= 64 ? bookingId : null,
        category,
        message: message.trim().slice(0, MAX_MESSAGE),
        page: pagePath,
      },
      select: { id: true, createdAt: true },
    });
    return NextResponse.json({ ok: true, id: feedback.id }, { status: 201, headers: NO_STORE });
  } catch (error) {
    console.error("[api/feedback] Could not store feedback", error);
    return NextResponse.json(
      { error: "We couldn't record your feedback right now. Please try again shortly." },
      { status: 503, headers: NO_STORE },
    );
  }
}
