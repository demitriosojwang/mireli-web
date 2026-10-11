ALTER TABLE "Booking"
ADD COLUMN "platformFeeAmount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LedgerEntry"
ADD COLUMN "platformFeeAmount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PayoutRecord"
ADD COLUMN "platformFeeAmount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PlatformConfig"
ADD COLUMN "bookingFeeAmount" INTEGER NOT NULL DEFAULT 50;

UPDATE "PlatformConfig"
SET "commissionRate" = 0.10,
    "payoutMode" = 'instant_per_trip';
