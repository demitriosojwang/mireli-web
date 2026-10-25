import { db } from "@/lib/db";

const ACTIVE_BOOKING_STATUSES = ["awaiting_payment", "confirmed", "boarded"];
const C2B_REFERENCE_PREFIX = "c2b-";

/**
 * Free old unpaid seat holds without discarding booking/audit history.
 * Any non-terminal M-Pesa attempt, confirmed transaction, ledger entry, or
 * Paybill receipt protects the reservation from automatic expiry.
 */
export async function expireUnpaidBookingReservations(now = new Date()): Promise<{
  expired: number;
  restoredCredit: number;
}> {
  const config = await db.platformConfig.findUnique({
    where: { id: "main" },
    select: { unpaidBookingHoldMinutes: true, creditValidityDays: true },
  });
  if (!config) return { expired: 0, restoredCredit: 0 };

  const holdMinutes = Number.isSafeInteger(config.unpaidBookingHoldMinutes)
    ? Math.max(1, config.unpaidBookingHoldMinutes)
    : 15;
  const cutoff = new Date(now.getTime() - holdMinutes * 60_000);
  const candidates = await db.booking.findMany({
    where: {
      status: "awaiting_payment",
      tripId: { not: null },
      createdAt: { lte: cutoff },
      ledgerEntry: { is: null },
      mpesaTransactions: {
        none: {
          OR: [
            { status: { not: "failed" } },
            { merchantRequestId: { startsWith: C2B_REFERENCE_PREFIX } },
          ],
        },
      },
    },
    select: { id: true, tripId: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  let expired = 0;
  let restoredCredit = 0;
  for (const candidate of candidates) {
    if (!candidate.tripId) continue;
    const result = await db.$transaction(async (tx) => {
      // Match allocation's trip-then-booking lock order so the cached seat
      // count cannot race with a new reservation.
      await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${candidate.tripId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${candidate.id} FOR UPDATE`;
      const booking = await tx.booking.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          code: true,
          passengerId: true,
          tripId: true,
          createdAt: true,
          status: true,
          creditApplied: true,
          ledgerEntry: { select: { id: true } },
          mpesaTransactions: { select: { status: true, merchantRequestId: true } },
        },
      });
      if (
        !booking ||
        booking.status !== "awaiting_payment" ||
        booking.tripId !== candidate.tripId ||
        booking.createdAt.getTime() > cutoff.getTime() ||
        booking.ledgerEntry ||
        booking.mpesaTransactions.some(
          (payment) => payment.status !== "failed" || payment.merchantRequestId.startsWith(C2B_REFERENCE_PREFIX),
        )
      ) {
        return null;
      }

      const cancelled = await tx.booking.updateMany({
        where: { id: booking.id, status: "awaiting_payment" },
        data: { status: "cancelled", cancelledAt: now, cancelTier: "early" },
      });
      if (cancelled.count !== 1) return null;

      if (booking.creditApplied > 0) {
        await tx.credit.create({
          data: {
            passengerId: booking.passengerId,
            sourceBookingId: booking.id,
            amount: booking.creditApplied,
            initialAmount: booking.creditApplied,
            note: `Travel credit restored after unpaid checkout expired (${booking.code})`,
            expiresAt: new Date(now.getTime() + config.creditValidityDays * 24 * 60 * 60_000),
          },
        });
      }

      const trip = await tx.trip.findUnique({
        where: { id: candidate.tripId! },
        select: { capacity: true },
      });
      if (trip) {
        const activeBookings = await tx.booking.findMany({
          where: { tripId: candidate.tripId, status: { in: ACTIVE_BOOKING_STATUSES } },
          select: { seats: true, isCharter: true },
        });
        const bookedSeats = activeBookings.some((active) => active.isCharter)
          ? trip.capacity
          : activeBookings.reduce((sum, active) => sum + active.seats, 0);
        await tx.trip.update({ where: { id: candidate.tripId! }, data: { bookedSeats } });
      }

      await tx.auditLog.create({
        data: {
          actorId: "system",
          actorName: "Booking expiry service",
          actorRole: "system",
          action: "booking.expire_unpaid",
          entity: "booking",
          entityId: booking.id,
          metadata: JSON.stringify({
            code: booking.code,
            holdMinutes,
            restoredCredit: booking.creditApplied,
          }),
        },
      });
      return booking.creditApplied;
    });

    if (result !== null) {
      expired++;
      restoredCredit += result;
    }
  }

  return { expired, restoredCredit };
}
