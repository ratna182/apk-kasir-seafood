-- CreateTable
CREATE TABLE "kasir_sesis" (
    "id" TEXT NOT NULL,
    "warung_id" TEXT NOT NULL,
    "tanggal" DATE NOT NULL,
    "ditutup_oleh" TEXT NOT NULL,
    "ditutup_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dibuka_kembali_pada" TIMESTAMP(3),
    "total_transaksi" INTEGER NOT NULL,
    "total_pendapatan" INTEGER NOT NULL,

    CONSTRAINT "kasir_sesis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kasir_sesis_warung_id_tanggal_ditutup_pada_idx" ON "kasir_sesis" ("warung_id", "tanggal", "ditutup_pada");

-- AddForeignKey
ALTER TABLE "kasir_sesis" ADD CONSTRAINT "kasir_sesis_warung_id_fkey" FOREIGN KEY ("warung_id") REFERENCES "warungs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasir_sesis" ADD CONSTRAINT "kasir_sesis_ditutup_oleh_fkey" FOREIGN KEY ("ditutup_oleh") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;