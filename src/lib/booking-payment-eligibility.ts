/** The trip states whose private seat hold may be offered for payment. */
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
  ledgerEntry?: unknown | null;
  trip: PaymentAssignment;
  reservationTrip?: PaymentAssignment;
};

/**
 * Payment is available only while an unpaid booking has a future departure
 * reserved on an active driver's trip. The reservation remains private until
 * the payment transaction commits the passenger assignment.
 */
export function isBookingReadyForPayment(
  booking: PaymentBooking,
  now = new Date(),
): boolean {
  const trip = booking.trip ?? booking.reservationTrip ?? null;
  return (
    booking.status === "awaiting_payment" &&
    booking.cashDue > 0 &&
    booking.ledgerEntry == null &&
    trip !== null &&
    Boolean(trip.driverId) &&
    trip.driver?.status === "active" &&
    PAYABLE_TRIP_STATES.has(trip.status) &&
    trip.departureAt.getTime() > now.getTime()
  );
}
