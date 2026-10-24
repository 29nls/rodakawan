# Audit keamanan & kesiapan rilis beta — Milestone 5 (P0)

Tanggal: 24 Oktober 2026 · Branch: `chore/m5-security-release-audit` (berbasis
`chore/m5-security-checklist`, yang sudah memuat `main` `1c469ea`) · Scope:
audit baca-saja lalu perbaikan terbatas. Tidak ada fitur, dependency, atau izin
Android baru yang ditambahkan; tidak ada `db push` yang dijalankan.

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
| AUD-04 | Edge Function `delete-account` | Info | Identitas hanya dari JWT yang diverifikasi (`supabase/functions/delete-account/index.ts:135`); body diabaikan sebagai penentu target (`:115`); lease eksklusif ADR-078 (`:149`, RPC `begin_account_deletion_claim`); respons memakai kode tetap; log hanya `{ jobId, step, code }` (`:320`) | Tidak ada bentuk permintaan yang bisa menghapus akun lain | Pertahankan pola ini | **Passed against dev backend** untuk lapisan database (`rls_account_delete_test.sql` di `db:test`); alur penuh Edge Function→Storage→Auth hanya **Passed against dev backend** lewat E2E sebelumnya |
| AUD-05 | Grant RPC hapus akun | Info | `purge_account_data`, `begin/finish_account_deletion`, `account_media_manifest` dicabut dari `public`/`anon`/`authenticated` dan hanya untuk `service_role` (`20261023004946_account_deletion_identity.sql:512-519`); fungsi lease/ checkpoint/ reconcile sama (`20261023120000_account_deletion_reliability.sql:314-322`) | Klien tidak bisa memanggil jalur hapus data orang lain | Pertahankan | **Passed against dev backend** |
| AUD-06 | Data lokasi | Info | Satu-satunya jalur tulis `publish_ride_location` dengan `revoke` dari `public`/`anon` (`20261019120000_ride_workflow.sql:706-708`); lokasi terakhir dihapus trigger saat consent mati/keluar/dikeluarkan (`:720-738`) dan saat ride final (`:741-763`); pesan sistem memuat nama, bukan koordinat (`20261020100000_convoy_chat_m4.sql:63-106`) | Tidak ada jejak lokasi yang tertinggal setelah opt-out/ride final di lapisan database | Uji dua klien WebSocket tetap **Blocked** (AUD-18) | **Passed against dev backend** |
| AUD-07 | Rahasia — bundel & riwayat | Info | `npm run export:android` exit 0; `entry-6419b9258db0f34c8e54fd125095f410.hbc`: JWT utuh = **0**, `postgres://` = **0**, nilai `sb_secret_` ≥30 karakter = **0** (literal `service_role` 2× = regex `src/lib/env.ts:99` + kode `@supabase/supabase-js`). `git log --all --diff-filter=A -- '.env*'` hanya `.env.example`; `git log -S 'eyJhbGciOi'` = nol commit; `sb_secret_`/`postgres://` di riwayat hanya dokumen, uji, dan skrip (`scripts/__tests__/write-app-env.test.mjs`) | Tidak ada kredensial di repo, riwayat, maupun bundel | Ulangi pemindaian setiap kali kredensial nyata dipakai | **Passed locally** |
| AUD-08 | Rahasia — konfigurasi | Info | `web/account-deletion/config.js` hanya placeholder `GANTI-…` + publishable key; `.github/workflows/*.yml` tidak memuat literal secret (hanya `secrets.*`/`vars.*`) | Tidak ada kebocoran lewat halaman web statis maupun workflow | Isi config hanya saat deploy, dengan nilai publik | **Passed locally** |
| AUD-09 | Tipe database | Info | `npm run db:types:check` lulus: `src/lib/supabase/database.generated.ts` sama dengan skema development | Tipe klien cocok dengan skema yang berjalan | Regenerasi setiap penerapan migration | **Passed against dev backend** |

## 3. Temuan yang DIBACA dari kode/dokumen (belum diverifikasi lewat eksekusi)

| ID | Area | Severity | Temuan dan bukti | Dampak | Rekomendasi | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AUD-10 | Fungsi definer | **Medium** | 12 fungsi `security definer` lama masih `set search_path = public`: enam helper (`20261013022938_initial_schema.sql:245,260,276,291,308,326`) dan enam RPC klub (`20261016093000_club_membership_rpc.sql:84,162,255,327,404,473`); ditambah 4 fungsi trigger yang masih bisa dieksekusi `PUBLIC`/`anon` (`bootstrap_profile`, `set_follow_status`, `clear_ride_location_on_opt_out`, `clear_ride_locations_on_finish`) | Pelanggaran aturan AGENTS.md; pembajakan nama objek bila ada peran yang bisa membuat objek di `public` (peran API pada umumnya tidak punya `CREATE`, jadi bukan Critical) | Terapkan migration aditif `20261024003227_m5_catalog_hardening.sql` yang sudah ditulis, diuji katalog, dan terdaftar; lalu bersihkan daftar tunggu di `supabase/tests/rls_catalog_test.sql` | **Blocked** — migration belum diterapkan, menunggu persetujuan pemilik |
| AUD-11 | Helper definer untuk `anon` | Low | Enam helper (`is_club_member`, `is_club_admin`, `is_ride_member`, `is_ride_host`, `is_ride_active_member`, `can_publish_ride_location`) tetap dieksekusi `anon` (daftar pengecualian beralasan di `rls_catalog_test.sql`); semuanya mengembalikan `false` tanpa sesi karena memakai `auth.uid()` | Tanpa kebocoran data yang terlihat; permukaan peran tanpa sesi seharusnya nol | Cabut `EXECUTE` dari `anon` pada hardening berikut dan beri grant hanya `authenticated` bila klien memang memakainya | Open |
| AUD-12 | Batas input | Low | `motorcycle_private_details.plate_number`/`private_notes` tanpa CHECK panjang (`20261013022938_initial_schema.sql:38-39`), padahal klien membatasi 16/500 | Pemilik baris bisa menulis nilai tak terbatas lewat Data API | Terapkan migration `20261024011825_m5_private_detail_limits.sql` (`not valid`), lalu `validate constraint` setelah data lama diperiksa | **Blocked** — menunggu persetujuan penerapan |
| AUD-13 | Batas input | Low | Kolom path (`avatar_url`, `logo_path`, `photo_path`, `media_path`) tanpa batas panjang di database | Penyimpangan data, bukan kebocoran | CHECK panjang pada hardening berikut | Open |
| AUD-14 | Rate limit | **Medium** | Belum ada rate limit pada follow, laporan moderasi (`report_content`), permintaan gabung/undang klub, dan throttle pembaruan lokasi (inventaris `docs/SECURITY_PRIVACY.md` §9) | Spam/abuse pada endpoint publik beta; tidak membuka data | Tambahkan batas di database (hardening M6) sebelum trafik publik | Open |
| AUD-15 | Edge Function | Info | `Access-Control-Allow-Origin: *` pada `delete-account` (`index.ts:23`) | Situs mana pun bisa memanggil fungsi, tetapi tetap membutuhkan access token milik pengguna itu sendiri | Diterima untuk aplikasi native; pertimbangkan allowlist bila ada klien web | Open (diterima) |
| AUD-16 | Auth | Info | Access token lama tetap sah sampai kedaluwarsa setelah akun dihapus (terdokumentasi di ADR-077) | Baris data sudah hilang dan tulis baru ditolak FK; yang tersisa hanya jendela token | Bila perlu jaminan keras, validasi `session_id` pada operasi sensitif | Open |
| AUD-17 | Log/monitoring | Low | Log Edge Function dan Postgres di dashboard belum diamati pada beban nyata; tidak ada pemantauan otomatis | Kebocoran tak terdeteksi baru terlihat saat insiden | Pantau saat beta; ikuti `docs/INCIDENT_RESPONSE.md` | Open |
| AUD-18 | Realtime | **Medium** | Uji dua klien WebSocket nyata (terima/tolak, reconnect, filter blokir) belum ada; lapisan database sudah terbukti (AUD-01/AUD-06) | Klaim "realtime aman" belum tuntas di lapisan aplikasi | Rencana uji di `docs/QA_TEST_PLAN.md` bagian 8d | **Blocked** |
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
menambah migration baru** dan **tidak menjalankan `db push`**. Perbaikan untuk
temuan Medium teratas sudah berupa migration aditif di branch ini dari audit
sebelumnya, lengkap dengan uji yang terdaftar:

| Temuan | Migration (aditif, belum diterapkan) | Uji | Terdaftar di |
| --- | --- | --- | --- |
| AUD-10 | `supabase/migrations/20261024003227_m5_catalog_hardening.sql` (kunci `search_path` 12 fungsi; cabut `EXECUTE` 4 fungsi trigger) | `supabase/tests/rls_catalog_test.sql` (notice `UJI KATALOG RLS LULUS`, daftar tunggu anti-usang) | `DEFAULT_TEST_FILES` di `scripts/db-test.mjs` + `.github/workflows/database-rls.yml` |
| AUD-12 | `supabase/migrations/20261024011825_m5_private_detail_limits.sql` (CHECK plat ≤ 16, catatan ≤ 500, `not valid`) | Belum ada uji SQL khusus (temuan Low, migration sengaja `not valid` sehingga aman untuk data lama) | — |

Perintah penerapan **setelah persetujuan pemilik** (jalankan di development
dulu, jangan ke production):

```bash
npx supabase db push --dry-run   # tinjau diff yang akan dijalankan
npx supabase db push --yes       # terapkan dua migration di atas
```

Setelah diterapkan: hapus entri daftar tunggu/pengecualian terkait dari
`supabase/tests/rls_catalog_test.sql` (ujinya sengaja gagal bila daftar sudah
usang), jalankan `validate constraint` untuk baris lama bila datanya bersih,
lalu ulangi `npm run db:test` dan `npm run db:types:check`. Regenerasi tipe
(`npm run db:types`) pada audit ini **tidak diperlukan** karena skema database
tidak berubah dan `db:types:check` lulus.

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

## 6. Batasan audit ini

- Verifikasi database hanya lewat `db:test` dan `db:types:check` (perintah
  `package.json`), sesuai batasan tugas; tidak ada kueri katalog manual yang
  dijalankan, sehingga sebagian temuan (AUD-10 s.d. AUD-23) berstatus **dibaca**
  dari kode, bukan diverifikasi di database.
- Tidak ada uji perangkat fisik, uji E2E dua klien, maupun pemindaian log
  runtime Supabase; ketiganya tetap **Blocked** dan tidak boleh ditandai lulus.
- Audit ini tidak menyentuh production, tidak memaksa-push, tidak meng-merge,
  dan tidak menyunting `CHANGELOG.md` maupun entri ADR lama.
