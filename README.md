# RodaKawan

Aplikasi pendamping berkendara untuk komunitas motor, klub sepeda, dan pecinta touring: berbagi
perjalanan, lokasi konvoi, laporan kondisi jalan, dan komunitas.

Repositori ini berisi aplikasi **React Native + Expo + TypeScript** (Android-first, struktur tidak
menutup iOS) dengan **Supabase** sebagai backend awal. Dokumentasi produk tetap menjadi sumber
kebenaran dan berada di [`docs/`](docs/).

> **Nama kerja.** Nama, logo, domain, dan identitas visual belum final (ADR-001 di
> [`docs/PROJECT_DECISIONS.md`](docs/PROJECT_DECISIONS.md)).

---

## Status saat ini

Istilah status dipakai konsisten di seluruh dokumentasi:

| Status                             | Artinya                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| **Implemented**                    | Kode ada di repo (dan biasanya punya automated test).                       |
| **Passed locally**                 | Sudah dijalankan di mesin developer, hasilnya dicatat di bawah.             |
| **Passed against dev backend**     | Sudah diverifikasi terhadap project Supabase **development** yang nyata.    |
| **Tested on physical device**      | Sudah dicoba di HP Android fisik.                                           |
| **Blocked**                        | Tidak dapat dijalankan sekarang; alasannya disebutkan.                      |

| Area                                             | Implemented | Passed locally | Dev backend | Perangkat fisik |
| ------------------------------------------------ | ----------- | -------------- | ----------- | --------------- |
| Fondasi: Expo Router, design system, error state | Ya          | Ya             | —           | Blocked         |
| Milestone 1: auth (daftar, login, logout, reset)  | Ya          | Ya             | **Blocked** | **Blocked**     |
| Milestone 1: profil sendiri + username unik       | Ya          | Ya             | **Blocked** | **Blocked**     |
| Milestone 1: RLS `public.profiles`                | Ya          | Ya             | **Ya** (uji RLS LULUS) | —    |
| Milestone 1.6: privasi follow + detail privat kendaraan | Ya    | Ya             | **Ya** (uji RLS LULUS) | —    |
| Milestone 2+: garasi, klub, perjalanan, lokasi, chat, hazard, feed, musik | **Belum** | — | — | — |

**Blocked** yang tersisa berarti: alur aplikasi belum pernah dijalankan terhadap project development
nyata, dan aplikasi belum pernah dipasang di HP fisik. Project Supabase development **sudah ada**
sejak 13 Oktober 2026, kelima migration sudah diterapkan, uji RLS `public.profiles` sudah lulus
(ADR-035), dan lubang privasi follow serta integritas detail privat kendaraan sudah diperbaiki dengan
uji allow/deny (ADR-039, ADR-040). Semua langkah yang dapat dijalankan tanpa backend sudah dijalankan
— lihat [Perintah pengujian](#perintah-pengujian).

Fitur Milestone 2 ke atas sengaja **tidak** ditampilkan sebagai tombol yang berfungsi: aksi seperti
"Buat perjalanan" tampil dalam keadaan nonaktif.

**Konteks database (13 Oktober 2026).** Project Supabase yang sebelumnya terkonfigurasi di `.env`
**bukan** database bersih: tabel `public.profiles` sudah ada dalam bentuk yang berbeda (hanya `id`,
`username`, `role`, `created_at`) dan seluruh tabel lain dari migration awal belum ada. Karena
`create table if not exists` akan melewati tabel itu diam-diam lalu migration gagal di policy yang
menyebut `is_private`, migration **tidak** dijalankan di project tersebut. Keputusan: memakai project
development baru yang bersih. Audit lengkap ada di `docs/PROJECT_DECISIONS.md` (ADR-033).

**Tindak lanjut (13 Oktober 2026).** Project development bersih sudah dibuat dan dihubungkan lewat
`.env` (URL + publishable key) dan `.env.db` (session pooler, `sslmode=require`). Kelima migration
diterapkan dengan `npx supabase link` + `npx supabase db push`; `npx supabase migration list`
menunjukkan kolom Local dan Remote sama untuk kelima versi. `npm run db:test` lulus dengan notice
`UJI RLS PROFIL LULUS`. Project lama tidak disentuh sama sekali (ADR-035).

---

## Prasyarat

- **Node.js 22.13 atau lebih baru** (`engines.node` di `package.json`; CI memakai 24.x).
- **npm** sebagai satu-satunya package manager; `package-lock.json` di-commit dan dipakai `npm ci`.
- Untuk mencoba di HP Android: aplikasi **Expo Go** (untuk UI/prototipe) atau APK development build.
- Android Studio **tidak** diperlukan: APK dibuat di cloud dengan EAS Build.
- Akun **Expo** (untuk EAS) dan akun **Supabase** (untuk backend) hanya dibutuhkan pada langkah
  build/backend, bukan untuk menjalankan aplikasi atau seluruh automated test.

## Setup di Windows

```powershell
git clone https://github.com/29nls/rodakawan.git
cd rodakawan
npm ci                      # pasang dependency persis mengikuti lockfile
npx expo start              # jalankan Metro
```

Catatan Windows:

- Perintah di dokumentasi ini memakai PowerShell. Di CMD/Git Bash, sintaks variabel environment
  berbeda (lihat [Uji RLS](#uji-rls-profil-supabase)).
- Bila PowerShell memblokir `npm.ps1`, gunakan `npm.cmd` atau `Set-ExecutionPolicy -Scope Process
  RemoteSigned` pada sesi itu saja.
- `npm install` juga bekerja, tetapi `npm ci` yang dipakai di CI dan lebih dapat diulang.

## Menjalankan aplikasi di HP Android

1. Pasang **Expo Go** dari Play Store, lalu sambungkan HP dan komputer ke Wi-Fi yang sama.
2. Jalankan `npx expo start`, lalu pindai QR yang muncul (di Android: buka Expo Go → *Scan QR code*).
   Bila jaringan memblokir, jalankan `npx expo start --tunnel`.
3. Aplikasi terbuka di gerbang sesi: menampilkan *loading* singkat, lalu layar **Masuk**.
   Tanpa konfigurasi Supabase, layar masuk menampilkan banner "Backend belum siap" — ini perilaku
   yang benar, bukan crash.
4. Tekan `a` pada terminal Metro untuk menjalankan di emulator Android, atau `r` untuk mengulang
   muat. Perubahan berkas TypeScript/JS cukup memicu fast refresh.

Untuk fitur native (background location, peta native, WebRTC) Expo Go tidak cukup; diperlukan
development build (`--profile development`, lihat [Build APK](#build-apk-android-tanpa-android-studio)).

## Konfigurasi Supabase

1. Salin `.env.example` menjadi `.env.local` di root repo, lalu isi:

   ```dotenv
   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
   EXPO_PUBLIC_MAP_STYLE_URL=https://<tile provider>/style.json
   ```

2. Nilai sebenarnya diambil dari **Project Settings → API** pada project **development** (bukan
   produksi). **Jangan** menaruh service role key, database password, LiveKit secret, atau token
   admin di `.env.local`: setiap variabel `EXPO_PUBLIC_*` ikut masuk ke bundle aplikasi.
3. Restart Metro setelah mengubah `.env.local` (nilai di-inline saat bundling).
4. Langkah lengkap pembuatan project, urutan migration, dan pengaturan **Redirect URLs** untuk
   tautan email ada di [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md).

Tanpa `EXPO_PUBLIC_SUPABASE_URL` dan `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, aplikasi tetap terbuka:
tidak ada request jaringan yang dikirim, tombol kirim dinonaktifkan, dan tidak ada nilai key yang
pernah ditampilkan di layar.

## Perintah pengujian

```powershell
npm run typecheck        # TypeScript strict tanpa emit
npm run lint             # ESLint (eslint-config-expo + Prettier)
npm run format:check     # pastikan format Prettier
npm test                 # unit + komponen test (jest-expo)
npm run doctor           # expo-doctor
npm run export:android   # bundel Android (Metro + Hermes) tanpa perangkat
npm run db:test          # uji RLS ke database development (butuh .env.db / DATABASE_URL)
```

Hasil nyata pada commit ini (13 Oktober 2026, Node 24.18, npm 12):

| Perintah               | Hasil                                                        |
| ---------------------- | ------------------------------------------------------------ |
| `npm ci`               | Exit 0, 1.076 paket terpasang dari lockfile.                 |
| `npm run typecheck`    | Exit 0 (juga lulus tanpa folder `.expo` — tidak perlu dev server dulu). |
| `npm run lint`         | Exit 0.                                                       |
| `npm run format:check` | Exit 0.                                                       |
| `npm test`             | **15 suite, 164 test lulus**, exit 0.                         |
| `npm run doctor`       | 21/21 pemeriksaan lulus.                                      |
| `npm run export:android` | Exit 0, bundel Hermes `entry-*.hbc` (~3,6 MB), tidak ada JWT/service role key di dalam bundel. |
| `npm run db:test`      | **Exit 0 — `UJI RLS PROFIL LULUS`** (88 perintah: profil, follow/privasi, detail privat kendaraan) terhadap project development, 13 Oktober 2026. |
| `npx supabase ...`     | CLI 2.120.0 (lewat `npx`, tidak masuk `package.json`). `link` + `db push` menerapkan seluruh migration (kelima versi); jangan menaruh connection string di argumen perintah karena npm/npx mencetak ulang argumennya. |
| `npx eas-cli build`    | **Blocked** — butuh akun Expo + secret `EXPO_TOKEN`. Profil `production-apk` dan workflow rilis sudah ada, tetapi belum ada build cloud yang dijalankan/diamati. |

`npm test` tidak menyentuh jaringan: fungsi api menerima client sebagai argumen sehingga test
menyuntikkan fake client dari `src/test-support/fakeSupabase.ts`; test navigasi memakai `jest.mock`
pada `@/lib/supabase/client` dan modul api.

### Catatan pengujian

- `npm test` memakai preset `jest-expo/android` dan `@testing-library/react-native` 14.
- Pada RTL 14, `render`, `fireEvent`, dan `renderRouter` bersifat **asynchronous** — selalu `await`
  sebelum melakukan assertion.
- Plugin `react-native-worklets/plugin` dimatikan khusus pada lingkungan test lewat `babel.config.js`
  (plugin itu menyuntikkan pemeriksaan Reanimated yang membutuhkan native worklets). Pada build
  Metro/APK plugin tetap aktif.
- Test navigasi menjalankan rute asli dari `src/app` (bukan mock), sehingga perubahan nama tab atau
  penambahan route akan terdeteksi.
- `moduleNameMapper` di `jest.config.js` hanya mengganti `expo-sqlite/localStorage/install` dengan
  shim `src/test-support/sqliteLocalStorageShim.js`. Shim itu hanya berlaku di Jest; di aplikasi
  nyata `expo-sqlite` tetap menjadi penyimpanan session.
- Uji `src/lib/crypto/__tests__/webcrypto.test.ts` memakai nilai vektor tetap dan tidak memanggil
  native module.

## Uji RLS profil (Supabase)

`supabase/tests/rls_profiles_test.sql` membuktikan bahwa user A tidak dapat membaca profil privat
atau mengubah baris user B, bahwa `anon` tidak melihat apa pun, dan bahwa bootstrap trigger serta
constraint username bekerja. Sejak Milestone 1.6 berkas ini juga membuktikan bahwa **relasi follow
yang dibuat sendiri tidak memberi akses** ke profil privat (permintaan berstatus `pending` sampai
pemilik menyetujui lewat `accept_follow_request`), dan bahwa **detail privat kendaraan hanya dapat
dibuat/diubah untuk kendaraan milik sendiri** — termasuk ketika `motorcycle_id` diubah. Berkas uji
juga memeriksa paritas skema di awal sehingga database yang belum dimigrasi gagal dengan pesan yang
jelas. Semua asersi berjalan dalam satu transaksi yang diakhiri `ROLLBACK`, jadi tidak ada data uji
yang tertinggal.

Cara pertama (disarankan): simpan connection string project **development** di berkas `.env.db` di root repo
(satu baris, diabaikan Git, dan **tidak** dibaca Expo sehingga tidak ikut ke bundel aplikasi):

```dotenv
# Pakai host *session pooler* dari Project Settings → Database → Connection string.
# Host langsung db.<ref>.supabase.co hanya punya record AAAA (tanpa IPv4) sehingga sering
# gagal ENOTFOUND; di pooler user ditulis postgres.<ref>.
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

```powershell
npm run db:test      # memuat .env.db otomatis; password tidak pernah dicetak
```

```text
# 2. Tanpa runner: tempel seluruh isi supabase/tests/rls_profiles_test.sql ke
#    Supabase Dashboard → SQL Editor, lalu pastikan notice
#    "UJI RLS PROFIL LULUS" muncul tanpa exception.
```

Aturan penting:

- Jalankan hanya pada project **development**. Jangan memakai kredensial produksi.
- `DATABASE_URL` **jangan** disimpan di `.env.local` (berkas itu untuk variabel `EXPO_PUBLIC_*` yang
  masuk ke bundle aplikasi). Isi langsung di shell untuk satu perintah.
- Runner hanya melaporkan lulus bila notice penanda benar-benar diterima dari server, sehingga
  "hijau palsu" (mis. berkas uji terpotong) tidak bisa lolos.
- Status saat ini: **Passed against dev backend** (13 Oktober 2026) — `npm run db:test` mencetak
  `UJI RLS PROFIL LULUS`, 88 perintah selesai, exit 0, pada database development yang sudah memuat
  kelima migration. Jalur kegagalan runner juga sudah diuji sebelumnya (tanpa `DATABASE_URL`, host
  tidak terjangkau, berkas tanpa penanda lulus). Jalankan ulang setiap kali policy/RPC berubah.

## CI dan rilis APK (GitHub Actions)

Dua workflow; keduanya tidak pernah mencetak nilai secret (tidak ada `echo $SECRET`, tidak ada `env`
tanpa filter).

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — pemeriksaan rutin, berisi dua job:
  - **`quality`** berjalan pada push ke `main` dan setiap pull request: `npm ci`, `typecheck`, `lint`,
    `format:check`, `npm test -- --ci`, `doctor`, dan `export:android`. Job ini **tidak memakai satu
    pun secret** Supabase dan justru membuktikan aplikasi tetap bersih saat backend belum
    dikonfigurasi.
  - **`database-rls`** hanya berjalan lewat **Actions → CI → Run workflow** dengan input `run_db_tests`
    dicentang, dan hanya bila secret `DB_TEST_DATABASE_URL` sudah diatur. Job ini tidak pernah berjalan
    pada push/PR biasa, sehingga database produksi tidak tersentuh.
- [`.github/workflows/android-release.yml`](.github/workflows/android-release.yml) — rilis APK.
  Berjalan pada push tag `v*` (mis. `v0.1.0`) dan lewat `workflow_dispatch`. Urutan job:
  **`verify`** (pemeriksaan kualitas) → **`build-apk`** (build APK di EAS Cloud dengan profil
  `production-apk`, lalu diunggah sebagai Actions artifact) → **`release`** (hanya untuk ref tag:
  melampirkan APK ke GitHub Release). Tidak ada build Android cloud pada push/PR biasa.

Status: `ci.yml` sudah berjalan di GitHub — job `quality` **hijau** pada run `38353855927` (13 Oktober
2026, commit `0b989a0`) dan pada lima run sebelumnya. Job `database-rls` belum pernah berjalan dan
memang hanya aktif lewat **Actions → CI → Run workflow** dengan input `run_db_tests` dicentang **dan**
secret `DB_TEST_DATABASE_URL` sudah diatur, sehingga database development tidak tersentuh oleh
push/PR biasa. `android-release.yml` belum pernah berjalan dan secret `EXPO_TOKEN` belum diatur.
Konfigurasi sekali saja ada di [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md) bagian 5.

## Build APK Android tanpa Android Studio

```powershell
npx eas-cli@latest login                                              # masuk ke akun Expo
npx eas-cli@latest init                                              # menulis projectId EAS ke app.json (sudah ada di repo ini)
npx eas-cli@latest build --platform android --profile development    # development build (expo-dev-client)
npx eas-cli@latest build --platform android --profile preview        # APK internal untuk pengujian
npx eas-cli@latest build --platform android --profile production-apk # APK siap pasang (variabel produksi)
npx eas-cli@latest build --platform android --profile production     # AAB untuk Google Play
```

Profil build ada di [`eas.json`](eas.json):

| Profil           | Artifact | Distribusi | Kegunaan                                                    |
| ---------------- | -------- | ---------- | ----------------------------------------------------------- |
| `development`    | APK      | internal   | development build (`expo-dev-client`)                       |
| `preview`        | APK      | internal   | APK uji cepat internal                                      |
| `production-apk` | APK      | internal   | APK untuk GitHub Release (dibangun otomatis oleh workflow)  |
| `production`     | AAB      | store      | unggah ke Google Play                                       |

`production-apk` memakai `extends: "production"`, jadi keduanya berbagi `autoIncrement` dan variabel
`environment: production`; yang berbeda hanya format berkas dan jalur distribusi. Nama paket Android
`com.rodakawan.app` di [`app.json`](app.json) masih sementara dan wajib diganti sebelum rilis Play
Store bila identitas final berbeda (ADR-015).

Status: **Blocked** — belum ada `EXPO_TOKEN` yang diatur dan belum ada build cloud yang dijalankan,
jadi belum ada APK. Verifikasi bundel lokal sudah dilakukan lewat `npm run export:android`.

### Merilis APK dari GitHub Release

```powershell
# 1. Naikkan "version" di app.json (mis. 0.1.0 → 0.2.0), lalu commit.
# 2. Tandai commit itu dan dorong tag-nya.
git tag v0.2.0
git push origin v0.2.0
```

Setelah tag didorong, `.github/workflows/android-release.yml` menjalankan pemeriksaan kualitas,
membangun APK di EAS Cloud, mengunggahnya sebagai Actions artifact, dan membuat GitHub Release
`v0.2.0` berisi `RodaKawan-v0.2.0.apk`. APK diunduh dari halaman **Releases** repository, atau dari
artifacts run bila build dipicu manual.

- `versionCode` Android **tidak** dinaikkan manual: `appVersionSource: remote` membuat EAS
  menaikkannya di server pada setiap build (ADR-036). Yang dinaikkan manual hanya `version`.
- Setiap rilis butuh **tag baru**; tag yang sudah dipakai akan memperbarui aset release yang ada,
  bukan membuat rilis kedua.
- Build manual tanpa rilis: **Actions → Android APK Release → Run workflow** — APK hanya menjadi
  Actions artifact, tanpa GitHub Release.
- Rilis ini **tidak** mengunggah apa pun ke Google Play; AAB Play Store tetap dikirim terpisah dari
  profil `production`.

### Aset ikon

Ikon, adaptive icon, dan splash dibuat dari kode tanpa dependency tambahan:

```powershell
npm run assets:generate
```

## Struktur proyek

```text
src/
  app/          # rute Expo Router
    (auth)/     # masuk, daftar, lupa password (hanya untuk pengunjung)
    (tabs)/     # area privat: Ringkasan, Perjalanan, Komunitas, Peringatan, Profil
    auth/       # callback tautan email (konfirmasi / pemulihan)
    profile/    # ubah profil
    index.tsx   # gerbang sesi (loading → area privat atau alur masuk)
    system.tsx  # pratinjau fondasi & sistem (privat)
    reset-password.tsx
  components/   # ui/ (primitif), feedback/ (error boundary), foundation/ (pratinjau token)
  constants/    # theme.ts, roadmap.ts, strings.ts
  features/
    auth/       # api.ts, session.tsx, errors.ts, validation.ts, redirect.ts, linkParams.ts, components/
    profile/    # api.ts, useProfile.ts, validation.ts, components/
  hooks/        # useAppStatus
  lib/          # env.ts (konfigurasi publik + validasi), supabase/client.ts, crypto/webcrypto.ts
  services/     # appInfo.ts (metadata build)
  test-support/ # fake client Supabase + shim storage untuk Jest
  types/        # deklarasi tipe lingkungan
  utils/        # color.ts (kontras WCAG)
assets/         # ikon & splash
scripts/        # generate-assets.mjs, db-test.mjs (runner uji RLS)
docs/           # sumber kebenaran produk
supabase/
  migrations/   # 20261013022938_initial_schema.sql (fondasi)
                # 20261013023038_auth_profile_bootstrap.sql (bootstrap profil + constraint)
  tests/        # rls_profiles_test.sql (uji RLS dua akun + kontrol positif)
.github/
  workflows/    # ci.yml
```

## Cara kerja autentikasi dan profil (Milestone 1)

- **Client:** satu instance Supabase di [`src/lib/supabase/client.ts`](src/lib/supabase/client.ts),
  dibuat lazy. Session disimpan lewat `expo-sqlite/localStorage/install` dengan `persistSession`,
  `autoRefreshToken`, `flowType: 'pkce'`, dan `detectSessionInUrl: false` (aplikasi native, bukan web).
- **Auto-refresh token:** `auth-js` menyalakan ticker-nya sendiri pada saat client dibuat di React
  Native (platform non-browser dianggap selalu foreground). Karena itu client menyelaraskan ticker
  dengan `AppState` **setelah** `initialize()` selesai: refresh berhenti saat aplikasi ke background
  dan menyala lagi saat kembali ke depan, listener-nya dibersihkan saat client dibuat ulang, dan
  promise-nya selalu di-handle supaya tidak menjadi unhandled rejection.
- **PKCE di Hermes:** `expo-crypto` dipasang dan [`src/lib/crypto/webcrypto.ts`](src/lib/crypto/webcrypto.ts)
  menyediakan `crypto.getRandomValues`/`TextEncoder`/`btoa` yang belum ada di Hermes; tanpa itu alur
  PKCE turun ke metode `plain` dan memakai `Math.random` untuk verifier.
- **Proteksi rute:** [`src/app/_layout.tsx`](src/app/_layout.tsx) memakai `Stack.Protected` — rute
  privat hanya terdaftar bila sesi sudah diperiksa dan valid, dan grup `(auth)` hanya bila belum ada
  sesi. [`src/app/index.tsx`](src/app/index.tsx) adalah gerbang awal: menampilkan loading selama sesi
  diperiksa, lalu `<Redirect>` ke `/ringkasan` atau `/sign-in`. Tidak ada redirect berbasis
  `useEffect`, jadi tidak ada redirect loop. Ini hanya lapisan navigasi klien — otorisasi data tetap
  milik RLS di database.
- **Profil:** `public.profiles` dibuat otomatis oleh trigger `on_auth_user_created` yang memanggil
  fungsi `bootstrap_profile()` (migration bootstrap profil), memakai `NEW.id` dari `auth.users` — bukan identitas
  yang dikirim klien. Username dinormalkan (huruf kecil, `_`), divalidasi, dan keunikannya dijaga
  unique index + CHECK `profiles_username_format`. Bila username bentrok, trigger memakai username
  sementara `rider_xxxxxx` dan aplikasi menampilkan banner untuk menggantinya.
- **Belum ada:** upload avatar (menunggu bucket Storage + policy), ubah email/password dari dalam
  aplikasi.

### Uji manual autentikasi (butuh backend + perangkat)

Setelah `.env.local` terisi, jalankan alur ini di perangkat:

1. Daftar akun baru → ikuti alur konfirmasi email → masuk.
2. Masuk, buka tab **Profil**, ubah nama tampilan/username/kota/bio, simpan, lalu muat ulang aplikasi.
3. Daftarkan username yang sudah dipakai; harus muncul pesan yang jelas, bukan crash.
4. Keluar; pastikan tab privat tidak bisa dibuka kembali lewat tautan langsung.
5. Kirim permintaan reset password dari layar **Lupa password** dan selesaikan tautannya.

## Aturan branch dan commit

- `main` harus selalu dapat dijalankan: `npm run typecheck`, `npm run lint`, dan `npm test` hijau
  sebelum merge.
- Satu milestone per branch, mis. `feat/m1-auth-profil`, `chore/m1-5-verifikasi-ci`.
- Commit mengikuti Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`), satu perubahan logis
  per commit.
- Bila keputusan teknis berubah, perbarui juga [`docs/PROJECT_DECISIONS.md`](docs/PROJECT_DECISIONS.md)
  dan dokumen terkait pada commit yang sama.

## Dokumentasi produk

| Dokumen                                                    | Isi                                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`docs/PRD.md`](docs/PRD.md)                               | Sasaran produk, pengguna, kebutuhan, ruang lingkup, acceptance criteria.    |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)             | Arsitektur aplikasi, pilihan teknologi, alur data, batasan native & build.  |
| [`docs/UX_SITEMAP.md`](docs/UX_SITEMAP.md)                 | Sitemap, layar utama, alur pengguna, prinsip berkendara aman.               |
| [`docs/DATA_AND_REALTIME.md`](docs/DATA_AND_REALTIME.md)   | Model data konseptual, event realtime, kontrak layanan, aturan lokasi.      |
| [`docs/SECURITY_PRIVACY.md`](docs/SECURITY_PRIVACY.md)     | RLS, privasi lokasi, moderasi, retensi, izin perangkat, threat model.       |
| [`docs/ERD.md`](docs/ERD.md)                               | Diagram konseptual entitas dan hubungan data.                              |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)                       | Milestone, urutan pekerjaan, definisi selesai, status verifikasi.           |
| [`docs/QA_TEST_PLAN.md`](docs/QA_TEST_PLAN.md)             | Strategi pengujian, skenario penerimaan, uji perangkat dan jaringan.        |
| [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md)               | Setup Expo/Supabase dan build APK tanpa Android Studio.                     |
| [`docs/PROJECT_DECISIONS.md`](docs/PROJECT_DECISIONS.md)   | ADR: keputusan teknis beserta alasannya.                                    |
| [`docs/AI_CODING_AGENT_PROMPT.md`](docs/AI_CODING_AGENT_PROMPT.md) | Aturan kerja untuk coding agent per milestone.                     |
| [`supabase/migrations/`](supabase/migrations)              | Skema PostgreSQL/Supabase: migration awal (fondasi) + migration bootstrap profil. |

Seluruh dokumen di atas sudah ada di repositori ini; tidak ada langkah "menyalin dokumen ke repo".

## Status dan disclaimer

Dokumen ini adalah baseline desain, bukan sertifikasi keselamatan berkendara, audit keamanan, atau
jaminan performa jaringan. Akurasi GPS, batasan background execution, latensi audio, biaya peta, dan
aturan distribusi aplikasi harus divalidasi di perangkat dan layanan yang benar-benar dipakai. Semua
threshold yang tertulis merupakan target awal yang dapat diubah setelah uji lapangan.
