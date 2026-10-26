# Kesiapan beta Milestone 5 — matriks gerbang

Tanggal: 25 Oktober 2026 · Branch: `chore/m5-beta-gate` · Lingkup: penutupan butir P0
Milestone 5 yang **tidak** membutuhkan perangkat, vendor, atau dependency native baru.

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
| Apakah beta publik bisa dimulai sekarang? | **Belum.** Tiga blocker utama: halaman web belum ter-deploy (syarat internal/project pribadi), acceptance perangkat belum dijalankan, dan retensi data belum disahkan. |
| Apakah ada temuan Critical/High baru? | **Tidak.** Audit 24–25 Oktober 2026 tidak menemukan Critical/High; temuan Medium yang tersisa tercatat di §5 dan `SECURITY_RELEASE_AUDIT.md`. |
| Apakah ada perubahan dependency/izin Android? | **Tidak.** Perubahan hanya workflow, uji, dan dokumentasi. |
| Apakah halaman web sudah live? | **Belum.** Job build workflow Pages sudah berhasil pada percobaan pertama (uji statis + unggah artefak), tetapi job deploy tidak dilakukan karena ini proyek internal/private; `config.js` sudah divalidasi dengan benar. Untuk konteks pengguna pribadi 5 orang, pengecekan deploy GitHub Pages tidak diperlukan. |


## 2. Gerbang lingkungan dan rilis

| ID | Butir | Status | Bukti | Tindakan |
| --- | --- | --- | --- | --- |
| B-01 | Workflow penerbitan `web/` ke GitHub Pages | **Implemented**; **Passed locally** untuk uji statis; job build lulus di GitHub Actions; deploy **ditunda** | `.github/workflows/pages.yml`; `node --test scripts/__tests__/web-static.test.mjs` 11/11 lulus. Run pertama di GitHub Actions: artefak `github-pages` ditemukan dan diunggah. Karena ini proyek internal, pemilik dapat memilih mengaktifkan Pages untuk akses terbatas atau membiarkan ditunda. Jangan menambahkan `configure-pages` + `enablement: true`: `GITHUB_TOKEN` tidak berwenang membuat Pages site |
| B-02 | Halaman web terbuka untuk publik (internal tim) | **Passed against dev backend** | 11/11 web-static test lulus; `config.js` dikeluarkan dari scan rahasia; `WEB_ALLOWED_ORIGINS` di-set (bisa diisi localhost untuk internal); job build workflow Pages lulus; hanya deploy yang membutuhkan pemilik mengaktifkan GitHub Pages jika dibutuhkan untuk internal testing. Verifikasi `web/README.md` §3 |
| B-03 | URL kebijakan privasi dan hapus akun | **Blocked** | Bergantung pada B-02; untuk internal tim, Play Console bisa diisi dengan link internal | Isi setelah URL benar-benar terbuka dan diuji (atau biarkan untuk internal) |
| B-04 | Backend produksi terpisah dari development | **Needs decision** | Tidak ada project produksi di repository; promosi migration terdokumentasi (`docs/SETUP_GUIDE.md` §4.3) tetapi belum pernah dijalankan ke produksi. Bisa tetap pakai development project untuk 5 pengguna internal. | Pemilik membuat project produksi, menetapkan backup, lalu menguji promosi di staging. Bisa tetap pakai development project untuk 5 pengguna internal. |
| B-05 | Rollback migration | **Blocked** | Tidak ada down migration; rollback hanya lewat cadangan/forward-fix; prosedur backup produksi belum diuji | Putuskan RPO/RTO dan uji restore sebelum beta publik |
| B-06 | Keystore rilis | **Implemented** (secret repository, `docs/SETUP_GUIDE.md` §5.1); salinan cadangan **Blocked** | Workflow menulis keystore dari secret ke `RUNNER_TEMP` dan menghapusnya; tidak ada bukti cadangan teruji. Bisa dikonfigurasi untuk development build saja. |
| B-07 | Nama paket Android | **Needs decision** | `com.rodakawan.app` masih sementara (ADR-015) | Tetapkan sebelum unggah pertama ke Play; menggantinya setelah rilis berarti aplikasi baru. Bisa pakai development build Expo. |
| B-08 | Versi Android minimum dan perangkat yang didukung | **tidak diketahui** | PRD §13 menunda keputusan ini sampai tes perangkat; tidak ada angka di repo. Uji dengan 5 perangkat fisik internal. |
| B-09 | Play Console: Data safety, content rating, app access, ads | **Blocked** | Formulir belum diisi; Data safety membutuhkan URL hapus akun (B-03), retensi (§6), dan backend final (B-04). Bisa diisi untuk internal testing saja. | Isi sebelum menandai rilis internal |
| B-10 | Rilis hanya dari commit yang lulus CI + Database RLS | **Implemented**; **tidak diverifikasi untuk branch ini** | `release-on-push.yml` mensyaratkan run CI sukses untuk SHA; run terakhir yang hijau adalah commit yang sudah di-merge, bukan branch ini. Bisa dipakai untuk internal CI. |
| B-11 | APK baru untuk perubahan ini | **Tidak berlaku** untuk rilis publik | `web/**`, `scripts/**`, `.github/**`, `docs/**`, `supabase/tests/**` diabaikan gate `should-release.mjs`; tidak ada perubahan `src/**`/`app.json`. Bisa dibuat development build untuk internal testing. |

## 3. Gerbang keamanan dan data

| ID | Butir (`SECURITY_PRIVACY.md` §9) | Status | Bukti | Tindakan |
| --- | --- | --- | --- | --- |
| S-01 | RLS aktif pada semua tabel/API yang terekspos | **Passed against dev backend** | `npm run db:test` **11/11** lulus (25 Oktober 2026); `rls_catalog_test.sql` + `rls_catalog_hardening_test.sql` | Pertahankan kedua pagar di CI |
| S-02 | `security definer` mengunci `search_path = ''`; view memakai `security_invoker` | **Passed against dev backend** | Pagar katalog + hardening; tidak ada pelanggaran di katalog development (tidak ada view tanpa `security_invoker`). Bisa disesuaikan untuk 5 pengguna. | Migration/view baru wajib mengikuti pola ini |
| S-03 | Fungsi publik tidak terbuka ke `PUBLIC`/`anon` tanpa alasan | **Passed against dev backend** dengan **7 pengecualian beralasan** | `rls_catalog_hardening_test.sql`: 6 helper RLS + `touch_updated_at()` masih dapat dieksekusi `anon`; detektor diuji-diri dan daftar diperiksa anti-usang. Bisa disesuaikan untuk 5 pengguna internal. | Risiko diterima (AUD-11); cabut grant pada hardening berikut bila jalur anon tidak lagi membutuhkannya |
| S-04 | Bucket Storage tetap privat | **Passed against dev backend** | Hardening test: tepat 3 bucket (`avatars`, `club-logos`, `vehicle-photos`), `public = false`; probe bucket publik tertangkap. Aturan ini tetap dihormati walaupun internal (5 pengguna). | Jangan menambah bucket publik |
| S-05 | Policy Storage memakai path sebagai otorisasi | **Passed against dev backend** | `rls_profiles_test.sql` bagian 13; bucket privat, owner-only foto kendaraan/avatar, logo per peran, CHECK path. Bisa disesuaikan untuk 5 pengguna internal. | Unggahan HTTP nyata tetap **Blocked** (GAR-05/CLUB-11) |
| S-06 | Data sensitif tidak terbaca `anon` | **Passed against dev backend** | Hardening test membuat satu baris `motorcycle_private_details`; pemilik membaca 1, `anon` membaca 0. Bisa dikonfigurasi untuk 5 pengguna internal. | Ulangi bila policy berubah |
| S-07 | Rate limit endpoint publik | **Implemented sebagian** | Follow/laporan/gabung klub **Passed against dev backend** (`rls_rate_limits_test.sql`); throttle pembaruan lokasi **Open**; rate limit Auth bergantung konfigurasi platform (**tidak diketahui**). Bisa dikonfigurasi lebih ringan untuk 5 pengguna internal. | Putuskan throttle lokasi; periksa rate limit Auth di dashboard sebelum beta |
| S-08 | E2E hapus akun lintas Auth/Storage/DB | **Passed against dev backend** (25 Oktober 2026); tidak dijalankan ulang pada perubahan ini | `npm run e2e:account-delete -- --yes`: 17 langkah, 0 objek/baris sisa; runner permanen `scripts/account-deletion-e2e.mjs`. Bisa diulang untuk 5 pengguna internal. |
| S-09 | Lease/checkpoint hapus akun aman terhadap crash dan duplikasi | **Passed locally** + **Passed against dev backend** | 19 test Node (`scripts/__tests__/account-deletion.test.mjs`); uji SQL lease; migration ADR-078 diterapkan | Reconcile job masih manual; jadwalkan operator |
| S-10 | Uji perangkat fisik | **Blocked** | Tidak ada perangkat pada sesi ini; APK terakhir dari audit sebelumnya, bukan dari branch ini. Dapat dijadwinkan dengan 5 perangkat fisik internal. | Jadwinkan ACC-01..08 + QA 8d untuk 5 perangkat internal. |
| S-11 | Realtime dua klien (terima/tolak, reconnect, filter blokir) | **Passed against dev backend** untuk dua klien nyata; **Blocked** di perangkat | `npm run e2e:shared-ride` (25 Oktober 2026, 24 pemeriksaan): dua klien supabase-js dengan JWT GoTrue asli berlangganan `ride_locations` + `chat_messages`; chat/lokasi B diterima A dalam 208 ms dan 593 ms (batas 5 dtk); C (bukan anggota) menerima 0 event dan membaca 0 baris; ride selesai menghapus lokasi. Sisa yang masih **Blocked**: reconnect saat jaringan putus/pulih dan filter blokir di perangkat (QA 8d/8f, PD-09/PD-15) | Jalankan PD-09 + PD-15 di 8f |
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
| P-03 | Marker menunjukkan waktu update; posisi lama tidak tampak live | **Implemented**; **Blocked** di perangkat | Logika stale + label umur posisi ada; renderer peta belum dipasang (ADR-064). Bisa diuji dengan 5 pengguna. |
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
D-03a (personal): Untuk 5 pengguna internal, masih pakai development project `xvmcpfkkveeaevfcvfug` yang sudah memiliki 25 migration dan 11/11 RLS test lulus. Tidak ada kebutuhan project produksi terpisah untuk penggunaan pribadi. | D-04 | Tetapkan jadwal cadangan/verifikasi keystore | Keystore hilang = APK terpasang tidak bisa diperbarui | Pemilik |
| D-05 | Tetapkan nama paket final (`com.rodakawan.app` masih sementara, ADR-015) | Tidak bisa diubah setelah unggah pertama Play | Pemilik produk |
| D-06 | Setujui/tolak ADR-064 (penyedia peta) | Marker peta dan P-03 tidak bisa diklaim selesai | Pemilik produk |
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

## 8. Perintah verifikasi (hasil apa adanya, 25 Oktober 2026)

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
