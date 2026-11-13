ALTER TABLE "DriverDocument"
  ADD COLUMN "filePurgeAt" TIMESTAMP(3),
  ADD COLUMN "filePurgedAt" TIMESTAMP(3),
  ADD COLUMN "expiryReminderAt" TIMESTAMP(3);

-- Give existing finalized files the full transition period. Pending review is excluded.
UPDATE "DriverDocument"
SET "filePurgeAt" = GREATEST(CURRENT_TIMESTAMP, COALESCE("reviewedAt", "createdAt")) + INTERVAL '7 days'
WHERE "state" IN ('approved', 'rejected', 'replaced');

CREATE INDEX "DriverDocument_filePurgeAt_idx" ON "DriverDocument"("filePurgeAt");
CREATE INDEX "DriverDocument_state_expiresAt_idx" ON "DriverDocument"("state", "expiresAt");
