-- Add an optional client-generated key for atomic direct checkout.
-- Existing saved orders keep NULL, and PostgreSQL allows multiple NULL values.
ALTER TABLE "transaksis" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "transaksis_warung_id_idempotency_key_key"
ON "transaksis"("warung_id", "idempotency_key");
