# Roadmap Implementasi

> Perkiraan sprint adalah cara mengurutkan pekerjaan, bukan janji durasi. Waktu aktual bergantung pada pengalaman developer, kondisi dependency, akses backend dan hasil uji perangkat.
>
> Istilah status yang dipakai konsisten di seluruh dokumen: **Implemented**, **Passed locally**,
> **Passed against dev backend**, **Tested on physical device**, dan **Blocked**. Artinya dijelaskan
> di README dan `docs/QA_TEST_PLAN.md` bagian 9.

## Prinsip eksekusi

- Satu vertical slice berfungsi sebelum berpindah ke fitur berikutnya.
- Kerjakan pada perangkat Android fisik sedini mungkin.
- Buat development build setelah dependency native diperkenalkan.
- P0 harus memenuhi test plan sebelum fitur P2 dimulai.
- Semua perubahan schema lewat migration versioned dan dites di project development.

## Milestone 0 — Fondasi proyek

**Hasil:** repo siap di-build dan dokumentasi menjadi source of truth.

- [x] Inisialisasi Expo app dengan TypeScript dan Expo Router.
- [x] Format/lint/typecheck scripts.
- [x] Environment config dan `.env.example` tanpa secret.
- [x] Setup Supabase development project (project khusus RodaKawan; seluruh migration diterapkan dan uji RLS lulus, ADR-035). Lihat `docs/SETUP_GUIDE.md`.
- [x] Setup alur build APK rilis tanpa cloud build: `expo prebuild` + Gradle di runner (ADR-051). *(rantai `prebuild` → `configure-android-release.mjs` → `assembleRelease` → `verify-apk.mjs` sudah dijalankan di mesin pengembang dan lulus; yang belum: menjalankannya di GitHub Actions, yang hanya menunggu keempat secret keystore — `docs/SETUP_GUIDE.md` bagian 5.1)*
- [x] Error boundary/loading/empty-state primitives.
- [x] README project berisi cara menjalankan dan aturan branch.

**Exit criteria:** aplikasi terbuka di perangkat (bundel + Metro **sudah diverifikasi lokal**; **Tested on physical device** masih *Blocked*); CI lokal typecheck bersih; preview build bisa dipasang (belum — menunggu secret keystore; akun Expo tidak lagi diperlukan sejak ADR-051).

## Milestone 1 — Auth, profil, privasi dasar

Status: **Implemented · Passed locally**; lapisan database sudah **Passed against dev backend**
(migration diterapkan dan uji RLS lulus, 13 Oktober 2026 — ADR-035). Verifikasi alur aplikasi dan
perangkat fisik masih **Blocked** (belum ada build terpasang), bukan lagi karena kredensial.

Kode dan skrip (implementasi):

- [x] Sign in/sign up/reset diimplementasikan dengan Supabase Auth (alur email + password).
- [x] Buat/edit profil dan username unik diimplementasikan (+ validasi dan penanganan benturan).
- [x] Pengaturan sesi/logout diimplementasikan (persistensi `expo-sqlite`, auto-refresh, PKCE).
- [x] Policy RLS profil dari migration awal dipertahankan tanpa pelonggaran.
- [x] Migration bootstrap profil (`20261013023038_auth_profile_bootstrap.sql`) ditulis.
- [x] Skrip uji RLS dua akun ditulis: `supabase/tests/rls_profiles_test.sql`.

**Blocked** (jangan ditandai selesai):

- [x] Profil privat tidak mengungkap data internal **dibuktikan di database** — `npm run db:test`
      LULUS di project development (PROF-01…PROF-05 tercakup).
- [x] Migration awal + migration bootstrap profil diterapkan ke project development (`npx supabase db
      push`; riwayat remote berisi kedua versi).
- [ ] Registrasi + konfirmasi email diuji ke project Supabase development (project sudah ada, uji
      manual belum dijalankan).
- [ ] Login, reset password, dan session persistence diuji di perangkat fisik.

**Exit criteria:** dua user dapat masuk di perangkat/sesi berbeda; user A tidak dapat mengedit profil user B. — *aturan di database sudah terbukti (uji RLS LULUS di project development); alur dua user di perangkat belum diverifikasi.*

## Milestone 1.5 — Verifikasi, hardening & CI

Status: **Implemented · Passed locally**; lapisan database **Passed against dev backend**; langkah yang
butuh APK di perangkat tetap **Blocked**.

- [x] Audit kode auth/profil dan kedua migration; temuan didokumentasikan dan diperbaiki.
- [x] Audit lifecycle auto-refresh token; client kini menyelaraskan ticker **setelah** `initialize()`
      (bukan sebelum), menangani promise `startAutoRefresh`/`stopAutoRefresh`, dan membersihkan
      listener saat client dibuat ulang — dengan 6 automated test baru.
- [x] Uji RLS diperluas: kontrol positif (profil publik memang terbaca), penolakan `DELETE`,
      serta penolakan `INSERT`/`UPDATE` untuk peran `anon`.
- [x] Runner reproducibility: `npm run db:test` (membaca `DATABASE_URL` dari environment, tidak pernah
      mencetak kredensial, hanya melaporkan lulus bila notice penanda diterima server).
- [x] CI GitHub Actions: job `quality` tanpa secret + job `workflows-lint` (actionlint 1.7.12 +
      shellcheck via `docker://rhysd/actionlint`) yang membuat kesalahan YAML/ekspresi di
      `.github/workflows/` gagal di pull request, bukan di tengah rilis; kesalahannya sendiri sudah
      ditemukan dan diperbaiki lewat pemeriksaan itu (`runner` di `env` tingkat job pada kedua
      workflow rilis). Uji RLS berdiri di workflow terpisah (`database-rls.yml`) karena membutuhkan
      secret Supabase — ADR-055.
- [x] Pipeline rilis APK: profil `production-apk` (`extends: "production"`), `appVersionSource: remote`
      + `autoIncrement` agar `versionCode` naik monoton antar-build, dan workflow `android-release.yml`
      (verify → EAS build → verifikasi artifact → GitHub Release) — ADR-036…038. Sejak ADR-042 rilis
      dijalankan manual (`workflow_dispatch` + input versi) dan tag `v<versi>` dibuat workflow setelah
      build sukses, bukan didorong lebih dulu sebagai pemicu. Sejak ADR-051 build APK-nya sendiri
      pindah ke runner GitHub (`expo prebuild` + Gradle), `appVersionSource` kembali `local`, dan
      profil EAS tersisa untuk build manual (development client, AAB Play).
- [x] Verifikasi berkas APK dinaikkan dari sekadar header ZIP `PK` menjadi pemeriksaan tanda tangan
      penuh (`scripts/verify-apk.mjs`: CRC-32 tiap entri, skema v2/v3, rantai v1) di kedua workflow
      rilis; script diuji terhadap `apksig` (library yang dipakai AGP/EAS menandatangani), APK nyata
      113 MB, APK hasil `jarsigner`, dan sepuluh varian berkas rusak/tanpa tanda tangan — ADR-043.
- [x] Rilis preview bisa dijalankan **atas permintaan** (`workflow_dispatch` + input `commit`) tanpa
      menunggu push ke `main`; commit pilihan tetap wajib punya run CI yang sukses, dan dispatch yang
      tidak membawa perubahan aplikasi gagal dengan pesan jelas alih-alih melewati rilis diam-diam —
      ADR-044.
- [x] Dokumentasi diselaraskan dengan kode: README, `SETUP_GUIDE.md`, `QA_TEST_PLAN.md`,
      `SECURITY_PRIVACY.md`, dan `PROJECT_DECISIONS.md`.
- [x] Adopsi Supabase CLI (2.120.0 lewat `npx`, tidak masuk `package.json`) dan audit read-only
      terhadap project development yang terkonfigurasi: `public.profiles` ada dalam bentuk berbeda
      (`id`, `username`, `role`, `created_at`) dan tabel lain belum ada, jadi migration **tidak**
      dijalankan di project itu (ADR-033).
- [x] Nama berkas migration disesuaikan konvensi CLI (`<timestamp>_name.sql`); karena belum ada
      migration yang diterapkan di database mana pun, penamaan ulang tidak butuh `migration repair`
      (ADR-031).
- [x] `npm run db:test` memuat `.env.db` otomatis sehingga password tidak pernah berada di baris
      perintah maupun log (ADR-032).
- [x] Membuat project development baru yang bersih, lalu mengisi `.env` (kunci publik) dan `.env.db`
      (connection string session pooler) — 13 Oktober 2026.
- [x] Menerapkan migration (`npx supabase link` + `npx supabase db push`) dan menjalankan
      `npm run db:test` sampai notice `UJI RLS PROFIL LULUS` muncul — 88 perintah, exit 0 (termasuk
      migration Milestone 1.6).
- [x] CI `ci.yml` benar-benar berjalan di GitHub: job `quality` (tanpa secret) hijau pada run
      `38353855927` (13 Oktober 2026, commit `0b989a0`, ±1 menit) dan pada lima run sebelumnya.
- [x] Uji RLS hijau di GitHub Actions (sebelumnya: **Blocked**). — Secret `DB_TEST_DATABASE_URL`
      sudah terpasang dan uji kini punya workflow sendiri (`database-rls.yml`) yang berjalan otomatis
      ketika file database berubah; run pertama hijau pada 16 Oktober 2026 (`38862870367`, notice
      `UJI RLS PROFIL LULUS`, 120 perintah).
- [x] Menjalankan rilis APK pertama sampai GitHub Release berisi APK. — `v0.1.0-build9` (15 Oktober
      2026) terbit; `v0.1.0-build20` (18 Oktober 2026, `fa4397e`) adalah build terbaru yang memuat
      Milestone 2 (baseline audit: `v0.1.0-build19` dari `749424c`).
- [ ] Uji manual AUTH-01…AUTH-14 dan PROF-01…PROF-07 di perangkat. — **Blocked** (APK tersedia, tetapi
      belum dijalankan di HP fisik; lihat bagian 5 `MILESTONE_2_REPORT.md`).

**Exit criteria:** seluruh pemeriksaan lokal tercatat beserta hasilnya; uji RLS punya cara jalan yang
reproducible; tidak ada kredensial di repo/laporan; tidak ada fitur Milestone 2 yang dimulai.

## Milestone 1.6 — Hardening privasi profil & integritas garasi

Status: **Implemented · Passed locally · Passed against dev backend** (13 Oktober 2026).

- [x] Privasi profil: relasi follow yang dibuat sendiri tidak lagi memberi akses ke profil privat.
      Status permintaan/persetujuan dikelola server dan pemilik menyetujui lewat
      `accept_follow_request` (ADR-039). Kerentanan lama direproduksi (1 baris terbaca) dan perilaku
      baru dibuktikan (0 baris sampai disetujui, akses hilang lagi setelah relasi dihapus).
- [x] Integritas `motorcycle_private_details`: `INSERT`/`UPDATE` memeriksa kepemilikan kendaraan —
      termasuk saat `motorcycle_id` diubah — dan invarian pemilik dijaga foreign key komposit
      (ADR-040).
- [x] Cakupan uji RLS diperluas dari 38 menjadi **88 perintah**: paritas skema di awal berkas,
      asersi follow (allow/deny/persetujuan/pencabutan), detail privat kendaraan lintas pengguna, dan
      penolakan peran `anon` pada `public.follows`.
- [x] Grant `EXECUTE` untuk peran `anon` dicabut pada fungsi baru Milestone 1.6 (ADR-041).
- [x] Audit policy kepemilikan (`created_by`/`author_id`/`owner_id`/…) dijalankan **otomatis di CI**, bukan
      lagi mengandalkan audit manual: `supabase/tests/rls_policy_guard_test.sql` menolak policy pada tabel
      wadah (`club_id`/`ride_id`) yang memberi akses lewat kolom kepemilikan tanpa penjaga keanggotaan
      (ADR-060). Berjalan lewat `npm run db:test` (berkas kedua, notice
      `UJI POLICY OWNER-GUARD LULUS`) dan di CI `database-rls`; detektornya diuji-diri lewat tabel probe
      dan daftar pengecualiannya diperiksa anti-usang. Jalur gagal sudah terbukti (exit 1 dengan daftar
      `tabel.policy` pada dua policy hazard yang saat itu belum terdaftar).
- [ ] Ratifikasi pemilik produk atas model persetujuan follow (ADR-039): notifikasi permintaan,
      layar daftar permintaan, dan apakah follow ke profil publik juga perlu persetujuan.
- [ ] Rate limit permintaan follow dan penolakan permintaan dari akun yang diblokir (belum ada;
      `user_blocks` hanya terlihat oleh pihak yang memblokir, jadi butuh helper tersendiri).
- [ ] UI persetujuan follow (daftar permintaan masuk) — aturan database sudah ada, layarnya belum.
      Ini tidak memblokir Milestone 3; masuk ke pekerjaan sosial (Milestone 6).

**Exit criteria:** setiap temuan keamanan pada audit policy ditutup atau dilaporkan sebagai risiko
terbuka, dengan uji allow/deny yang benar-benar dijalankan di project development.

## Milestone 2 — Garasi dan klub

Status: **Implemented · Passed locally · Passed against dev backend · Tested on physical device
(owner-reported)** (tiga belas migration diterapkan, uji RLS LULUS dengan 171 + 17 + 67 perintah
termasuk Storage foto/logo/avatar, foto profil, dan workflow perjalanan, diverifikasi ulang
19 Oktober 2026). Pemilik aplikasi melaporkan pengujian di perangkat berjalan tanpa error yang
teramati; tag APK dan kasus uji per kasus **tidak tersedia sebagai artefak**, jadi klaim ini dicatat
sebagai laporan pemilik, bukan bukti uji terverifikasi. Basis implementasi: `749424c` (tag
`v0.1.0-build19`, 105.904.027 byte, SHA-256 `775a3309…b3d9`); build terbaru: `v0.1.0-build20` dari
`fa4397e` (105.904.031 byte, SHA-256 `a4ae87b4…fe9d`). Implementasi `cf818be`, checklist perangkat
`1ef13a8`, perbaikan versi Expo `a9858a9`, perbaikan generator tipe `ca2461c`. CI #26/RLS #4/Release
#19 hijau pada `749424c`; CI #27/Release #20 hijau pada `fa4397e`. Setelah tag hanya ada commit
dokumentasi `ee0a0bd`.

- [x] CRUD kendaraan; pisahkan detail sensitif. (`src/app/garage.tsx`, `src/app/vehicle.tsx`, `src/features/garage/api.ts`)
- [x] Buat/temukan klub. (`src/app/(tabs)/community.tsx`, `src/app/club.tsx`, RPC `create_club`)
- [x] Join request, approval dan role. (RPC `request_club_membership`, `review_club_membership`, `set_club_member_role`, `remove_club_member`, `leave_club` + tabel `club_role_audit`)
- [x] Foto kendaraan dan logo klub di Storage privat. (`src/features/media/photos.ts`, `PhotoCard`, unggah/ganti/hapus di `src/app/vehicle.tsx` dan `src/app/club-admin.tsx`; bucket + policy di `20261017120000_private_photo_storage.sql`, diperbaiki `20261017121000_club_logo_policy_qualified_name.sql`) Foto diperkecil + dikompres otomatis di perangkat sebelum diunggah (`src/features/media/imageCompression.ts`, 1600 px/512 px, kualitas 0.7) supaya kuota Storage dan waktu unggah hemat. Objek Storage yatim — sisa ganti foto yang gagal dihapus atau kendaraan yang barisnya sudah tidak ada — disapu otomatis dengan sesi pemilik (`src/features/media/photoCleanup.ts`: listing folder + jendela tenggang 1 jam, satu `remove` per sapuan), dijalankan di latar belakang saat garasi dibuka dan setelah kendaraan dihapus; 18 test unit menemaninya (ADR-058).
- [x] Foto profil (avatar) privat. Bucket `avatars` (`<user_id>/<berkas>`, 2 MiB, JPEG/PNG/WEBP) dengan policy owner-only,
  CHECK `profiles_avatar_path_owner`, unggah/ganti/hapus dari tab Profil (`src/app/(tabs)/profile.tsx`,
  `uploadProfileAvatar`/`deleteProfileAvatar` di `src/features/media/photos.ts`), diperkecil otomatis ke 512 px;
  17 test unit (12 API + 5 komponen) + 9 langkah HTTP Storage + asersi RLS (ADR-059). Foto profil sengaja hanya terlihat pemiliknya sampai
  kebijakan visibilitas avatar ada.
- [x] UI anggota/owner/admin. (`src/app/club-admin.tsx`)
- [ ] Sapuan objek yatim untuk **logo klub** dan **avatar** (foto kendaraan sudah; dua bucket lain
      masih best-effort saat ganti/hapus). Optimasi kuota, bukan celah keamanan — tidak memblokir
      Milestone 3.
- [ ] Kebijakan visibilitas avatar (saat ini owner-only). Butuh keputusan produk + policy `SELECT`
      baru; jangan dilonggarkan tanpa keputusan itu.

**Exit criteria:** non-member tidak bisa membaca detail klub privat atau mengubah anggota; plat privat
hanya terlihat owner. — **terpenuhi di lapisan database** (uji RLS allow/deny, `npm run db:test` exit 0);
verifikasi lewat aplikasi di perangkat fisik dilaporkan pemilik berjalan tanpa error (owner-reported;
artefak per kasus tidak tersedia — bagian 5 `docs/MILESTONE_2_REPORT.md`).

## Milestone 3 — Perjalanan dan live location

Rencana rinci, termasuk yang sengaja **di luar** lingkup, ada di
[`docs/MILESTONE_3_PLAN.md`](MILESTONE_3_PLAN.md). Status: **Implemented · Passed locally ·
Passed against dev backend**; uji dua perangkat/background/baterai masih **Blocked**. Gerbang M2
dilaporkan lulus oleh pemilik aplikasi (owner-reported, tanpa artefak uji per kasus).

Gerbang tambahan sebelum layar peta: **penyedia peta/tile belum dipilih** (ADR-009/ADR-064). Opsi,
lisensi, kuota, privasi, dan syarat offline ada di
[`docs/MAP_PROVIDER_DECISION.md`](MAP_PROVIDER_DECISION.md); jangan menambahkan dependency peta
sebelum keputusan itu dicatat. Sampai itu terjadi, layar perjalanan menampilkan **daftar posisi**
dengan label live/basi/belum ada, bukan peta tiruan.

- [x] Create/join/leave ride, undangan, dan pengeluaran peserta lewat RPC.
- [x] State machine planned/active/completed/cancelled, ditegakkan di database.
- [x] Location sharing opt-in per ride; consent terpisah dari izin OS.
- [x] Foreground + background location (`expo-location`/`expo-task-manager`) dengan foreground service.
- [x] Realtime posisi lewat Postgres Changes pada `ride_locations` (RLS per baris).
- [x] Indikator live/basi/offline dan waktu pembaruan di layar detail.
- [x] Stop task saat keluar/opt-out/ride berakhir; baris lokasi dihapus trigger.
- [x] Migration, RPC, tipe generated, uji RLS/RPC, dan uji Jest.
- [ ] Map markers (setelah provider dipilih dan renderer diuji di development build).
- [ ] Test dua perangkat, GPS mati, mode pesawat, force-stop/reboot, dan baterai/network 30 menit.

**Exit criteria:** anggota sah melihat update lokasi; non-member dan `anon` ditolak; menolak berbagi
tetap bisa ikut; izin ditolak/GPS mati/network drop dijelaskan; status final tidak bisa kembali
aktif; tracking tidak berjalan tanpa ride aktif dan opt-in.

## Milestone 4 — Hazard reports dan convoy chat

- [ ] CRUD report dan expiry rules.
- [ ] Marker/list/filter laporan.
- [ ] Report abuse/confirm report.
- [ ] Chat persisted + realtime events.
- [ ] System messages untuk start/end/member changes.
- [ ] Rate limits dan error states.

**Exit criteria:** report kedaluwarsa tidak aktif; chat tidak dapat dibaca non-member; retry tidak membuat duplicate message.

## Milestone 5 — Push, polish dan beta

- [ ] Push notification undangan/status perjalanan.
- [ ] Kategori dan preferensi notifikasi dasar.
- [ ] Loading/offline/error/empty states lengkap.
- [ ] Android device matrix dan accessibility pass.
- [ ] Crash/error monitoring tanpa lokasi presisi.
- [ ] Privacy policy, delete account flow, support contact.
- [ ] Security and release checklist.

**Exit criteria:** semua P0 acceptance test lulus dan tidak ada blocker severity tinggi.

## Milestone 6 — Feed dan komunitas sosial (P1)

- [ ] Post teks/foto.
- [ ] Like, komentar, follow/follow-back (termasuk UI permintaan/persetujuan follow sesuai ADR-039).
- [ ] Notification activity.
- [ ] Block/report/moderation queue.
- [ ] Pagination, media optimization, storage cleanup.

**Exit criteria:** idempotent reactions, RLS tests lulus, upload/access/delete media dites.

## Milestone 7 — Voice PTT proof-of-concept (P2)

- [ ] Pilih penyedia dan lakukan analisis biaya/privacy.
- [ ] EAS development build dengan native WebRTC dependency.
- [ ] Edge Function token endpoint dengan authorization.
- [ ] Join/leave/mute/PTT state machine.
- [ ] Uji dengan minimal beberapa Android dan headset/helmet intercom berbeda.
- [ ] Uji screen lock, app background, wifi-to-cellular, baterai, mic permissions, audio focus.
- [ ] Tidak menampilkan klaim hands-free universal jika belum tervalidasi.

**Exit criteria:** PTT stabil untuk perangkat yang didukung dan limitation dipublikasikan.

## Milestone 8 — Musik lokal dan penyempurnaan lanjutan (P2)

- [ ] Pilih file lokal menggunakan API media yang sesuai Android.
- [ ] Playback controls + audio focus.
- [ ] Background playback sesuai konfigurasi yang diizinkan.
- [ ] Uji transisi voice ↔ music, panggilan sistem dan lock screen.

## Utang produk dan keputusan terbuka (per 19 Oktober 2026)

| Item | Status | Memblokir Milestone 3? | Pemilik keputusan |
| --- | --- | --- | --- |
| Uji perangkat fisik Milestone 2 | **Blocked** — APK `v0.1.0-build20` siap, belum dijalankan | **Ya** — gerbang masuk seluruh M3 | Pemilik aplikasi |
| Penyedia peta/tile | **Belum diputuskan** (ADR-009, ADR-064) | **Ya**, hanya untuk langkah marker/peta; skema & RPC ride tidak | Pemilik produk + engineering |
| UI persetujuan follow (daftar permintaan) | Belum ada; aturan database sudah | Tidak — pekerjaan sosial (M6) | Pemilik produk |
| Rate limit follow + penolakan permintaan dari akun terblokir | Belum ada | Tidak — hardening sosial (M6) | Engineering |
| Sapuan objek yatim logo klub & avatar | Belum ada; foto kendaraan sudah | Tidak — optimasi kuota | Engineering |
| Visibilitas avatar | Owner-only sampai kebijakan ada | Tidak | Pemilik produk + security |

Aturan: jangan melonggarkan policy, menampilkan avatar ke publik, atau membuka foto kendaraan tanpa
keputusan produk/keamanan yang tercatat. Item yang tidak memblokir M3 tetap dilacak di sini supaya
tidak hilang saat fokus pindah ke perjalanan.

## Kriteria siap rilis umum

- PRD acceptance terpenuhi.
- Automated tests dan manual smoke tests lulus.
- Security/RLS negative tests lulus.
- No secrets in repository/build.
- Versi Android minimum/perangkat yang didukung tertulis.
- Kebijakan privasi, terms, report/abuse path dan deletion flow tersedia.
- Biaya infra, maps/tiles, notification dan audio dievaluasi dengan pilot data.
- Build artifact dan source commit ditandai dengan release tag.
- APK rilis dapat dipasang dari GitHub Release dan `android.versionCode`-nya lebih besar daripada rilis sebelumnya (naik otomatis dari hitungan riwayat repository — ADR-051).
