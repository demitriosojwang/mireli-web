-- Keep checkout capacity under a private reservation relation. The public
-- driver assignment (`tripId`) is populated only after payment confirmation.
ALTER TABLE "Booking"
  ADD COLUMN "reservationTripId" TEXT;

-- Existing unpaid bookings already hold a seat on their selected trip. Move
-- those holds without changing occupancy or losing their checkout state.
UPDATE "Booking"
SET "reservationTripId" = "tripId",
    "tripId" = NULL
WHERE "status" = 'awaiting_payment'
  AND "tripId" IS NOT NULL;

CREATE INDEX "Booking_reservationTripId_status_idx"
  ON "Booking"("reservationTripId", "status");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_reservationTripId_fkey"
  FOREIGN KEY ("reservationTripId") REFERENCES "Trip"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
