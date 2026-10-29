# Langkah berikutnya — audit induk 28 Oktober 2026

Tanggal: **28 Oktober 2026** · Branch: `audit/current-main-2026-10-28` · HEAD: `30e3524`
(tag `v0.1.0-build72`, merge PR #24 `feat/closed-beta-safe-build`) · Target database:
**development** `xvmcpfkkveeaevfcvfug` saja.

Dokumen ini jejak singkat audit: baseline, temuan yang dikonfirmasi, perubahan yang benar-benar
diterapkan, bukti uji, keputusan yang tetap milik pemilik, dan gerbang rilis. Label status
mengikuti `AGENTS.md`: **Implemented**, **Passed locally**, **Passed against dev backend**,
**Tested on physical device**, **Blocked**; untuk non-teknis dipakai **Needs decision**,
**NOT RUN**, dan **PASS/FAIL** pada bukti perintah.

## 1. Basar yang diverifikasi ulang

| Butir | Keadaan (28 Oktober 2026) | Status |
| --- | --- | --- |
| Branch / HEAD | `audit/current-main-2026-10-28` di `30e3524`; sama dengan `main` dan tag `v0.1.0-build72` | **PASS** (git) |
| Rilis terbaru | `v0.1.0-build72` dari PR #24; CI, Database RLS, build APK, dan smoke-test emulator lulus pada run tersebut | **PASS** (GitHub Actions) |
| Environment `beta` | Belum ada di repository; preflight beta exit 2 (`BETA_SUPABASE_PROJECT_REF` tidak dikonfigurasi) | **Blocked** |
| Paritas migration | `npx supabase migration list --linked` → **31 lokal = 31 remote** (termasuk `20261028031237`) | **PASS** |
| Edit lokal yang sudah ada | `.vscode/settings.json` dan `supabase/functions/delete-account/index.ts` dimodifikasi sebelum sesi; dipertahankan apa adanya, tidak dimodifikasi dan tidak di-commit | catatan kepemilikan |

## 2. Temuan yang dikonfirmasi dan tindakannya

| ID | Temuan | Status | Bukti / tindakan |
| --- | --- | --- | --- |
| AUD-11 | Enam helper RLS (`is_club_member`, `is_club_admin`, `is_ride_member`, `is_ride_host`, `is_ride_active_member`, `can_publish_ride_location`) masih dapat dieksekusi `anon` | **FIXED — Passed against dev backend** | Migration aditif `supabase/migrations/20261028031237_revoke_anon_rls_helper_execute.sql` mencabut `EXECUTE` dari `public`/`anon`. Penelusuran 76 `create policy` di seluruh migration: semuanya `to authenticated`, tidak ada pemanggil `anon`. Diterapkan ke development setelah `--dry-run` hanya menampilkan migration ini |
| AUD-11 (regression) | Pagar uji harus mencegah grant kembali | **PASS** | `supabase/tests/rls_catalog_test.sql` + `supabase/tests/rls_catalog_hardening_test.sql`: daftar pengecualian helper dikosongkan (cek anti-usang), plus asersi dua sisi — `anon` ditolak, `authenticated` tetap diizinkan (menjaga policy Storage logo klub dan policy RLS lain) |
| AUD-12 | CHECK `not valid` pada `motorcycle_private_details` belum divalidasi untuk baris lama | **Open (Low)** | Periksa data lama lalu `validate constraint`; bukan perubahan kode |
| AUD-13 | CHECK panjang kolom path belum ada | **Open (Low)** | Migration aditif berikutnya bila diperlukan |
| AUD-14 | Rate limit jalur tulis | **Implemented — Passed against dev backend** | Tiga migration throttle + FK cascade sudah di development; `db:test` dan `db:test:concurrency` lulus 28 Oktober |
| AUD-19 | Uji perangkat fisik PD-01…PD-22 | **Blocked** | Tidak ada perangkat pada sesi ini; checklist bukti ada di `docs/QA_TEST_PLAN.md` §8f |
| AUD-20/AUD-27/AUD-28 | Halaman web belum terbit; `config.js` menunjuk development | **Blocked** | Butuh aktivasi GitHub Pages + backend rilis oleh pemilik; jangan mengklaim URL publik |
| AUD-21 | Belum ada project produksi | **Needs decision** | Rencana lengkap di `docs/PRODUCTION_MIGRATION_PLAN.md` |
| AUD-22 | Cadangan keystore belum terverifikasi | **Open (Medium)** | Jadwalkan verifikasi oleh pemilik |
| AUD-23 | Retensi data (hazard/audit/pesan teredaksi/metadata job) belum disahkan | **Needs decision** | Produk + legal; cleanup otomatis belum boleh dibuat |
| AUD-25 | `npm audit` melaporkan kerentanan toolchain build | **Open (Low)** | Jangan `npm audit fix --force` (menurunkan Expo ke 44.x); pantau patch SDK 57 |
| AUD-26 | `autoconfirm` aktif di development | **Needs decision** | Preflight exit 1 (7 lulus, 1 gagal); pemilik memilih: aktifkan Confirm email + SMTP kustom, atau terima risiko tertulis |
| C-01 | `supabase/config.toml` kini ada (berisi `verify_jwt = false` + komentar penjelas) | **Implemented** | Catatan: penghapusan verifikasi platform ditutup oleh verifikasi `auth.getUser` di dalam fungsi; lihat komentar `config.toml` §0.1 `PRODUCTION_MIGRATION_PLAN.md` |

Temuan **Critical/High: 0** — konsisten dengan `docs/SECURITY_RELEASE_AUDIT.md`.

## 3. Perubahan yang dibuat pada audit ini

| Berkas | Perubahan |
| --- | --- |
| `supabase/migrations/20261028031237_revoke_anon_rls_helper_execute.sql` | **Baru** — `revoke all … from public, anon` pada enam helper; komentar memuat latar dan audit trail |
| `supabase/tests/rls_catalog_test.sql` | Daftar pengecualian helper dikosongkan; komentar anti-usang diperbarui |
| `supabase/tests/rls_catalog_hardening_test.sql` | Komentar bagian (a) diperbarui; tabel pengecualian hanya menyisakan `touch_updated_at()`; asersi dua sisi anon/authenticated ditambahkan |
| `docs/BETA_READINESS.md` | S-03 diperbarui (1 pengecualian); §7d bukti verifikasi lanjutan |
| `docs/SECURITY_RELEASE_AUDIT.md` | AUD-11 dipindahkan ke Ditutup dengan bukti; AUD-05, tabel severity, dan §5 diperbarui |
| `docs/QA_TEST_PLAN.md` | Catatan hasil terbaru merujuk §7d dan asersi dua sisi |
| `docs/NEXT_STEPS_AUDIT_2026-10-28.md` | Berkas ini |

Tidak ada perubahan kode aplikasi (`src/**`), dependency, `app.json`, maupun workflow.

## 4. Bukti perintah (28 Oktober 2026)

| Perintah | Hasil |
| --- | --- |
| `npm run db:test:lint` | **PASS** — 12 berkas uji / 31 migration |
| `npx supabase db push --dry-run --linked` | **PASS** — hanya migration revoke yang tertunda |
| `npx supabase db push --linked --yes` | **PASS** — migration diterapkan ke development |
| `npm run db:test` (sebelum push) | **FAIL 10/12** — dua uji katalog menangkap grant yang belum dicabut (detektor bekerja sebagaimana mestinya) |
| `npm run db:test` (sesudah push) | **PASS 12/12** — seluruh notice penanda diterima server |
| `npx supabase migration list --linked` | **PASS** — 31 lokal = 31 remote |
| `git diff --check` | **PASS** — tidak ada whitespace error |

**NOT RUN** pada sesi ini (tidak ada perubahan kode aplikasi/TS; jalankan di CI sebelum rilis):
`npm ci`, `npm test -- --ci`, `npm run test:scripts`, `typecheck`, `lint`, `format:check`,
`storage:test`, `e2e:account-delete`, `e2e:shared-ride`, `export:android`, `doctor`,
`beta:preflight` (butuh project beta — **Blocked**), uji perangkat fisik (**Blocked**).

## 5. Keputusan pemilik dan prasyarat eksternal

| Keputusan / prasyarat | Pihak | Mengapa memblokir |
| --- | --- | --- |
| Aktifkan/tolak konfirmasi email + SMTP (AUD-26) | Pemilik | Preflight beta gagal pada satu-satunya pemeriksaan ini |
| Buat Environment `beta` GitHub + variabel `BETA_*` + backend beta | Pemilik | Build APK beta tidak bisa dijalankan |
| Aktifkan GitHub Pages dan arahkan `web/account-deletion/config.js` ke backend rilis (AUD-20/27/28) | Pemilik | Syarat Play Console dan uji halaman |
| Project produksi + backup + rehearsal (AUD-21) | Pemilik + engineering | Rilis publik tidak boleh di development |
| Sahkan retensi data (AUD-23) | Produk + legal | Cleanup otomatis dan kebijakan publik |
| Verifikasi cadangan keystore (AUD-22) | Pemilik | Kunci hilang = APK tidak bisa diperbarui |
| Jadwalkan uji dua perangkat fisik + tiga akun (AUD-19) | Pemilik + QA | Satu-satunya bukti yang tidak bisa digantikan uji SQL |
| Setujui/tolak penyedia peta (ADR-064, D-06) | Pemilik produk | Marker peta dan P-03 tidak bisa diklaim selesai |
| Tetapkan nama paket final (ADR-015, B-07) | Pemilik produk | Tidak bisa diubah setelah unggah Play pertama |

## 6. Gerbang rilis

1. **CI + Database RLS hijau** untuk commit perubahan ini (setelah didorong dan di-PR-kan — belum
   dilakukan; aturan repo: kerja di branch terpisah, pemilik me-review).
2. Keputusan **autoconfirm** diambil (AUD-26), lalu `npm run beta:preflight` exit 0.
3. Environment `beta` dibuat, migration dipush ke backend beta, Edge Function `delete-account`
   dideploy ulang, preflight ulang.
4. APK beta dibangun dari variabel beta; SHA-256 dan sertifikat dicatat.
5. Checklist perangkat PD-01…PD-22 (§8f QA) diisi bukti per baris.

## 7. Satu tindakan terpenting berikutnya

**Ambil keputusan `autoconfirm` (AUD-26).** Itu satu-satunya kegagalan preflight yang sudah
berjalan, dan seluruh jalur build/preflight beta berhenti di situ; semua gerbang lain sudah
terpetakan dengan pelaksana masing-masing. Perbaikan kode seperti AUD-11 sudah selesai dan lulus
bukti, sehingga tidak lagi menjadi penghalang.
