import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  adminCookieOptions,
  encodeSession,
  getPassengerSession,
  normalizePhone,
  passengerCookieOptions,
} from "@/lib/session";

import { audit } from "@/lib/audit";
import { DriverError, text } from "@/lib/driver/errors";
import { assertPassengerPiiEncryptionReady, decryptPassengerIdNumber, encryptPassengerIdNumber } from "@/lib/passenger-pii";
import {
  consumePassengerChallenge,
  requestPassengerChallenge,
  verifyPassengerChallenge,
} from "@/lib/passenger-auth";

const NO_STORE = { "Cache-Control": "no-store" };

/** Passenger sign-in uses a short-lived, single-use SMS/email challenge. */
export async function POST(req: NextRequest) {
  const parsed = await req.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400, headers: NO_STORE });
  }
  const body = parsed as Record<string, unknown>;
  const step = typeof body.step === "string" ? body.step : "";

  if (step === "logout") {
    const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
    res.cookies.set({ ...passengerCookieOptions(), value: "" });
    res.cookies.set({ ...adminCookieOptions(), value: "" });
    return res;
  }

  try {
    if (step === "request") {
      const challenge = await requestPassengerChallenge(body.identifier);
      return NextResponse.json({ ok: true, ...challenge }, { headers: NO_STORE });
    }

    if (step === "verify") return await verifySignIn(body);
    if (step === "signup") return await claimGuestAccount(body);
    return NextResponse.json({ error: "Unknown authentication step" }, { status: 400, headers: NO_STORE });
  } catch (error) {
    if (error instanceof DriverError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
    }
    console.error("passenger authentication failed", error);
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503, headers: NO_STORE });
  }
}

async function verifySignIn(body: Record<string, unknown>) {
  const challenge = await verifyPassengerChallenge(body.challengeId, body.code);
  const phone = challenge.phone;
  const email = challenge.email;
  const contact = phone || email!;
  const nameInput = typeof body.name === "string" ? body.name.trim() : "";
  // A first-time email passenger supplies a mobile number with their name; it
  // becomes the account's contact for booking and M-Pesa.
  const phoneInput = phone ? "" : normalizePhone(typeof body.phone === "string" ? body.phone : "");
  const existing = phone
    ? await db.passenger.findUnique({ where: { phone } })
    : await db.passenger.findFirst({ where: { email: email! } });

  // Keep the verified challenge pending while a first-time passenger supplies
  // the name (and, for email sign-ups, the mobile number) required to create
  // their account. It is consumed in the account transaction below, so this
  // response alone cannot grant a session.
  if (!existing && (!nameInput || (!phone && !phoneInput))) {
    return NextResponse.json(
      { needsName: true, needsPhone: !phone, identifier: contact },
      { headers: NO_STORE },
    );
  }
  const name = existing ? existing.name || "Passenger" : text(nameInput, "Name", 2, 80);

  const result = await db.$transaction(async (tx) => {
    await consumePassengerChallenge(tx, challenge);
    const found = phone
      ? await tx.passenger.findUnique({ where: { phone } })
      : await tx.passenger.findFirst({ where: { email: email! } });
    if (found) return { passenger: found, isNew: false };
    if (!nameInput) throw new DriverError(400, "NAME_REQUIRED", "Enter your name to create an account.");
    // Email sign-ups bind a verified-by-challenge phone; phone sign-ups already
    // have one. Either way the account always carries a mobile contact.
    const accountPhone = phone || phoneInput;
    if (!accountPhone) throw new DriverError(400, "MOBILE_REQUIRED", "Add your mobile number to create an account.");
    if (!phone) {
      const phoneTaken = await tx.passenger.findUnique({ where: { phone: accountPhone } });
      if (phoneTaken) {
        throw new DriverError(
          409,
          "MOBILE_IN_USE",
          "That mobile number already has an account. Sign in with the mobile number instead.",
        );
      }
    }
    const passenger = await tx.passenger.create({
      data: {
        phone: accountPhone,
        email: email || null,
        name,
      },
    });
    return { passenger, isNew: true };
  });

  // No welcome credit on signup either: new accounts start at zero balance.
  // Credit is only issued as refunds or ops compensation (see lib/money).

  const passenger = result.passenger;
  const session = {
    role: "passenger" as const,
    id: passenger.id,
    name: passenger.name || "Passenger",
    identifier: contact,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const res = NextResponse.json({ ok: true, session, isNew: result.isNew }, { headers: NO_STORE });
  res.cookies.set({ ...passengerCookieOptions(), value: encodeSession(session) });
  await audit({
    actorId: passenger.id,
    actorName: passenger.name || contact,
    actorRole: "passenger",
    action: result.isNew ? "auth.signup" : "auth.login",
    entity: "passenger",
    entityId: passenger.id,
    metadata: result.isNew ? { welcomeCredit: 0 } : undefined,
  });
  return res;
}

async function claimGuestAccount(body: Record<string, unknown>) {
  const fullName = text(body.name, "Full name", 2, 80);
  if (!fullName.includes(" ")) {
    return NextResponse.json({ error: "Enter your first and last name" }, { status: 400, headers: NO_STORE });
  }
  const phone = normalizePhone(typeof body.phone === "string" ? body.phone : "");
  if (!phone) return NextResponse.json({ error: "Enter a valid Kenyan mobile number" }, { status: 400, headers: NO_STORE });
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400, headers: NO_STORE });
  const idType = body.idType === "passport" ? "passport" : "id";
  const idNumber = text(body.idNumber, idType === "passport" ? "Passport number" : "ID number", 4, 100);
  const nationality = text(body.nationality, "Nationality", 1, 60);
  const gender = text(body.gender, "Gender", 1, 20).toLowerCase();
  if (!["female", "male", "other"].includes(gender)) return NextResponse.json({ error: "Select a valid gender" }, { status: 400 });
  try {
    assertPassengerPiiEncryptionReady();
  } catch {
    throw new DriverError(503, "PASSENGER_ID_PROTECTION_UNAVAILABLE", "Secure account setup is temporarily unavailable. Please try again shortly.");
  }
  const encryptedIdNumber = encryptPassengerIdNumber(idNumber)!;

  const session = await getPassengerSession();
  if (!session) return NextResponse.json({ error: "Session expired — refresh and try again" }, { status: 401, headers: NO_STORE });
  const guest = await db.passenger.findUnique({ where: { id: session.id } });
  if (!guest) return NextResponse.json({ error: "Session expired — refresh and try again" }, { status: 401, headers: NO_STORE });
  if (!guest.phone.startsWith("guest-")) {
    return NextResponse.json({ error: "You already have a Mi-Reli account. Log out first to sign up with different details." }, { status: 409, headers: NO_STORE });
  }

  const challenge = await verifyPassengerChallenge(body.challengeId, body.code);
  if (challenge.channel !== "passenger_sms" || challenge.phone !== phone) {
    return NextResponse.json({ error: "Request a verification code for this phone number first." }, { status: 400, headers: NO_STORE });
  }

  const profile = { name: fullName, email, idType, idNumber: encryptedIdNumber, nationality, gender };
  const sameDetails = (a: string | null | undefined, b: string) => (a || "").trim().toLowerCase() === b.trim().toLowerCase();
  const result = await db.$transaction(async (tx) => {
    await consumePassengerChallenge(tx, challenge);
    const current = await tx.passenger.findUnique({ where: { id: guest.id } });
    if (!current || !current.phone.startsWith("guest-")) throw new DriverError(409, "GUEST_SESSION_CHANGED", "Refresh the page and try again.");
    const existing = phone === current.phone ? null : await tx.passenger.findUnique({ where: { phone } });

    if (existing) {
      const matches = sameDetails(existing.name, fullName) &&
        sameDetails(existing.email, email) &&
        sameDetails(decryptPassengerIdNumber(existing.idNumber), idNumber) &&
        sameDetails(existing.nationality, nationality) &&
        sameDetails(existing.gender, gender);
      if (!matches) throw new DriverError(409, "ACCOUNT_DETAILS_MISMATCH", "An account with this phone already exists. Use the same details as that account, or sign in instead.");
      await tx.booking.updateMany({ where: { passengerId: current.id }, data: { passengerId: existing.id } });
      await tx.credit.updateMany({ where: { passengerId: current.id }, data: { passengerId: existing.id } });
      await tx.passenger.delete({ where: { id: current.id } });
      const updated = await tx.passenger.update({ where: { id: existing.id }, data: {
        email: existing.email || email,
        idType: existing.idType || idType,
        idNumber: existing.idNumber
          ? encryptPassengerIdNumber(decryptPassengerIdNumber(existing.idNumber))
          : encryptedIdNumber,
        nationality: existing.nationality || nationality,
        gender: existing.gender || gender,
      } });
      return { passenger: updated, claimed: true, guestId: current.id };
    }

    const updated = await tx.passenger.update({ where: { id: current.id }, data: { phone, ...profile } });
    return { passenger: updated, claimed: false, guestId: current.id };
  });

  const nextSession = {
    role: "passenger" as const,
    id: result.passenger.id,
    name: result.passenger.name || fullName,
    identifier: result.passenger.phone,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const res = NextResponse.json({ ok: true, claimed: result.claimed }, { headers: NO_STORE });
  res.cookies.set({ ...passengerCookieOptions(), value: encodeSession(nextSession) });
  await audit({
    actorId: result.passenger.id,
    actorName: result.passenger.name || fullName,
    actorRole: "passenger",
    action: result.claimed ? "auth.claim" : "auth.signup",
    entity: "passenger",
    entityId: result.passenger.id,
    metadata: result.claimed ? { matchedBy: "exact_details", guestId: result.guestId } : { upgradedFromGuest: true, nationality, gender },
  });
  return res;
}
