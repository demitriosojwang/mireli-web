import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import {
  getPassengerSession,
  encodeSession,
  assertSessionSigningKeyAvailable,
  passengerCookieOptions,
  type Session,
} from "@/lib/session";
import { issueCredit } from "@/lib/money";
import { audit } from "@/lib/audit";
import { decryptPassengerIdNumber } from "@/lib/passenger-pii";

/**
 * Passenger identity — frictionless by design.
 * The booking site has no login wall: on first visit the platform silently
 * provisions a guest session (cookie) so the passenger can browse, book and
 * pay immediately. A real passenger can still claim their bookings later via
 * /login (kept as a hidden URL, not part of the main flow).
 * Admin stays identity-gated at /admin — never touched by this route.
 */
export async function GET() {
  try {
    assertSessionSigningKeyAvailable();
  } catch (error) {
    console.error("[api/me] Passenger session signing is unavailable", error);
    return NextResponse.json(
      { error: "Your booking session is temporarily unavailable. Please try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const existing = await getPassengerSession();

  if (existing) {
    const passenger = await db.passenger.findUnique({ where: { id: existing.id } });
    if (passenger) return respondFor(passenger, existing);
  }

  // A guest session lets people browse before operations have finished
  // configuring the platform. Welcome credit is only issued when an operator
  // configuration exists; never invent settings to make a guest account.
  const cfg = await db.platformConfig.findUnique({
    where: { id: "main" },
    select: { creditValidityDays: true },
  });
  const passenger = await createGuestPassenger();

  if (cfg) {
    await issueCredit({
      passengerId: passenger.id,
      amount: 100,
      note: "Karibu Mi-Reli! Welcome credit — applies to any ride.",
      validityDays: cfg.creditValidityDays,
    });
  }
  await audit({
    actorId: passenger.id,
    actorName: "Guest",
    actorRole: "passenger",
    action: "auth.guest_start",
    entity: "passenger",
    entityId: passenger.id,
    metadata: { welcomeCredit: cfg ? 100 : 0, welcomeCreditSkipped: !cfg },
  });

  const session = {
    role: "passenger" as const,
    id: passenger.id,
    name: passenger.name || "Guest",
    identifier: passenger.phone,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  return respondFor(passenger, session, true);
}

async function createGuestPassenger() {
  // Retry the (astronomically unlikely) unique-phone collision.
  for (let i = 0; i < 3; i++) {
    const phone = `guest-${crypto.randomBytes(4).toString("hex")}`;
    try {
      return await db.passenger.create({ data: { phone, name: "Guest" } });
    } catch (error) {
      // Only retry an actual unique-phone collision. A database outage or
      // schema error must not be hidden behind repeated create attempts.
      if (!isUniqueConstraintError(error)) throw error;
    }
  }
  throw new Error("Could not start a guest session");
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function respondFor(
  passenger: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    idType: string | null;
    idNumber: string | null;
    nationality: string | null;
    gender: string | null;
  },
  session: Session,
  setCookie = false
) {
  let idNumber: string | null;
  try {
    idNumber = decryptPassengerIdNumber(passenger.idNumber);
  } catch (error) {
    console.error(
      "[api/me] Passenger identity is unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "Your saved passenger details are temporarily unavailable. Please try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const credits = await db.credit.findMany({
    where: { passengerId: passenger.id, status: "active", expiresAt: { gt: new Date() } },
  });
  const creditBalance = credits.reduce((s, c) => s + c.amount, 0);
  // Guest rule state: a guest who has already placed (and not cancelled) their
  // single no-login booking must create an account to book again.
  const guestUsed =
    (await db.booking.count({
      where: { passengerId: passenger.id, status: { notIn: ["cancelled"] } },
    })) > 0;
  const res = NextResponse.json({
    session,
    passenger: {
      id: passenger.id,
      name: passenger.name,
      phone: passenger.phone,
      email: passenger.email,
      idType: passenger.idType,
      idNumber,
      nationality: passenger.nationality,
      gender: passenger.gender,
      isGuest: passenger.phone.startsWith("guest-"),
      guestUsed,
    },
    creditBalance,
    activeCredits: credits.length,
  }, { headers: { "Cache-Control": "no-store" } });
  if (setCookie) {
    res.cookies.set({ ...passengerCookieOptions(), value: encodeSession(session) });
  }
  return res;
}
