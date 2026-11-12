CREATE TABLE "StaffAccount" (
  "id" TEXT NOT NULL, "email" TEXT NOT NULL, "totpSecret" TEXT,
  "mfaEnrolledAt" TIMESTAMP(3), "lastTotpStep" INTEGER NOT NULL DEFAULT -1,
  "disabledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffAccount_email_key" ON "StaffAccount"("email");
CREATE TABLE "StaffSession" (
  "id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffSession_tokenHash_key" ON "StaffSession"("tokenHash");
CREATE INDEX "StaffSession_accountId_expiresAt_idx" ON "StaffSession"("accountId","expiresAt");
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StaffAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "StaffAuthChallenge" (
  "id" TEXT NOT NULL, "email" TEXT NOT NULL, "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffAuthChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffAuthChallenge_email_createdAt_idx" ON "StaffAuthChallenge"("email","createdAt");
