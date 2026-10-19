-- Keep passenger ticket email delivery durable and idempotent per booking.
CREATE TABLE "BookingTicketEmailDelivery" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookingTicketEmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingTicketEmailDelivery_bookingId_key"
    ON "BookingTicketEmailDelivery"("bookingId");
CREATE INDEX "BookingTicketEmailDelivery_status_updatedAt_idx"
    ON "BookingTicketEmailDelivery"("status", "updatedAt");

ALTER TABLE "BookingTicketEmailDelivery"
    ADD CONSTRAINT "BookingTicketEmailDelivery_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
