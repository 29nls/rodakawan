# Audit keamanan & kesiapan rilis beta — Milestone 5 (P0)

Tanggal audit dasar: **27 Oktober 2026** · Perbarui: **28 Oktober 2026** · HEAD audit dasar `c882939`; branch kerja sekarang `feat/closed-beta-safe-build` · Project database yang diuji: **development** `xvmcpfkkveeaevfcvfug` saja.

Audit dasar bersifat baca-saja. Perubahan 28 Oktober menambahkan throttle `update_ride`, cleanup window saat profil dihapus, pengaman konfigurasi build beta, panduan pilot, serta pencabutan grant `anon` untuk enam helper RLS (AUD-11). Tiga migration **diterapkan ke development**; **tidak ada migration yang diterapkan ke beta atau produksi**.

Istilah status mengikuti `AGENTS.md`: **Implemented**, **Passed locally**,
**Passed against dev backend**, **Tested on physical device**, **Blocked**.
Istilah tambahan **Needs decision** dipakai untuk hal yang memang keputusan
pemilik, bukan pekerjaan teknis yang bisa diselesaikan agent.

> Ringkas: **0 Critical, 0 High.** Tidak ada perbaikan Critical/High yang bisa
> atau perlu dilakukan. Gerbang beta masih tertahan oleh keputusan konfigurasi
> Auth (`autoconfirm`), uji perangkat fisik, dan halaman web yang belum terbit —
> semuanya bukan celah kode yang bisa ditambal migration.

## 1. Metode dan batas bukti

Dua kategori dipisahkan sepanjang dokumen:

- **Diverifikasi** — perintah dijalankan sendiri pada audit ini, terhadap
  project development, memakai perintah `package.json`/script proyek. Hasilnya
  dicatat apa adanya.
- **Dibaca** — disimpulkan dari kode, migration, workflow, atau dokumen tanpa
  eksekusi. Tidak dinaikkan menjadi "lulus" hanya karena kodenya terlihat benar.

Verifikasi database dibatasi pada `npm run db:test`, `npm run db:types:check`,
`npm run beta:preflight`, `npm run storage:test`, dan dua runner E2E yang sudah
ada. Tidak ada kueri katalog manual di luar runner. Tidak ada URL database,
password, service-role key, token, keystore, atau isi `.env*` yang dicetak.

Catatan penting: repository ini **publik**. Karena itu pemeriksaan rahasia
mencakup tree, riwayat, workflow, bundel Android, dan halaman `web/` — bukan
hanya kode aplikasi.

## 2. Ringkasan severity

| Severity | Jumlah | ID |
| --- | --- | --- |
| Critical | **0** | — |
| High | **0** | — |
| Medium | 8 | AUD-14, AUD-19, AUD-20, AUD-21, AUD-22, AUD-23, AUD-26, AUD-27 |
| Low | 5 | AUD-12, AUD-13, AUD-17, AUD-18 (sisa perangkat), AUD-25 |
| Ditutup | 1 | AUD-11 (dicabut 28 Oktober 2026, lihat §4 dan §5) |
| Info | 13 | AUD-01…AUD-09, AUD-15, AUD-16, AUD-24, AUD-28 |

Tidak ada temuan yang membuka data pengguna lain, memungkinkan eskalasi peran,
atau membocorkan secret. Seluruh temuan Medium adalah kesiapan rilis/abuse,
bukan kebocoran.

## 3. Temuan yang DIVERIFIKASI pada audit ini

| ID | Area | Severity | Bukti | Dampak | Rekomendasi | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AUD-01 | RLS katalog | Info | `npm run db:test` **exit 0 — 12/12 berkas** (27 Oktober 2026), seluruh notice penanda diterima server. `rls_catalog_test.sql` menerima `UJI KATALOG RLS LULUS`; `rls_catalog_hardening_test.sql` menerima `UJI KATALOG HARDENING LULUS`; `rls_policy_guard_test.sql` menerima `UJI POLICY OWNER-GUARD LULUS`. `npm run beta:preflight`: **RLS aktif di semua 22 tabel public** | Tidak ada tabel `public` yang terbuka tanpa RLS | Pertahankan kedua uji katalog + pagar policy di CI | **Passed against dev backend** |
| AUD-02 | Policy longgar | Info | Pemindaian seluruh 30 migration: **0** policy memakai `using (true)`/`with check (true)` dan **0** policy `to anon`; 81 `create policy` total. `rls_policy_guard_test.sql` lulus terhadap katalog | Tidak ada policy eksplisit yang membuka semua baris | Pertahankan pagar; jangan longgarkan policy demi UI | **Passed locally** (statis) + **Passed against dev backend** (katalog) |
| AUD-03 | Storage | Info | `npm run storage:test` **exit 0 — 27 langkah**, termasuk: unduhan langsung B ke objek A **HTTP 400**, unggah anon **400**, signed URL B untuk avatar A **400**, unggah B ke folder A **400**, hapus oleh pemilik **200**, signed URL objek terhapus **400**, kebersihan **0 objek/0 akun**. Preflight: bucket `avatars`, `vehicle-photos`, `club-logos` ada dan **privat**. `UJI KATALOG HARDENING LULUS` juga menegaskan **tidak ada bucket publik** | Tidak ada jalur baca/tulis lintas pengguna yang terbukti di Storage API | Pertahankan path-based policy dan uji HTTP ini | **Passed against dev backend** |
| AUD-04 | Edge Function `delete-account` | Info | Preflight: request **tanpa JWT → 401** dan **hanya `apikey` → 401**. `npm run e2e:account-delete -- --yes` **exit 0 — 21 langkah** (27 Oktober 2026): Auth/profil/kendaraan/token A hilang, hazard/laporan/chat jadi tombstone dan diredaksi, logo klub dipindah, akun B utuh, JWT lama ditolak, job `completed`, 0 sisa. Langkah 10–13 kasus negatif baru: tanpa token → 401, token tidak valid → 401, dan token hanya menghapus akun pemantau sendiri | Tidak ada bentuk permintaan yang bisa menghapus akun orang lain; kegagalan parsial tidak dilaporkan sukses | Pertahankan lease ADR-078 dan verifikasi JWT di server | **Passed against dev backend** |
| AUD-05 | Grant fungsi definer | Info | `UJI KATALOG RLS LULUS` + `UJI KATALOG HARDENING LULUS` lulus: tidak ada `security definer` yang dapat dieksekusi `PUBLIC`/`anon` di luar pengecualian tersisa `touch_updated_at()` (fungsi trigger); enam helper RLS dicabut dari `anon` oleh migration `20261028031237` dengan asersi dua sisi (anon ditolak, `authenticated` tetap diizinkan); **seluruh** definer memakai `search_path = ''` (daftar tunggu kosong); `anon` membaca **nol** baris `motorcycle_private_details`. Fungsi orkestrasi hapus akun hanya untuk `service_role` (`20261023004946_account_deletion_identity.sql:512-519`, `20261023120000_account_deletion_reliability.sql:314-322`) | Permukaan RPC tanpa sesi nol; klien tidak bisa memanggil `purge_account_data` | Pertahankan; uji katalog akan gagal bila fungsi definer baru lupa dikunci | **Passed against dev backend** |
| AUD-06 | Data lokasi | Info | `npm run e2e:shared-ride` **exit 0 — 24 langkah**: A menerima lokasi B dalam **457 ms**, chat **415 ms**; C (non-anggota) **0 event** realtime dan tidak bisa membaca rides/chat/lokasi; A menyelesaikan perjalanan; **lokasi terakhir A dan B terhapus**. Satu-satunya jalur tulis `publish_ride_location`, `INSERT/UPDATE` tabel dicabut (`20261019120000_ride_workflow.sql:706-717`); trigger opt-out dan finish (`:720-763`) | Tidak ada lokasi presisi yang tersisa setelah opt-out/keluar/ride final di lapisan database; non-anggota tidak menerima event | Uji perangkat (PD-03…PD-08) tetap **Blocked** | **Passed against dev backend** |
| AUD-07 | Rahasia — bundel & riwayat | Info | `npm run export:android` **exit 0**; `entry-59f75a3f81d0aa95ad299079c92531d4.hbc` (4,1 MB): JWT utuh **0**, `postgres://` **0**, nilai `sb_secret_` ≥30 karakter **0**, `SUPABASE_SERVICE_ROLE_KEY` **0**. Literal `service_role` **2** (regex klien + kode dependency). Riwayat: `git log --all --diff-filter=A -- '.env*'` hanya `.env.example`; `git log -S` menemukan `eyJhbGciOi` hanya di dokumen dan fixture 49 karakter, `sb_secret_` hanya di regex uji, `postgres://` hanya di dokumen/fixture | Tidak ada kredensial nyata di repo, riwayat, atau bundel | Ulangi pemindaian setiap kali `.env.local` berisi kredensial nyata | **Passed locally** |
| AUD-08 | Rahasia — konfigurasi web/workflow | Info | `web/account-deletion/config.js` hanya memuat `supabaseUrl`, `publishableKey`, `supportUrl`, `privacyUrl`; tidak ada service-role/password/JWT. Workflow hanya memakai `secrets.*`; keystore ditulis ke `RUNNER_TEMP` dan dihapus (`android-release.yml:253-264,367-372`; `release-on-push.yml:318-329,367-372`) | Tidak ada secret di halaman statis atau log workflow | Jangan pernah mengisi `config.js` dengan secret; nilai dev saat ini **publik**, bukan kebocoran | **Passed locally** |
| AUD-09 | Tipe database | Info | `npm run db:types:check` **exit 0**: `database.generated.ts` sama dengan skema development. `supabase_migrations.schema_migrations`: **30 lokal = 30 remote** (28 Oktober 2026) | Tipe klien cocok dengan skema yang berjalan | Regenerasi setiap migration baru | **Passed against dev backend** |
| AUD-18 | Realtime dua klien | Low | E2E `shared-ride` memakai dua klien supabase-js dengan JWT asli dan Postgres Changes; event diterima ≤5 detik, C nol event. Sisa yang belum diuji: reconnect jaringan nyata dan filter blokir di perangkat | Lapisan API terbukti; perilaku perangkat/OS tetap belum | Uji PD-09/PD-15 di HP | **Passed against dev backend**; perangkat **Blocked** |
| AUD-24 | E2E hapus akun | Info | Runner permanen `npm run e2e:account-delete -- --yes` **21 langkah lulus** (27 Oktober 2026), 0 sisa, termasuk 3 kasus negatif autentikasi | Bukti lintas Auth/Storage/DB dapat diulang | Jalankan ulang setiap perubahan orkestrasi | **Passed against dev backend** |
| AUD-25 | Dependensi | Low | `npm ci` **exit 0** tetapi `npm audit` melaporkan **5 high, 3 moderate**. Seluruhnya jalur build/dev: `expo → @expo/cli → node-forge`, `zod` (lewat `@expo/cli` dan `eslint-config-expo`), `expo-router → query-string → decode-uri-component`. Tidak ada impor `zod`/`node-forge` di `src/`. "Fix" npm menurunkan `expo` ke **44.0.6** (merusak SDK 57) | Tidak ada kode rentan di bundel runtime; risikonya pada mesin build/CI | **Jangan** `npm audit fix --force`; pantau rilis Expo SDK 57 dan naikkan patch bila tersedia | **Open** (Low) |
| AUD-26 | Auth — autoconfirm | **Medium** | `npm run beta:preflight` **exit 1**: 7 lulus, 1 gagal — `auth settings: autoconfirm aktif; email peserta beta tidak diverifikasi` | Siapa pun (repo publik + publishable key) dapat membuat akun development tanpa memiliki email; pemulihan kata sandi dan identitas peserta tidak dapat dipercaya | Pemilik memutuskan: aktifkan **Confirm email** + SMTP kustom (disarankan) atau terima risiko secara tertulis untuk pilot. Bukan perubahan kode | **Needs decision** — blocker beta menurut preflight |
| AUD-27 | Kesiapan rilis — web | **Medium** | `web/account-deletion/config.js` kini menunjuk **project development** (`xvmcpfkkveeaevfcvfug.supabase.co`) + publishable key dev. Uji statis sengaja mengecualikan `config.js` dari larangan ref dev (`scripts/__tests__/web-static.test.mjs:196-206`). `web/README.md` menyatakan halaman **belum ter-deploy** | Bila diterbitkan apa adanya, pengguna publik akan menghapus akun di backend development, bukan backend rilis | Arahkan ke backend rilis sebelum Play Console; jangan klaim URL publik | **Open** — **Blocked** sampai project rilis & Pages aktif |
| AUD-28 | CI halaman web | Low | Run Pages terakhir (`40180579692`, `946269b`) gagal di **Uji statis halaman publik** dengan `AssertionError: web/account-deletion/config.js memuat ref project development`. Uji lokal sekarang **11/11 lulus** karena `config.js` dikecualikan dari pemindaian (`d8697ec`) — bukan karena backend diganti. Job deploy belum pernah berjalan karena GitHub Pages belum diaktifkan | Tidak ada halaman publik; klaim URL akan salah; pengecualian uji membuat ref dev tidak lagi dicegah otomatis | Aktifkan Pages, arahkan config ke backend rilis, jalankan ulang workflow, verifikasi URL | **Passed locally**; deploy **Blocked** |

## 4. Temuan yang DIBACA dari kode

Sebagian temuan di bagian ini sudah dikerjakan setelah audit; status per baris
menunjukkan bukti terbaru. **AUD-14** adalah satu-satunya yang mendapat migration
baru pada 27 Oktober 2026.

| ID | Area | Severity | Temuan dan bukti | Dampak | Rekomendasi | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AUD-10 | Fungsi definer lama | Info | 12 fungsi M1–M2 sempat `search_path = public`; sudah dikunci oleh `20261024003227_m5_catalog_hardening.sql` dan diverifikasi uji katalog | Tidak ada pelanggaran tersisa | Pertahankan uji anti-usang | **Fixed / Passed against dev backend** |
| AUD-11 | Helper untuk `anon` | Low | Enam helper (`is_club_member`, `is_club_admin`, `is_ride_member`, `is_ride_host`, `is_ride_active_member`, `can_publish_ride_location`) masih dapat dieksekusi `anon`; semuanya memakai `auth.uid()` dan mengembalikan `false` tanpa sesi. **Ditutup 28 Oktober 2026:** migration aditif `20261028031237_revoke_anon_rls_helper_execute.sql` mencabut `EXECUTE` dari `public`/`anon` pada keenam helper; penelusuran 76 `create policy` di seluruh migration menunjukkan semuanya `to authenticated`, jadi tidak ada pemanggil `anon` yang terdampak. Diterapkan ke development lewat `npx supabase db push --linked --yes` setelah `--dry-run` hanya menampilkan migration ini | Tidak ada data yang terbaca tanpa sesi; permukaan RPC tanpa sesi kini nol untuk helper ini | Regression: `rls_catalog_test.sql` + `rls_catalog_hardening_test.sql` mengosongkan daftar pengecualian helper (cek anti-usang) dan menambah asersi dua sisi anon ditolak / `authenticated` diizinkan; `npm run db:test` **12/12** lulus setelah push | **Fixed / Passed against dev backend** (28 Oktober 2026) |
| AUD-12 | Batas input | Low | `motorcycle_private_details` punya CHECK panjang baru (`20261024011825`), tetapi `validate constraint` untuk baris lama belum dijalankan | Baris lama yang melanggar tidak diperiksa ulang | Periksa data lama lalu `validate constraint` | **Open** |
| AUD-13 | Batas input path | Low | Kolom path (`avatar_url`, `logo_path`, `photo_path`, `media_path`) belum punya CHECK panjang di database | Penyimpangan data, bukan kebocoran | Tambah CHECK panjang aditif | **Open** |
| AUD-14 | Rate limit jalur tulis | **Medium** | Follow 10/10 menit, laporan 10/10 menit, gabung klub 5/10 menit, chat 20/60 detik, hazard 5/10 menit, konfirmasi 10/jam. `create_club` 10/jam, `create_ride` 10/jam, `publish_ride_location` minimum 2 detik, serta `update_ride` 20 perubahan per ride per pengguna per 10 menit. Bukti: `rls_write_throttles_test.sql` mencakup allow/deny, penolakan tanpa write, pemulihan window; `db:test:concurrency` memakai dua koneksi untuk membuktikan request kedua menunggu lock lalu ditolak pada kuota create dan update. Migration `20261028015624` menambahkan FK cascade ke profil. | Klien yang dimodifikasi dapat membanjiri DB (biaya/availability); tidak membuka data | Pertahankan tes throttle; rate limit Auth tetap perlu diperiksa di Dashboard | **Implemented**; **Passed against dev backend** (28 Oktober 2026) |
| AUD-15 | CORS Edge Function | Info | `cors.mjs` fail-closed: `*` dibuang, hanya origin persis, `Vary: Origin`; permintaan tanpa `Origin` (Android) tetap dilayani | Tidak ada situs sembarang yang bisa memanggil fungsi dari browser | Uji browser setelah halaman terbit | **Implemented**; uji origin nyata **Blocked** (AUD-20) |
| AUD-16 | Token setelah hapus akun | Info | Access token lama tetap sah sampai kedaluwarsa (ADR-077), tetapi profil/baris sudah hilang dan tulis ditolak FK; E2E membuktikan baca 0 baris dan login ulang gagal | Jendela token tanpa data | Bila perlu jaminan keras, validasi `session_id` pada operasi sensitif | **Open** (diterima) |
| AUD-17 | Log/monitoring | Low | Log Edge Function/Postgres belum diamati pada beban nyata; tidak ada alert otomatis | Insiden tidak terdeteksi cepat | Pantau selama pilot; ikuti `docs/INCIDENT_RESPONSE.md` | **Open** |
| AUD-19 | Uji perangkat | **Medium** | Checklist 8f ada, tetapi belum ada artefak PD-01…PD-22 | Fitur tidak boleh disebut lulus di perangkat | Jalankan di dua HP + akun ketiga | **Blocked** |
| AUD-20 | Halaman web publik | **Medium** | `web/` belum ter-deploy; Pages belum diaktifkan; URL publik belum ada | Syarat Play Console belum terpenuhi | Aktifkan Pages, deploy, catat URL | **Blocked** |
| AUD-21 | Project produksi & rollback | **Medium** | Belum ada project produksi; promosi migration terdokumentasi, tetapi tidak ada down migration/backup teruji. Rencana terperinci (promosi, backup/restore, rollback, web) ada di [`PRODUCTION_MIGRATION_PLAN.md`](PRODUCTION_MIGRATION_PLAN.md) | Perubahan skema produksi tidak bisa dibatalkan otomatis | Buat project produksi, lakukan rehearsal staging + drill restore, lalu jalankan cutover sesuai rencana | **Implemented** (rencana); eksekusi **Blocked** menunggu project & keputusan §1 |
| AUD-22 | Cadangan keystore | **Medium** | Keystore ada sebagai secret repo; salinan asli di luar repo; tidak ada verifikasi/cadangan berkala | Kunci hilang = APK tidak bisa diperbarui | Jadwalkan verifikasi dan cadangan | **Open** |
| AUD-23 | Retensi data | **Medium** | Retensi hazard/audit/pesan teredaksi dan metadata `account_deletion_jobs` belum disahkan produk/legal (ADR-077) | Kebijakan publik bisa tidak cocok dengan praktik | Sahkan sebelum rilis publik | **Needs decision** |

## 5. Fase 2 — perbaikan terbatas

**Tidak ada temuan Critical atau High.** Pada audit awal fase ini tidak ada migration baru.
**Pembaruan 28 Oktober 2026:** dua migration aditif AUD-14 ditambahkan dan diterapkan ke **development**: `20261028013537_ride_metadata_update_throttle.sql` membatasi edit metadata 20/10 menit dan `20261028015624_ride_update_throttle_cleanup.sql` memastikan window ikut terhapus bersama profil. **Pembaruan lanjutan 28 Oktober 2026 (AUD-11):** migration ketiga `20261028031237_revoke_anon_rls_helper_execute.sql` mencabut grant `anon`/`PUBLIC` pada enam helper RLS dan menerapkan asersi dua sisi di kedua berkas uji katalog. **31 lokal = 31 remote** (`npx supabase migration list --linked`); `db:test` **12/12**, `db:test:concurrency` membuktikan throttling serentak untuk create dan update, `db:types:check` exit 0. Tidak ada migration lama yang disunting; **tidak ada perubahan diterapkan ke beta atau production**.

Bila mempromosikan ke project lain, perintahnya tetap:

```bash
npx supabase db push --linked --dry-run   # periksa daftar
npx supabase db push --linked --yes       # hanya setelah persetujuan pemilik
```

Alasan temuan Medium lain **tidak** diperbaiki di sini:

- **AUD-26** adalah pengaturan project (Dashboard/Management API), bukan kode;
  mengubahnya butuh keputusan pemilik dan kredensial.
- **AUD-27/AUD-20** butuh project rilis dan aktivasi GitHub Pages, keduanya
  tindakan pemilik.
- **AUD-14** pada tiga jalur create/location sudah ditutup; throttle `update_ride` juga diterapkan ke development pada 28 Oktober 2026. Rate limit Auth tetap memerlukan pemeriksaan Dashboard oleh pemilik.
- **AUD-19, AUD-21, AUD-22, AUD-23** butuh perangkat, akun provider, atau
  keputusan produk/legal.

## 6. Gerbang kualitas (27 Oktober 2026, hasil apa adanya)

| Perintah | Hasil |
| --- | --- |
| `npm ci` | **exit 0** — 8 kerentanan dilaporkan (5 high, 3 moderate), seluruhnya toolchain build (AUD-25) |
| `npm run deps:check` | **exit 0** |
| `npm run typecheck` | **exit 0** |
| `npm run lint` | **exit 0** |
| `npm run format:check` | **exit 0** |
| `npm test -- --ci` | **exit 0** — 48 suite / **525** test lulus |
| `npm run test:scripts` | **exit 0** — 94 suite / **395** test lulus |
| `npm run db:test:lint` | **exit 0** |
| `npm run db:test` | **exit 0** — **12/12** berkas lulus terhadap development |
| `npm run db:test:concurrency` | **exit 0** — dua `create_club`/`create_ride` serentak; yang kedua menunggu lock lalu ditolak `P0001`; data uji bersih |
| `npm run db:types:check` | **exit 0** — tipe sama dengan skema development |
| `npm run storage:test` | **exit 0** — 27 langkah, 0 sisa |
| `npm run e2e:account-delete -- --yes` | **exit 0** — 21 langkah, 0 sisa (27 Oktober 2026) |
| `npm run e2e:shared-ride` | **exit 0** — 24 langkah; event 384/344 ms; C 0 event; 0 sisa |
| `npm run beta:preflight` | **exit 1** — 7 lulus, 1 gagal (**AUD-26 autoconfirm**) |
| `npm run export:android` | **exit 0** — `entry-5b1e7578341af943a8c87db4569e242c.hbc` 4,1 MB; pemindaian 0 JWT / 0 `postgres://` / 0 `SUPABASE_SERVICE_ROLE_KEY`. Satu kecocokan regex `sb_secret_` adalah string komentar dependency `@supabase/functions-js` di tabel string bytecode, bukan nilai kunci |
| `npm run doctor` | **exit 1 — Blocked**: `getaddrinfo EAI_AGAIN exp.host` (jaringan mesin, bukan temuan proyek) |

Status GitHub pada 27 Oktober 2026: `npx supabase migration list --linked` **28 = 28**;
`main` HEAD `b504e8a` — CI dan Database RLS **success**. Release run `40382138910`
(`b504e8a`) juga **success**, tetapi job Build APK **skipped**: gate
`should-release.mjs` menilai perubahan tidak menyentuh isi aplikasi. Rilis APK
terbaru tetap `v0.1.0-build68` (tag `9afb10b`, pre-release 26 Oktober 2026,
SHA-256 `96cb58e3…`), yang dibuat **sebelum** migration throttle dan bukan APK
untuk branch ini. Artefak itu tidak diunduh ulang dan tanda tangannya tidak
diverifikasi ulang.

## 7. Risiko terbuka dan keputusan pemilik

1. **`autoconfirm` (AUD-26)** — putuskan sebelum APK beta dibagikan: aktifkan
   konfirmasi email + SMTP kustom, atau terima risiko tertulis.
2. **Project rilis (AUD-21, AUD-27)** — backend produksi, promosi migration,
   backup/rollback, dan pengarahan `web/account-deletion/config.js` ke backend
   rilis. Rencananya sudah tertulis di
   [`PRODUCTION_MIGRATION_PLAN.md`](PRODUCTION_MIGRATION_PLAN.md); eksekusinya
   tetap **Blocked** sampai project produksi dan keputusan §1 rencana itu ada.
   Development hanya untuk pilot dengan akun sintetis.
3. **Halaman web (AUD-20)** — aktifkan Pages, deploy, verifikasi URL; jangan
   mengklaim URL sebelum benar-benar terbuka.
4. **Retensi data (AUD-23)** — sahkan kebijakan retensi hazard/audit/chat.
5. **Keystore (AUD-22)** — verifikasi cadangan dan pemegang salinan.
6. **Uji perangkat (AUD-19)** — dua HP + akun ketiga; status tetap **Blocked**
   sampai artefak PD-01…PD-20 diisi.
7. **Throttle jalur tulis (AUD-14)** — throttle create/location/update diterapkan dan lulus uji development; rate limit Auth perlu dicek pemilik di Dashboard.
8. **Dependensi toolchain (AUD-25)** — pantau patch Expo; jangan turunkan SDK.

## 8. Batasan audit

- Tidak ada uji perangkat fisik, sehingga tidak ada klaim **Tested on physical
  device** dan tidak ada klaim bahwa background location, reconnect jaringan,
  atau filter blokir bekerja di HP.
- Tidak ada pengujian browser nyata untuk CORS/`delete-account`; allowlist hanya
  dibuktikan lewat kode dan uji unit.
- Tidak ada pemindaian log runtime Supabase/Actions, tidak ada `supabase db
  advisors` (butuh akses CLI terautentikasi), dan tidak ada pengujian beban.
- Tidak menyentuh production, tidak force-push, tidak merge, tidak mengubah
  `CHANGELOG.md` atau entri ADR lama.
- Repo publik: seluruh temuan diperlakukan dengan asumsi isi repo dapat dibaca
  siapa pun.
- `docs/PROJECT_DECISIONS.md` ADR-079 masih menyebut `config.js` "placeholder".
  Entri ADR lama sengaja **tidak disunting** (aturan repo); keadaan sebenarnya
  dicatat di AUD-27 dan dokumen status di atas.

## 9. Kesimpulan

Secara **keamanan kode dan database**, tidak ada temuan Critical/High yang
terbuka: RLS, fungsi definer, Storage, hapus akun, lokasi, chat, dan pemisahan
rahasia semuanya punya bukti eksekusi terhadap development. Yang menghalangi
**rilis publik** bukan celah yang bisa ditambal di repo, melainkan konfigurasi
Auth, backend rilis, halaman web, retensi, dan uji perangkat. Pilot internal
belum boleh disebut siap sampai keputusan `autoconfirm` diambil dan checklist
perangkat dijalankan.
