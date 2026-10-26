# Audit keamanan & kesiapan rilis beta — Milestone 5 (P0)

Tanggal: 24 Oktober 2026 · Diverifikasi ulang: 25 Oktober 2026 · Branch:
`chore/m5-security-release-audit` (berbasis `chore/m5-security-checklist`, yang
sudah memuat `main` `1c469ea`; kini fast-forward ke `origin/main` `c24030a`) ·
Scope: audit baca-saja lalu perbaikan terbatas. Tidak ada fitur, dependency,
atau izin Android baru yang ditambahkan. Audit awal (24 Oktober 2026) tidak
menjalankan `db push`; penerapan migration rate limit pada 25 Oktober 2026
(persetujuan pemilik, hanya project development) dicatat di §4a.

Istilah status memakai katurgantingan repo: **Implemented**, **Passed locally**,
**Passed against dev backend**, **Tested on physical device**, **Blocked**.

## 1. Metode dan bukti

Dua kategori bukti dipisahkan sepanjang dokumen ini:

- **Diverifikasi** — hasil perintah yang dijalankan sendiri pada audit ini
  (terhadap project development `xvmcpfkkveeaevfcvfug` lewat perintah
  `package.json` saja, sesuai batasan tugas).
- **Dibaca** — pembacaan kode/dokumen tanpa eksekusi; dipakai untuk temuan yang
  tidak bisa dibuktikan lewat `db:test`/`db:types:check`.

Perintah yang dijalankan dan hasilnya ada di bagian 5 (gerbang kualitas).
Pemindaian rahasia pada bundel memakai `npm run export:android` lalu `grep`
terhadap `dist/_expo/static/js/android/entry-*.hbc`; riwayat git diperiksa
dengan `git log --all --diff-filter=A -- '.env*'` dan `git log --all -S`.
Tidak ada nilai kredensial yang dicetak dalam proses apa pun.

## 2. Temuan yang DIVERIFIKASI

| ID | Area | Severity | Temuan dan bukti | Dampak | Rekomendasi | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AUD-01 | RLS katalog | Info | `npm run db:test` **9/9** berkas lulus; `rls_catalog_test.sql` membuktikan seluruh tabel/partisi `public` mengaktifkan RLS, semua view memakai `security_invoker`, dan `chat_messages`/`ride_locations` ada di publikasi `supabase_realtime` | Nol tabel terbuka tanpa RLS | Pertahankan pagar katalog di CI | **Passed against dev backend** |
| AUD-02 | Policy longgar | Info | grep terhadap seluruh 24 migration: **0** policy memakai `using (true)`/`with check (true)` dan **0** policy `to anon` | Tidak ada policy eksplisit yang melonggar | Pertahankan; `rls_policy_guard_test.sql` tetap menjaga policy wadah | **Passed locally** (statis) + **Passed against dev backend** (uji per tabel) |
| AUD-03 | Storage | Info | Ketiga bucket privat (`public = false`); seluruh policy membaca `storage.foldername(...)` sebagai otorisasi (`20261017120000_private_photo_storage.sql:71-174`, `20261017121000_club_logo_policy_qualified_name.sql:30-78`, `20261018120000_profile_avatar_storage.sql:42`); uji bagian 13 berkas RLS berjalan di `db:test` | Tidak ada jalur baca lintas pengguna yang terlihat di kode | Uji unggahan HTTP nyata tetap di perangkat (GAR-05/CLUB-11) | **Passed against dev backend** |
| AUD-04 | Edge Function `delete-account` | Info | Identitas hanya dari JWT yang diverifikasi (`supabase/functions/delete-account/index.ts:135`); body diabaikan sebagai penentu target (`:115`); lease eksklusif ADR-078 (`:149`, RPC `begin_account_deletion_claim`); respons memakai kode tetap; log hanya `{ jobId, step, code }` (`:320`) | Tidak ada bentuk permintaan yang bisa menghapus akun lain | Pertahankan pola ini | **Passed against dev backend** untuk lapisan database (`rls_account_delete_test.sql` di `db:test`) **dan** alur penuh Edge Function→Storage→Auth lewat runner `npm run e2e:account-delete -- --yes` (25 Oktober 2026, 17 langkah) |
| AUD-05 | Grant RPC hapus akun | Info | `purge_account_data`, `begin/finish_account_deletion`, `account_media_manifest` dicabut dari `public`/`anon`/`authenticated` dan hanya untuk `service_role` (`20261023004946_account_deletion_identity.sql:512-519`); fungsi lease/ checkpoint/ reconcile sama (`20261023120000_account_deletion_reliability.sql:314-322`) | Klien tidak bisa memanggil jalur hapus data orang lain | Pertahankan | **Passed against dev backend** |
| AUD-06 | Data lokasi | Info | Satu-satunya jalur tulis `publish_ride_location` dengan `revoke` dari `public`/`anon` (`20261019120000_ride_workflow.sql:706-708`); lokasi terakhir dihapus trigger saat consent mati/keluar/dikeluarkan (`:720-738`) dan saat ride final (`:741-763`); pesan sistem memuat nama, bukan koordinat (`20261020100000_convoy_chat_m4.sql:63-106`) | Tidak ada jejak lokasi yang tertinggal setelah opt-out/ride final di lapisan database | Uji dua klien WebSocket tetap **Blocked** (AUD-18) | **Passed against dev backend** |
| AUD-07 | Rahasia — bundel & riwayat | Info | `npm run export:android` exit 0; `entry-6419b9258db0f34c8e54fd125095f410.hbc`: JWT utuh = **0**, `postgres://` = **0**, nilai `sb_secret_` ≥30 karakter = **0** (literal `service_role` 2× = regex `src/lib/env.ts:99` + kode `@supabase/supabase-js`). `git log --all --diff-filter=A -- '.env*'` hanya `.env.example`; `git log -S 'eyJhbGciOi'` = nol commit; `sb_secret_`/`postgres://` di riwayat hanya dokumen, uji, dan skrip (`scripts/__tests__/write-app-env.test.mjs`) | Tidak ada kredensial di repo, riwayat, maupun bundel | Ulangi pemindaian setiap kali kredensial nyata dipakai | **Passed locally** |
| AUD-08 | Rahasia — konfigurasi | Info | `web/account-deletion/config.js` hanya placeholder `GANTI-…` + publishable key; `.github/workflows/*.yml` tidak memuat literal secret (hanya `secrets.*`/`vars.*`) | Tidak ada kebocoran lewat halaman web statis maupun workflow | Isi config hanya saat deploy, dengan nilai publik | **Passed locally** |
| AUD-09 | Tipe database | Info | `npm run db:types:check` lulus: `src/lib/supabase/database.generated.ts` sama dengan skema development | Tipe klien cocok dengan skema yang berjalan | Regenerasi setiap penerapan migration | **Passed against dev backend** |
| AUD-24 | E2E hapus akun | Low | E2E 23 Oktober 2026 memakai skrip sementara yang tidak di-commit (`docs/SETUP_GUIDE.md:181`), sehingga bukti cross-service Auth/Storage tidak dapat diulang oleh developer berikutnya | Regresi Auth Admin API/Storage bisa lolos karena `db:test` berjalan dalam transaksi dan tidak memanggil layanan itu | Buat runner permanen dengan guard project development, akun sintetis, dan cleanup | **Fixed / Passed against dev backend** — `scripts/account-deletion-e2e.mjs` (`npm run e2e:account-delete -- --yes`), 25 Oktober 2026: 17 langkah lulus, 0 sisa |

## 3. Temuan yang DIBACA dari kode/dokumen (belum diverifikasi lewat eksekusi)

| ID | Area | Severity | Temuan dan bukti | Dampak | Rekomendasi | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AUD-10 | Fungsi definer | **Medium** | 12 fungsi `security definer` lama masih `set search_path = public`: enam helper (`20261013022938_initial_schema.sql:245,260,276,291,308,326`) dan enam RPC klub (`20261016093000_club_membership_rpc.sql:84,162,255,327,404,473`); ditambah 4 fungsi trigger yang masih bisa dieksekusi `PUBLIC`/`anon` (`bootstrap_profile`, `set_follow_status`, `clear_ride_location_on_opt_out`, `clear_ride_locations_on_finish`) | Pelanggaran aturan AGENTS.md; pembajakan nama objek bila ada peran yang bisa membuat objek di `public` (peran API pada umumnya tidak punya `CREATE`, jadi bukan Critical) | Terapkan migration aditif `20261024003227_m5_catalog_hardening.sql` yang sudah ditulis, diuji katalog, dan terdaftar; lalu bersihkan daftar tunggu di `supabase/tests/rls_catalog_test.sql` | **Fixed / Passed against dev backend** — diterapkan 24 Oktober 2026 (persetujuan pemilik); daftar tunggu sudah dihapus, `db:test` 9/9 lulus dengan pemeriksaan anti-usang |
| AUD-11 | Helper definer untuk `anon` | Low | Enam helper (`is_club_member`, `is_club_admin`, `is_ride_member`, `is_ride_host`, `is_ride_active_member`, `can_publish_ride_location`) tetap dieksekusi `anon` (daftar pengecualian beralasan di `rls_catalog_test.sql`); semuanya mengembalikan `false` tanpa sesi karena memakai `auth.uid()` | Tanpa kebocoran data yang terlihat; permukaan peran tanpa sesi seharusnya nol | Cabut `EXECUTE` dari `anon` pada hardening berikut dan beri grant hanya `authenticated` bila klien memang memakainya | Open |
| AUD-12 | Batas input | Low | `motorcycle_private_details.plate_number`/`private_notes` tanpa CHECK panjang (`20261013022938_initial_schema.sql:38-39`), padahal klien membatasi 16/500 | Pemilik baris bisa menulis nilai tak terbatas lewat Data API | Terapkan migration `20261024011825_m5_private_detail_limits.sql` (`not valid`), lalu `validate constraint` setelah data lama diperiksa | **Fixed sebagian** — CHECK sudah diterapkan 24 Oktober 2026 (baris baru + setiap UPDATE diperiksa); `validate constraint` untuk baris lama **belum** dijalankan |
| AUD-13 | Batas input | Low | Kolom path (`avatar_url`, `logo_path`, `photo_path`, `media_path`) tanpa batas panjang di database | Penyimpangan data, bukan kebocoran | CHECK panjang pada hardening berikut | Open |
| AUD-14 | Rate limit | **Medium** | Belum ada rate limit pada follow, laporan moderasi (`report_content`), permintaan gabung klub, dan throttle pembaruan lokasi (inventaris `docs/SECURITY_PRIVACY.md` §9) | Spam/abuse pada endpoint publik beta; tidak membuka data | Migration `20261025013131_m5_rate_limits.sql` + uji `rls_rate_limits_test.sql` (lihat §4a); throttle lokasi tetap terbuka | **Fixed untuk follow/laporan/gabung klub — Passed against dev backend** (diterapkan 25 Oktober 2026, `db:test` 10/10); throttle lokasi tetap **Open** |
| AUD-15 | Edge Function | Info | `Access-Control-Allow-Origin: *` pada `delete-account` (`index.ts:23`) | Situs mana pun bisa memanggil fungsi, tetapi tetap membutuhkan access token milik pengguna itu sendiri | Allowlist origin persis lewat `WEB_ALLOWED_ORIGINS`, fail-closed, `*` diabaikan (`cors.mjs` + 12 uji) | **Fixed / Passed locally** — origin halaman sebenarnya **Blocked** sampai Pages terbit (B-02) |
| AUD-16 | Auth | Info | Access token lama tetap sah sampai kedaluwarsa setelah akun dihapus (terdokumentasi di ADR-077) | Baris data sudah hilang dan tulis baru ditolak FK; yang tersisa hanya jendela token | Bila perlu jaminan keras, validasi `session_id` pada operasi sensitif | Open |
| AUD-17 | Log/monitoring | Low | Log Edge Function dan Postgres di dashboard belum diamati pada beban nyata; tidak ada pemantauan otomatis | Kebocoran tak terdeteksi baru terlihat saat insiden | Pantau saat beta; ikuti `docs/INCIDENT_RESPONSE.md` | Open |
| AUD-18 | Realtime | **Low** (turun dari Medium) | Dua klien WebSocket nyata **sudah diuji** lewat `npm run e2e:shared-ride` (25 Oktober 2026): dua supabase-js dengan JWT asli, chat/lokasi diterima ≤5 detik, non-anggota 0 event; lapisan database terbukti (AUD-01/AUD-06). Sisa: reconnect putus/nyambung dan filter blokir di perangkat | Klaim realtime di lapisan API kini punya bukti; perilaku perangkat tetap terbuka | Uji perangkat di `docs/QA_TEST_PLAN.md` bagian 8d/8f (PD-09, PD-15) | **Passed against dev backend**; perangkat **Blocked** |
| AUD-19 | Uji perangkat | **Medium** | Uji perangkat ACC-01..08 dan QA 8d (izin background, GPS mati, force-stop, baterai) belum pernah berjalan | Fitur tidak boleh disebut lulus di perangkat | Jalankan di HP setelah APK baru | **Blocked** |
| AUD-20 | Kesiapan rilis | Info | `web/` (privasi + hapus akun) belum ter-deploy; ini syarat Play Console | Peluncuran tertahan | Deploy, lalu catat URL-nya | **Blocked** |
| AUD-21 | Kesiapan rilis | **Medium** | Belum ada project Supabase produksi; jalur promosi migration terdokumentasi (`npx supabase db push --dry-run` lalu `--yes`, `docs/SETUP_GUIDE.md` bagian 4.3) tetapi **tidak ada down migration** sehingga rollback hanya lewat cadangan/forward-fix | Perubahan skema produksi tidak bisa dibatalkan otomatis | Buat project produksi + prosedur backup/rollback sebelum beta | Needs decision |
| AUD-22 | Kesiapan rilis | **Medium** | Keystore rilis disimpan sebagai secret repository dengan salinan asli di luar repo (`docs/SETUP_GUIDE.md` bagian 5.1); checklist cadangan berkala tidak ada | Kunci hilang = APK terpasang tidak bisa diperbarui | Jadwalkan verifikasi/cadangan keystore berkala | Open |
| AUD-23 | Privasi/retensi | **Medium** | Retensi laporan bahaya, audit moderasi, pesan yang diredaksi, dan metadata `account_deletion_jobs` belum disahkan produk/legal (ADR-077) | Kebijakan publik bisa tidak cocok dengan praktik | Putuskan retensi sebelum beta publik | Needs decision |

Tidak ada temuan **Critical**. Temuan **High** juga tidak ada: dua temuan
tertinggi (AUD-10, AUD-14) berSeverity **Medium** — AUD-10 tidak bisa dieksploitasi
oleh peran Data API karena mereka tidak memiliki `CREATE` pada skema `public`
(klaim ini **dibaca**, tidak diverifikasi langsung di audit ini, sehingga
severity tidak diturunkan ke Low), dan AUD-14 adalah celah abuse, bukan
kebocoran data.

## 4. Fase 2 — perbaikan terbatas

Karena tidak ada temuan Critical/High yang belum tertangani, audit ini **tidak
menambah migration untuk Critical/High**. Perbaikan untuk temuan Medium teratas
berupa
migration aditif dari audit sebelumnya, dan **sudah diterapkan ke project
development pada 24 Oktober 2026** atas persetujuan pemilik
(`npx supabase db push --yes`, exit 0); `npx supabase db push --dry-run` yang
berjalan sebelumnya exit 0 dan hanya menyebut kedua migration ini:

| Temuan | Migration (aditif, sudah diterapkan ke development) | Uji | Terdaftar di |
| --- | --- | --- | --- |
| AUD-10 | `supabase/migrations/20261024003227_m5_catalog_hardening.sql` (kunci `search_path` 12 fungsi; cabut `EXECUTE` 4 fungsi trigger) | `supabase/tests/rls_catalog_test.sql` (notice `UJI KATALOG RLS LULUS`; daftar tunggu/pengecualian sementara sudah dihapus, pemeriksaan anti-usang tetap berjaga) | `DEFAULT_TEST_FILES` di `scripts/db-test.mjs` + `.github/workflows/database-rls.yml` |
| AUD-12 | `supabase/migrations/20261024011825_m5_private_detail_limits.sql` (CHECK plat ≤ 16, catatan ≤ 500, `not valid`) | `supabase/tests/rls_profiles_test.sql` bagian 7f — fixture plat dipatuhi batas baru dan pemilik tetap bisa memperbarui detailnya | `DEFAULT_TEST_FILES` di `scripts/db-test.mjs` + `.github/workflows/database-rls.yml` |

Dry-run penerapan sudah dijalankan terhadap project development (24 Oktober
2026): `npx supabase migration list` exit 0 mencocokkan 22 migration remote
dengan lokal dan menampilkan persis dua yang belum ada di remote;
`npx supabase db push --dry-run` exit 0 menyebut kedua migration di atas sebagai
satu-satunya yang akan didorong. **Penerapan kemudian disetujui pemilik dan
berhasil** (24 Oktober 2026): `npx supabase db push --yes` exit 0, kedua
migration tercatat di remote. Setelahnya `npm run db:test` **9/9** lulus (salah
satu fixture uji lama menyalahi CHECK plat baru dan diperbaiki sesuai batas
16 karakter), `npm run db:types:check` lulus (skema tidak berubah strukturnya
terhadap tipe), dan `npm run db:test:lint` tetap hijau.

Perintah yang **tersisa** (belum dijalankan, bukan bagian persetujuan di atas):
`validate constraint` untuk dua CHECK plat/catatan pada baris lama — aman
karena migration memakai `not valid`; jalankan setelah data lama diperiksa.

### 4a. Rate limit database untuk interaksi sosial (AUD-14, 25 Oktober 2026)

Migration aditif `supabase/migrations/20261025013131_m5_rate_limits.sql`:

- `follows_rate_limit` — trigger BEFORE INSERT pada `public.follows`: **10 follow
  baru / 10 menit / pengikut**. Trigger dipilih karena `follows_insert_self`
  masih mengizinkan INSERT REST langsung.
- `content_reports_rate_limit` — trigger BEFORE INSERT pada `public.content_reports`:
  **10 laporan / 10 menit / pelapor**. Trigger menutup RPC `report_content`
  **dan** INSERT REST lewat `content_reports_insert_self` yang masih terbuka.
- `request_club_membership` — badan fungsi sama, ditambah **5 permintaan gabung /
  10 menit / pengguna** sebelum baris ditulis. Baris berperan `owner` tidak
  dihitung, sehingga pembuatan klub tidak menghabiskan kuota bergabung. Hitungan
  menyimpan `FOUND` sebelum `SELECT ... INTO` kuota karena hitungan selalu
  menemukan satu baris dan akan menimpa `FOUND`.

Semua penolakan memakai SQLSTATE `P0001` + detail
`follow_rate_limit`/`report_rate_limit`/`club_join_rate_limit`. Identitas selalu
`auth.uid()`; fungsi trigger `security definer` dengan `search_path = ''` dan
`EXECUTE` dicabut dari `public`/`anon`/`authenticated`. Tidak ada policy, data,
atau tanda tangan fungsi yang berubah — `database.generated.ts` tetap sama.

Uji `supabase/tests/rls_rate_limits_test.sql` (notice
`UJI RATE LIMIT DATABASE LULUS`) terdaftar di `DEFAULT_TEST_FILES` dan penanda
`.github/workflows/database-rls.yml`. Uji membuktikan allow/deny, isolasi per
pengguna, jalur REST `content_reports` ikut tertutup, dan penolakan tidak
menyimpan baris. Berkas uji dijalankan bersama migration di dalam satu transaksi
yang di-ROLLBACK terhadap project development: **exit 0**, notice diterima.

Status: **Implemented** · **Passed locally** · **Passed against dev backend** —
migration diterapkan ke project development pada 25 Oktober 2026
(`npx supabase db push --linked --yes`; **25 lokal = 25 remote**). Setelahnya
`npm run db:test` **10/10** berkas lulus (notice `UJI RATE LIMIT DATABASE LULUS`
diterima server) dan `npm run db:types:check` lulus tanpa perubahan tipe karena
fungsi trigger tidak terekspos ke peran API. Gerbang lain pada 25 Oktober 2026:
`typecheck`, `lint`, `format:check`, `npm test -- --ci` (500 test),
`test:scripts` (343 test), dan `export:android` semuanya exit 0; `db:test:lint`
exit 0 untuk **10 berkas vs 25 migration**. Temuan yang tetap terbuka: throttle
pembaruan lokasi dan rate limit endpoint Auth.

## 5. Gerbang kualitas (hasil apa adanya, 24 Oktober 2026)

| Perintah | Hasil |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run deps:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm test -- --ci` | exit 0 — 45 suite / **500** test lulus |
| `npm run test:scripts` | exit 0 — 74 suite / **343** test lulus |
| `npm run db:test:lint` | exit 0 — 9 berkas uji vs 24 migration |
| `npm run db:test` | exit 0 — **9/9** berkas lulus terhadap project development (sembilan notice penanda diterima server) |
| `npm run db:types:check` | percobaan pertama exit 1 (koneksi pooler terputus: `Connection terminated unexpectedly`), **retry exit 0** — tipe sama dengan skema development |
| `npm run export:android` | exit 0 — bundel `entry-6419b9258db0f34c8e54fd125095f410.hbc`; pemindaian rahasia 0/0/0 (AUD-07) |
| `npm run doctor` | exit 1 — **20/21** pemeriksaan lulus; satu gagal: "Check Expo config (app.json/ app.config.js) schema" = `getaddrinfo EAI_AGAIN exp.host` (butuh koneksi ke Expo API) → **Blocked** karena jaringan mesin, bukan temuan proyek |

Tidak ada gerbang yang dibulatkan menjadi lulus; kegagalan sementara
`db:types:check` dan `doctor` dicatat apa adanya.

## 6. Verifikasi ulang 25 Oktober 2026 (HEAD `c24030a`)

Branch ini di-fast-forward ke `origin/main` sebelum verifikasi; working tree
bersih. Tidak ada migration baru, tidak ada `db push`, dan tidak ada perubahan
kode aplikasi pada verifikasi ini — yang diuji adalah keadaan yang sudah
di-merge lewat PR #11.

### 6.1 Status GitHub dan migration

| Item | Hasil |
| --- | --- |
| `npx supabase migration list --linked` | exit 0 — **24 lokal = 24 remote**, termasuk `20261024003227_m5_catalog_hardening.sql` dan `20261024011825_m5_private_detail_limits.sql` |
| CI (run `40144973648`) | success pada `c24030a` |
| Database RLS (run `40144973825`) | success pada `c24030a` |
| Release APK (run `40145137205`) | success; job build/tag **skipped** karena perubahan hanya dokumen — gate `should-release.mjs` bekerja seperti yang diuji |
| Rilis APK terakhir | `v0.1.0-build47`, tag commit `84b89f2`, asset `app-preview.apk` 106.634.155 byte, digest GitHub `sha256:3af17f8a8f9d4283f715ee61f1f8279602dc518435893191839611565c9c85b8`. Asset **tidak** diunduh ulang dan tanda tangannya **tidak** diverifikasi ulang pada audit ini |

### 6.2 Gerbang kualitas (25 Oktober 2026)

| Perintah | Hasil |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run deps:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm test -- --ci` | exit 0 — 45 suite / **500** test lulus |
| `npm run test:scripts` | exit 0 — 74 suite / **343** test lulus |
| `npm run db:test:lint` | exit 0 — 9 berkas uji vs **24** migration |
| `npm run db:test` | exit 0 — **9/9** berkas lulus (termasuk `UJI KATALOG RLS LULUS` dan `UJI HAPUS AKUN LULUS`) |
| `npm run db:types:check` | exit 0 — tipe sama dengan skema development |
| `npm run export:android` | exit 0 — `entry-6419b9258db0f34c8e54fd125095f410.hbc` |
| `npm run doctor` | exit 1 — **Blocked**: satu pemeriksaan butuh `exp.host` dan gagal `getaddrinfo EAI_AGAIN` (jaringan mesin, bukan temuan proyek) |

Pemindaian rahasia pada bundel hasil `export:android` di atas: JWT utuh `eyJhbGciOi` = **0**, `postgres://` = **0**, nilai `sb_secret_` (≥30 karakter) = **0**; literal `service_role` = 2 (regex `src/lib/env.ts` dan kode `@supabase/supabase-js`, bukan nilai kunci).

### 6.3 Kesimpulan verifikasi ulang

- **Tidak ada temuan Critical atau High baru.** Seluruh temuan dan status di
  bagian 2–4 tetap berlaku; AUD-10 sudah **Fixed** dan AUD-12 **Fixed sebagian**.
- Risiko terbuka: **throttle pembaruan lokasi** (sisa AUD-14; rate limit
  follow/laporan/gabung klub sudah diterapkan dan lulus `db:test` 10/10),
  metadata job tanpa cleanup (AUD-23), project produksi + rollback
  (AUD-21), keystore cadangan (AUD-22), uji perangkat (AUD-19), uji dua klien
  Realtime (AUD-18), dan halaman web yang belum ter-deploy (AUD-20 —
  `web/account-deletion/config.js` masih placeholder `GANTI-…`).
- Uji SQL membuktikan database/RLS, bukan Auth Admin API atau Storage API; tidak
  ada klaim **Tested on physical device** pada audit ini.

## 7. Batasan audit ini

- Verifikasi database hanya lewat `db:test` dan `db:types:check` (perintah
  `package.json`), sesuai batasan tugas; tidak ada kueri katalog manual yang
  dijalankan, sehingga sebagian temuan (AUD-10 s.d. AUD-23) berstatus **dibaca**
  dari kode, bukan diverifikasi di database.
- Tidak ada uji perangkat fisik, uji E2E dua klien, maupun pemindaian log
  runtime Supabase; ketiganya tetap **Blocked** dan tidak boleh ditandai lulus.
  E2E hapus akun **dijalankan** pada 25 Oktober 2026 lewat runner permanen
  (`npm run e2e:account-delete -- --yes`, 17 langkah) — bukan bagian `db:test`.
- Audit ini tidak menyentuh production, tidak memaksa-push, tidak meng-merge,
  dan tidak menyunting `CHANGELOG.md` maupun entri ADR lama.

Verifikasi ulang 25 Oktober 2026 menambahkan bukti eksekusi pada HEAD
`c24030a`: migration 24/24, CI + Database RLS hijau, gate rilis melewati build
untuk perubahan dokumen, dan seluruh gerbang kualitas lulus kecuali `doctor`
yang **Blocked** karena jaringan. Verifikasi itu tidak menerapkan migration;
setelahnya §4a menerapkan satu migration rate limit ke development (25 lokal =
25 remote).
