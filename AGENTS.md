# Instruksi agent — RodaKawan

Aplikasi komunitas motor Indonesia: Expo/React Native (Android), Supabase
(Postgres + RLS + Auth + Storage + Edge Functions), TypeScript strict.

## Aturan kerja

1. **Bahasa.** Kode dan identifier berbahasa Inggris; komentar, pesan pengguna,
   dokumentasi, dan commit message berbahasa Indonesia. Pesan galat harus
   menyebut tindakan pemulihan, bukan detail internal.
2. **Periksa dulu, jangan mengarang.** Jalankan perintah yang ada di
   `package.json`; jangan menambah dependency tanpa alasan yang diuji. Jangan
   mengklaim suatu fitur "teruji di perangkat" tanpa artefak per kasus.
3. **Jangan menyentuh production.** Semua migration/uji diarahkan ke project
   development (`xvmcpfkkveeaevfcvfug`). Jangan pernah mencetak URL database,
   password, service role key, access token, atau isi `.env*`.
4. **Jangan mengedit migration yang sudah diterapkan.** Tambahkan migration baru
   yang aditif. Nama file dibuat lewat `npx supabase migration new <nama>`.
5. **Jangan force-push / merge otomatis.** Kerjakan di branch terpisah; biarkan
   pemilik me-review.

## Perintah quality gate

```bash
npm ci
npm run deps:check
npm run typecheck
npm run lint
npm run format:check
npm test -- --ci
npm run test:scripts
npm run db:test:lint
npm run db:test                 # butuh .env.db → project development
npm run db:types:check          # butuh .env.db
npm run storage:test            # butuh .env.db + .env.local
npm run export:android
npm run doctor
```

`npm test` menjalankan `pretest` (`deps:check` + `db:test:lint`). Uji RLS berjalan
dalam transaksi dan `ROLLBACK`; setiap berkas di `supabase/tests/` wajib punya
direktif `-- db:test notice: <teks>` dan berkasnya terdaftar di
`DEFAULT_TEST_FILES` (`scripts/db-test.mjs`).

## Arsitektur yang tidak boleh dilanggar

- **Otorisasi di database.** RLS adalah otoritas terakhir; UI bukan batas
  keamanan. Fungsi `security definer` wajib `search_path = ''`, memakai
  `auth.uid()` untuk identitas, dan grant-nya dicabut dari `public`/`anon` lalu
  diberikan hanya ke peran yang perlu.
- **Storage.** Jangan `DELETE` langsung dari `storage.objects`; Supabase
  memblokirnya. Gunakan Storage API. Bucket privat: `avatars`,
  `vehicle-photos`, `club-logos`; path adalah bagian dari otorisasi
  (`<uid>/…`, `<club_id>/…`).
- **Hapus akun (ADR-076/ADR-077).** Satu jalur: Edge Function `delete-account`
  → media Storage (logo klub dipindahkan, bukan dihapus) → `purge_account_data`
  (satu transaksi) → Auth Admin API. Blokir akun dipertahankan lewat tombstone
  `00000000-0000-4000-8000-000000000001`; profil akun dihapus. Jangan
  menambahkan klien yang menghapus sebagian data lalu mengaku sukses.
- **Identitas profil.** `profiles.id` sengaja **tidak** punya FK ke
  `auth.users`; trigger `enforce_profile_identity` menjaga pembuatan profil
  aktif dan mencegah akun terhapus dibuat ulang. Jangan menambah FK balik tanpa
  ADR baru.
- **Konten bersama.** Laporan bahaya, audit moderasi, dan riwayat yang
  dipertahankan tidak boleh hilang saat akun dihapus; identitasnya dialihkan ke
  tombstone dan isi pribadi diredaksi.
- **Realtime.** Chat memakai Postgres Changes; RLS tetap penentu akses. Jangan
  menambah policy baca yang lebih longgar demi kenyamanan UI.

## Uji dan status

Gunakan istilah ini secara konsisten: **Implemented**, **Passed locally**,
**Passed against dev backend**, **Tested on physical device**, **Blocked**.
Uji SQL membuktikan database/RLS, bukan Auth Admin API atau Storage API. Untuk
alur lintas layanan, jalankan uji E2E terhadap project development dan catat
hasil per butir di `docs/QA_TEST_PLAN.md`.

## Rilis

- `scripts/should-release.mjs` menentukan apakah perubahan perlu APK. Perubahan
  dokumen/uji SQL/tooling tidak memicu build.
- Rilis hanya dari commit yang lulus CI + Database RLS.
- Jangan menandai rilis sukses sebelum workflow selesai dan asset terunggah.
  Catat commit, SHA-256 APK, dan sertifikat penandatangan dari log verifikasi.
- `CHANGELOG.md` ditulis workflow; jangan menyunting entri lama.

## Web publik

`web/` berisi halaman statis privasi dan hapus akun. Halaman itu **belum
ter-deploy**; jangan mengklaim URL publik sebelum pemilik menerbitkannya.
`web/account-deletion/config.js` hanya boleh berisi URL project + publishable
key, tidak pernah service role key.
