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
| Milestone 2: garasi (CRUD, kendaraan utama, detail privat nomor polisi) | Ya | Ya | **Ya** (uji RLS LULUS, 171 perintah) | **Ya** (dilaporkan pemilik; artefak per kasus tidak tersedia) |
| Milestone 2: klub (buat, gabung, peran, keluarkan, jejak audit) | Ya | Ya | **Ya** (uji RLS LULUS) | **Ya** (dilaporkan pemilik) |
| Milestone 2: foto kendaraan & logo klub (Supabase Storage) | Ya — bucket privat, unggah/ganti/hapus, foto diperkecil + dikompres otomatis di perangkat, objek yatim disapu otomatis | Ya (75 unit test) | **Ya** (uji Storage RLS LULUS + uji HTTP LULUS) | **Ya** (dilaporkan pemilik; build19/build20 memuat modul native) |
| Milestone 2: foto profil (avatar) | Ya — bucket privat owner-only, unggah/ganti/hapus dari tab Profil, foto diperkecil otomatis | Ya (17 unit test) | **Ya** (uji HTTP Storage LULUS) | **Ya** (dilaporkan pemilik) |
| Milestone 3: perjalanan klub (buat, undang, gabung, keluar, host memulai/menyelesaikan/membatalkan) | Ya — RPC transactional, state machine di database | Ya (27 test fitur + 20 test layar, termasuk 11 test formulir buat/ubah) | **Ya** (uji RLS/RPC 67 perintah) | **Blocked** (dua perangkat) |
| Milestone 3: berbagi lokasi opt-in (foreground + background) | Ya — consent terpisah dari izin OS, sampling 15 dtk/25 m, basi 60 dtk, lokasi terakhir dihapus saat opt-out/keluar/ride final | Ya | **Ya** (uji allow/deny lokasi) | **Blocked** (izin, GPS mati, force-stop, baterai 30 menit) |
| Milestone 3: peta konvoi | **Belum** — ADR-064 masih **Proposed** (rekomendasi MapLibre + MapTiler Flex, riset ulang 20 Oktober 2026); layar menampilkan daftar posisi + status kesegaran, bukan peta tiruan | — | — | — |
| Milestone 4+: chat, hazard, feed, musik | **Belum** | — | — | — |

**Blocked** yang tersisa berarti: alur itu belum dijalankan terhadap backend nyata atau belum diuji di
HP fisik. Status **Ya** pada kolom perangkat Milestone 2 berasal dari laporan pemilik aplikasi
(owner-reported) bahwa build sudah dicoba di HP tanpa error yang teramati; tidak ada log, rekaman,
atau tag rilis per kasus yang disertakan. Project Supabase development **sudah ada**
sejak 13 Oktober 2026, **seluruh tiga belas** migration sudah diterapkan, uji RLS sudah lulus
(ADR-035), dan lubang privasi follow serta integritas detail privat kendaraan sudah diperbaiki dengan
uji allow/deny (ADR-039, ADR-040). Dua migration pertama adalah sejarah penyiapan awal; jumlah itu
tidak lagi menggambarkan keadaan sekarang. Semua langkah yang dapat dijalankan tanpa backend sudah dijalankan
— lihat [Perintah pengujian](#perintah-pengujian).

Layar Milestone 2 (garasi dan klub) dan Milestone 3 (perjalanan) sepenuhnya **berfungsi**: seluruh
aksinya memanggil service yang menembak tabel/RPC Supabase, dan setiap mutasi punya uji RLS allow/deny
terhadap database development. Perjalanan memiliki daftar, formulir buat/ubah, detail peserta,
undangan, serta kontrol host untuk memulai/menyelesaikan/membatalkan. Berbagi lokasi bersifat opt-in
per perjalanan dan terpisah dari izin OS; peta **belum** dipasang, jadi layar menampilkan daftar
posisi dengan label live/basi/belum ada — bukan peta atau koordinat contoh.

**Unggah foto kendaraan, logo klub, dan foto profil sudah berfungsi.** `vehicle-photos`,
`club-logos`, dan `avatars` adalah bucket privat: foto kendaraan dan foto profil hanya bisa dibaca
pemiliknya, logo klub dibaca anggota aktif (atau pengunjung klub publik) dan hanya ditulis
owner/admin. Path memuat pemilik/klub dan dijaga CHECK (`photo_path`, `logo_path`, `avatar_url`),
sedangkan tampilan memakai signed URL berumur 1 jam. Unggah/ganti/hapus tersedia di layar detail
kendaraan, dashboard admin klub, dan tab Profil. Dashboard admin klub memakai rute sendiri (`/club-admin?id=…`,
terpisah dari tab) dengan form ubah klub, daftar anggota aktif beserta perannya, permintaan yang
menunggu keputusan, dan riwayat permintaan yang ditolak/dikeluarkan.

**Foto diperkecil dan dikompres di perangkat sebelum diunggah.** Foto galeri 12 MP (4000×3000,
2–5 MB) turun ke sisi terpanjang 1600 px (kendaraan) atau 512 px (logo klub dan foto profil) dan
JPEG/WEBP ditulis ulang pada kualitas 0.7; formatnya dipertahankan (PNG tetap PNG) supaya transparansi tidak hilang.
Foto kecil yang tidak perlu diproses tidak disentuh sama sekali, dan kegagalan manipulasi tidak
pernah memblokir unggahan — berkas asli dipakai dan batas bucket tetap berlaku. Hasilnya: kuota
Storage dan waktu unggah jauh lebih hemat, dan blok metadata asli (EXIF) tidak ikut tersalin
karena berkasnya ditulis ulang (perlu dikonfirmasi di perangkat — checklist GAR-05/CLUB-11). Aturan Storage diuji di database
(`npm run db:test` bagian 13) dan lewat HTTP API Storage dengan akun uji sementara
(`npm run storage:test`: unggah, signed URL, penolakan lintas pengguna, lalu pembersihan penuh).
Modul native yang dipakai (`expo-image-picker`, `expo-file-system`, `expo-image-manipulator`) **sudah
ada di APK `v0.1.0-build19` dan `v0.1.0-build20`**, dan tetap ada di build berikutnya termasuk `v0.1.0-build23` karena dependency native itu tidak berubah sejak `fa4397e`** — diperiksa di `classes*.dex` dan bundel JS kedua
berkas rilis itu; yang
belum terbukti adalah pemakaian nyata di perangkat fisik (izin galeri, hasil kompresi, signed URL
setelah aplikasi dibuka ulang).

**Konteks database (13 Oktober 2026).** Project Supabase yang sebelumnya terkonfigurasi di `.env`
**bukan** database bersih: tabel `public.profiles` sudah ada dalam bentuk yang berbeda (hanya `id`,
`username`, `role`, `created_at`) dan seluruh tabel lain dari migration awal belum ada. Karena
`create table if not exists` akan melewati tabel itu diam-diam lalu migration gagal di policy yang
menyebut `is_private`, migration **tidak** dijalankan di project tersebut. Keputusan: memakai project
development baru yang bersih. Audit lengkap ada di `docs/PROJECT_DECISIONS.md` (ADR-033).

**Tindak lanjut (13 Oktober 2026, diperluas sampai 18 Oktober).** Project development bersih sudah
dibuat dan dihubungkan lewat `.env` (URL + publishable key) dan `.env.db` (session pooler,
`sslmode=require`). Seluruh **tiga belas** migration diterapkan dengan `npx supabase link` +
`npx supabase db push`; `npx supabase migration list` menunjukkan kolom Local dan Remote sama untuk
keduabelasnya. Dua migration pertama adalah fondasi awal; sepuluh sisanya ditambahkan per milestone.
`npm run db:test` lulus dengan kedua notice. Project lama tidak disentuh sama sekali (ADR-035).

---

## Prasyarat

- **Node.js 22.13 atau lebih baru** (`engines.node` di `package.json`; CI memakai 24.x).
- **npm** sebagai satu-satunya package manager; `package-lock.json` di-commit dan dipakai `npm ci`.
  Field `packageManager` pnpm lama sudah dihapus karena tidak ada `pnpm-lock.yaml` dan seluruh CI
  memakai npm (ADR-062).
- Untuk mencoba di HP Android: aplikasi **Expo Go** (untuk UI/prototipe) atau APK development build.
- Android Studio **tidak** wajib untuk rilis: APK dibangun di runner GitHub (`expo prebuild` +
  Gradle, ADR-051). Build lokal tetap membutuhkan JDK 17 dan Android SDK (bagian “Build APK Android”).
- Akun **Expo** hanya dibutuhkan untuk build EAS opsional (development client, AAB Play) — rilis APK
  tidak memakainya sejak ADR-051. Akun **Supabase** dibutuhkan untuk backend. Menjalankan aplikasi
  dan seluruh automated test tidak memerlukan keduanya.

## Editor (VS Code)

`.vscode/settings.json` di repo ini mengarahkan IntelliSense ke TypeScript yang terpasang di repo,
bukan versi bawaan VS Code, dan menyalakan prompt untuk memakainya:

```json
{
  "js/ts.tsdk.path": "node_modules/typescript/lib",
  "js/ts.tsdk.promptToUseWorkspaceVersion": true
}
```

Setelah `npm ci`, buka berkas `.ts`/`.tsx`. VS Code menawarkan **Use Workspace Version**; bila
prompt-nya tidak muncul, klik nomor versi TypeScript di status bar lalu pilih **Use Workspace
Version**. Pilihan itu disimpan VS Code per workspace, bukan di repo, jadi cukup sekali per mesin —
status bar harus menampilkan versi yang sama dengan `npx tsc -v`.

`npm run check:editor-ts` menjaga sisi repo-nya: path harus menunjuk `node_modules/typescript/lib`
di repo ini, versinya harus memenuhi `devDependencies.typescript`, dan versi terpasang harus sama
dengan `package-lock.json` yang dipakai `npm ci` di CI. Pemeriksaan itu ikut berjalan lewat
`npm run deps:check` dan `npm test`, jadi pengaturan editor yang menyimpang menggagalkan CI — bukan
ditemukan setelah berbulan-bulan berbeda pendapat dengan `tsc`. Editor lain: arahkan language server
TypeScript-nya ke `node_modules/typescript/lib` yang sama.

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
npm run deps:check       # TypeScript editor = CI + versi dependency terhadap Expo SDK (≈3 detik)
npm run check:editor-ts  # hanya pemeriksaan TypeScript editor (lokal, tanpa jaringan)
npm test                 # unit + komponen test (jest-expo); menjalankan deps:check lebih dulu
npm run doctor           # expo-doctor (pemeriksaan menyeluruh)
npm run export:android   # bundel Android (Metro + Hermes) tanpa perangkat
npm run db:test          # uji RLS ke database development (butuh .env.db / DATABASE_URL)
npm run storage:test     # uji integrasi HTTP Storage dengan akun uji sementara (.env.local + .env.db)
npm run db:types         # generate ulang tipe database dari skema development
npm run db:types:check   # periksa drift tipe (dijalankan CI database)
```

`npm test` menjalankan `npm run deps:check` lebih dulu (`pretest` di `package.json`) karena dua
ketidakcocokan versi sudah pernah lolos sampai CI: editor yang memakai TypeScript bawaan VS Code
(sehingga diagnostiknya berbeda dari `tsc`), dan dependency yang menyimpang dari Expo SDK — yang
terakhir ini dulu baru terlihat di CI, setelah seluruh test berjalan (ADR-053). Pemeriksaan pertama
(`check:editor-ts`) berjalan lokal tanpa jaringan dan membandingkan pengaturan editor, pin
`devDependencies`, dan lockfile; pemeriksaan kedua memakai CLI Expo yang terpasang
(`expo install --check`), jadi aturannya sama dengan `npm run doctor` dan tidak digandakan di repo
ini. Ongkosnya ±3 detik pada mesin pengembang
(termasuk startup npm dan Node; pemeriksaan CLI-nya sendiri ±1 detik), sedangkan `npm run doctor`
yang menyeluruh tetap dijalankan di CI. Bila daftar versi resmi Expo tidak terjangkau
(sedang offline), pemeriksaan melaporkan bahwa hasilnya **tidak bisa dipastikan** dengan
`::warning::` dan tidak menggagalkan `npm test` — lulus hanya dilaporkan bila benar-benar diperiksa.

Hasil nyata pada commit `749424c` (19 Oktober 2026, Node 24.18.1, npm 12.0.2):

| Perintah               | Hasil                                                        |
| ---------------------- | ------------------------------------------------------------ |
| `npm ci`               | Exit 0, 1.082 paket terpasang dari `package-lock.json` (lockfile v3). |
| `npm run typecheck`    | Exit 0 (juga lulus tanpa folder `.expo` — tidak perlu dev server dulu). |
| `npm run lint`         | Exit 0.                                                       |
| `npm run format:check` | Exit 0.                                                       |
| `npm run deps:check`   | Exit 0 — versi dependency cocok dengan Expo SDK 57.0.30 (ADR-054). |
| `npm test`             | **33 suite, 364 test lulus**, exit 0 (dijalankan setelah `npm ci`; termasuk suite perjalanan Milestone 3, 14 test kompresi foto, 18 test pembersihan objek yatim Storage, dan 17 test foto profil: 12 API + 5 komponen layar). Diverifikasi ulang 20 Oktober 2026 setelah **11 test komponen `ride-new.tsx`** ditambahkan (sebelumnya 32 suite/353 test). |
| `npm run test:scripts` | **240 test lulus, exit 0** (19 Oktober 2026) — termasuk 4 test penjaga Milestone 3. Sebelumnya 235 test dengan satu kegagalan di checkout Windows: asersi baris pertama `CHANGELOG.md` membandingkan CRLF di disk dengan `HEADER` ber-LF. Kini akhir baris diseragamkan di batas perbandingan (`normalizeLineEndings`, ADR-063) dan ada test regresi untuk LF/CRLF/CR; asersi judul tetap ketat, file Git tidak diubah, dan `core.autocrlf` tidak disentuh. |
| `npm run doctor`       | **Tidak dapat dipastikan** (19 Oktober 2026): 20 dari 21 pemeriksaan berjalan, pemeriksaan skema config gagal `TypeError: fetch failed` / `EAI_AGAIN exp.host` karena DNS lingkungan ini. Dua percobaan memberi hasil sama; bukan temuan proyek. Jalankan ulang di CI atau jaringan yang menjangkau `exp.host`. |
| `npm run export:android` | Exit 0, bundel Hermes `entry-*.hbc` 3,8 MB. |
| `npm run db:test`      | **Exit 0 — dua berkas, dua notice** (diulang 19 Oktober 2026): `UJI RLS PROFIL LULUS` (171 perintah: profil, follow/privasi, detail privat kendaraan, garasi, klub, konten klub, perjalanan, Storage foto/logo/avatar) dan `UJI POLICY OWNER-GUARD LULUS` (17 perintah: 18 policy wadah diperiksa, detektor diuji-diri) terhadap project development. |
| `npm run db:types:check` | Exit 0 — `database.generated.ts` (653 baris, Supabase CLI 2.121.0) sama dengan skema project development, diverifikasi ulang 18 Oktober 2026 **tanpa link project maupun access token** (target dioper lewat `--db-url`, ADR-061). Skenario CI direproduksi lokal dengan memindahkan `supabase/.temp` (tautan CLI) — sebelumnya exit 1 dengan `Must specify one of --local, --linked, --project-id, or --db-url`. Drift yang disengaja terdeteksi (exit 1) dan menampilkan baris pertama yang berbeda. |
| `npm run storage:test` | **Exit 0 — `UJI INTEGRASI STORAGE LULUS`** (27 langkah: unggah sebagai pemilik untuk foto kendaraan **dan** foto profil, signed URL + unduhan SHA-256, delapan penolakan lintas pengguna/anon, hapus oleh pemilik, verifikasi nol sisa) terhadap project development, 18 Oktober 2026. Dijalankan tiga kali berturut-turut tanpa sisa (satu di antaranya menyapu objek yatim yang sengaja ditinggalkan run terputus), dan sekali dengan publishable key salah (exit 1, data uji tetap dibersihkan). |
| `npx supabase ...`     | CLI 2.121.0 (lewat `npx`, tidak masuk `package.json`). `link` + `db push` menerapkan seluruh migration (tiga belas versi; `npx supabase migration list` 19 Oktober 2026 menunjukkan kolom Local dan Remote sama untuk ketiga belasnya). Pada umumnya jangan menaruh connection string di argumen perintah karena npm/npx mencetak ulang baris perintahnya; pengecualian tunggal adalah `npm run db:types` (ADR-061) yang mengoperkannya sebagai `--db-url` karena itulah satu-satunya cara mengarahkan `gen types` tanpa access token mesin — perintah itu menyetel `npm_config_loglevel=error` supaya `npx` tidak mencetak ulang argumennya dan menyunting seluruh keluaran sebelum dicetak, dan keduanya diuji di `scripts/__tests__/db-types.test.mjs`. |
| `npx expo prebuild` + `./gradlew assembleRelease` | **Berjalan lokal maupun di GitHub Actions**: Release APK run **#23** (18 Oktober 2026, commit `df75ba1`) menerbitkan `v0.1.0-build23`; run **#20** menerbitkan `v0.1.0-build20` dari `fa4397e`, dan run **#19** menerbitkan `v0.1.0-build19` dari `749424c`. Semuanya berisi `app-preview.apk` bertanda tangan. `npm run test:scripts` juga menguji `scripts/configure-android-release.mjs`. |

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

`npm run db:test` menjalankan **dua** berkas uji berurutan, masing-masing dalam satu transaksi yang
diakhiri `ROLLBACK` dan masing-masing menyatakan notice penanda lulusnya sendiri lewat direktif
`-- db:test notice: <teks>` (berkas tanpa direktif itu ditolak sebelum apa pun dijalankan ke
database):

| Berkas | Yang dibuktikan | Notice penanda |
| --- | --- | --- |
| [`rls_profiles_test.sql`](supabase/tests/rls_profiles_test.sql) | Izin dan penolakan per tabel/RPC dan Storage (profil, follow, garasi, klub, perjalanan, bucket foto) | `UJI RLS PROFIL LULUS` |
| [`rls_policy_guard_test.sql`](supabase/tests/rls_policy_guard_test.sql) | Pagar katalog: tidak ada policy wadah yang memberi akses lewat kolom kepemilikan tanpa penjaga keanggotaan (ADR-060) | `UJI POLICY OWNER-GUARD LULUS` |

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
# 2. Tanpa runner: tempel seluruh isi berkas uji yang ingin diperiksa ke
#    Supabase Dashboard → SQL Editor, lalu pastikan notice pada direktifnya
#    (mis. "UJI RLS PROFIL LULUS") muncul tanpa exception.
#    Satu berkas saja: npm run db:test -- --file supabase/tests/rls_policy_guard_test.sql
```

Aturan penting:

- Jalankan hanya pada project **development**. Jangan memakai kredensial produksi.
- `DATABASE_URL` **jangan** disimpan di `.env.local` (berkas itu untuk variabel `EXPO_PUBLIC_*` yang
  masuk ke bundle aplikasi). Isi langsung di shell untuk satu perintah.
- Runner hanya melaporkan lulus bila notice penanda benar-benar diterima dari server, sehingga
  "hijau palsu" (mis. berkas uji terpotong) tidak bisa lolos.
- Status saat ini: **Passed against dev backend** (diverifikasi ulang 18 Oktober 2026) — `npm run db:test`
  mencetak kedua notice (`UJI RLS PROFIL LULUS` 171 perintah + `UJI POLICY OWNER-GUARD LULUS`
  17 perintah, 18 policy wadah diperiksa), exit 0, pada database development yang sudah memuat dua
  belas migration (termasuk garasi, klub, dan tiga bucket Storage foto/logo/avatar). Jalur kegagalan
  runner juga sudah diuji: tanpa `DATABASE_URL`, host tidak terjangkau, berkas tanpa direktif notice,
  dan temuan policy tanpa penjaga yang belum terdaftar (exit 1 dengan daftar tabel.policy-nya).
  Jalankan ulang setiap kali policy/RPC berubah.

### Pagar policy: kepemilikan tanpa penjaga keanggotaan

[`supabase/tests/rls_policy_guard_test.sql`](supabase/tests/rls_policy_guard_test.sql) membaca katalog
(`pg_policies`) dan **gagal** bila ada policy pada tabel **wadah** — tabel `public` yang punya kolom
`club_id` atau `ride_id` — yang memberi akses lewat kolom kepemilikan (`created_by`, `author_id`,
`owner_id`, `user_id`, `sender_id`, `reporter_id`, `blocker_id`, `recipient_id`, `follower_id`,
`followed_id`) tanpa penjaga keanggotaan (`is_club_member`, `is_club_admin`, `is_ride_member`,
`is_ride_active_member`, `is_ride_host`, `can_publish_ride_location`, atau subquery ke
`club_members`/`ride_members`).

Pagar ini menutup kelas bug yang pernah nyata: `rides_select_allowed` sempat memuat
`created_by = auth.uid()` yang berdiri sendiri, sehingga pembuat perjalanan klub tetap membacanya
setelah keluar dari klub (ditutup `20261017090000`). Typecheck, lint, dan uji aplikasi tidak bisa
melihat bentuk policy — hanya katalog database yang tahu.

Pengecualian harus tertulis beserta alasannya di dalam berkas uji itu (saat ini empat: menghapus
pesan/lokasi sendiri, dan dua policy hazard yang memang data komunitas). Daftar pengecualian
diperiksa **anti-usang**: entri yang tidak lagi diperlukan (policy hilang/sudah berpenjaga/berubah
bentuk) menggagalkan uji, supaya daftarnya tidak membusuk. Detektornya sendiri diuji-diri dengan
tabel probe — satu policy tanpa penjaga harus tertangkap, satu dengan penjaga tidak boleh — supaya
"nol temuan" tidak berarti "detektor buta".

## Uji integrasi Storage (HTTP)

`npm run storage:test` ([`scripts/storage-test.mjs`](scripts/storage-test.mjs)) menguji jalur yang
benar-benar dipakai aplikasi lewat **HTTP API Storage**, bukan hanya policy di database seperti
`db:test`:

- dua akun uji sementara dibuat lewat `DATABASE_URL` — kata sandi acak per run, di-hash `pgcrypto`,
  tidak pernah dicetak — lalu sign-in lewat **GoTrue password grant**. Uji ini karena itu tidak
  membutuhkan `service_role` key, yang memang tidak pernah disimpan di repo/mesin ini;
- user A mengunggah PNG 1×1 sebagai foto kendaraan (`vehicle-photos/<A>/<motor>/uji.png`) → HTTP 200;
- A membuat **signed URL** lalu mengunduhnya tanpa token apa pun; isi berkas dibandingkan lewat
  SHA-256 dengan yang diunggah;
- **penolakan lintas pengguna**: B ditolak saat mengunggah ke folder A, menautkan motor A ke foldernya
  sendiri, membuat signed URL untuk objek A, dan mengunduh objek A; `anon` juga ditolak. Setiap
  percobaan dicek lagi di database — objek yang ditolak tidak boleh benar-benar terbentuk;
- **pola yang sama diuji untuk foto profil** (`avatars/<A>/uji-avatar.png`): A unggah/sign/hapus, B dan
  `anon` ditolak untuk unggah, sign, dan unduh, dan objek yang ditolak diverifikasi tidak terbentuk;
- A menghapus objeknya lewat Storage API, lalu signed URL baru untuk path itu ditolak;
- **pembersihan selalu berjalan** (blok `finally`, termasuk saat uji gagal): objek dihapus lewat
  Storage API — Supabase menolak `delete from storage.objects` langsung — lalu akun uji dihapus
  sehingga profil dan kendaraan ikut `ON DELETE CASCADE`, dan runner memverifikasi nol sisa.
  `UJI INTEGRASI STORAGE LULUS` hanya dicetak bila semua langkah lulus **dan** tidak ada sisa.

Cakupan: runner ini menguji bucket `vehicle-photos` dan `avatars` dari ujung ke ujung. Policy
`club-logos` tetap diuji di database (`npm run db:test` bagian 13); jalur HTTP-nya belum ditambahkan
karena alur logo perlu klub + keanggotaan terlebih dahulu.

```powershell
npm run storage:test    # memuat .env.local (URL + publishable key) dan .env.db (DATABASE_URL)
```

Sisa run yang terputus disapu otomatis di awal run berikutnya: akun pengganti memakai ID uji yang
sama, dan policy DELETE hanya memeriksa folder pemilik, sehingga objek yatim tetap bisa dihapus.
Status saat ini: **Passed against dev backend** (18 Oktober 2026) — 27 langkah lulus (termasuk 8
langkah foto profil), tiga run berturut-turut bersih (satu di antaranya menyapu objek yatim yang
sengaja ditinggalkan run terputus), dan jalur gagal (publishable key salah) berakhir exit 1 tanpa
meninggalkan data uji.

### Pembersihan objek yatim di aplikasi

Penghapusan objek lama saat ganti foto bersifat best-effort: perangkat offline, aplikasi ditutup di
tengah alur, atau baris kendaraan dihapus lebih dulu bisa meninggalkan berkas yang tidak lagi
dirujuk baris mana pun. [`src/features/media/photoCleanup.ts`](src/features/media/photoCleanup.ts)
merapikannya dari sisi klien karena `delete from storage.objects` langsung ditolak Supabase dan
`service_role` tidak disimpan di repo ini:

- `findOrphanPhotoPaths` (fungsi murni) membandingkan isi folder dengan `photo_path` yang masih
  dirujuk, dan hanya menyebut path yang lebih tua dari **jendela tenggang 1 jam**
  (`ORPHAN_PHOTO_GRACE_MS`) sebagai yatim — unggahan menulis objek lebih dulu baru memperbarui
  barisnya, jadi objek baru belum tentu yatim;
- `sweepOrphanVehiclePhotos` membaca folder `<user_id>/` dan setiap folder kendaraan per halaman
  (100 entri), lalu menghapus semua yatim dalam **satu** panggilan `remove`; daftar kendaraan yang
  dipakai harus lengkap, karena itulah pemanggilnya layar yang memegang seluruh garasi;
- `cleanUpVehiclePhotosAfterDelete` dipanggil setelah baris kendaraan terhapus: objek yang pathnya
  masih diketahui dihapus lebih dulu, lalu folder kendaraan itu disapu untuk sisa unggahan lama;
- `garage.tsx` menjalankan sapuan di latar belakang setiap kali daftar garasi termuat (`void`, hasil
  tidak ditampilkan). Pembersihan tidak pernah melempar dan tidak pernah membatalkan aksi utama —
  kegagalannya hanya berarti objek dicoba lagi pada pembukaan garasi berikutnya.

Sapuan ini optimasi kuota, bukan penegakan keamanan: policy `SELECT`/`DELETE` bucket
`vehicle-photos` hanya cocok untuk folder pemiliknya, sehingga klien tidak punya jalur untuk
menyentuh folder pengguna lain, dan objek yatim tetap hanya bisa dibaca pemiliknya.

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

Status per 20 Oktober 2026: pada `df75ba1` (tag `v0.1.0-build23`), CI **#30** dan Release APK **#23**
hijau, sebagai run pertama yang menerbitkan tag build23. Database RLS **#5** hijau pada merge `7cce0ef`.
`origin/main` kini `117bed3` (pencatatan build23 di `CHANGELOG.md`), dan tidak ada perubahan kode
aplikasi setelah `df75ba1`.

Uji RLS berjalan **di GitHub Actions**, bukan hanya lokal: workflow `database-rls` memverifikasi
connection string menunjuk project development sebelum menyentuh database, lalu menolak lulus bila
notice penanda dari server tidak diterima. Run **#3** pada `575b166` sempat **gagal** di langkah
terakhir (`gen types` tanpa target, ADR-061); perbaikannya ada di `ca2461c` dan run **#4** hijau.
Workflow `ci.yml` tetap bebas secret Supabase.

Kedua alur rilis **sudah berjalan di GitHub**. APK preview terbaru adalah
[v0.1.0-build23](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build23) (18 Oktober 2026,
commit `df75ba1`): `app-preview.apk`, 106.518.751 byte, SHA-256
`2f289030950807b6c17026afc435814406b87c61bb7c22441f75f4849679ee75`, sertifikat
`3ea8bb4745b638be8fddf71e15edd9786d45aac65c0384b87be8fa2c32b3b14d` — nilai itu adalah digest aset
dan sertifikat yang dicetak workflow rilis, **belum** diverifikasi ulang di mesin ini. Baseline audit sebelumnya,
[v0.1.0-build20](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build20) dari `fa4397e`,
berukuran 105.904.031 byte dengan SHA-256
`a4ae87b459c8ffffaaeb53406bbb2dd1ec529aa91112a64ea887f0b015d9fe9d`. Kedua berkas build19/build20 sudah diunduh ulang
dan diverifikasi lokal: SHA-256/ukuran sama dengan metadata rilis, tanda tangan v2 sah, dan
`classes*.dex` memuat modul `expo.modules.imagepicker`, `expo.modules.imagemanipulator`, serta
`expo.modules.filesystem`. `v0.1.0-build9` (commit `7639ba9`) dibuat **sebelum** garasi dan klub ada,
sehingga ia **bukan** bukti fitur Milestone 2. Push yang hanya mengubah dokumentasi melewatkan
**seluruh** job build, uji nyala, dan tag, jadi dokumentasi tidak memakan menit build. Isi keempat
secret keystore dan tiga variabel publik ada di bagian 5 [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md).

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

Status: rantai build **sudah terbukti di GitHub Actions** — Release APK run #23 (18 Oktober 2026)
menjalankan prebuild, Gradle, verifikasi tanda tangan, uji nyala di emulator, dan penerbitan
`v0.1.0-build23`. Pemilik aplikasi melaporkan build itu dipakai tanpa galat yang teramati; itu
laporan pemilik (owner-reported), bukan uji perangkat yang terekam. Uji khusus yang masih **Blocked**:
dua perangkat untuk alur perjalanan, izin/GPS mati/mode pesawat, force-stop dan reboot, serta ukur
baterai 30 menit (lihat [`docs/QA_TEST_PLAN.md`](docs/QA_TEST_PLAN.md)).

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
    garage/     # api.ts + validation.ts (CRUD kendaraan, kendaraan utama)
    clubs/      # api.ts + validation.ts (RPC keanggotaan, jelajah klub)
    media/      # photos.ts, picker.ts, imageCompression.ts, photoCleanup.ts, components/
  hooks/        # useAppStatus
  lib/          # env.ts (konfigurasi publik + validasi), supabase/client.ts, crypto/webcrypto.ts
  services/     # appInfo.ts (metadata build)
  test-support/ # fake client Supabase + shim storage untuk Jest
  types/        # deklarasi tipe lingkungan
  utils/        # color.ts (kontras WCAG)
assets/         # ikon & splash
.vscode/        # settings.json: IntelliSense memakai TypeScript dari node_modules
scripts/        # generate-assets.mjs, db-test.mjs (runner uji RLS), verify-apk.mjs (tanda
                # tangan APK), configure-android-release.mjs (tanda tangan + nomor
                # versi build), write-app-env.mjs (konfigurasi publik EXPO_PUBLIC_*),
                # smoke-test-apk.mjs (uji nyala di emulator), device-checklist.mjs
                # (perekam bukti checklist 14 langkah di HP fisik),
                # check-editor-ts.mjs (TypeScript editor = CI), release-notes.mjs,
                # update-changelog.mjs, prune-preview-releases.mjs (pemangkas rilis
                # preview lama)
docs/           # sumber kebenaran produk
supabase/
  migrations/   # tiga belas migration: dua berkas fondasi awal
                # (20261013022938_initial_schema.sql, 20261013023038_auth_profile_bootstrap.sql)
                # + sepuluh migration aditif (privasi, klub, garasi, Storage)
  tests/        # rls_profiles_test.sql (uji RLS dua akun + kontrol positif)
                # rls_policy_guard_test.sql (pagar policy wadah: kepemilikan tanpa penjaga)
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
- **Foto profil:** bucket privat `avatars` (`<user_id>/<berkas>`, 2 MB, owner-only) dengan alur
  unggah/ganti/hapus yang sama dengan foto kendaraan; `profiles.avatar_url` menyimpan **path**, bukan
  URL, dan dijaga CHECK `profiles_avatar_path_owner`. Diatur dari tab Profil.
- **Belum ada:** ubah email/password dari dalam aplikasi.

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
