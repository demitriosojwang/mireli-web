-- The owner-approved Hailed Ride fare schedule sets the platform fee at KSh 60 per seat.
ALTER TABLE "PlatformConfig" ALTER COLUMN "bookingFeeAmount" SET DEFAULT 60;
UPDATE "PlatformConfig" SET "bookingFeeAmount" = 60 WHERE "bookingFeeAmount" = 50;
