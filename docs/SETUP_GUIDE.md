# Setup Guide — Mulai Mengembangkan Tanpa Android Studio

Panduan ini untuk Windows + VS Code + HP Android fisik. Periksa kembali versi dan requirement pada dokumentasi resmi sebelum instalasi karena SDK dapat berubah.

## 1. Prasyarat

- Node.js 22.13 atau lebih baru (`engines.node` di `package.json`; CI memakai 24.x).
- VS Code.
- Git.
- HP Android dengan internet.
- Akun Expo untuk cloud builds.
- Akun/project Supabase untuk backend.

Android Studio tidak dibutuhkan untuk membuat build melalui EAS cloud. Expo Go tetap berguna untuk UI/prototipe awal, tetapi background location dan native modules perlu development build.

## 2. Ambil repository dan pasang dependency

Repository ini **sudah** berisi aplikasi Expo-nya, jadi jangan membuat project baru dengan
`create-expo-app` dan jangan menyalin dokumen `docs/` kembali ke repo — semua dokumen, migration, dan
konfigurasi sudah ada di sini.

Di PowerShell:

```powershell
git clone https://github.com/29nls/rodakawan.git
cd rodakawan
npm ci
npx expo start
```

`npm ci` memasang dependency persis mengikuti `package-lock.json`. Setelah Metro berjalan, instal Expo
Go di ponsel lalu pindai QR code yang ditampilkan terminal; untuk fitur native gunakan development
build (bagian 5). Jika router/CLI pada versi terpasang menampilkan alur QR yang berbeda, ikuti
instruksi CLI tersebut.

## 3. Quality tools yang sudah tersedia

Tidak perlu memasang tool tambahan: ESLint (`eslint-config-expo` + `eslint-plugin-prettier`),
TypeScript strict, Jest (`jest-expo` + `@testing-library/react-native`), dan `expo-doctor` sudah
dikonfigurasi di repo ini.

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run doctor
npm run export:android   # verifikasi bundel Android tanpa perangkat
```

Tetap pakai satu package manager (npm) dan commit lockfile. Sebelum memasang dependency native baru,
baca dokumentasi kompatibilitasnya dengan Expo SDK aktif lalu jalankan `npm run doctor`.

## 4. Hubungkan Supabase (langkah konkret Milestone 1)

Bagian ini adalah urutan yang sudah disesuaikan dengan kode di repo. Project development RodaKawan **sudah dibuat dan kedua migration sudah diterapkan** (13 Oktober 2026, ADR-035), jadi langkah di bawah adalah panduan lengkap untuk project baru — staging, produksi, atau mesin developer lain.

### 4.1 Buat project development

1. Masuk ke https://supabase.com/dashboard lalu buat project baru khusus pengembangan (jangan pakai project produksi).
2. Simpan database password di password manager; password itu tidak dipakai aplikasi mobile.
3. Catat region project agar latensi dari Indonesia wajar (mis. Singapore).

### 4.2 Ambil URL dan publishable key

1. Buka **Project Settings → API**.
2. Salin **Project URL** dan **publishable key** (project baru) atau **anon public** key (project lama).
3. Jangan pernah menyalin **service_role** key ke aplikasi; key itu hanya untuk backend/Edge Functions.

### 4.3 Jalankan migration

Ada dua migration, dan urutannya penting:

1. `supabase/migrations/20261013022938_initial_schema.sql` — skema fondasi (migration awal).
2. `supabase/migrations/20261013023038_auth_profile_bootstrap.sql` — bootstrap profil, constraint
   username, dan trigger `updated_at`. Migration ini idempotent (`create or replace`,
   `drop trigger if exists`) sehingga aman dijalankan ulang dan tidak menghapus data.

**Penting:** migration awal memakai `create table if not exists`. Bila tabel `profiles` sudah ada di
database dengan bentuk yang berbeda, tabel itu **dilewati diam-diam** lalu migration gagal di policy
yang menyebut `is_private` — dan database berakhir setengah jadi. Pastikan database benar-benar bersih
(tidak ada `public.profiles`) sebelum menjalankan migration awal.

**Cara 1 — Supabase CLI (disarankan, otomatis dan dapat diulang).** Simpan connection string project
di berkas `.env.db` di root repo (berkas ini diabaikan Git dan **tidak** dibaca Expo, jadi password
tidak masuk ke bundel aplikasi):

```dotenv
# .env.db — hanya satu baris, jangan di-commit
# Salin dari Project Settings → Database → Connection string → **Session pooler**:
# host langsung db.<ref>.supabase.co hanya punya record AAAA (tanpa IPv4) sehingga sering gagal
# ENOTFOUND, jadi pakai host pooler dan tulis user sebagai postgres.<ref>.
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

`sslmode=require` adalah nilai standar yang juga dipahami `psql` dan `npx supabase`. Runner
`npm run db:test` menerapkannya dengan semantik libpq; alasannya dijelaskan di bagian 4.6.

Lalu hubungkan CLI ke project itu dan terapkan migration:

```powershell
npx supabase link --project-ref <ref>   # menanyakan password database sekali, bukan lewat argumen
npx supabase migration list            # bandingkan riwayat lokal vs remote
npx supabase db push --dry-run          # lihat apa yang akan dijalankan
npx supabase db push --yes              # terapkan kedua migration
```

**Jangan** menuliskan connection string sebagai argumen perintah (mis. `--db-url "$env:DATABASE_URL"`,
termasuk pada `npm run <script> -- ...`): npm/npx mencetak ulang argumen lengkap lewat baris
`npm notice run ...`, sehingga password database muncul di layar dan di log CI. Jika password pernah
tercetak, segera reset di Dashboard → **Project Settings → Database → Reset database password**, lalu
perbarui `.env.db`. Bila Anda memang harus memakai `--db-url` (tanpa `link`), redam dulu outputnya,
mis. `... 2>&1 | sed -E 's#://[^@/]*@#://***@#g'`.

Catatan: `npx supabase link` menulis project ref ke `supabase/.temp/` (diabaikan Git) dan CLI langsung
membaca `supabase/migrations`. `npx supabase` mengunduh CLI ke cache npm; CLI **tidak** ditambahkan ke
`package.json`. Setelah pindah project, **link wajib diperbarui**: tanpa itu, `npx supabase db push`
tanpa argumen masih menargetkan project lama. Kalau memilih jalur `--db-url` daripada `link`, muat nilai
`.env.db` lebih dulu (di PowerShell):
`$env:DATABASE_URL=(Get-Content .env.db | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=',''`.

**Cara 2 — SQL Editor (tanpa CLI).** Tempel isi kedua berkas di atas secara berurutan dan periksa
pesan error tiap langkah. Cara ini tidak mencatat riwayat migration di database, sehingga nanti tidak
bisa dipakai `db push` untuk perubahan berikutnya tanpa `supabase migration repair`.

Verifikasi setelah selesai: **Table Editor → profiles** harus ada, kolom `is_private` harus terlihat,
dan **Database → Triggers** pada skema `auth` menampilkan `on_auth_user_created`.

### 4.4 Atur URL konfirmasi email

Tanpa langkah ini, email konfirmasi/reset akan membuka halaman web dan aplikasi tidak pernah menerima kodenya.

1. **Authentication → URL Configuration**.
2. **Redirect URLs** — tambahkan:
   - `rodakawan://auth/callback` (development build & APK; `scheme` di `app.json`).
   - `exp://**` atau URL `exp://<host>:<port>/--/auth/callback` yang ditampilkan Metro bila menguji lewat Expo Go.
3. **Site URL** boleh tetap nilai default; aplikasi native tidak memakainya.
4. **Authentication → Providers → Email**: putuskan apakah **Confirm email** menyala.
   - Menyala: setelah daftar, aplikasi menampilkan instruksi "cek email" dan pengguna harus mengklik tautan.
   - Mati: sesi langsung tersedia dan aplikasi membawa pengguna masuk tanpa menunggu konfirmasi.
   Kedua pengaturan didukung kode; yang penting konfigurasinya diketahui saat pengujian manual.

### 4.5 Isi environment lokal

1. Salin `.env.example` menjadi `.env.local` di root repo (`.env` juga dibaca Expo dan diabaikan Git;
pilih salah satu, jangan keduanya dengan nilai berbeda).
2. Isi nilainya:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_CLIENT_KEY
EXPO_PUBLIC_MAP_STYLE_URL=https://YOUR_TILE_PROVIDER/STYLE.json
```

3. `.env.local` sudah masuk `.gitignore`. Setiap variabel berprefix `EXPO_PUBLIC_` ikut masuk ke bundle aplikasi, jadi isinya tidak boleh berupa secret.
4. Restart Metro setelah mengubah `.env.local` (nilai di-inline saat build).

### 4.6 Jalankan uji RLS profil

Uji ini membuktikan user A tidak dapat membaca atau mengubah profil privat user B, bahwa `anon` tidak
melihat apa pun, bahwa `DELETE` profil sendiri ditolak, dan bahwa bootstrap trigger serta constraint
username bekerja. Semua asersi berjalan dalam satu transaksi yang berakhir `ROLLBACK`, sehingga tidak
ada pengguna/profil uji yang tertinggal.

**Cara 1 — runner `npm run db:test` (disarankan).** Ambil connection string dari **Project Settings →
Database → Connection string → Session pooler** (host `aws-0-<region>.pooler.supabase.com`, user
`postgres.<ref>`) dan tambahkan `?sslmode=require`. Jangan memakai host langsung: `db.<ref>.supabase.co`
hanya punya record AAAA (tanpa IPv4), sehingga koneksi gagal `ENOTFOUND` pada jaringan biasa.

```powershell
$env:DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
npm run db:test
Remove-Item Env:\DATABASE_URL   # jangan biarkan nilai ini tertinggal di sesi shell
```

`sslmode=require` diperlakukan mengikuti semantik libpq: koneksi terenkripsi, tetapi rantai
sertifikat tidak diverifikasi. Itu diperlukan karena pooler Supabase memakai CA internal, sedangkan
`node-postgres` (sejak `pg-connection-string` 2.14) memetakan `require` ke `verify-full` sehingga
koneksi gagal `SELF_SIGNED_CERT_IN_CHAIN`. Runner memakai semantik libpq untuk `require` dan mencetak
catatannya satu baris di output. Bila ingin verifikasi penuh, pakai `sslmode=verify-full` bersama
`sslrootcert` berisi CA project Supabase.

Di Bash/Git Bash:

```bash
DATABASE_URL="postgresql://..." npm run db:test
```

Runner hanya melaporkan lulus bila notice `UJI RLS PROFIL LULUS` benar-benar diterima dari server.
Password tidak pernah dicetak; hanya `user@host:port/database` yang ditampilkan. Jalankan
`npm run db:test -- --help` untuk melihat opsi.

**Cara 2 — SQL Editor.** Tempel seluruh isi
[`supabase/tests/rls_profiles_test.sql`](../supabase/tests/rls_profiles_test.sql) ke SQL Editor →
**Run**. Hasil lulus ditandai notice `UJI RLS PROFIL LULUS`; bila ada masalah, pesan menyebutkan
asersi mana yang gagal.

Catatan penting:

- Jalankan hanya pada project **development**. Jangan memakai kredensial produksi.
- Perintah `set local role ...` hanya berlaku di dalam transaksi; pastikan seluruh berkas dijalankan
  sebagai satu blok, bukan baris per baris.
- **Jangan** menyimpan `DATABASE_URL` di `.env.local`: berkas itu berisi variabel `EXPO_PUBLIC_*` yang
  ikut masuk ke bundle aplikasi. Untuk CI, simpan sebagai secret repository (`DB_TEST_DATABASE_URL`).
- Status saat ini: **LULUS** pada project development khusus RodaKawan (ADR-035): notice
  `UJI RLS PROFIL LULUS` diterima dan 38 perintah selesai tanpa error. Sebelumnya uji ini **belum pernah
  lulus**: pada project lama yang dipakai bersama aplikasi lain, `bootstrap_profile()` gagal
  `42703 column "display_name" of relation "profiles" does not exist` karena `public.profiles` di sana
  bukan tabel buatan migration (ADR-033). Pesan itu berguna sebagai gejala khas schema drift: lihat
  juga langkah verifikasi di bagian 4.3 dan `docs/QA_TEST_PLAN.md` bagian 9.

### 4.7 Uji manual alur autentikasi

1. `npx expo start` lalu buka aplikasi di perangkat.
2. Daftar akun baru → ikuti alur konfirmasi sesuai pengaturan 4.4 → masuk.
3. Tab **Profil** → ubah nama tampilan/username/kota/bio → simpan → muat ulang aplikasi untuk memastikan perubahan tersimpan.
4. Daftarkan username yang sudah dipakai; aplikasi harus menampilkan pesan yang jelas, bukan crash.
5. Logout → pastikan layar privat tidak bisa dibuka kembali.
6. **Lupa password** → selesaikan tautan reset dari email.

### 4.8 Hal yang belum ada di Milestone 1

- Bucket Storage dan policy avatar (Milestone 2). Karena itu tidak ada tombol upload foto profil.
- Edge Function, private Realtime channel, push notification, dan peta.
- Riwayat migration di project: CLI sudah dipakai untuk menerapkan kedua migration (bagian 4.3).
  CI database otomatis belum ada — job `database-rls` di CI hanya menjalankan uji RLS, bukan migration.
- Uji RLS **sudah** punya runner (`npm run db:test`, lihat 4.6) yang membaca `.env.db` otomatis.

## 5. Buat cloud development build

Saat mulai memakai native location/background service, MapLibre, atau LiveKit, tambahkan dependency yang sesuai dan buat development build. Contoh alur EAS standar:

```powershell
npx expo install expo-dev-client
npm install -g eas-cli
```

Jika perintah kedua tertulis tidak sesuai pada versi EAS yang digunakan, gunakan cara instalasi yang dijelaskan di dokumentasi resmi EAS. Kemudian:

```powershell
eas login
eas build:configure
eas build --platform android --profile development
```

Konfigurasikan profile `development` di `eas.json` dengan `developmentClient: true` dan `distribution: internal`. Contoh konfigurasi awal yang bisa disesuaikan:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true
    }
  }
}
```

Ikuti wizard/validasi EAS untuk menyetel package name, credentials, dan opsi CLI yang kompatibel dengan versi EAS aktif.

Setelah build selesai, unduh dan instal APK di perangkat Android. Untuk menjalankan JS bundler di mode development:

```powershell
npx expo start --dev-client
```

Catatan: command di atas adalah workflow generik; struktur proyek dan versi EAS Anda bisa menuntut penyesuaian kecil. Build native perlu diulang setelah native dependency atau konfigurasi native berubah. Perubahan TypeScript/JS biasa biasanya cukup dengan restart bundler/refresh.

## 6. Preview APK

Untuk menghasilkan APK internal yang dapat dipasang tanpa emulator, konfigurasikan profile `preview` di `eas.json` dengan `distribution: internal` dan `android.buildType: apk`. Kemudian jalankan:

```powershell
eas build --platform android --profile preview
```

Build produksi untuk Google Play umumnya memakai AAB. APK internal cocok untuk pengujian/pilot terbatas; gunakan AAB ketika workflow distribusi Play Store mengharuskannya. Periksa panduan EAS APK builds untuk format konfigurasi terbaru.

## 7. Fitur native jangan diuji hanya di Expo Go

Gunakan development build dan perangkat fisik untuk:

- background location / Android foreground service;
- permission background location;
- native map provider tertentu;
- WebRTC/voice PTT;
- audio background dan integrasi headset.

Perangkat vendor dapat menerapkan battery optimization secara berbeda. Tes perjalanan nyata dan catat model perangkat, Android version, jenis jaringan, serta perilaku permission.

## 8. Commands dan CI

```powershell
npm ci
npx expo start
npm run typecheck
npm run lint
npm run format:check
npm test
npm run doctor
npm run export:android
```

Jalankan perintah sesuai script yang benar-benar tersedia di `package.json`; jangan melaporkan sukses
bila command belum dijalankan.

### 8.1 CI (GitHub Actions)

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) menjalankan seluruh pemeriksaan di atas pada
push ke `main` dan setiap pull request. Job itu **tidak** memakai secret apa pun, jadi tidak ada yang
perlu dikonfigurasi untuk mulai memakainya.

Job kedua (`database-rls`) menjalankan `npm run db:test` dan hanya aktif lewat
**Actions → CI → Run workflow** dengan input `run_db_tests` dicentang. Sebelum mengaktifkannya:

1. Buat repository **development** khusus pengujian (jangan produksi).
2. Tambahkan secret **`DB_TEST_DATABASE_URL`** di **Settings → Secrets and variables → Actions**.
   Nilainya adalah connection string PostgreSQL project development dengan `?sslmode=require`.
3. Jalankan workflow secara manual dan periksa bahwa langkah uji lulus.

Jangan pernah menaruh connection string atau service role key di berkas repo, log, atau dokumentasi
publik; nilai itu hanya boleh berada di secret GitHub atau environment server.

## 9. Dokumentasi resmi

- Expo workflow: https://docs.expo.dev/workflow/overview/
- Development builds: https://docs.expo.dev/develop/development-builds/introduction/
- EAS APK: https://docs.expo.dev/build-reference/apk/
- Expo Location: https://docs.expo.dev/versions/latest/sdk/location/
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
