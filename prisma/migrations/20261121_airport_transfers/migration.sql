ALTER TABLE "Driver" ADD COLUMN "rideService" TEXT NOT NULL DEFAULT 'sgr'
    CHECK ("rideService" IN ('sgr', 'airport', 'both'));

CREATE TABLE "AirportTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "passengerId" TEXT NOT NULL REFERENCES "Passenger"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "driverId" TEXT REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "requestKey" TEXT NOT NULL,
    "airport" TEXT NOT NULL CHECK ("airport" IN ('mba', 'uka')),
    "direction" TEXT NOT NULL CHECK ("direction" IN ('from', 'to')),
    "address" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "passengers" INTEGER NOT NULL CHECK ("passengers" > 0),
    "flight" TEXT,
    "luggage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested'
        CHECK ("status" IN ('requested', 'quoted', 'confirmed', 'in_progress', 'completed', 'cancelled')),
    "quoteKes" INTEGER CHECK ("quoteKes" > 0),
    "quoteExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "AirportTransfer_passengerId_requestKey_key" ON "AirportTransfer"("passengerId", "requestKey");
CREATE INDEX "AirportTransfer_status_pickupAt_idx" ON "AirportTransfer"("status", "pickupAt");
CREATE INDEX "AirportTransfer_driverId_status_pickupAt_idx" ON "AirportTransfer"("driverId", "status", "pickupAt");
