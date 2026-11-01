ALTER TABLE "PlatformConfig"
ADD COLUMN "unpaidBookingHoldMinutes" INTEGER NOT NULL DEFAULT 15;

CREATE INDEX "Booking_status_createdAt_idx"
ON "Booking"("status", "createdAt");
