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

## 4. Hubungkan Supabase

1. Buat project development terpisah dari production.
2. Jalankan migration di `supabase/migrations/0001_initial_schema.sql` pada project development setelah review; jangan langsung menjalankannya pada database produksi.
3. Audit semua policy dan buat migrations lanjutan untuk Edge Functions, storage bucket, dan private Realtime channel.
4. Siapkan environment lokal, misalnya `.env.local`:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_CLIENT_KEY
EXPO_PUBLIC_MAP_STYLE_URL=https://YOUR_TILE_PROVIDER/STYLE.json
```

5. `.env.local` harus masuk `.gitignore`. Nilai `EXPO_PUBLIC_*` dimasukkan ke app bundle; isinya tidak boleh berupa secrets.
6. Jangan pernah menggunakan Supabase secret/service-role key pada aplikasi mobile. Key tersebut hanya untuk backend/Edge Functions.

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
