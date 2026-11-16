CREATE TABLE "DriverPosition" (
    "tripId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "bearingDeg" DOUBLE PRECISION,
    "speedMps" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverPosition_pkey" PRIMARY KEY ("tripId")
);

CREATE INDEX "DriverPosition_driverId_recordedAt_idx" ON "DriverPosition" ("driverId", "recordedAt");

ALTER TABLE "DriverPosition" ADD CONSTRAINT "DriverPosition_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverPosition" ADD CONSTRAINT "DriverPosition_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
