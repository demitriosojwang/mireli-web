import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPassengerSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { applyCredits, getConfig, recordCollection } from "@/lib/money";
import { allocateBooking } from "@/lib/engine";
import { generateBookingCode, toMpesaMsISDN } from "@/lib/daraja";
import { nairobiDate, nairobiDayRange } from "@/lib/nairobi-time";
import { isBookingReadyForPayment } from "@/lib/booking-payment-eligibility";
import { attemptBookingTicketEmail } from "@/lib/booking-ticket-email";
import { calculateCharterFare, calculateCharterPlatformShare } from "@/lib/charter-pricing";
import { calculateBookingFeeAmount, calculateSharedFare, calculateSharedOffstageFare } from "@/lib/pricing";
import { isOffstageQuoteRouteEnabled, OffstageQuoteError, quoteOffstageAddress } from "@/lib/offstage-quote";
import { getApprovedStageFare } from "@/lib/fare-catalogue";
import { expireUnpaidBookingReservations } from "@/lib/unpaid-booking-expiry";
import { assertPassengerPiiEncryptionReady, encryptPassengerIdNumber } from "@/lib/passenger-pii";
import { MIRELI_SUPPORT_PHONE_E164 } from "@/lib/support";

/** Statuses that count towards the guest booking limit — a cancelled booking
 *  frees the guest to rebook their single no-login seat. */
const GUEST_COUNTING_STATUSES = {
  status: { notIn: ["cancelled"] },
};

/** The exact rule copy shown to guests who try to go past the 1-seat limit. */
const GUEST_LIMIT_ERROR =
  "You can only book up to 1 seat without logging in. Login to book more seats.";

const PAYMENT_UNAVAILABLE_ERROR =
  "M-Pesa is temporarily unavailable. No booking was created and no payment was requested.";

async function hasStkPaymentMethod(): Promise<boolean> {
  try {
    const options = await getPublicPayOptions();
    return options.methods.includes("mpesa_stk");
  } catch {
    return false;
  }
}

/** Cost guard for the two paid Location calls needed by an off-stage quote. */
async function checkOffstageQuoteRateLimit(passengerId: string): Promise<"ok" | "limited"> {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = Math.floor(now / windowMs);
  const passengerHash = createHash("sha256").update(passengerId).digest("hex").slice(0, 32);
  const [passenger, global] = await Promise.all([
    db.driverRateLimit.upsert({
      where: { key: `offstage-quote:passenger:${passengerHash}:${bucket}` },
      create: { key: `offstage-quote:passenger:${passengerHash}:${bucket}`, expiresAt: new Date(now + windowMs) },
      update: { count: { increment: 1 } },
    }),
    db.driverRateLimit.upsert({
      where: { key: `offstage-quote:global:${bucket}` },
      create: { key: `offstage-quote:global:${bucket}`, expiresAt: new Date(now + windowMs) },
      update: { count: { increment: 1 } },
    }),
  ]);
  if (global.count === 1) {
    await db.driverRateLimit.deleteMany({
      where: { key: { startsWith: "offstage-quote:" }, expiresAt: { lt: new Date(now - windowMs) } },
    }).catch(() => undefined);
  }
  return passenger.count > 3 || global.count > 60 ? "limited" : "ok";
}

/** My bookings */
export async function GET() {
  const session = await getPassengerSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const bookings = await db.booking.findMany({
    where: { passengerId: session.id },
    orderBy: { createdAt: "desc" },
    include: {
      route: true,
      trip: { include: { route: true, driver: true } },
      reservationTrip: { include: { route: true, driver: true } },
      ledgerEntry: true,
      refunds: true,
    },
  });
  const now = new Date();
  return NextResponse.json({
    bookings: bookings.map((b) => {
      const timelineTrip = b.trip ?? b.reservationTrip;
      return ({
      id: b.id,
      code: b.code,
      routeName: timelineTrip?.route.name || b.route.name,
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
      cancellationRequestedAt: b.cancellationRequestedAt?.toISOString() || null,
      createdAt: b.createdAt,
      departureAt: timelineTrip?.departureAt || null,
      tripStatus: timelineTrip?.status || null,
      // Keep driver identity and vehicle registration private until payment is
      // settled (paid or fully covered by travel credit).
      driver:
        ["confirmed", "boarded", "completed"].includes(b.status) && b.trip?.driver
          ? {
              name: b.trip.driver.name,
              plate: b.trip.driver.plate,
              cabType: b.trip.driver.cabType,
              phone: ["confirmed", "boarded", "completed"].includes(b.status) ? b.trip.driver.phone : null,
            }
          : null,
      allocationNote: b.status === "awaiting_payment" && b.ledgerEntry
        ? `Payment received; your driver assignment needs review. Call or WhatsApp Mireli support at ${MIRELI_SUPPORT_PHONE_E164} with booking ${b.code}.`
        : ["confirmed", "boarded", "completed"].includes(b.status)
        ? b.allocationNote
        : b.status === "awaiting_payment" ? "Your departure is held while payment is pending. Driver and vehicle will be assigned after payment." : b.allocationNote,
      paymentNeedsReview: b.status === "awaiting_payment" && !!b.ledgerEntry,
      passengerName: b.passengerName,
      passengerPhone: b.passengerPhone,
      checkedInAt: b.checkedInAt,
      ledger: b.ledgerEntry
        ? { status: b.ledgerEntry.status, cash: b.ledgerEntry.cashAmount, credit: b.ledgerEntry.creditApplied, receipt: b.ledgerEntry.mpesaReceipt }
        : null,
      canPay: isBookingReadyForPayment(b, now),
      canCancel: ["awaiting_payment", "confirmed", "boarded"].includes(b.status) && timelineTrip?.status !== "departed" && timelineTrip?.status !== "completed",
      canCheckIn: b.status === "confirmed" && b.trip && ["scheduled", "locked"].includes(b.trip.status),
      refund: b.refunds.length ? { amount: b.refunds[0].amount, status: b.refunds[0].status, reason: b.refunds[0].reason } : null,
    });
    }),
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
    tripId,
    direction = "FROM_TERMINUS",
    stageId,
    homePickup = false,
    homeAddress,
    locationQuoteConsent,
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
  let encryptedIdNumber: string;
  try {
    assertPassengerPiiEncryptionReady();
    encryptedIdNumber = encryptPassengerIdNumber(idNumber)!;
  } catch (error) {
    console.error(
      "[api/bookings] Passenger identity encryption is unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "Secure booking is temporarily unavailable. Please try again shortly.", code: "PASSENGER_ID_PROTECTION_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
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
  if (typeof routeId !== "string" || routeId.length === 0 || typeof tripId !== "string" || tripId.length === 0 || typeof stageId !== "string" || stageId.length === 0) {
    return NextResponse.json({ error: "Choose an available cab, route, and stop." }, { status: 400 });
  }
  if (typeof homePickup !== "boolean" || typeof isCharter !== "boolean" || typeof applyCredit !== "boolean") {
    return NextResponse.json({ error: "Review your ride options and try again." }, { status: 400 });
  }
  if (locationQuoteConsent !== undefined && typeof locationQuoteConsent !== "boolean") {
    return NextResponse.json({ error: "Review the location-quote consent and try again." }, { status: 400 });
  }
  if (!Number.isSafeInteger(seats) || seats < 1 || seats > 6) {
    return NextResponse.json({ error: "Choose between 1 and 6 seats." }, { status: 400 });
  }

  const cfg = await getConfig();
  const route = await db.route.findUnique({ where: { id: routeId }, include: { stages: true } });
  if (!route || !route.active) {
    return NextResponse.json({ error: "This route is not currently open for booking." }, { status: 409 });
  }
  let stage = route.stages.find((s) => s.id === stageId && s.order > 0);
  if (!stage) {
    return NextResponse.json({ error: "Choose a published pickup or drop-off stop." }, { status: 409 });
  }
  const stageFare = getApprovedStageFare(stage.name) ?? stage.fare;
  if (!Number.isSafeInteger(stageFare) || stageFare <= 0) {
    return NextResponse.json({ error: "This stop's fare is not configured for booking yet." }, { status: 503 });
  }
  if (homePickup && (!homeAddress || typeof homeAddress !== "string" || homeAddress.trim().length < 5 || homeAddress.trim().length > 200)) {
    return NextResponse.json({ error: "Enter an address between 5 and 200 characters." }, { status: 400 });
  }
  if (homePickup && !isCharter && locationQuoteConsent !== true) {
    return NextResponse.json({ error: "Agree to the one-time location quote to continue with an off-stage shared ride." }, { status: 400 });
  }
  if (homePickup && !isCharter && !isOffstageQuoteRouteEnabled(route.id)) {
    return NextResponse.json(
      { error: "Off-stage shared rides are not enabled for this route yet. Choose the designated SGR stage." },
      { status: 409 },
    );
  }

  // Quote every booking from the exact cab the passenger selected. Shared
  // fares use the listed stage fare for every cab size; the separate KSh 50
  // fee is added to each booked seat. Charters use the listed base fare and 10% split.
  const selectedTrip = await db.trip.findUnique({
    where: { id: tripId },
    select: { capacity: true, routeId: true, direction: true },
  });
  if (!selectedTrip || selectedTrip.routeId !== route.id || selectedTrip.direction !== direction ||
      !Number.isSafeInteger(selectedTrip.capacity) || selectedTrip.capacity < 1) {
    return NextResponse.json(
      { error: "That cab is no longer available. Refresh the list and choose another cab or date." },
      { status: 409 },
    );
  }

  // An off-stage shared booking without credit will require a cash payment.
  // Fail before rate-limit writes or paid Location lookups when real M-Pesa is
  // unavailable; otherwise the passenger gets no quote and Mireli still pays
  // for geocoding and routing.
  if (homePickup && !isCharter && !applyCredit && !(await hasStkPaymentMethod())) {
    return NextResponse.json(
      { error: PAYMENT_UNAVAILABLE_ERROR, code: "PAYMENT_OPTIONS_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const tripSeats = isCharter ? 0 : seats;
  let fare = 0;
  let platformFeeAmount = 0;
  let homeSurcharge = 0;
  let offstageQuote: { distanceMeters: number; surchargePerSeat: number } | null = null;
  if (homePickup && !isCharter) {
    try {
      if (await checkOffstageQuoteRateLimit(session.id) === "limited") {
        return NextResponse.json({ error: "Too many address quotes in a short time. Please wait a minute and try again." }, { status: 429 });
      }
      const quote = await quoteOffstageAddress(
        route.id,
        String(homeAddress).trim(),
        route.stages,
        direction,
      );
      stage = quote.nearestStage;
      const nearestStageFare = getApprovedStageFare(stage.name) ?? stage.fare;
      if (!Number.isSafeInteger(nearestStageFare) || nearestStageFare <= 0) {
        return NextResponse.json({ error: "The nearest SGR stage does not have an approved fare yet." }, { status: 503 });
      }
      const quoteFare = calculateSharedOffstageFare(
        nearestStageFare,
        quote.distanceMeters,
        tripSeats,
        cfg.bookingFeeAmount,
      );
      fare = calculateSharedFare(nearestStageFare, selectedTrip.capacity, tripSeats);
      platformFeeAmount = quoteFare.platformFeeAmount;
      homeSurcharge = quoteFare.totalSurcharge;
      offstageQuote = { distanceMeters: quote.distanceMeters, surchargePerSeat: quoteFare.surchargePerSeat };
    } catch (error) {
      if (error instanceof OffstageQuoteError) {
        const response = error.code === "OFFSTAGE_NOT_ENABLED"
          ? { status: 409, error: "Off-stage shared rides are not enabled for this route yet. Choose the designated SGR stage." }
          : error.code === "ADDRESS_NOT_FOUND"
            ? { status: 400, error: "We couldn't locate that address in the service area. Check it and try again." }
            : error.code === "NO_DRIVING_ROUTE"
              ? { status: 422, error: "We couldn't find a drivable route from the nearest SGR stage to that address." }
              : { status: 503, error: "We couldn't calculate the distance quote. No booking was created; please try again." };
        return NextResponse.json({ error: response.error }, { status: response.status });
      }
      console.error("off-stage booking quote failed", {
        code: typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
          ? error.code
          : "UNKNOWN",
      });
      return NextResponse.json(
        { error: "We couldn't calculate the distance quote. No booking was created; please try again." },
        { status: 503 },
      );
    }
  }
  try {
    if (!offstageQuote) {
      fare = isCharter
        ? calculateCharterFare(selectedTrip.capacity, stageFare)
        : calculateSharedFare(stageFare, selectedTrip.capacity, tripSeats);
      platformFeeAmount = calculateBookingFeeAmount(cfg.bookingFeeAmount, isCharter ? 1 : tripSeats, isCharter);
    }
  } catch {
    return NextResponse.json(
      { error: "We couldn't confirm this cab's fare. No booking was created; please try again." },
      { status: 503 },
    );
  }
  // Private charters may use the passenger's desired address without an extra
  // mileage charge. Shared off-stage bookings use a server-only route quote;
  // ignore the legacy per-stage fixed surcharge because it is not distance-based.
  let total = fare + homeSurcharge + (isCharter ? 0 : platformFeeAmount);

  if (isCharter) {
    if (calculateCharterPlatformShare(fare, Math.round(cfg.commissionRate * 10000)) < platformFeeAmount) {
      return NextResponse.json(
        { error: "This vehicle's charter fare cannot cover the booking fee. Choose another cab." },
        { status: 409 },
      );
    }
    total = fare + homeSurcharge;
  }

  // ── Guest rule: 1 seat, 1 booking — no login required. Anything more needs
  // a Mi-Reli account created with the exact same details. ─────────────────
  const passenger = await db.passenger.findUnique({ where: { id: session.id } });
  const isGuest = !!passenger && passenger.phone.startsWith("guest-");
  let availableCreditBalance = 0;
  if (applyCredit) {
    try {
      const credits = await db.credit.findMany({
        where: {
          passengerId: session.id,
          status: "active",
          amount: { gt: 0 },
          expiresAt: { gt: new Date() },
        },
        select: { amount: true },
      });
      availableCreditBalance = credits.reduce((sum, credit) => sum + credit.amount, 0);
    } catch {
      return NextResponse.json(
        { error: "We couldn't verify your travel credit. No booking was created; please try again." },
        { status: 503 },
      );
    }
  }
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
  }

  // Cash may be due while M-Pesa is not yet configured. The booking is still
  // created and the seat held; unpaid holds release automatically, and the
  // pay sheet reports checkout availability when the passenger pays.
  if (!isGuest && passenger) {
    // Signed-in account — keep the profile in sync with the details they book
    // with, so future bookings prefill identically.
    await db.passenger.update({
      where: { id: passenger.id },
      data: {
        name: fullName.slice(0, 80),
        email,
        idType,
        idNumber: encryptedIdNumber,
        nationality,
        gender,
      },
    });
  }

  // Clear safe, abandoned checkout holds before assigning this new booking.
  await expireUnpaidBookingReservations();

  const booking = await db.booking.create({
    data: {
      code: generateBookingCode(),
      passengerId: session.id,
      routeId: route.id,
      direction,
      stageId: stage.id,
      stageName: homePickup
        ? `${direction === "FROM_TERMINUS" ? "Home drop-off" : "Home pickup"} · ${stage.name} area`
        : stage.name,
      homePickup,
      homeAddress: homePickup ? String(homeAddress).slice(0, 200) : null,
      seats: isCharter ? 1 : tripSeats,
      isCharter,
      // Charter fare was calculated from the exact selected vehicle before
      // creating the draft; allocation is pinned to that same trip.
      fareAmount: total,
      platformFeeAmount,
      homeSurcharge,
      creditApplied: 0,
      cashDue: total,
      status: "awaiting_payment",
      passengerName: fullName.slice(0, 80),
      passengerPhone: phone,
      passengerEmail: email,
      passengerIdType: idType,
      passengerIdNumber: encryptedIdNumber,
      passengerNationality: nationality.slice(0, 60),
      passengerGender: gender,
    },
  });

  // Hold seats on an eligible departure before applying credit or allowing
  // payment. Attach the booking to the driver's manifest only after payment.
  let allocation: Awaited<ReturnType<typeof allocateBooking>>;
  try {
    allocation = await allocateBooking({
      bookingId: booking.id,
      routeId: route.id,
      selectedTripId: tripId,
      direction,
      seats: isCharter ? 999 : tripSeats, // charter handled inside allocator
      travelDate: travelDateDate,
      charter: isCharter,
    });
  } catch {
    // Allocation is the gate before credit use or M-Pesa. Remove the unpaid
    // draft if the scheduler/database fails so it cannot look bookable later.
    await db.booking.delete({ where: { id: booking.id } }).catch(() => undefined);
    return NextResponse.json(
      { error: "We couldn't secure a driver for this booking yet. No payment was requested; please try again shortly." },
      { status: 503 },
    );
  }
  if (!allocation.tripId) {
    await db.booking.delete({ where: { id: booking.id } });
    return NextResponse.json(
      { error: "That cab is no longer available. No payment was taken; refresh the list and choose another cab or date." },
      { status: 409 },
    );
  }

  // Credit offer — the passenger chooses; partial use supported
  let creditApplied = 0;
  if (applyCredit) {
    // If the preflight thought credit covered the whole fare, make the final
    // redemption all-or-nothing. A competing checkout may have spent it after
    // the balance read; then redeem whatever remains and let the passenger
    // pay the residual cash amount like any other held booking.
    const requireFullCredit = total - Math.min(total, availableCreditBalance) === 0;
    creditApplied = await applyCredits(session.id, booking.id, total, {
      requireFull: requireFullCredit,
    });
    if (requireFullCredit && creditApplied < total) {
      creditApplied = await applyCredits(session.id, booking.id, total);
    }
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
    const collection = await recordCollection({
      bookingId: booking.id,
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
      action: collection.tripId ? "payment.credit_full" : "payment.credit_full_assignment_review",
      entity: "booking",
      entityId: booking.id,
      metadata: { code: booking.code, creditApplied, assignmentReviewRequired: !collection.tripId },
    });
    await attemptBookingTicketEmail(booking.id);
  }

  const fresh = await db.booking.findUnique({
    where: { id: booking.id },
    include: {
      route: true,
      trip: { include: { driver: true, route: true } },
      reservationTrip: { include: { driver: true, route: true } },
      ledgerEntry: true,
    },
  });
  const timelineTrip = fresh!.trip ?? fresh!.reservationTrip;

  return NextResponse.json({
    ok: true,
    booking: {
      id: fresh!.id,
      code: fresh!.code,
      status: fresh!.status,
      fareAmount: fresh!.fareAmount,
      baseFareAmount: fare,
      platformFeeAmount: fresh!.platformFeeAmount,
      homeSurcharge: fresh!.homeSurcharge,
      offstageQuote: offstageQuote ? {
        nearestStageName: stage.name,
        distanceMeters: offstageQuote.distanceMeters,
        surchargePerSeat: offstageQuote.surchargePerSeat,
      } : null,
      creditApplied: fresh!.creditApplied,
      cashDue: fresh!.cashDue,
      stageName: fresh!.stageName,
      seats: fresh!.seats,
      isCharter: fresh!.isCharter,
      passengerName: fresh!.passengerName,
      passengerPhone: fresh!.passengerPhone,
      paymentNeedsReview: fresh!.status === "awaiting_payment" && !!fresh!.ledgerEntry,
      trip: timelineTrip
        ? {
            ...(fresh!.trip ? { id: fresh!.trip.id } : {}),
            departureAt: timelineTrip.departureAt,
            status: timelineTrip.status,
            routeName: timelineTrip.route.name,
            driver: ["confirmed", "boarded", "completed"].includes(fresh!.status) && fresh!.trip?.driver
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
      allocationNote: fresh!.status === "awaiting_payment" && fresh!.ledgerEntry
        ? `Payment received; your driver assignment needs review. Call or WhatsApp Mireli support at ${MIRELI_SUPPORT_PHONE_E164} with booking ${fresh!.code}.`
        : ["confirmed", "boarded", "completed"].includes(fresh!.status)
        ? fresh!.allocationNote
        : fresh!.status === "awaiting_payment" ? "Your departure is held while payment is pending. Driver and vehicle will be assigned after payment." : fresh!.allocationNote,
    },
    bookingWindowMinutes: cfg.bookingWindowMinutes,
  });
}
