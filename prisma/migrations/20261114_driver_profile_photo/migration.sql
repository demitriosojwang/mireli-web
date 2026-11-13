CREATE TABLE "DriverProfilePhoto" (
    "driverId" TEXT NOT NULL,
    "jpeg" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverProfilePhoto_pkey" PRIMARY KEY ("driverId")
);

ALTER TABLE "DriverProfilePhoto" ADD CONSTRAINT "DriverProfilePhoto_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
