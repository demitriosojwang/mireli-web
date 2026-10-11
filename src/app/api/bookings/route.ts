import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPassengerSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { applyCredits, getConfig, recordCollection } from "@/lib/money";
import { allocateBooking } from "@/lib/engine";
import { generateBookingCode, toMpesaMsISDN } from "@/lib/daraja";
import { nairobiDate, nairobiDayRange } from "@/lib/nairobi-time";

/** Statuses that count towards the guest booking limit — a cancelled booking
 *  frees the guest to rebook their single no-login seat. */
const GUEST_COUNTING_STATUSES = {
  status: { notIn: ["cancelled"] },
};

/** The exact rule copy shown to guests who try to go past the 1-seat limit. */
const GUEST_LIMIT_ERROR =
  "You can only book up to 1 seat without logging in. Login to book more seats.";

/** My bookings */
export async function GET() {
  const session = await getPassengerSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const bookings = await db.booking.findMany({
    where: { passengerId: session.id },
    orderBy: { createdAt: "desc" },
    include: {
      trip: { include: { route: true, driver: true } },
      ledgerEntry: true,
      refunds: true,
    },
  });
  const now = new Date();
  return NextResponse.json({
    bookings: bookings.map((b) => ({
      id: b.id,
      code: b.code,
      routeName: b.trip?.route.name || null,
      direction: b.direction,
      stageName: b.stageName,
      homePickup: b.homePickup,
      homeAddress: b.homeAddress,
      seats: b.seats,
      isCharter: b.isCharter,
      fareAmount: b.fareAmount,
      platformFeeAmount: b.platformFeeAmount,
      homeSurcharge: b.homeSurcharge,
      creditApplied: b.creditApplied,
      cashDue: b.cashDue,
      status: b.status,
      cancelTier: b.cancelTier,
      createdAt: b.createdAt,
      departureAt: b.trip?.departureAt || null,
      tripStatus: b.trip?.status || null,
      // Driver phone unlocks once the fare is settled (paid or credit-covered);
      // identity (name + plate) is visible from the start.
      driver:
        b.trip?.driver
          ? {
              name: b.trip.driver.name,
              plate: b.trip.driver.plate,
              cabType: b.trip.driver.cabType,
              phone: ["confirmed", "boarded", "completed"].includes(b.status) ? b.trip.driver.phone : null,
            }
          : null,
      allocationNote: b.allocationNote,
      passengerName: b.passengerName,
      passengerPhone: b.passengerPhone,
      checkedInAt: b.checkedInAt,
      lockNote:
        b.trip?.status === "locked"
          ? "Trip locked — cancelling now converts your fare to credit"
          : null,
      ledger: b.ledgerEntry
        ? { status: b.ledgerEntry.status, cash: b.ledgerEntry.cashAmount, credit: b.ledgerEntry.creditApplied, receipt: b.ledgerEntry.mpesaReceipt }
        : null,
      canPay: b.status === "awaiting_payment" && b.cashDue > 0,
      canCancel: ["awaiting_payment", "confirmed", "boarded"].includes(b.status) && b.trip?.status !== "departed" && b.trip?.status !== "completed",
      canCheckIn: b.status === "confirmed" && b.trip && ["scheduled", "locked"].includes(b.trip.status),
      refund: b.refunds.length ? { amount: b.refunds[0].amount, status: b.refunds[0].status, reason: b.refunds[0].reason } : null,
    })),
    now: now.toISOString(),
  });
}

/** Create a booking: fare → credit offer → allocation → payment stage. */
export async function POST(req: NextRequest) {
  const session = await getPassengerSession();
  if (!session) return NextResponse.json({ error: "Sign in to book" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const {
    routeId,
    direction = "FROM_TERMINUS",
    stageId,
    homePickup = false,
    homeAddress,
    seats = 1,
    isCharter = false,
    applyCredit = false,
    travelDate, // YYYY-MM-DD (the day the passenger wants to travel)
    passengerName, // primary passenger — full name
    passengerPhone, // doubles as the default M-Pesa number
    passengerEmail, // contact info
    passengerIdType, // "id" | "passport"
    passengerIdNumber, // national ID or passport number
    passengerNationality, // dropdown value from /lib/nationalities
    passengerGender, // "male" | "female" | "other"
  } = body;
  let travelDateDate: Date;
  try { travelDateDate = nairobiDayRange(travelDate ?? nairobiDate(new Date())).start; }
  catch { return NextResponse.json({ error: "Invalid travel date" }, { status: 400 }); }
  if (!["FROM_TERMINUS", "TO_TERMINUS"].includes(direction)) return NextResponse.json({ error: "Invalid direction" }, { status: 400 });

  // ── Primary passenger details (required for every booking) ────────────────
  const fullName = String(passengerName || "").trim();
  if (fullName.length < 2 || !fullName.includes(" ")) {
    return NextResponse.json(
      { error: "Enter the passenger's full name (first and last name)" },
      { status: 400 },
    );
  }
  const idType = passengerIdType === "passport" ? "passport" : "id";
  const idNumber = String(passengerIdNumber || "").trim();
  if (idNumber.length < 4) {
    return NextResponse.json(
      { error: `Enter a valid ${idType === "passport" ? "passport number" : "ID number"}` },
      { status: 400 },
    );
  }
  const nationality = String(passengerNationality || "").trim();
  if (!nationality) {
    return NextResponse.json({ error: "Select your nationality" }, { status: 400 });
  }
  const gender = String(passengerGender || "").trim().toLowerCase();
  if (!gender) {
    return NextResponse.json({ error: "Select your gender" }, { status: 400 });
  }
  const email = String(passengerEmail || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  const phone = toMpesaMsISDN(String(passengerPhone || ""));
  if (!phone) {
    return NextResponse.json(
      { error: "Enter a valid M-Pesa number (07XX XXX XXX or 2547XX XXX XXX)" },
      { status: 400 },
    );
  }

  const cfg = await getConfig();
  const route = await db.route.findUnique({ where: { id: routeId }, include: { stages: true } });
  if (!route) return NextResponse.json({ error: "Route not found" }, { status: 400 });
  const stage = route.stages.find((s) => s.id === stageId);
  if (!stage) return NextResponse.json({ error: "Pickup stage required" }, { status: 400 });
  if (homePickup && (!homeAddress || String(homeAddress).trim().length < 5)) {
    return NextResponse.json({ error: "Home pickup needs an address" }, { status: 400 });
  }

  const tripSeats = isCharter ? 0 : Math.max(1, Math.min(parseInt(seats, 10) || 1, 6));
  const fare = isCharter ? route.charterPrice : stage.fare * tripSeats;
  const homeSurcharge = homePickup ? (isCharter ? stage.homeSurcharge : stage.homeSurcharge * tripSeats) : 0;
  const platformFeeAmount = cfg.bookingFeeAmount;
  const total = fare + homeSurcharge + platformFeeAmount;

  // ── Guest rule: 1 seat, 1 booking — no login required. Anything more needs
  // a Mi-Reli account created with the exact same details. ─────────────────
  const passenger = await db.passenger.findUnique({ where: { id: session.id } });
  const isGuest = !!passenger && passenger.phone.startsWith("guest-");
  if (isGuest) {
    const priorBookings = await db.booking.count({
      where: { passengerId: session.id, ...GUEST_COUNTING_STATUSES },
    });
    if (priorBookings > 0 || tripSeats > 1 || isCharter) {
      return NextResponse.json(
        { error: GUEST_LIMIT_ERROR, code: "GUEST_LIMIT" },
        { status: 403 },
      );
    }
  } else if (passenger) {
    // Signed-in account — keep the profile in sync with the details they book
    // with, so future bookings prefill identically.
    await db.passenger.update({
      where: { id: passenger.id },
      data: {
        name: fullName.slice(0, 80),
        email,
        idType,
        idNumber,
        nationality,
        gender,
      },
    });
  }

  const booking = await db.booking.create({
    data: {
      code: generateBookingCode(),
      passengerId: session.id,
      routeId: route.id,
      direction,
      stageId: stage.id,
      stageName: homePickup ? `Home pickup · ${stage.name} area` : stage.name,
      homePickup,
      homeAddress: homePickup ? String(homeAddress).slice(0, 200) : null,
      seats: isCharter ? 1 : tripSeats,
      isCharter,
      fareAmount: total, // total charged (fare + home surcharge + flat platform fee)
      platformFeeAmount,
      homeSurcharge,
      creditApplied: 0,
      cashDue: total,
      status: "awaiting_payment",
      passengerName: fullName.slice(0, 80),
      passengerPhone: phone,
      passengerEmail: email,
      passengerIdType: idType,
      passengerIdNumber: idNumber,
      passengerNationality: nationality.slice(0, 60),
      passengerGender: gender,
    },
  });

  // Secure a driver and cab before applying credit or allowing payment. An
  // unmatched request must never look like a confirmed booking to a passenger.
  const allocation = await allocateBooking({
    bookingId: booking.id,
    routeId: route.id,
    direction,
    seats: isCharter ? 999 : tripSeats, // charter handled inside allocator
    travelDate: travelDateDate,
    charter: isCharter,
  });
  if (!allocation.tripId) {
    await db.booking.delete({ where: { id: booking.id } });
    return NextResponse.json(
      { error: "No approved driver and cab are available for this journey yet. No payment was taken; please try another date later." },
      { status: 409 },
    );
  }

  // Credit offer — the passenger chooses; partial use supported
  let creditApplied = 0;
  if (applyCredit) {
    creditApplied = await applyCredits(session.id, booking.id, total);
  }
  const cashDue = total - creditApplied;
  if (creditApplied > 0) {
    await db.booking.update({
      where: { id: booking.id },
      data: { creditApplied, cashDue },
    });
  }

  await audit({
    actorId: session.id,
    actorName: session.name,
    actorRole: "passenger",
    action: isCharter ? "booking.create.charter" : "booking.create",
    entity: "booking",
    entityId: booking.id,
    metadata: { code: booking.code, total, platformFeeAmount, creditApplied, cashDue, allocation: allocation.note, passengerName: fullName, passengerPhone: phone, passengerNationality: nationality, passengerGender: gender },
  });

  // Fully covered by credit? Confirm immediately — no cash ever moves.
  if (cashDue <= 0) {
    await db.booking.update({ where: { id: booking.id }, data: { status: "confirmed" } });
    await recordCollection({
      bookingId: booking.id,
      tripId: allocation.tripId,
      totalAmount: total,
      cashAmount: 0,
      creditApplied,
      homeSurchargeAmount: homeSurcharge,
      platformFeeAmount,
      mpesaReceipt: null,
    });
    await audit({
      actorId: session.id,
      actorName: session.name,
      actorRole: "passenger",
      action: "payment.credit_full",
      entity: "booking",
      entityId: booking.id,
      metadata: { code: booking.code, creditApplied },
    });
  }

  const fresh = await db.booking.findUnique({
    where: { id: booking.id },
    include: { trip: { include: { driver: true, route: true } } },
  });

  return NextResponse.json({
    ok: true,
    booking: {
      id: fresh!.id,
      code: fresh!.code,
      status: fresh!.status,
      fareAmount: fresh!.fareAmount,
      platformFeeAmount: fresh!.platformFeeAmount,
      homeSurcharge: fresh!.homeSurcharge,
      creditApplied: fresh!.creditApplied,
      cashDue: fresh!.cashDue,
      stageName: fresh!.stageName,
      seats: fresh!.seats,
      isCharter: fresh!.isCharter,
      passengerName: fresh!.passengerName,
      passengerPhone: fresh!.passengerPhone,
      trip: fresh!.trip
        ? {
            id: fresh!.trip.id,
            departureAt: fresh!.trip.departureAt,
            status: fresh!.trip.status,
            routeName: fresh!.trip.route.name,
            driver: fresh!.trip.driver
              ? {
                  name: fresh!.trip.driver.name,
                  plate: fresh!.trip.driver.plate,
                  // Phone only once the fare is settled (e.g. credit-covered).
                  phone: ["confirmed", "boarded", "completed"].includes(fresh!.status)
                    ? fresh!.trip.driver.phone
                    : null,
                }
              : null,
          }
        : null,
      allocationNote: fresh!.allocationNote,
    },
    bookingWindowMinutes: cfg.bookingWindowMinutes,
  });
}
