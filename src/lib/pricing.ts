/** Default Mireli fee in KSh per passenger seat on a shared booking.
 *  A charter still records one KSh 50 fee inside its 10% platform share. */
export const DEFAULT_BOOKING_FEE_AMOUNT = 50;

/** Shared fares for 10/11-seat cabs are KSh 50 lower per passenger seat. */
export const LARGE_SHARED_VEHICLE_CAPACITIES = [10, 11] as const;
export const LARGE_SHARED_VEHICLE_DISCOUNT = 50;

export function calculateSharedSeatFare(stageFare: number, vehicleCapacity: number): number {
  if (!Number.isSafeInteger(stageFare) || stageFare < 1 ||
      !Number.isSafeInteger(vehicleCapacity) || vehicleCapacity < 1) {
    throw new RangeError("Shared fare requires a valid stage fare and vehicle capacity.");
  }
  const fare = stageFare - (LARGE_SHARED_VEHICLE_CAPACITIES.includes(vehicleCapacity as 10 | 11)
    ? LARGE_SHARED_VEHICLE_DISCOUNT
    : 0);
  if (!Number.isSafeInteger(fare) || fare < 1) {
    throw new RangeError("The 10/11-seat discount cannot exceed the stage fare.");
  }
  return fare;
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
