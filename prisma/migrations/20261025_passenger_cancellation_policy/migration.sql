ALTER TABLE "Booking"
  ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3);

ALTER TABLE "PlatformConfig"
  ALTER COLUMN "fullRefundCutoffMinutes" SET DEFAULT 1440;

UPDATE "PlatformConfig"
SET "fullRefundCutoffMinutes" = 1440
WHERE "id" = 'main';
