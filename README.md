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
| Milestone 2: garasi (CRUD, kendaraan utama, detail privat nomor polisi) | Ya | Ya | **Ya** (uji RLS LULUS, 120 perintah) | **Blocked** (APK belum diuji di HP) |
| Milestone 2: klub (buat, gabung, peran, keluarkan, jejak audit) | Ya | Ya | **Ya** (uji RLS LULUS) | **Blocked** |
| Milestone 2: foto kendaraan & logo klub (Supabase Storage) | **Belum** — belum ada bucket maupun policy; tidak ada tombol unggah palsu | — | — | — |
| Milestone 2+: perjalanan, lokasi, chat, hazard, feed, musik | **Belum** | — | — | — |

**Blocked** yang tersisa berarti: alur aplikasi belum pernah dijalankan terhadap project development
nyata, dan aplikasi belum pernah dipasang di HP fisik. Project Supabase development **sudah ada**
sejak 13 Oktober 2026, kelima migration sudah diterapkan, uji RLS `public.profiles` sudah lulus
(ADR-035), dan lubang privasi follow serta integritas detail privat kendaraan sudah diperbaiki dengan
uji allow/deny (ADR-039, ADR-040). Semua langkah yang dapat dijalankan tanpa backend sudah dijalankan
— lihat [Perintah pengujian](#perintah-pengujian).

Layar Milestone 2 (garasi dan klub) sepenuhnya **berfungsi**: seluruh aksinya memanggil service
yang menembak tabel/RPC Supabase, dan setiap mutasi punya uji RLS allow/deny terhadap database
development. Yang sengaja **tidak** ditampilkan sebagai tombol berfungsi adalah fitur perjalanan ke
atas (mis. "Buat perjalanan"), karena belum dibangun.

Satu bagian Milestone 2 yang memang belum ada: **unggah foto kendaraan dan logo klub**. Supabase
Storage belum disiapkan (tidak ada bucket maupun policy-nya — diperiksa langsung ke project
development), jadi kolom `photo_path`/`logo_path` sengaja dibiarkan kosong dan layarnya menyatakan
belum tersedia alih-alih menampilkan tombol yang tidak melakukan apa-apa.

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
- Android Studio **tidak** wajib untuk rilis: APK dibangun di runner GitHub (`expo prebuild` +
  Gradle, ADR-051). Build lokal tetap membutuhkan JDK 17 dan Android SDK (bagian “Build APK Android”).
- Akun **Expo** hanya dibutuhkan untuk build EAS opsional (development client, AAB Play) — rilis APK
  tidak memakainya sejak ADR-051. Akun **Supabase** dibutuhkan untuk backend. Menjalankan aplikasi
  dan seluruh automated test tidak memerlukan keduanya.

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
npm run deps:check       # versi dependency terhadap Expo SDK yang terpasang (≈3 detik)
npm test                 # unit + komponen test (jest-expo); menjalankan deps:check lebih dulu
npm run doctor           # expo-doctor (pemeriksaan menyeluruh)
npm run export:android   # bundel Android (Metro + Hermes) tanpa perangkat
npm run db:test          # uji RLS ke database development (butuh .env.db / DATABASE_URL)
```

`npm test` menjalankan `npm run deps:check` lebih dulu (`pretest` di `package.json`), karena
ketidakcocokan versi dependency dengan SDK adalah penyebab kegagalan yang sudah pernah mematikan
gerbang rilis (ADR-053) dan baru terlihat di CI — di sana letaknya setelah seluruh test berjalan.
Pemeriksaan itu memakai CLI Expo yang terpasang (`expo install --check`), jadi aturannya sama dengan
`npm run doctor` dan tidak digandakan di repo ini. Ongkosnya ±3 detik pada mesin pengembang
(termasuk startup npm dan Node; pemeriksaan CLI-nya sendiri ±1 detik), sedangkan `npm run doctor`
yang menyeluruh tetap dijalankan di CI. Bila daftar versi resmi Expo tidak terjangkau
(sedang offline), pemeriksaan melaporkan bahwa hasilnya **tidak bisa dipastikan** dengan
`::warning::` dan tidak menggagalkan `npm test` — lulus hanya dilaporkan bila benar-benar diperiksa.

Hasil nyata pada commit ini (`a9858a9`, 16 Oktober 2026, Node 24.18, npm 12):

| Perintah               | Hasil                                                        |
| ---------------------- | ------------------------------------------------------------ |
| `npm ci`               | Exit 0, 1.076 paket terpasang dari lockfile.                 |
| `npm run typecheck`    | Exit 0 (juga lulus tanpa folder `.expo` — tidak perlu dev server dulu). |
| `npm run lint`         | Exit 0.                                                       |
| `npm run format:check` | Exit 0.                                                       |
| `npm run deps:check`   | Exit 0 — versi dependency cocok dengan Expo SDK 57.0.30 (ADR-054). |
| `npm test`             | **20 suite, 222 test lulus**, exit 0 (dijalankan setelah `npm ci`). |
| `npm run test:scripts` | **172 test lulus**, exit 0.                                   |
| `npm run doctor`       | 21/21 pemeriksaan lulus (sebelum perbaikan versi: 20/21, exit 1). |
| `npm run export:android` | Exit 0, bundel Hermes `entry-*.hbc` (~3,6 MB), tidak ada JWT/service role key di dalam bundel. |
| `npm run db:test`      | **Exit 0 — `UJI RLS PROFIL LULUS`** (120 perintah: profil, follow/privasi, detail privat kendaraan, garasi, klub) terhadap project development, diverifikasi ulang 16 Oktober 2026. |
| `npx supabase ...`     | CLI 2.120.0 (lewat `npx`, tidak masuk `package.json`). `link` + `db push` menerapkan seluruh migration (kedelapan versi; `npx supabase migration list` 16 Oktober 2026 menunjukkan kolom Local dan Remote sama untuk kedelapannya); jangan menaruh connection string di argumen perintah karena npm/npx mencetak ulang argumennya. |
| `npx expo prebuild` + `./gradlew assembleRelease` | **Berjalan lokal maupun di GitHub Actions**: rantai yang sama menghasilkan APK bertanda tangan `v0.1.0-build9` (15 Oktober 2026) dan build preview berikutnya untuk setiap push yang mengubah isi aplikasi. `npm run test:scripts` juga menguji `scripts/configure-android-release.mjs`. |

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
- Status saat ini: **Passed against dev backend** (diverifikasi ulang 16 Oktober 2026) — `npm run db:test`
  mencetak `UJI RLS PROFIL LULUS`, 120 perintah selesai, exit 0, pada database development yang sudah
  memuat kedelapan migration (termasuk garasi dan klub Milestone 2). Jalur kegagalan runner juga sudah diuji sebelumnya (tanpa `DATABASE_URL`, host
  tidak terjangkau, berkas tanpa penanda lulus). Jalankan ulang setiap kali policy/RPC berubah.

## CI dan rilis APK (GitHub Actions)

Tiga workflow; semuanya tidak pernah mencetak nilai secret (tidak ada `echo $SECRET`, tidak ada `env`
tanpa filter).

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — pemeriksaan rutin, berisi tiga job:
  - **`quality`** berjalan pada push ke `main` dan setiap pull request: `npm ci`, `typecheck`, `lint`,
    `format:check`, `npm test -- --ci`, `npm run test:scripts` (test script rilis), `doctor`, dan
    `export:android`. Job ini **tidak memakai satu
    pun secret** Supabase dan justru membuktikan aplikasi tetap bersih saat backend belum
    dikonfigurasi.
  - **`workflows-lint`** memeriksa file workflow milik CI-nya sendiri dengan `actionlint` lewat
    container `docker://rhysd/actionlint:1.7.12`: sintaks YAML, ekspresi `${{ }}` (konteks dan
    referensi yang tidak ada), serta shellcheck untuk tiap blok `run:`. File workflow tidak dijangkau
    tsc/eslint/Prettier, jadi tanpa job ini kesalahan di `.github/workflows/` baru terlihat saat
    workflow berjalan — yaitu tepat pada rilis; dengan job ini, pull request-nya yang gagal.
  - **Uji RLS** berjalan di workflow terpisah, [`.github/workflows/database-rls.yml`](.github/workflows/database-rls.yml),
    karena ia satu-satunya pemeriksaan yang membutuhkan secret Supabase. Ia berjalan **otomatis**
    ketika file database berubah (`supabase/**`, `scripts/db-test.mjs`, atau workflow-nya sendiri),
    plus lewat **Actions → Database RLS → Run workflow**. Sebelum uji, connection string diverifikasi
    menunjuk project development (ref `xvmcpfkkveeaevfcvfug`), sehingga secret yang salah tempat
    tidak bisa menjalankan uji apa pun; PR dari fork dilewati karena tidak menerima secret. `ci.yml`
    tetap bebas secret Supabase sepenuhnya.
- [`.github/workflows/release-on-push.yml`](.github/workflows/release-on-push.yml) — rilis APK
  **preview**, dengan dua cara memicu:
  - **otomatis** setelah `ci.yml` sukses pada push ke `main`;
  - **manual** lewat **Actions → Release APK (push to main or manual) → Run workflow** dengan input
    `commit` (SHA, nama branch, atau tag) — atau `gh workflow run release-on-push.yml -f commit=<sha>`
    — untuk merilis commit pilihan tanpa menunggu push ke `main`.

  Job `plan` menyelesaikan input itu menjadi **satu SHA** yang dipakai seluruh job, memastikan SHA
  tersebut sudah lulus CI (pada jalur manual, lewat API Actions), lalu memutuskan perlu build atau
  tidak (`scripts/should-release.mjs`). Tag rilis berbentuk `v<versi>-build<N>` dan release-nya ditandai
  *prerelease*. Sebelum release-nya dibuat, APK hasil build dijalankan lebih dulu di emulator Android
  (`scripts/smoke-test-apk.mjs`) — pratinjau yang crash saat dibuka tidak terbit. Setelah itu job
  **`prune`** memangkas rilis preview lama beserta tag-nya (`scripts/prune-preview-releases.mjs`,
  menyimpan sepuluh terbaru) supaya halaman Releases tidak penuh oleh satu rilis untuk setiap push;
  riwayatnya tetap ada di [`CHANGELOG.md`](CHANGELOG.md), dan rilis produksi tidak pernah disentuh.
  Dispatch manual yang tidak membawa perubahan aplikasi apa pun **gagal** dengan pesan jelas, bukan
  run hijau tanpa rilis (bagian 6.7 di [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md)).
- [`.github/workflows/android-release.yml`](.github/workflows/android-release.yml) — rilis APK
  produksi, dijalankan **manual** (`workflow_dispatch` dengan input `version`). Urutan job:
  **`verify`** (validasi versi + pemeriksaan kualitas) → **`build-apk`** (APK dibangun di runner sendiri:
  `expo prebuild` + Gradle, lalu diunggah sebagai Actions artifact) → **`smoke-test`** (APK dipasang dan
  dinyalakan di emulator Android) → **`release`** (setelah build sukses **dan** uji nyala lulus:
  **membuat** tag `v<versi>` dan GitHub Release berisi APK) → **`changelog`** (mencatat rilis itu ke
  `CHANGELOG.md`). Tidak ada build Android pada push/PR biasa: hanya `ci.yml` yang berjalan di sana.
- [`CHANGELOG.md`](CHANGELOG.md) — riwayat permanen setiap rilis, ditulis otomatis oleh job `changelog`
  di kedua workflow rilis: rilis produksi sebagai bagian penuh, build preview diringkas di dalam blok
  yang bisa dibuka. Isinya sama dengan badan GitHub Release (`scripts/release-notes.mjs`), dan tag yang
  sudah tercatat tidak pernah ditulis dua kali. Commit pencatatannya bertanda `[skip ci]`, sehingga
  tidak ikut muncul sebagai “perubahan” di catatan rilis maupun entri berikutnya. Rinciannya di
  [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md) bagian 6.8.

Status per 16 Oktober 2026: `ci.yml` **hijau pada setiap push sejak perbaikan versi** — run
`38857101603` (`a9858a9`), `38858837494` (`95ec43a`), dan `38860337113` (`ab3a9a8`), semuanya job
`quality` tanpa secret. Run `38855099318` pada `1ef13a8` sebelumnya **gagal** di langkah `Expo doctor`
karena `expo` 57.0.29 (diminta `~57.0.30`) dan `expo-router` 57.0.27 (diminta `~57.0.28`);
perbaikan versinya ada di `a9858a9` (ADR-053, ADR-054).

Uji RLS kini berjalan **di GitHub Actions**, bukan hanya lokal: run `38862870367` (16 Oktober 2026,
commit `21e49d1`, dipicu otomatis oleh perubahan `.github/workflows/database-rls.yml`) memuat
`UJI RLS PROFIL LULUS` dan `120 perintah selesai dijalankan` dari server, dengan secret
`DB_TEST_DATABASE_URL` terpasang (ADR-055). Workflow `ci.yml` tetap bebas secret Supabase.

Kedua alur rilis **sudah berjalan di GitHub**: `v0.1.0-build9` (15 Oktober 2026, commit `7639ba9`)
terbit sebagai APK preview bertanda tangan, dan setiap push ke `main` yang mengubah isi aplikasi
memicu rilis preview berikutnya. Isi keempat secret keystore dan tiga variabel publik ada di bagian 5
[`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md).

APK preview yang **memuat** Milestone 2 adalah
[v0.1.0-build11](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build11) (16 Oktober 2026):
tag-nya menunjuk `a9858a9` dan catatan rilisnya memuat `cf818be`, sedangkan `v0.1.0-build9` dibuat
**sebelum** garasi dan klub ada sehingga ia **bukan** bukti fitur ini. SHA-256 berkasnya ada di bagian
**🔒 Verifikasi berkas** pada badan rilis. Push yang hanya mengubah dokumentasi melewatkan **seluruh**
job build, uji nyala, dan tag (terverifikasi pada run `38859004932`), jadi dokumentasi tidak memakan
menit build.

## Build APK Android

APK dibangun **di runner sendiri** (`expo prebuild` + Gradle), bukan di EAS Cloud — tanpa kuota build
pihak ketiga dan tanpa token Expo (ADR-051). Hal yang sama bisa dijalankan di laptop:

```powershell
npm ci
npx expo prebuild --platform android --no-install
$env:ANDROID_KEYSTORE_PATH="$PWD\rilis.jks"   # + sandi, alias, dan sandi kunci (bagian 5.1 dokumentasi)
node scripts/configure-android-release.mjs --project android --version-code auto
cd android; ./gradlew :app:assembleRelease      # android\app\build\outputs\apk\release\app-release.apk
```

Development client masih bisa dibangun lewat EAS bila tidak ingin memasang toolchain Android:

```powershell
npx eas-cli@latest build --platform android --profile development    # development build (expo-dev-client)
npx eas-cli@latest build --platform android --profile production     # AAB untuk Google Play
```

Profil build EAS yang tersisa ada di [`eas.json`](eas.json):

| Profil                    | Artifact | Distribusi | Kegunaan                                              |
| ------------------------- | -------- | ---------- | ----------------------------------------------------- |
| `development`             | APK      | internal   | development build (`expo-dev-client`)                 |
| `preview`                 | APK      | internal   | APK uji cepat internal (opsional; CI memakai Gradle)  |
| `production-apk`          | APK      | internal   | APK manual; **bukan** yang terbit di halaman Releases |
| `production`              | AAB      | store      | unggah ke Google Play                                 |

Nama paket Android `com.rodakawan.app` di [`app.json`](app.json) masih sementara dan wajib diganti
sebelum rilis Play Store bila identitas final berbeda (ADR-015).

Status: rantai build lokalnya **sudah dibuktikan** — prebuild, tanda tangan, `assembleRelease`, dan
`scripts/verify-apk.mjs` dijalankan di mesin pengembang dan lulus; yang belum pernah terjadi adalah
menjalankannya di GitHub Actions, yang menunggu keempat secret keystore.

### Merilis APK lewat workflow

```powershell
# 1. Naikkan "version" di app.json (mis. 0.1.0 → 0.2.0), lalu commit dan push.
# 2. Jalankan workflow rilis dari commit itu, dengan versi yang sama.
gh workflow run android-release.yml --ref main -f version=0.2.0
#    Atau: Actions → Android APK Release → Run workflow, isi input "version".
```

`.github/workflows/android-release.yml` memvalidasi versi, menjalankan pemeriksaan kualitas,
membangun APK dengan Gradle di runner, dan **hanya setelah build sukses** membuat tag `v0.2.0` beserta
GitHub Release berisi `RodaKawan-v0.2.0.apk`. APK diunduh dari halaman **Releases** repository, atau
dari Artifacts run tersebut.

- APK diperiksa sebelum dilampirkan: `scripts/verify-apk.mjs` memverifikasi struktur ZIP (CRC-32
tiap entri), tanda tangan **v2/v3**, dan rantai tanda tangan **v1**, jadi berkas rusak, tanpa
tanda tangan, atau yang diubah setelah ditandatangani tidak pernah sampai ke halaman Releases —
baik di rilis produksi maupun di rilis preview (ADR-043). Pemeriksaan yang sama bisa dijalankan
lokal: `node scripts/verify-apk.mjs RodaKawan-v0.2.0.apk`.
- Unduhan juga bisa **diperiksa sendiri** sebelum dipasang: badan rilis ditutup bagian **🔒 Verifikasi
  berkas** berisi nama berkas, ukuran, SHA-256, dan sidik jari sertifikat penandatangan, beserta
  perintah untuk mencocokkannya (`Get-FileHash` di Windows, `sha256sum` di Linux/macOS). Bagian itu
  ditambahkan job `release` tepat sebelum rilis terbit — SHA-256 baru diketahui setelah build selesai —
  dan hanya ada di halaman rilis, bukan di entri `CHANGELOG.md` (ADR-049).
- `versionCode` Android **tidak** dinaikkan manual: CI menghitungnya dari riwayat repository (jumlah
  seluruh commit), jadi selalu naik dan tidak bergantung pada workflow mana yang berjalan lebih dulu.
  `android.versionCode` di `app.json` menjadi lantai bila hitungan itu lebih kecil (ADR-051). Yang
dinaikkan manual hanya `version`.
- Tag versi **dibuat oleh workflow**, bukan didorong manusia: build yang gagal tidak meninggalkan tag
  tanpa release, dan versi yang sama bisa dijalankan ulang setelah penyebab kegagalannya diperbaiki
  (ADR-042).
- Versi yang tag-nya sudah ada ditolak sebelum build dimulai — naikkan `version` di `app.json` untuk
  rilis berikutnya, dan rilis lama tidak pernah ditimpa.
- Build produksi **tanpa** rilis: jalankan rantai lokal di bagian “Build APK Android” (bagian 6.1 di
  [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md)) — jangan kirim APK hasil `eas build` manual ke halaman
  Releases, karena nomor versinya dan kuncinya bukan yang dipakai rilis.
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
scripts/        # generate-assets.mjs, db-test.mjs (runner uji RLS), verify-apk.mjs (tanda
                # tangan APK), configure-android-release.mjs (tanda tangan + nomor
                # versi build), write-app-env.mjs (konfigurasi publik EXPO_PUBLIC_*),
                # smoke-test-apk.mjs (uji nyala di emulator), release-notes.mjs,
                # update-changelog.mjs, prune-preview-releases.mjs (pemangkas rilis
                # preview lama)
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

- `main` harus selalu dapat dijalankan: `npm run typecheck`, `npm run lint`, `npm test`, dan
  `npm run test:scripts` hijau sebelum merge.
- Satu milestone per branch, mis. `feat/m1-auth-profil`, `chore/m1-5-verifikasi-ci`.
- Commit mengikuti Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`), satu perubahan logis
  per commit. Perubahan yang **merusak kompatibilitas** ditandai `!` sebelum titik dua (`feat!: hapus
  endpoint lama`) atau baris footer `BREAKING CHANGE:`; catatan rilis APK — preview maupun produksi,
  keduanya lewat `scripts/release-notes.mjs` — menaruh penanda itu di bagian paling atas, jadi jangan
  dipakai untuk perubahan yang sebenarnya aman (`docs/SETUP_GUIDE.md` §6.3 dan §6.7).
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
