# Panduan Setup Kasir Seafood

## 1. Persiapan Akun & Layanan (Gratis)

| Layanan | Link | Digunakan untuk |
|---------|------|-----------------|
| Neon Database | https://neon.tech | PostgreSQL database |
| Vercel | https://vercel.com | Hosting server Next.js |
| GitHub | https://github.com | Repo & CI/CD |

---

## 2. Setup Database (Neon)

1. Buka https://neon.tech → Sign up → Create Project
2. Copy **Connection String** (pooled connection):
   ```
   postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
3. Paste ke `.env` → `DATABASE_URL`

---

## 3. Setup Server (Vercel)

1. Push repo ke GitHub
2. Buka Vercel → Import Project → Pilih repo GitHub
3. Environment Variables (Add di Vercel dashboard):
   ```
   DATABASE_URL=postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   SESSION_SECRET=random-string-32-chars (generate di bawah)
   ```
4. Deploy → Dapatkan URL: `https://kasir-seafood-xxx.vercel.app`
5. Copy URL ini ke `.env` → `CAPACITOR_SERVER_URL`

**Generate SESSION_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. Setup Local & Build APK

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma client & migrate database
npx prisma generate
npx prisma migrate deploy

# 3. Seed data awal (optional)
npx prisma db seed

# 4. Build Next.js untuk production
npm run build

# 5. Sync ke Capacitor Android
npx cap sync android

# 6. Build APK debug
cd android && ./gradlew assembleDebug
# APK ada di: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 5. Install ke Device IMIN/HP Android

**Via ADB (device terkoneksi USB):**
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**Atau transfer manual:**
- Copy `app-debug.apk` ke HP
- Buka di File Manager → Install
- Izinkan "Install unknown apps" di Settings

---

## 6. Konfigurasi .env Lengkap

```env
# Database (Neon)
DATABASE_URL="postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/kasir_seafood?sslmode=require"

# Server (Vercel URL setelah deploy)
CAPACITOR_SERVER_URL="https://kasir-seafood-xxx.vercel.app"
CAPACITOR_APP_ID="id.vianjaya.kasir.cabang1"
CAPACITOR_APP_NAME="Kasir Vian Jaya 08 - Cabang 1"

# Session (generate random 32+ chars)
SESSION_SECRET="your-generated-secret-here"
```

---

## 7. Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `adb devices` kosong | Aktifkan USB Debugging di HP, izin di popup |
| Prisma migrate error | Pastikan DATABASE_URL benar, Neon aktif |
| Build Next.js error | Cek `npm run build` log, fix error TypeScript |
| APK tidak bisa buka | Pastikan CAPACITOR_SERVER_URL HTTPS & benar |
| Session tidak jalan | SESSION_SECRET harus sama di local & Vercel |

---

## 8. Update Deploy (Setelah perubahan code)

```bash
git add .
git commit -m "update"
git push origin main
# Vercel auto-deploy
# Lalu build APK baru kalau ada perubahan native/config
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

---

## 9. Produksi (Release APK)

Untuk Play Store / distribusi formal:
```bash
cd android
./gradlew bundleRelease
# AAB di: android/app/build/outputs/bundle/release/app-release.aab
# Perlu signing key (keystore) - lihat docs Capacitor
```