/** The assignment states that may be offered to a passenger for payment. */
const PAYABLE_TRIP_STATES = new Set(["scheduled", "locked"]);

type PaymentAssignment = {
  driverId: string | null;
  status: string;
  departureAt: Date;
  driver: { status: string } | null;
} | null;

type PaymentBooking = {
  status: string;
  cashDue: number;
  trip: PaymentAssignment;
};

/**
 * Payment is available only while an unpaid booking has a future trip with an
 * active, assigned driver. Keep this check shared by the booking list and the
 * payment API so stale UI state cannot bypass the assignment requirement.
 */
export function isBookingReadyForPayment(
  booking: PaymentBooking,
  now = new Date(),
): boolean {
  const trip = booking.trip;
  return (
    booking.status === "awaiting_payment" &&
    booking.cashDue > 0 &&
    trip !== null &&
    Boolean(trip.driverId) &&
    trip.driver?.status === "active" &&
    PAYABLE_TRIP_STATES.has(trip.status) &&
    trip.departureAt.getTime() > now.getTime()
  );
}
