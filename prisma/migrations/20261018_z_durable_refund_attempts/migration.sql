-- Persist and correlate each Daraja refund attempt before sending money.
CREATE TABLE "RefundAttempt" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "callbackHash" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "receiverPhone" TEXT,
    "originalReceipt" TEXT,
    "state" TEXT NOT NULL DEFAULT 'submitting',
    "conversationId" TEXT,
    "originatorId" TEXT,
    "receipt" TEXT,
    "resultCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RefundAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundAttempt_callbackHash_key" ON "RefundAttempt"("callbackHash");
CREATE UNIQUE INDEX "RefundAttempt_conversationId_key" ON "RefundAttempt"("conversationId");
CREATE UNIQUE INDEX "RefundAttempt_originatorId_key" ON "RefundAttempt"("originatorId");
CREATE UNIQUE INDEX "RefundAttempt_receipt_key" ON "RefundAttempt"("receipt");
CREATE INDEX "RefundAttempt_refundId_state_idx" ON "RefundAttempt"("refundId", "state");

ALTER TABLE "RefundAttempt"
    ADD CONSTRAINT "RefundAttempt_refundId_fkey"
    FOREIGN KEY ("refundId") REFERENCES "RefundRecord"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
