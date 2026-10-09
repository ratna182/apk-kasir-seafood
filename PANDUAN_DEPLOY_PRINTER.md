# Panduan Deploy Kasir dan Printer iMin

## 1. Repository Vercel

Di Vercel, buka project kasir lalu pastikan:

- Connected repository: `ratna182/apk-kasir-seafood`
- Production branch: `master`
- Framework: `Next.js`
- Root Directory: `./` atau kosong
- Install Command: `npm install`
- Build Command: `npm run build`

## 2. Environment Variables

Di **Settings > Environment Variables**, isi untuk environment **Production**:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
SESSION_SECRET=random-string-minimal-32-characters
```

Buat `SESSION_SECRET` secara lokal:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Jangan commit file `.env` atau nilai secret ke GitHub.

## 3. Memperbaiki Migration Gagal

Build Vercel sebelumnya gagal dengan:

```text
P3009: migrate found failed migrations
20261005000000_create_kasir_sesi_table
```

Buka **Neon > SQL Editor** pada database yang sama dengan `DATABASE_URL`, lalu jalankan query diagnostik berikut:

```sql
SELECT migration_name, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name = '20261005000000_create_kasir_sesi_table';

SELECT to_regclass('public.kasir_sesis') AS kasir_sesis_table;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'kasir_sesis'
ORDER BY ordinal_position;
```

### Kasus A: tabel sudah ada dan kolom lengkap

Kolom yang diharapkan:

- `id`
- `warung_id`
- `tanggal`
- `ditutup_oleh`
- `ditutup_pada`
- `dibuka_kembali_pada`
- `total_transaksi`
- `total_pendapatan`

Jalankan dari folder project lokal dengan `DATABASE_URL` production sementara:

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require"
npx prisma migrate resolve --applied 20261005000000_create_kasir_sesi_table
npx prisma migrate status
```

Jangan simpan nilai `DATABASE_URL` ke file atau commit.

### Kasus B: tabel belum ada atau hanya terbentuk sebagian

Jangan menjalankan `--applied` dan jangan menjalankan `prisma migrate reset`.

Kirim hasil query diagnostik kepada developer/database administrator. Migration harus diperbaiki atau bagian yang gagal harus diselesaikan secara manual terlebih dahulu agar tidak merusak data transaksi.

## 4. Redeploy Vercel

Setelah migration berstatus applied atau sudah diperbaiki:

1. Buka **Vercel > Deployments**.
2. Pilih commit `f816cc9` pada branch `master`.
3. Klik `... > Redeploy`.
4. Matikan penggunaan build cache jika pilihan tersebut tersedia.
5. Tunggu status menjadi `Ready`.

Build yang benar akan menjalankan:

```text
npm install
npm run build
```

## 5. Verifikasi Web

Buka:

```text
https://kasir-seafood.vercel.app/login
https://kasir-seafood.vercel.app/printer-test
```

Sebelum login, `/printer-test` boleh diarahkan ke `/login`. Setelah login, halaman diagnostik harus tampil.

## 6. Build dan Install APK

APK yang sudah dibangun berada di:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

APK menggunakan server:

```text
https://kasir-seafood.vercel.app
```

Install APK setelah deployment web berstatus `Ready`. Jika APK lama memakai signing key berbeda, uninstall APK lama terlebih dahulu.

## 7. Tes Printer iMin

1. Install APK ke D4-504.
2. Login ke kasir.
3. Buka `/printer-test`.
4. Tekan `Connect`.
5. Pastikan status `connected`.
6. Tekan `Cetak Struk Uji`.
7. Buka **Setup Printer** dan pilih **Gunakan Printer Built-in (iMin)**.
8. Cetak order asli.

Untuk log navigasi dan printer:

```bash
adb logcat -s NavTrace IMinPrinter
```

Saat mencetak struk iMin, tidak boleh ada navigasi browser. Jika hasil native tidak pasti, UI menampilkan `unknown`; jangan langsung menekan cetak ulang sampai memastikan kertas tidak keluar.

## 8. Batasan Verifikasi

Build APK dan build web dapat diverifikasi tanpa device. Hasil kertas keluar dari printer D4-504 hanya dapat diverifikasi di device fisik.
