-- CreateEnum
CREATE TYPE "StatusShift" AS ENUM ('TERBUKA', 'DITUTUP');

-- CreateEnum
CREATE TYPE "JenisShiftEvent" AS ENUM ('BUKA', 'TUTUP', 'PAKSA_TUTUP');

-- CreateTable
CREATE TABLE "kasir_shifts" (
    "id" TEXT NOT NULL,
    "warung_id" TEXT NOT NULL,
    "dibuka_oleh" TEXT NOT NULL,
    "ditutup_oleh" TEXT,
    "dibuka_pada" TIMESTAMPTZ(3),
    "ditutup_pada" TIMESTAMPTZ(3),
    "status" "StatusShift" NOT NULL DEFAULT 'TERBUKA',
    "catatan_buka" TEXT,
    "catatan_tutup" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kasir_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kasir_shift_events" (
    "id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "warung_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "jenis" "JenisShiftEvent" NOT NULL,
    "waktu" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "catatan" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kasir_shift_events_pkey" PRIMARY KEY ("id")
);

-- AlterTable: transactions now belong to the shift that was open when they were created.
ALTER TABLE "transaksis" ADD COLUMN "shift_id" TEXT;

-- CreateIndex
CREATE INDEX "kasir_shifts_warung_id_status_idx" ON "kasir_shifts"("warung_id", "status");

-- CreateIndex
CREATE INDEX "kasir_shifts_warung_id_dibuka_pada_idx" ON "kasir_shifts"("warung_id", "dibuka_pada");

-- CreateIndex
CREATE INDEX "kasir_shift_events_shift_id_idx" ON "kasir_shift_events"("shift_id");

-- CreateIndex
CREATE INDEX "kasir_shift_events_warung_id_waktu_idx" ON "kasir_shift_events"("warung_id", "waktu");

-- At most one open shift per outlet.
CREATE UNIQUE INDEX "kasir_shifts_one_open_per_warung" ON "kasir_shifts"("warung_id") WHERE "status" = 'TERBUKA';

-- CreateIndex
CREATE INDEX "transaksis_shift_id_idx" ON "transaksis"("shift_id");

-- AddForeignKey
ALTER TABLE "kasir_shifts" ADD CONSTRAINT "kasir_shifts_warung_id_fkey" FOREIGN KEY ("warung_id") REFERENCES "warungs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasir_shifts" ADD CONSTRAINT "kasir_shifts_dibuka_oleh_fkey" FOREIGN KEY ("dibuka_oleh") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasir_shifts" ADD CONSTRAINT "kasir_shifts_ditutup_oleh_fkey" FOREIGN KEY ("ditutup_oleh") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasir_shift_events" ADD CONSTRAINT "kasir_shift_events_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "kasir_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasir_shift_events" ADD CONSTRAINT "kasir_shift_events_warung_id_fkey" FOREIGN KEY ("warung_id") REFERENCES "warungs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasir_shift_events" ADD CONSTRAINT "kasir_shift_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaksis" ADD CONSTRAINT "transaksis_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "kasir_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only guard: shift events may never be edited or deleted.
CREATE OR REPLACE FUNCTION prevent_kasir_shift_event_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'kasir_shift_events bersifat append-only: % tidak diizinkan', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER kasir_shift_events_append_only
BEFORE UPDATE OR DELETE ON "kasir_shift_events"
FOR EACH ROW EXECUTE FUNCTION prevent_kasir_shift_event_mutation();
