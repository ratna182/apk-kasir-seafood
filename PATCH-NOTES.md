# Printer Investigation and Patch Notes

## Investigation

- Source Android exists at `android/app/src/main/java/id/vianjaya/kasir/cabang1/MainActivity.java`; the iMin dependency is `com.github.iminsoftware:IminPrinterLibrary:V2.0.0.18`.
- The transaction receipt handler previously encoded ESC/POS and called `printer.print()`. It did not call `window.print()` or `window.open()`.
- The setup dialog previously exposed `Gunakan Print Bawaan`; that path has been removed so selecting iMin cannot fall through to a browser print window.
- `src/app/laporan/LaporanClient.tsx` and `src/app/riwayat/RiwayatClient.tsx` still contain browser print windows for their existing browser/report flows. They are not used by the transaction iMin handler.
- `src/lib/printer/bluetooth.ts` still contains Web Bluetooth for the explicitly selected Bluetooth printer. It is not used by the iMin handler.
- The deployed APK/web combination was not available as a runtime device session here, so the original external URL cannot be proven without installing the debug APK and collecting `adb logcat -s NavTrace`.

## Changes

- iMin printing now has a job-aware `printJob(jobId, base64)` contract with `printed`, `failed`, and `unknown` results.
- Transaction printing generates a unique job ID and does not use browser print APIs or automatic web navigation.
- Native printing is serialized, deduplicated for 60 seconds, reconnects for up to 3 seconds, and retries only definite pre-print failures. Timeout returns `unknown` without retry.
- Native version is `1.1` / version code `2`.
- Capacitor navigation allowlist is restricted to `kasir-seafood.vercel.app`; native `NavTrace` logs URL override attempts.
- `/printer-test` provides connect, test receipt, status, job ID, attempts, and result logs.

## Verification status

The web and Android commands must be run from this directory:

```text
npm run test:run
npx tsc --noEmit
npm run lint
npm run build
npx cap sync android
./gradlew assembleDebug
```

- `npx tsc --noEmit`: passed.
- Printer/payment tests: 16 passed.
- `npx cap sync android`: passed.
- `gradlew.bat assembleDebug`: passed with Android Studio JBR Java 25 because the installed JDK 17 cannot compile Capacitor 8's Java 21 source target.
- `npm run build`: passed when run with a temporary process-only `SESSION_SECRET` value. Without that required environment variable it correctly fails during production configuration collection.
- Full `npx vitest run` is not green from the existing repository baseline: two unrelated date-sensitive laporan assertions fail and four `.agents` skill files are incorrectly collected as Vitest files. Those files were not changed.
- `npm run lint` is not green from the existing repository baseline: existing API `any` errors and React effect errors remain; no new TypeScript error was introduced.

No physical D4-504 device is available in this environment. Therefore successful APK compilation is not proof that paper was printed. The expected APK is `android/app/build/outputs/apk/debug/app-debug.apk`; install over the old app only if the signing key matches, otherwise uninstall the old APK first.
