-- Airport shuttle destinations + charter VAT.
-- 1. Airport shuttle slots anchor airport-feeder departures through the same
--    scheduler and driver allocation as train-anchored SGR feeder trips.
-- 2. Charter VAT (16%) is charged on top to the client and recorded per
--    booking/ledger so it is never part of the driver's settlement base.

ALTER TABLE "Route" ADD COLUMN "serviceKind" TEXT NOT NULL DEFAULT 'sgr_feeder';

CREATE TABLE "AirportShuttleSlot" (
    "id" TEXT NOT NULL,
    "airportCode" TEXT NOT NULL,
    "airportName" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "departTime" TEXT NOT NULL,
    "serviceDays" INTEGER[] DEFAULT ARRAY[0,1,2,3,4,5,6]::INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AirportShuttleSlot_pkey" PRIMARY KEY ("id")
);

-- Do not alter the existing Trip table shape beyond the new optional anchor:
-- trips already exist for SGR feeders and must keep their train anchor.
ALTER TABLE "Trip" ADD COLUMN "shuttleSlotId" TEXT;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_shuttleSlotId_fkey"
  FOREIGN KEY ("shuttleSlotId") REFERENCES "AirportShuttleSlot"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Trip_shuttleSlotId_idx" ON "Trip"("shuttleSlotId");

ALTER TABLE "Booking" ADD COLUMN "vatAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LedgerEntry" ADD COLUMN "vatAmount" INTEGER NOT NULL DEFAULT 0;
