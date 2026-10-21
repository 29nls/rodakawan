# Changelog

Seluruh rilis APK RodaKawan, terbaru di atas. Bagian di bawah dibuat otomatis oleh
`.github/workflows/release-on-push.yml` dan `.github/workflows/android-release.yml` dari catatan
rilis yang sama dengan halaman Releases (`scripts/release-notes.mjs`); jangan menyunting entri yang
sudah ada — entri berikutnya disisipkan di atasnya. Rilis produksi tampil sebagai bagian penuh,
sedangkan build preview (`v<versi>-build<N>`) diringkas di dalam blok yang bisa dibuka. Judul tiap
versi adalah tautan ke halaman rilisnya di GitHub, sehingga riwayat ini bisa dinavigasi langsung
dari berkas.

## [v0.1.0-build31](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build31) — 2026-10-20 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Perubahan lain

- Menambahkan dashboard moderasi berbasis konteks perjalanan dan memindahkan penyaringan pesan terblokir ke sisi server untuk memperkuat privasi dan kepatuhan RLS. (`55cee4d`)
- Selesaikan Milestone 4 dan pulihkan gerbang kualitas yang merah (`e3a1653`)
- streamline code formatting and improve error handling in hazards and chat features (`2b84ec4`)
- Implement Milestone 4 hazard reports and convoy chat (`ed603e4`)
- Add RLS and RPC tests for chat and hazard reporting features in Milestone 4 (`b6b6e7f`)

</details>

## Belum dirilis — Milestone 4 (21 Oktober 2026)

Catatan manual; belum ada tag rilis yang memuat perubahan ini. Rilis berikutnya akan disisipkan di atas
bagian ini oleh workflow rilis.

### Fitur

- Laporan bahaya jalan: buat, filter kategori/keparahan, ubah/lepas dalam 15 menit, konfirmasi
  "masih ada", dan lapor penyalahgunaan. Masa berlaku dihitung server per kategori; tanpa peta
  (ADR-064 masih Proposed), daftar memakai label area perkiraan dari koordinat.
- Chat konvoi di detail perjalanan: riwayat 50 pesan + muat pesan lama (keyset), kirim idempoten,
  ubah/hapus 15 menit, pesan sistem untuk mulai/selesai/batal dan perubahan peserta, realtime
  Postgres Changes, serta penyembunyian pesan dari pengguna yang diblokir.
- Dashboard moderasi laporan penyalahgunaan: antrean laporan atas hazard dan chat untuk host
  perjalanan/admin klub, aksi hapus konten (soft delete), abaikan, dan tandai ditinjau, plus jejak
  audit yang mencatat pelaku, alasan, dan waktu. Tanpa peran moderator global (ADR-067).
- Migration `20261020090000_hazard_reports_m4.sql` dan `20261020100000_convoy_chat_m4.sql`:
  RPC `security definer`, idempotensi, batas laju, deteksi duplikat, trigger expiry/pesan sistem, dan
  pencabutan jalur tulis langsung. **Sudah diterapkan** ke project development.
- Migration `20261021120000_moderation_dashboard.sql`: tabel audit `moderation_actions`, helper
  wewenang `can_moderate_*`, policy baca moderator pada `content_reports`, dan RPC
  `get_moderation_subject`/`moderate_hazard`/`moderate_chat_message`/`review_content_report`/
  `list_moderation_actions`. **Sudah diterapkan**.
- Migration `20261021130000_blocked_chat_server_filter.sql`: helper `is_blocked_by_me` dan policy
  `chat_select_ride_member` baru yang menyaring pesan teks dari pengguna yang diblokir. **Sudah
  diterapkan**.

### Perbaikan

- Pesan dari pengguna yang diblokir kini disaring **di server** lewat policy `chat_select_ride_member`
  dan helper `is_blocked_by_me` (ADR-068), bukan disembunyikan di UI setelah isinya terkirim. Berlaku
  untuk REST maupun realtime; pesan sistem tetap terlihat. Klien tidak lagi memuat daftar blokir.
- `ROW_NOT_APPLIED_ERROR` dikembalikan ke `not_authorized`; sebelumnya (commit `2b84ec4`) berubah
  menjadi `not_found` dan membuat empat test garasi/klub gagal serta pesan yang tidak bisa
  ditindaklanjuti.
- Tab Peringatan tidak lagi melempar exception ketika client mengembalikan galat; kegagalan muat
  ditampilkan sebagai state error.
- Akhiran baris CRLF pada lima berkas dinormalkan ke LF dan dua pelanggaran `react-hooks` di
  `ChatPanel.tsx` diperbaiki, sehingga `npm run lint` dan `npm run format:check` kembali exit 0
  (CI `#37` sebelumnya gagal di langkah Lint).

### Catatan

- API chat/hazard yang lama (`getChatHistory`, `insertRideSystemMessage`, `filterActiveMembers`) diganti;
  `insert_ride_system_message` sengaja tidak punya grant untuk `authenticated`.
- Belum ada rilis APK yang memuat Milestone 4; build terbaru tetap `v0.1.0-build28` (`794d473`).

## [v0.1.0-build28](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build28) — 2026-10-20 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Fitur

- add MapStatusCard component and corresponding tests for map rendering states (`794d473`)

### Perubahan lain

- selaraskan dokumentasi dengan rilis build26 (`0ff389d`)

</details>

## [v0.1.0-build26](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build26) — 2026-10-20 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Fitur

- siapkan lapisan provider peta tanpa dependency (`b0c8361`)

### Perubahan lain

- rapikan status rilis dan tautan peta di README/ROADMAP (`6a3340e`)
- tutup celah uji formulir perjalanan dan catat usulan peta (`dde55d1`)

</details>

## [v0.1.0-build23](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build23) — 2026-10-18 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Perbaikan

- hentikan pelacakan saat akses lokasi dicabut (`df75ba1`)

</details>

## [v0.1.0-build22](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build22) — 2026-10-18 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Perubahan lain

- Add RLS tests for ride sharing and location consent (`554a507`)

</details>

## [v0.1.0-build21](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build21) — 2026-10-18 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Perubahan lain

- catat build20 sebagai rilis terbaru dan build19 sebagai baseline (`a7d67db`)
- tambah draft RLS/RPC Milestone 3 tanpa mengaktifkan skema (`60985a2`)

</details>

## Catatan rinci Milestone 3 (dirilis bertahap di build21–build23)

Bagian ini ditulis manual dan bukan entri rilis tersendiri; entri rilis di atas tetap otoritatif
untuk tanggal, tag, dan APK. Rincian di bawah menjelaskan isi Milestone 3 yang masuk lewat beberapa
build preview.

- Perjalanan klub: buat/ubah, undang, terima undangan, gabung, keluar, keluarkan peserta, dan
  kontrol host untuk memulai/menyelesaikan/membatalkan. Seluruh mutasi lewat RPC transactional dengan
  state machine di database; klien tidak menulis `rides`/`ride_members` langsung.
- Berbagi lokasi opt-in per perjalanan: consent terpisah dari izin Android, satu baris lokasi terakhir
  per peserta (tanpa riwayat GPS), sampling 15 detik/25 meter, marker basi setelah 60 detik, dan
  penghapusan otomatis saat opt-out, keluar, dikeluarkan, atau perjalanan final.
- Realtime posisi lewat Postgres Changes pada `ride_locations` (RLS per baris), bukan kanal publik.
- `expo-location` + `expo-task-manager` dengan foreground service Android; izin background diminta
  terpisah setelah penjelasan, dan izin notifikasi Android 13+ diminta lebih dulu agar tanda
  berbagi tetap terlihat.
- Task lokasi berhenti sendiri saat server menolak secara permanen (consent dicabut, peserta
  dikeluarkan, atau perjalanan final), memakai penjaga agar batch tidak tumpang tindih, dan tidak
  meninggalkan ride id tertinggal bila task gagal dimulai. Membuka detail perjalanan lain tidak
  lagi menghentikan task yang sedang berjalan di perjalanan sendiri.
- Migration `20261019120000_ride_workflow.sql`, tipe database diperbarui, uji RLS/RPC perjalanan
  (**67 perintah**), dan uji Jest untuk API/validasi/kesegaran/UI.
- **Belum:** renderer peta (ADR-064), uji dua perangkat, GPS mati/mode pesawat/force-stop/reboot, dan
  pengukuran baterai 30 menit.

## [v0.1.0-build20](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build20) — 2026-10-18 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Perbaikan

- stabilkan test changelog Windows dan selaraskan npm (`fa4397e`)

</details>

## [v0.1.0-build19](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build19) — 2026-10-18 · pratinjau

<details>
<summary>Catatan rilis pratinjau</summary>

### Perubahan lain

- Refactor code structure for improved readability and maintainability (`ca2461c`)

</details>

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
