# Changelog

Seluruh rilis APK RodaKawan, terbaru di atas. Bagian di bawah dibuat otomatis oleh
`.github/workflows/release-on-push.yml` dan `.github/workflows/android-release.yml` dari catatan
rilis yang sama dengan halaman Releases (`scripts/release-notes.mjs`); jangan menyunting entri yang
sudah ada — entri berikutnya disisipkan di atasnya. Rilis produksi tampil sebagai bagian penuh,
sedangkan build preview (`v<versi>-build<N>`) diringkas di dalam blok yang bisa dibuka. Judul tiap
versi adalah tautan ke halaman rilisnya di GitHub, sehingga riwayat ini bisa dinavigasi langsung
dari berkas.

## [v0.1.0-build18](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build18) — 2026-10-18 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Fitur

- add image size shim for Jest tests to support Promise-based Image.getSize (`575b166`)

### Perubahan lain

- catat bahwa uji RLS kini berjalan otomatis di CI (`efcf203`)
- tambahkan newline akhir berkas ci.yml (`b68f562`)
- jalankan uji RLS otomatis saat file database berubah (`21e49d1`)
- sebut ketiga run CI yang hijau, bukan hanya satu commit (`217cff3`)
- tunjuk APK preview yang bisa membuktikan Milestone 2 (`ab3a9a8`)
- sinkronkan status Milestone 2 dengan bukti yang diverifikasi ulang (`95ec43a`)

</details>

## [v0.1.0-build11](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build11) — 2026-10-16 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Fitur

- update Expo SDK dependencies and add version check script (`a9858a9`)
- implement Milestone 2 garage and club membership with verifiable RLS (`cf818be`)

### Perubahan lain

- lampirkan checklist uji perangkat fisik pada laporan Milestone 2 (`1ef13a8`)

</details>

## [v0.1.0-build9](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build9) — 2026-10-15 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Fitur

- update write-app-env script to include EXPO_PUBLIC_MAP_STYLE_URL and improve validation (`7639ba9`)
- update write-app-env script to handle optional EXPO_PUBLIC_MAP_STYLE_URL variable (`7ca888a`)
- update changelog to include links to GitHub release pages and enhance documentation (`61aa9dc`)
- add script to write .env.local from public environment variables (`02d40f5`)
- add packageManager field to specify pnpm version in package.json (`fe5c88c`)
- add GitHub Actions workflow for automated release on push to main (`8aa64ec`)
- implement follow consent for private profiles and enhance vehicle details ownership integrity (`c4b7ccd`)
- implement automatic APK release workflow and update project configuration (`0b989a0`)
- update documentation and gitignore for Supabase project setup and RLS testing results (`1adcfcd`)
- update connection string to use session pooler for Supabase and enhance SSL handling in documentation (`f5dca93`)
- simplify Supabase CLI initialization and update setup instructions (`b897c83`)
- update migration files and documentation for Supabase integration (`6077900`)
- add initial schema and bootstrap profile function for user management (`4f24193`)
- add PostgreSQL support and implement RLS tests (`6afd563`)
- implement webcrypto polyfill for Hermes and create Supabase client (`b2178b8`)
- implement HomeScreen component with application status and milestone display (`8dc8e37`)
- add StateView component for displaying various application states (`88309a9`)

### Perbaikan

- ensure app-preview.apk is included in release artifacts (`b888c49`)

### Perubahan lain

- remove version specification for PNPM setup in GitHub Actions workflow (`713cec0`)
- add pnpm lockfile (`d0749b3`)
- first commit (`0578e80`)

</details>
