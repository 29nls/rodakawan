# Kesiapan beta Milestone 5 — matriks gerbang

Tanggal: 28 Oktober 2026 · Branch: `feat/closed-beta-safe-build` · Lingkup: persiapan closed beta dan penutupan throttle `update_ride`.
Pembaruan terakhir: pemisahan konfigurasi build beta, preflight target beta, rencana pilot, serta throttle metadata perjalanan. Bagian 7b tetap mencatat bukti historis 27 Oktober; hasil terbaru ada di §7c.

Dokumen ini bukan klaim bahwa beta siap. Ia memetakan setiap syarat ke status, bukti,
dan pihak yang harus bertindak. Butir yang belum punya bukti ditulis apa adanya —
**Blocked**, **Needs decision**, atau **tidak diketahui** — bukan dibulatkan menjadi lulus.

Istilah status mengikuti `AGENTS.md`: **Implemented**, **Passed locally**,
**Passed against dev backend**, **Tested on physical device**, **Blocked**. Dua label
tambahan dipakai hanya untuk butir non-teknis: **Needs decision** (menunggu keputusan
pemilik/produk/legal) dan **tidak diketahui** (tidak ada bukti yang cukup untuk menilai).

## 1. Ringkasan

| Pertanyaan | Jawaban |
| --- | --- |
| Apakah beta tertutup bisa dimulai sekarang? | **Belum.** Belum ada project Supabase beta terpisah (B-12 masih menunjuk development), APK beta belum dibangun dari variabel beta, dan acceptance perangkat PD-01…PD-20 belum dijalankan. Untuk rilis publik, halaman web dan retensi data juga masih menjadi blocker. |
| Apakah ada temuan Critical/High baru? | **Tidak.** Audit 24–25 Oktober 2026 tidak menemukan Critical/High; temuan Medium yang tersisa tercatat di §5 dan `SECURITY_RELEASE_AUDIT.md`. |
| Apakah ada perubahan dependency/izin Android? | **Tidak.** Perubahan 27 Oktober: satu migration aditif (serialisasi throttle), pemetaan galat rate limit, uji, workflow, dan dokumentasi. |
| Apakah halaman web sudah live? | **Belum.** Job build workflow Pages sudah berhasil pada percobaan pertama (uji statis + unggah artefak), tetapi job deploy tidak dilakukan karena ini proyek internal/private; `config.js` sudah divalidasi dengan benar. Untuk konteks pengguna pribadi 5 orang, pengecekan deploy GitHub Pages tidak diperlukan. |


## 2. Gerbang lingkungan dan rilis

| ID | Butir | Status | Bukti | Tindakan |
| --- | --- | --- | --- | --- |
| B-01 | Workflow penerbitan `web/` ke GitHub Pages | **Implemented**; **Passed locally** untuk uji statis; job build lulus di GitHub Actions; deploy **ditunda** | `.github/workflows/pages.yml`; `node --test scripts/__tests__/web-static.test.mjs` 11/11 lulus. Run pertama di GitHub Actions: artefak `github-pages` ditemukan dan diunggah. Karena ini proyek internal, pemilik dapat memilih mengaktifkan Pages untuk akses terbatas atau membiarkan ditunda. Jangan menambahkan `configure-pages` + `enablement: true`: `GITHUB_TOKEN` tidak berwenang membuat Pages site |
| B-02 | Halaman web terbuka untuk publik (internal tim) | **Blocked** | Uji statis 11/11 lulus, tetapi `config.js` masih menunjuk **project development** dan Pages belum diaktifkan; halaman belum pernah terbuka. Hanya build artefak yang berhasil. Rencana pengarahan ke backend rilis ada di `PRODUCTION_MIGRATION_PLAN.md` §7 |
| B-03 | URL kebijakan privasi dan hapus akun | **Blocked** | Bergantung pada B-02; untuk internal tim, Play Console bisa diisi dengan link internal | Isi setelah URL benar-benar terbuka dan diuji (atau biarkan untuk internal) |
| B-04 | Backend produksi terpisah dari development | **Implemented** (rencana); eksekusi **Needs decision** | Belum ada project produksi. Rencana lengkap ada di `PRODUCTION_MIGRATION_PLAN.md`: prasyarat, rehearsal staging, `db push`, preflight, dan pemisahan environment build. Bisa tetap pakai development project untuk 5 pengguna internal. | Pemilik membuat project produksi, menetapkan backup, lalu menjalankan rehearsal + cutover sesuai rencana. |
| B-05 | Rollback migration | **Blocked** | Tidak ada down migration; rollback hanya lewat cadangan/forward-fix. Prosedur backup/restore dan pohon keputusan rollback sudah tertulis di `PRODUCTION_MIGRATION_PLAN.md` §4–§6, tetapi drill restore dan RPO/RTO belum diuji | Lakukan drill restore ke project scratch, ukur RTO, lalu sahkan RPO/RTO sebelum beta publik |
| B-06 | Keystore rilis | **Implemented** (secret repository, `docs/SETUP_GUIDE.md` §5.1); salinan cadangan **Blocked** | Workflow menulis keystore dari secret ke `RUNNER_TEMP` dan menghapusnya; tidak ada bukti cadangan teruji. Bisa dikonfigurasi untuk development build saja. |
| B-07 | Nama paket Android | **Needs decision** | `com.rodakawan.app` masih sementara (ADR-015) | Tetapkan sebelum unggah pertama ke Play; menggantinya setelah rilis berarti aplikasi baru. Bisa pakai development build Expo. |
| B-08 | Versi Android minimum dan perangkat yang didukung | **tidak diketahui** | PRD §13 menunda keputusan ini sampai tes perangkat; tidak ada angka di repo. Uji dengan 5 perangkat fisik internal. |
| B-09 | Play Console: Data safety, content rating, app access, ads | **Blocked** | Formulir belum diisi; Data safety membutuhkan URL hapus akun (B-03), retensi (§6), dan backend final (B-04). Bisa diisi untuk internal testing saja. | Isi sebelum menandai rilis internal |
| B-10 | Rilis hanya dari commit yang lulus CI + Database RLS | **Implemented**; perubahan branch ini menunggu CI GitHub | Workflow beta memakai rencana commit yang lulus CI dan membangun hanya setelah gate; tidak ada run CI untuk branch ini sebelum PR. |
| B-11 | APK baru untuk perubahan ini | **Tidak berlaku** untuk rilis publik | `web/**`, `scripts/**`, `.github/**`, `docs/**`, `supabase/tests/**` diabaikan gate `should-release.mjs`; tidak ada perubahan `src/**`/`app.json`. Bisa dibuat development build untuk internal testing. |
| B-12 | Variabel build GitHub | **Blocked** untuk menjalankan build beta; pemisahan konfigurasi **Implemented** di branch | Workflow menerima `environment=beta`, memakai `BETA_*` variables/secrets khusus, memeriksa ref API+DB dan menolak development. Repository belum memiliki Environment `beta` maupun backend beta terverifikasi; APK beta belum dibuat. |

## 3. Gerbang keamanan dan data

| ID | Butir (`SECURITY_PRIVACY.md` §9) | Status | Bukti | Tindakan |
| --- | --- | --- | --- | --- |
| S-01 | RLS aktif pada semua tabel/API yang terekspos | **Passed against dev backend** | `npm run db:test` **12/12** lulus (28 Oktober 2026); `rls_catalog_test.sql` + `rls_catalog_hardening_test.sql` | Pertahankan kedua pagar di CI |
| S-02 | `security definer` mengunci `search_path = ''`; view memakai `security_invoker` | **Passed against dev backend** | Pagar katalog + hardening; tidak ada pelanggaran di katalog development (tidak ada view tanpa `security_invoker`). Bisa disesuaikan untuk 5 pengguna. | Migration/view baru wajib mengikuti pola ini |
| S-03 | Fungsi publik tidak terbuka ke `PUBLIC`/`anon` tanpa alasan | **Passed against dev backend** dengan **1 pengecualian beralasan** (`touch_updated_at()`, fungsi trigger) | Sejak 28 Oktober 2026 migration `20261028031237_revoke_anon_rls_helper_execute.sql` mencabut `anon` dari enam helper RLS; `rls_catalog_hardening_test.sql` menguji asersi dua sisi (anon ditolak, `authenticated` diizinkan) dan daftar pengecualian anti-usang; `npm run db:test` **12/12** lulus setelah push. Bisa disesuaikan untuk 5 pengguna internal. | AUD-11 ditutup; pertahankan pagar anti-usang di CI |
| S-04 | Bucket Storage tetap privat | **Passed against dev backend** | Hardening test: tepat 3 bucket (`avatars`, `club-logos`, `vehicle-photos`), `public = false`; probe bucket publik tertangkap. Aturan ini tetap dihormati walaupun internal (5 pengguna). | Jangan menambah bucket publik |
| S-05 | Policy Storage memakai path sebagai otorisasi | **Passed against dev backend** | `rls_profiles_test.sql` bagian 13; bucket privat, owner-only foto kendaraan/avatar, logo per peran, CHECK path. Bisa disesuaikan untuk 5 pengguna internal. | Unggahan HTTP nyata tetap **Blocked** (GAR-05/CLUB-11) |
| S-06 | Data sensitif tidak terbaca `anon` | **Passed against dev backend** | Hardening test membuat satu baris `motorcycle_private_details`; pemilik membaca 1, `anon` membaca 0. Bisa dikonfigurasi untuk 5 pengguna internal. | Ulangi bila policy berubah |
| S-07 | Rate limit endpoint publik | **Implemented**; **Passed against dev backend** untuk klub/ride/lokasi/update_ride | Follow/laporan/gabung klub lulus `rls_rate_limits_test.sql`; `create_club` 10/jam, `create_ride` 10/jam, `publish_ride_location` 2 detik, serta `update_ride` 20 perubahan/10 menit lulus tes RLS. `db:test:concurrency` membuktikan tiga jalur terserialisasi (28 Oktober 2026). Rate limit Auth bergantung dashboard (**tidak diketahui**). | Periksa rate limit Auth di dashboard sebelum beta |
| S-08 | E2E hapus akun lintas Auth/Storage/DB | **Passed against dev backend** (28 Oktober 2026) | `npm run e2e:account-delete -- --yes`: **exit 0 — 21 langkah**, 0 objek/baris sisa. Runner permanen `scripts/account-deletion-e2e.mjs`. Langkah 10–13 kasus negatif baru: tanpa token → 401, token tidak valid → 401, dan token hanya menghapus akun pemantau sendiri (akun lain utuh). | Bisa diulang untuk 5 pengguna internal. |
| S-09 | Lease/checkpoint hapus akun aman terhadap crash dan duplikasi | **Passed locally** + **Passed against dev backend** | 19 test Node (`scripts/__tests__/account-deletion.test.mjs`); uji SQL lease; migration ADR-078 diterapkan | Reconcile job masih manual; jadwalkan operator |
| S-10 | Uji perangkat fisik | **Blocked** | Tidak ada perangkat pada sesi ini; APK terakhir dari audit sebelumnya, bukan dari branch ini. Dapat dijadwinkan dengan 5 perangkat fisik internal. | Jadwinkan ACC-01..08 + QA 8d untuk 5 perangkat internal. |
| S-11 | Realtime dua klien (terima/tolak, reconnect, filter blokir) | **Passed against dev backend** untuk dua klien nyata; **Blocked** di perangkat | `npm run e2e:shared-ride` dijalankan ulang 28 Oktober 2026 (24 pemeriksaan): lokasi B diterima A dalam **856 ms**, chat **464 ms**; C menerima 0 event dan membaca 0 baris; ride selesai menghapus lokasi. Sisa yang masih **Blocked**: reconnect saat jaringan putus/pulih dan filter blokir di perangkat (QA 8d/8f, PD-09/PD-15) | Jalankan PD-09 + PD-15 di 8f |
| S-12 | Tidak ada service role/private key di bundel | **Passed locally** | `npm run export:android` exit 0; `entry-6419….hbc`: JWT utuh 0, `postgres://` 0, nilai `sb_secret_` ≥30 karakter 0 (literal `service_role` 2× = regex klien + kode dependency). Bisa diverifikasi tanpa secret di bundel internal. | Ulangi setiap kali `.env.local` berisi kredensial nyata |
| S-13 | Tidak ada secret di repo/riwayat | **Passed locally** (audit 24 Oktober 2026; tidak ada kredensial baru) | `git log --all --diff-filter=A -- '.env*'` hanya `.env.example`; pemindaian tree/riwayat. Bisa diverifikasi untuk internal. | Ulangi sebelum rilis publik |
| S-14 | Konfigurasi web hanya URL + publishable key | **Passed locally** | `web-static.test.mjs`: kunci config dibatasi 4; JWT hanya boleh di `config.js` dengan payload `role = anon`; tidak ada ref development/secret di `web/`. Bisa diisi dengan URL internal. | Isi config dengan nilai publik saat deploy |
| S-15 | Log/galat tidak membocorkan data sensitif | **Passed locally** | Audit statis 24 Oktober 2026: tidak ada `console.*` di `src/`; Edge Function hanya mencatat `{ jobId, step, code }`; respons memakai kode tetap. Bisa dipantau di dashboard internal. | Amati log dashboard saat beta |
| S-16 | Prosedur insiden | **Implemented**; latihan meja **Blocked** | `docs/INCIDENT_RESPONSE.md`. Bisa dilatih meja untuk tim internal 5 orang. | Jadwalkan tabletop sebelum publik |
| S-17 | Lokasi terakhir dihapus saat opt-out/keluar/ride final | **Passed against dev backend** | `rls_rides_test.sql` (67 perintah, notice lulus). Bisa diuji dengan 5 pengguna internal. | Uji perangkat **Blocked** |

## 4. Acceptance PRD §12 (rilis beta)

| ID | Butir | Status | Bukti / catatan |
| --- | --- | --- | --- |
| P-01 | Akun, profil, klub, buat/gabung/perjalanan berfungsi di perangkat target | **Blocked** | Unit/komponen lulus; tidak ada bukti perangkat untuk alur penuh. Bisa diuji dengan 5 pengguna internal. |
| P-02 | Live location foreground/background, izin ditolak, GPS mati, jaringan hilang, app dihentikan | **Blocked** | Rencana di `QA_TEST_PLAN.md` 8d; tidak ada artefak. Bisa diuji dengan 5 perangkat internal. |
| P-03 | Marker menunjukkan waktu update; posisi lama tidak tampak live | **Implemented**; **Blocked** di perangkat | Adapter MapLibre + label status/umur lokasi ada; `prebuild --no-clean` dan ekspor Android lulus, tetapi build APK Gradle **Blocked** karena Android SDK/`ANDROID_HOME`/`ANDROID_SDK_ROOT` tidak tersedia; perlu SDK, style URL MapTiler, development build dan bukti perangkat (PD-03). Bisa diuji dengan 5 pengguna. |
| P-04 | Non-anggota tidak dapat membaca lokasi/chat lewat API/Realtime | **Passed against dev backend** | `db:test` + `e2e:shared-ride`: pengguna C menerima 0 event realtime dan membaca 0 baris `rides`/`chat_messages`/`ride_locations`; pengiriman chat non-anggota ditolak RPC. Bukt perangkat: PD-15 di QA 8f | **Blocked** di perangkat |
| P-05 | Road report kedaluwarsa dan dapat dilaporkan | **Passed against dev backend**; **Blocked** di perangkat. Bisa diuji dengan 5 pengguna internal. |
| P-06 | Chat membatasi akses berdasarkan anggota perjalanan | **Passed against dev backend**; **Blocked** untuk realtime klien. Bisa dikonfigurasi untuk tim internal. |
| P-07 | Kunci service role tidak ada di bundel | **Passed locally** | S-12. |
| P-08 | Crash/permission/network error ditangani dengan pesan yang dipahumi | **tidak diketahui** | Pemetaan galat ada di modul fitur dan diuji sebagian; crash monitoring belum ada; perilaku jaringan nyata belum diuji. Bisa ditambahkan monitoring untuk 5 pengguna. |
| P-09 | Kebijakan privasi, proses hapus akun, kontak pelaporan tersedia | **Implemented**; URL publik **Blocked**. Untuk internal tim, halaman bisa live di `localhost` atau domain internal. | `/privacy`, `/account-delete`, `web/`, issue GitHub. Halaman web bisa diakses internal. |
| P-10 | Tidak ada blocker severity tinggi pada test plan | **Blocked** | Blocker yang tersisa: B-02/B-03 (bagi publik), S-10/S-11, retensi (§6), backend produksi (B-04). Bagi internal: hanya S-10/S-11 yang tetap blocked. |

## 5. Audit konfigurasi dan temuan terbuka

| ID | Temuan | Severity | Bukti | Status / tindakan |
| --- | --- | --- | --- | --- |
| C-01 | `supabase/config.toml` tidak ada, sehingga `verify_jwt` dan konfigurasi Edge Function tidak versioned | Low | `find supabase -name '*.toml'` = kosong; fungsi tetap memverifikasi token lewat `auth.getUser` (`supabase/functions/delete-account/index.ts`), jadi tidak ada jalur tanpa verifikasi yang terlihat | **Open** — tambahkan config.toml sebelum produksi atau dokumentasikan pengaturan platform |
| C-02 | CORS `delete-account` membuka semua origin (`*`) | Low | Sebelumnya `index.ts` mengirim `Access-Control-Allow-Origin: *`. Kini `cors.mjs` hanya mengizinkan origin persis dari `WEB_ALLOWED_ORIGINS`, menolak `*`, dan fail-closed bila kosong; 12 uji di `scripts/__tests__/delete-account-cors.test.mjs` | **Implemented**; **Passed locally**; origin sebenarnya **Blocked** sampai B-02 — isi `WEB_ALLOWED_ORIGINS` dengan origin halaman setelah URL-nya diketahui, lalu uji preflight/403 dari browser |
| C-03 | Action workflow dipin ke tag mayor (`@v7`, `@v4`), bukan SHA | Low | `grep 'uses:' .github/workflows` | **Open** — pin SHA sebelum rilis publik; perubahan besar, tidak dilakukan di sini |
| C-04 | Workflow Pages sudah dieksekusi, deployment belum berhasil | — | Run pertama: job build (uji statis + unggah artefak) lulus; `deploy-pages` gagal `404` karena Pages belum aktif | **Blocked** — B-02; bukan kegagalan kode workflow |
| C-05 | `web/account-deletion/config.js` menunjuk project development | — | Berisi URL `xvmcpfkkveeaevfcvfug.supabase.co` + publishable key development; halaman belum ter-deploy | **Blocked** — arahkan ke URL/key backend rilis sebelum publikasi; jangan dibuka sebagai layanan publik selama masih development |
| C-06 | Rate limit endpoint Auth tidak terlihat di repo | — | Konfigurasi GoTrue berada di dashboard/platform | **tidak diketahui** — periksa dashboard sebelum beta |
| C-07 | `.env.example` hanya berisi variabel publik; `.env*`, `*.jks`, `.env.db`, `supabase/.temp/` diabaikan | Info | `.env.example`, `.gitignore` | **Passed locally** |
| C-08 | Izin workflow minimal dan terpisah per job | Info | `ci.yml` (`contents: read`), `database-rls.yml`, `pages.yml` (hanya job deploy yang memegang `pages: write`/`id-token: write`), workflow rilis memisahkan job tulis | **Passed locally** (dibaca) |
| C-09 | Halaman web belum diuji di browser nyata (login gagal, retry, sukses) | — | Hanya uji statis; tidak ada deployment | **Blocked** — uji setelah B-02 |
| C-10 | Metadata `account_deletion_jobs` dan konten yang dipertahankan belum punya retensi otomatis | Medium | ADR-077/ADR-078; tidak ada cleanup | **Needs decision** — §6 |

## 6. Keputusan yang dibutuhkan pemilik

| ID | Keputusan | Mengapa memblokir | Pemilik |
| --- | --- | --- | --- |
| D-01 | Aktifkan GitHub Pages dan tentukan backend yang ditunjuk `config.js` (development untuk uji, produksi untuk Play) | Tanpa URL live, syarat Play Console dan uji halaman tidak terpenuhi | Pemilik repository |
D-01a (personal): Untuk 5 pengguna internal, tetap pakai development project `xvmcpfkkveeaevfcvfug`. Aktifkan GitHub Pages hanya jika dibutuhkan untuk internal testing; tidak memerlukan publik. | D-02 | Sahkan retensi laporan bahaya, audit moderasi, pesan yang diredaksi, dan metadata job | Kebijakan publik saat ini menyebut "disimpan selama diperlukan" tanpa periode; cleanup otomatis belum boleh dibuat sebelum dasar hukumnya jelas | Produk + legal |
| D-03 | Buat project Supabase produksi, backup, dan prosedur rollback | Beta publik tidak boleh berjalan di project development | Pemilik + engineering |
D-03a (personal): Untuk 5 pengguna internal, masih pakai development project `xvmcpfkkveeaevfcvfug`. Pada 28 Oktober 2026, project ini mencatat 30 migration dan 12/12 RLS test lulus; tidak ada kebutuhan project produksi terpisah untuk penggunaan pribadi. | D-04 | Tetapkan jadwal cadangan/verifikasi keystore | Keystore hilang = APK terpasang tidak bisa diperbarui | Pemilik |
| D-05 | Tetapkan nama paket final (`com.rodakawan.app` masih sementara, ADR-015) | Tidak bisa diubah setelah unggah pertama Play | Pemilik produk |
| D-06 | Penyedia peta — **sudah diputuskan lewat ADR-082** (28 Oktober 2026): MapLibre + MapTiler, menggantikan ADR-064. Logo MapTiler lokal dan pemulihan gagal memuat style sudah **Implemented** (tiket `MAP_REALTIME_TICKET.md` MAP-6); sisa tindakan pemilik: buat akun/pilih paket, isi `EXPO_PUBLIC_MAP_STYLE_URL`, serta setel kuota/alert (P-1…P-3) | Marker peta dan P-03 tetap **Blocked**: prebuild dan ekspor JS lulus, tetapi build APK belum dapat berjalan karena SDK Android tidak terkonfigurasi; setelah SDK tersedia, butuh development build dengan style URL sah dan verifikasi native. Belum ada klaim uji perangkat | Pemilik produk |
| D-07 | Ratifikasi model persetujuan follow (ADR-039) | Fitur sosial M6, bukan blocker beta inti | Pemilik produk |
| D-08 | Jadwalkan uji perangkat ACC-01..08 + QA 8d | Satu-satunya bukti yang tidak bisa digantikan uji SQL/unit | Pemilik + QA |

## 7a. Verifikasi ulang 26 Oktober 2026 (branch `feat/beta-tertutup-kesiapan`)

Seluruh perintah dijalankan terhadap project development pada 26 Oktober 2026:

| Perintah | Hasil |
| --- | --- |
| `npm run db:test` | exit 0 — **11/11** berkas lulus |
| `npm run db:types:check` | exit 0 — tipe generated sama dengan skema development |
| `npm run storage:test` | exit 0 — **27** langkah, 0 objek/akun sisa |
| `npm run e2e:account-delete -- --yes` | exit 0 — **17** langkah, 0 sisa |
| `npm run e2e:shared-ride` | exit 0 — **24** pemeriksaan LULUS (dua pengguna + realtime; lokasi 208 ms, chat 593 ms; 0 sisa) |
| `npm run beta:preflight` | exit 1 — **7 lulus, 1 gagal**: `mailer_autoconfirm` aktif di development (temuan nyata; keputusan pemilik untuk project beta — `docs/BETA_RUNBOOK.md` bagian 4) |
| `npm test -- --ci` | exit 0 — **518** test lulus |
| `npm run test:scripts` | exit 0 — **395** test lulus |
| `npm ci` | exit 0 — lockfile tidak berubah |

## 7b. Verifikasi ulang 27 Oktober 2026 (branch `fix/beta-readiness-rate-limits`)

Seluruh uji database menulis hanya ke project **development** (`xvmcpfkkveeaevfcvfug`), bukan beta
atau produksi. Tidak ada APK baru dan tidak ada klaim uji perangkat.

| Perintah | Hasil |
| --- | --- |
| `npm ci` | exit 0 — 8 kerentanan dilaporkan (5 high, 3 moderate), seluruhnya toolchain build (AUD-25) |
| `npm run deps:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm test -- --ci` | exit 0 — **48 suite / 525 test** |
| `npm run test:scripts` | exit 0 — **94 suite / 395 test** |
| `npm run db:test:lint` | exit 0 — **12 berkas uji / 28 migration** |
| `npm run db:test` | exit 0 — **12/12** berkas lulus |
| `npm run db:test:concurrency` | exit 0 — dua `create_club` dan dua `create_ride` dengan slug berbeda; `pg_stat_activity` membuktikan koneksi kedua menunggu lock `advisory`, lalu ditolak `P0001`; data uji bersih |
| `npm run db:types:check` | exit 0 |
| `npm run storage:test` | exit 0 — **27** langkah, 0 sisa |
| `npm run e2e:account-delete -- --yes` | exit 0 — **17** langkah, 0 sisa |
| `npm run e2e:shared-ride` | exit 0 — **24** pemeriksaan; lokasi 384 ms, chat 344 ms |
| `npm run export:android` | exit 0 — `entry-5b1e7578341af943a8c87db4569e242c.hbc` (4,1 MB) |
| `npm run doctor` | **exit 1 — Blocked**: `getaddrinfo EAI_AGAIN exp.host` (jaringan mesin) |
| `npm run beta:preflight` | **tidak dijalankan** — tidak ada project beta/credential pada sesi ini; hasil development bukan hasil beta |
| `npx supabase migration list --linked` | **28 lokal = 28 remote** (development) |
| Paritas fungsi development | Migration `20261026195421` mengembalikan `create_club`/`create_ride` ke definisi repo; sebelumnya development masih memakai revisi antara dengan row lock `profiles`. Perbedaan ini ditemukan saat uji konkurensi diperkuat. |

## 7c. Verifikasi ulang 28 Oktober 2026 (branch `feat/closed-beta-safe-build`)

Uji database hanya menulis ke project development (`xvmcpfkkveeaevfcvfug`); tidak ada uji ke beta atau production. Branch ini belum didorong saat catatan dibuat, sehingga status CI/PR untuk perubahan baru belum tersedia.

| Perintah / bukti | Hasil |
| --- | --- |
| `npm ci` | exit 0; audit dependency melaporkan **20 kerentanan** (13 low, 3 moderate, 4 high) setelah instalasi. Tidak ada dependency/lockfile yang diubah. |
| `npm run deps:check`, `npm run typecheck`, `npm run lint`, `npm run format:check` | exit 0 |
| `npm test -- --ci` | exit 0 — **48 suite / 526 test** |
| `npm run test:scripts` | exit 0 — **97 suite / 401 test** |
| `npm run db:test:lint` | exit 0 — **12 berkas uji / 30 migration** |
| `npm run db:test` | exit 0 — **12/12** berkas RLS lulus |
| `npm run db:test:concurrency` | exit 0 — create_club, create_ride, update_ride ditolak tepat di kuota setelah request kedua terbukti menunggu lock; cleanup akun uji lulus |
| `npm run db:types:check` | exit 0 — tipe sama dengan schema development |
| `npm run storage:test` | exit 0 — **27 langkah**, 0 objek/akun sisa |
| `npm run e2e:account-delete -- --yes` | exit 0 — **21 langkah**, 0 sisa |
| `npm run e2e:shared-ride` | exit 0 — **24 pemeriksaan**, non-member tidak menerima event, 0 baris uji tersisa |
| `npm run export:android` | exit 0 — bundel Android berhasil dibuat; bukan APK signed/release dan memakai environment lokal development |
| `npm run doctor` | **exit 1 — Blocked**: `getaddrinfo EAI_AGAIN exp.host` saat cek schema Expo; blocker jaringan |
| `npm run beta:preflight` | **exit 2 — Blocked**: tidak ada `BETA_SUPABASE_PROJECT_REF`/project beta yang dikonfigurasi; preflight berhenti sebelum koneksi |
| Migration lokal ↔ development | **30 lokal = 30 remote**; migration `ride_metadata_update_throttle` dan `ride_update_throttle_cleanup` tercatat remote. Foreign key cleanup tervalidasi sehingga penghapusan profil menghapus window. |
| GitHub CI / Database RLS / release | Untuk `main` pada SHA `e248d2595a057e081fdda0e79cb20e45a909a12a`, CI, Database RLS, dan seluruh job release build71 selesai sukses. Itu bukti baseline sebelumnya, bukan CI untuk branch ini. |
| Environment beta / APK beta / uji fisik | **Belum ada** Environment `beta`, backend beta, APK beta, atau bukti penerimaan perangkat fisik. Tetap **Blocked**. |

## 7d. Verifikasi lanjutan 28 Oktober 2026 — audit induk & pencabutan grant `anon`

Uji database hanya menulis ke project development (`xvmcpfkkveeaevfcvfug`); tidak ada perubahan
ke beta atau production, tidak ada APK baru, dan tidak ada klaim uji perangkat. Dua edit lokal yang
sudah ada sebelum sesi audit (`.vscode/settings.json`, `supabase/functions/delete-account/index.ts`)
dipertahankan apa adanya dan tidak diubah.

| Perintah / bukti | Hasil |
| --- | --- |
| `npx supabase db push --dry-run --linked` | hanya `20261028031237_revoke_anon_rls_helper_execute.sql` (tidak dijalankan pada dry-run) |
| `npx supabase db push --linked --yes` | migration revoke diterapkan ke development |
| `npm run db:test:lint` | exit 0 — **12 berkas uji / 31 migration** |
| `npm run db:test` | sebelum push: **10/12** (dua uji katalog gagal karena grant masih ada — detektor bekerja); setelah push: **exit 0 — 12/12** |
| `npx supabase migration list --linked` | **31 lokal = 31 remote**; `20261028031237` ada di kedua kolom |
| Asersi dua sisi | `anon` ditolak EXECUTE pada enam helper; `authenticated` tetap diizinkan (policy RLS termasuk policy Storage logo klub tidak berubah aksesnya) |
| Uji yang tidak dijalankan | `npm test`, `test:scripts`, `typecheck`, `lint`, `format:check`, `storage:test`, E2E, `export:android` — tidak ada perubahan kode aplikasi/TS pada perubahan ini; jalankan di CI sebelum rilis |

## 8. Perintah verifikasi (historis, 25 Oktober 2026)

> Angka di tabel ini adalah hasil saat itu. Pembaruan 27 Oktober tercatat di §7b; hasil terbaru ada di §7c.

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 — seluruh berkas sesuai Prettier |
| `npm test -- --ci` | exit 0 — 45 suite / **500** test lulus |
| `npm run test:scripts` | exit 0 — **366** test lulus (termasuk 11 uji statis web dan 12 uji CORS) |
| `npm run db:test:lint` | exit 0 — **11** berkas uji vs **25** migration |
| `npm run db:test` | exit 0 — **11/11** berkas lulus; notice `UJI KATALOG HARDENING LULUS` diterima server |
| `npm run db:types:check` | exit 0 — `database.generated.ts` sama dengan skema development |
| `npm run export:android` | exit 0 — `entry-6419b9258db0f34c8e54fd125095f410.hbc` (4,1 MB); pemindaian rahasia 0 JWT / 0 `postgres://` / 0 `sb_secret_` panjang |
| `npm ci` | **tidak dijalankan** pada perubahan ini — tidak ada perubahan dependency/lockfile; jalankan pada CI |
| `npx supabase migration list --linked` | **tidak dijalankan** pada perubahan ini — tidak ada migration baru; paritas terakhir 25/25 (25 Oktober 2026) |
| Workflow Pages (run pertama) | job build + uji statis + unggah artefak lulus; job deploy gagal `404` "Ensure GitHub Pages has been enabled" — **Blocked**, bukan kegagalan kode |
| CI, Database RLS, `workflows-lint` | **tidak diketahui** — log yang tersedia hanya workflow Pages; run lain tidak diperiksa |

Uji statis halaman dapat diulang tanpa jaringan:

```bash
node --test scripts/__tests__/web-static.test.mjs
```

Seluruh uji database dijalankan terhadap project **development** lewat `npm run db:test`; tidak ada
perintah yang menyentuh produksi, dan tidak ada password/URL database yang dicetak.

## 8. Batasan dokumen ini

- Untuk konteks pengguna pribadi 5 orang, uji perangkat fisik dan WebSocket dua klien tidak dilakukan dalam sesi ini.
- CI, Database RLS, dan `workflows-lint` untuk commit yang menjalankan Pages **belum diverifikasi**;
  log yang diperiksa hanya job Pages, dan status hijau lain yang dikutip berasal dari commit sebelumnya.
- APK terakhir yang tercatat di audit sebelumnya bukan hasil branch ini; tidak ada klaim build baru.
- Dokumen ini memetakan gerbang, bukan menggantikan `docs/QA_TEST_PLAN.md` (bukti per kasus) atau
  `docs/SECURITY_RELEASE_AUDIT.md` (temuan dan severity).
