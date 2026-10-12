# Setup Guide — Mulai Mengembangkan Tanpa Android Studio

Panduan ini untuk Windows + VS Code + HP Android fisik. Periksa kembali versi dan requirement pada dokumentasi resmi sebelum instalasi karena SDK dapat berubah.

## 1. Prasyarat

- Node.js versi LTS yang kompatibel dengan versi Expo yang dipakai.
- VS Code.
- Git.
- HP Android dengan internet.
- Akun Expo untuk cloud builds.
- Akun/project Supabase untuk backend.

Android Studio tidak dibutuhkan untuk membuat build melalui EAS cloud. Expo Go tetap berguna untuk UI/prototipe awal, tetapi background location dan native modules perlu development build.

## 2. Buat aplikasi Expo

Di PowerShell:

```powershell
npx create-expo-app@latest rodagroup-app
cd rodagroup-app
npx expo start
```

Untuk prototipe yang kompatibel, instal Expo Go di ponsel lalu scan QR code yang ditampilkan terminal. Jika router/template yang dipilih membuat QR flow berbeda, ikuti instruksi CLI pada versi yang terpasang.

## 3. Tambahkan quality tools

Pastikan repository menggunakan satu package manager dan commit lockfile. Tambahkan script lint/typecheck/test bertahap, bukan memasang semua library sekaligus. Sebelum memasang dependency native, baca dokumentasi kompatibilitasnya dengan Expo SDK aktif.

## 4. Hubungkan Supabase (langkah konkret Milestone 1)

Bagian ini adalah urutan yang sudah disesuaikan dengan kode di repo. Belum ada project Supabase yang terhubung saat dokumen ini diperbarui, jadi langkah di bawah **belum pernah dijalankan** dan harus Anda lakukan sendiri.

### 4.1 Buat project development

1. Masuk ke https://supabase.com/dashboard lalu buat project baru khusus pengembangan (jangan pakai project produksi).
2. Simpan database password di password manager; password itu tidak dipakai aplikasi mobile.
3. Catat region project agar latensi dari Indonesia wajar (mis. Singapore).

### 4.2 Ambil URL dan publishable key

1. Buka **Project Settings → API**.
2. Salin **Project URL** dan **publishable key** (project baru) atau **anon public** key (project lama).
3. Jangan pernah menyalin **service_role** key ke aplikasi; key itu hanya untuk backend/Edge Functions.

### 4.3 Jalankan migration

Di **SQL Editor**, jalankan berurutan dan periksa pesan error tiap langkah:

1. Tempel isi [`supabase/migrations/0001_initial_schema.sql`](../supabase/migrations/0001_initial_schema.sql) → **Run**.
2. Tempel isi [`supabase/migrations/0002_auth_profile_bootstrap.sql`](../supabase/migrations/0002_auth_profile_bootstrap.sql) → **Run**. Migration ini idempotent (`create or replace`, `drop trigger if exists`) sehingga aman dijalankan ulang, dan tidak menghapus data.
3. Verifikasi cepat: **Table Editor → profiles** harus ada, dan **Database → Triggers** pada skema `auth` menampilkan `on_auth_user_created`.

Migration 0001 **tidak diubah** pada Milestone 1. Semua penyesuaian ada di 0002 supaya project yang sudah terlanjur memakai 0001 tidak perlu di-reset.

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

1. Salin `.env.example` menjadi `.env.local` di root repo.
2. Isi nilainya:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_CLIENT_KEY
EXPO_PUBLIC_MAP_STYLE_URL=https://YOUR_TILE_PROVIDER/STYLE.json
```

3. `.env.local` sudah masuk `.gitignore`. Setiap variabel berprefix `EXPO_PUBLIC_` ikut masuk ke bundle aplikasi, jadi isinya tidak boleh berupa secret.
4. Restart Metro setelah mengubah `.env.local` (nilai di-inline saat build).

### 4.6 Jalankan uji RLS profil

Uji ini membuktikan user A tidak dapat membaca/mengubah profil privat user B, memakai dua akun uji di dalam satu transaksi yang berakhir `ROLLBACK`.

- **Cara cepat:** tempel seluruh isi [`supabase/tests/rls_profiles_test.sql`](../supabase/tests/rls_profiles_test.sql) ke SQL Editor → **Run**. Hasil lulus ditandai notice `UJI RLS PROFIL LULUS`. Jika ada `UJI GAGAL`, pesan menyebutkan asersi mana yang gagal.
- **Catatan:** perintah `set local role ...` hanya berlaku di dalam transaksi; pastikan seluruh berkas dijalankan sebagai satu blok, bukan baris per baris.
- Skrip tidak menyisakan pengguna uji karena diakhiri `rollback`.

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
- Perintah `supabase` CLI, `npm run db:test`, atau CI database: migration dijalankan manual lewat SQL Editor.

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

## 8. Commands yang disarankan untuk setiap milestone

```powershell
npx expo start
npx tsc --noEmit
npx expo-doctor
```

Jalankan perintah sesuai dependency/script yang benar-benar tersedia. Tambahkan lint dan test scripts di `package.json`; jangan laporkan sukses bila command belum dijalankan.

## 9. Dokumentasi resmi

- Expo workflow: https://docs.expo.dev/workflow/overview/
- Development builds: https://docs.expo.dev/develop/development-builds/introduction/
- EAS APK: https://docs.expo.dev/build-reference/apk/
- Expo Location: https://docs.expo.dev/versions/latest/sdk/location/
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
