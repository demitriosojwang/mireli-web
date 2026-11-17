/** Default Mireli fee in KSh per passenger seat on a shared booking.
 *  A charter still records one KSh 50 fee inside its 10% platform share. */
export const DEFAULT_BOOKING_FEE_AMOUNT = 50;

/** Off-stage shared-ride surcharge: half the road kilometres × KSh 50. */
export function calculateOffstageSurcharge(distanceMeters: number): number {
  if (!Number.isSafeInteger(distanceMeters) || distanceMeters < 0) {
    throw new RangeError("Off-stage fare requires a valid road distance in metres.");
  }
  // distanceMeters / 40 is equivalent to (distanceKm / 2) * KSh 50.
  // Whole-shilling fares round to the nearest shilling; .50 rounds up.
  const surcharge = Math.round(distanceMeters / 40);
  if (!Number.isSafeInteger(surcharge)) {
    throw new RangeError("Off-stage surcharge exceeds the supported amount.");
  }
  return surcharge;
}

export type SharedOffstageFareQuote = {
  surchargePerSeat: number;
  totalSurcharge: number;
  platformFeeAmount: number;
  driverPayoutAmount: number;
  totalAmount: number;
};

/** Quote an off-stage shared booking from the stage fare and trusted road distance. */
export function calculateSharedOffstageFare(
  stageFare: number,
  distanceMeters: number,
  seats: number,
  feePerSeat = DEFAULT_BOOKING_FEE_AMOUNT,
): SharedOffstageFareQuote {
  if (!Number.isSafeInteger(stageFare) || stageFare < 1 ||
      !Number.isSafeInteger(seats) || seats < 1 ||
      !Number.isSafeInteger(feePerSeat) || feePerSeat < 0) {
    throw new RangeError("Off-stage fare requires valid fare, seat, and fee amounts.");
  }

  const surchargePerSeat = calculateOffstageSurcharge(distanceMeters);
  const totalSurcharge = surchargePerSeat * seats;
  const platformFeeAmount = feePerSeat * seats;
  const driverPayoutAmount = (stageFare + surchargePerSeat) * seats;
  const totalAmount = driverPayoutAmount + platformFeeAmount;
  if (![totalSurcharge, platformFeeAmount, driverPayoutAmount, totalAmount].every(Number.isSafeInteger)) {
    throw new RangeError("Off-stage fare exceeds the supported amount.");
  }

  return { surchargePerSeat, totalSurcharge, platformFeeAmount, driverPayoutAmount, totalAmount };
}

export function calculateSharedSeatFare(stageFare: number, vehicleCapacity: number): number {
  if (!Number.isSafeInteger(stageFare) || stageFare < 1 ||
      !Number.isSafeInteger(vehicleCapacity) || vehicleCapacity < 1) {
    throw new RangeError("Shared fare requires a valid stage fare and vehicle capacity.");
  }
  // Every shared passenger pays the approved stage fare. The separate KSh 50
  // booking fee is added per seat and retained by Mireli, regardless of cab size.
  return stageFare;
}

export function calculateSharedFare(stageFare: number, vehicleCapacity: number, seats: number): number {
  if (!Number.isSafeInteger(seats) || seats < 1) {
    throw new RangeError("Shared fare requires at least one passenger seat.");
  }
  const total = calculateSharedSeatFare(stageFare, vehicleCapacity) * seats;
  if (!Number.isSafeInteger(total)) throw new RangeError("Shared fare exceeds the supported amount.");
  return total;
}

/** Shared bookings retain the configured fee for every passenger seat.
 *  Charters retain one fee line; it is included within the 10% share. */
export function calculateBookingFeeAmount(perSeatAmount: number, seats: number, isCharter = false): number {
  if (!Number.isSafeInteger(perSeatAmount) || perSeatAmount < 0 ||
      !Number.isSafeInteger(seats) || seats < 1) {
    throw new RangeError("Booking fee requires a valid per-seat amount and seat count.");
  }
  const total = perSeatAmount * (isCharter ? 1 : seats);
  if (!Number.isSafeInteger(total)) throw new RangeError("Booking fee exceeds the supported amount.");
  return total;
}
