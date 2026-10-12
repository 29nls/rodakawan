# RodaKawan — Paket Dokumentasi Produk

> **Nama kerja:** RodaKawan. Nama, logo, domain, dan identitas visual belum final.  
> **Versi dokumen:** 1.0 · **Tanggal:** 12 Oktober 2026 · **Status:** Draft untuk validasi dan implementasi bertahap.

RodaKawan adalah aplikasi pendamping berkendara untuk komunitas motor, klub sepeda, dan pecinta touring. Paket ini disusun sebagai acuan produk dan teknis untuk membangun aplikasi Android menggunakan **React Native + Expo + TypeScript**, dengan **Supabase** sebagai backend awal.

## Daftar dokumen

| File | Kegunaan |
|---|---|
| `docs/PRD.md` | Sasaran produk, pengguna, kebutuhan, ruang lingkup, requirement, acceptance criteria, risiko. |
| `docs/ARCHITECTURE.md` | Arsitektur aplikasi, pilihan teknologi, alur data, batasan native dan build. |
| `docs/UX_SITEMAP.md` | Sitemap, layar utama, alur pengguna, prinsip desain berkendara aman. |
| `docs/DATA_AND_REALTIME.md` | Data model konseptual, event realtime, kontrak layanan, dan aturan lokasi. |
| `docs/SECURITY_PRIVACY.md` | RLS, privasi lokasi, moderasi, retensi, izin perangkat, threat model. |
| `docs/ROADMAP.md` | Milestone implementasi, urutan pekerjaan, dan definisi selesai. |
| `docs/QA_TEST_PLAN.md` | Strategi pengujian, skenario penerimaan, uji perangkat dan kondisi jaringan. |
| `docs/AI_CODING_AGENT_PROMPT.md` | Prompt utama untuk coding agent dan aturan kerja per milestone. |
| `docs/ERD.md` | Diagram konseptual entitas dan hubungan data. |
| `docs/SETUP_GUIDE.md` | Setup VS Code, Expo, Supabase, dan build APK cloud tanpa Android Studio. |
| `supabase/migrations/0001_initial_schema.sql` | Fondasi skema PostgreSQL/Supabase untuk MVP. Perlu review dan pengujian sebelum produksi. |

## Keputusan awal

- Fokus rilis awal: **Android terlebih dahulu**, dengan struktur yang tidak menutup kemungkinan iOS.
- Pengembangan dilakukan melalui VS Code dan perangkat Android fisik. Android Studio tidak diwajibkan jika development build dibuat di cloud melalui Expo EAS Build.
- Expo Go digunakan hanya untuk prototipe yang kompatibel. Background location, peta native tertentu, dan voice room harus diuji dalam **development build**.
- Backend awal: Supabase Auth, PostgreSQL, Row Level Security (RLS), Realtime, Storage, dan Edge Functions.
- Live location dibagikan hanya saat pengguna menjadi peserta perjalanan aktif. Posisi terkini boleh disimpan singkat untuk pemulihan koneksi; histori perjalanan permanen tidak aktif secara default.
- Fitur PTT/voice room menggunakan layanan WebRTC khusus (rekomendasi untuk proof-of-concept: LiveKit). Supabase Realtime bukan transport audio.
- Fitur disusun bertahap. Jangan membangun tracking background, voice room, feed sosial, musik lokal, dan seluruh administrasi sekaligus.

## Cara menggunakan paket ini

1. Baca `docs/PRD.md` dan pastikan keputusan produk sementara dipahami.
2. Baca `docs/ARCHITECTURE.md` sebelum memilih dependency native.
3. Buat repository, lalu salin dokumen ini ke folder `docs/` agar menjadi sumber kebenaran proyek; pertahankan struktur folder `docs/` dan `supabase/`.
4. Implementasikan satu milestone dari `docs/ROADMAP.md` pada satu waktu.
5. Jalankan acceptance test dalam `docs/QA_TEST_PLAN.md` dan uji RLS sebelum menambah pengguna sungguhan.
6. Jangan pernah memasukkan secret/service-role key ke kode aplikasi mobile.

## Aplikasi (Milestone 0 + 1)

Repositori ini kini berisi aplikasi **React Native + Expo + TypeScript** di root, dengan `docs/` tetap menjadi sumber kebenaran produk.

Yang sudah ada: struktur Expo Router (`src/app`), design system gelap (charcoal + amber), komponen UI dasar, error boundary dan state primitives, konfigurasi lingkungan tanpa secret, profil build EAS, serta **vertical slice autentikasi + profil** (Milestone 1): daftar, login, logout, lupa/reset password, konfirmasi email, session persistence, dan baca/ubah profil sendiri. Fitur produk berikutnya (garasi, klub, perjalanan, live location, chat, laporan jalan, feed, musik) **belum** dibangun dan sengaja tidak ditampilkan sebagai tombol yang berfungsi.

> **Status verifikasi Milestone 1:** seluruh kode, migration, dan automated test lulus secara lokal. Alur ke Supabase **belum pernah diuji** karena belum ada project/credential. Lihat bagian *Uji autentikasi dengan backend nyata* di bawah.

### Prasyarat

- Node.js 22.13 atau lebih baru (disarankan 24.3+; pengembangan ini memakai Node 24.18).
- npm sebagai satu-satunya package manager (lockfile `package-lock.json` di-commit).
- Untuk mencoba di HP Android: aplikasi **Expo Go** (prototipe) atau APK development build.
- Android Studio tidak diperlukan; APK dibuat di cloud dengan EAS Build.

### Perintah utama (PowerShell)

```powershell
npm install                 # pasang dependency sesuai lockfile
npx expo start              # jalankan Metro; pindai QR dengan Expo Go
npm run typecheck           # TypeScript strict tanpa emit
npm run lint                # ESLint (eslint-config-expo + Prettier)
npm run format              # rapikan format dengan Prettier
npm test                    # unit test (jest-expo)
npm run doctor              # pemeriksaan kesehatan project
npm run export:android      # verifikasi bundel Android tanpa perangkat
```

Catatan: tipe rute Expo Router dihasilkan saat `npx expo start` pertama kali dijalankan ke folder `.expo/types`. Pada clone baru, jalankan dev server sekali sebelum `npm run typecheck`.

### Konfigurasi lingkungan

1. Salin `.env.example` menjadi `.env.local`.
2. Isi `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, dan `EXPO_PUBLIC_MAP_STYLE_URL` setelah project development tersedia.
3. `.env.local` diabaikan Git. Hanya variabel `EXPO_PUBLIC_*` yang masuk ke bundle aplikasi; jangan pernah menaruh service role key, database password, LiveKit secret, atau token admin di sana.

Tanpa `EXPO_PUBLIC_SUPABASE_URL` dan `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, aplikasi tetap terbuka: layar autentikasi menampilkan banner "konfigurasi belum tersedia", tombol kirim dinonaktifkan, dan tidak ada request jaringan yang dikirim. Aplikasi tidak crash dan tidak menampilkan nilai key apa pun.

Langkah lengkap membuat project Supabase, menjalankan migration, dan mengatur URL konfirmasi email ada di [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md).

### Build APK Android tanpa Android Studio

```powershell
npx eas-cli@latest login                                       # masuk ke akun Expo
npx eas-cli@latest init                                        # menulis projectId EAS ke app.json
npx eas-cli@latest build --platform android --profile preview  # APK internal untuk pengujian
npx eas-cli@latest build --platform android --profile development  # development build (expo-dev-client)
```

Profil `development` wajib dipakai untuk fitur native (background location, peta native, WebRTC) karena Expo Go tidak mendukungnya. Ubah nama paket Android (`com.rodakawan.app` di `app.json`) sebelum rilis ke Play Store bila identitas final berbeda.

### Aset ikon

Ikon, adaptive icon, dan splash mark dibuat dari kode tanpa dependency tambahan:

```powershell
npm run assets:generate
```

### Catatan pengujian

- `npm test` memakai `jest-expo` preset Android dan `@testing-library/react-native` 14.
- Pada RTL 14 `render`, `fireEvent`, dan `renderRouter` bersifat **asynchronous** — selalu `await` sebelum melakukan assertion.
- Plugin `react-native-worklets/plugin` dimatikan khusus pada lingkungan test melalui `babel.config.js` (plugin itu menyuntikkan pemeriksaan Reanimated yang membutuhkan native worklets). Pada build Metro/APK plugin tetap aktif.
- Test navigasi menjalankan rute asli dari `src/app` (bukan mock) sehingga perubahan nama tab atau penambahan route akan terdeteksi.
- Uji fitur auth/profil tidak menyentuh jaringan: fungsi api menerima client sebagai argumen sehingga test menyuntikkan fake client dari `src/test-support/fakeSupabase.ts`, sedangkan test navigasi melakukan `jest.mock` pada `@/lib/supabase/client` dan modul api. `moduleNameMapper` di `jest.config.js` hanya mengganti `expo-sqlite/localStorage/install` dengan shim.
- Uji `src/lib/crypto/__tests__/webcrypto.test.ts` memakai nilai vektor tetap; tidak memanggil native module.
- Shim itu hanya berlaku di Jest; di aplikasi nyata `expo-sqlite` tetap menjadi penyimpanan session.

### Struktur proyek

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
  lib/          # env.ts (konfigurasi publik + validasi), supabase/client.ts
  services/     # appInfo.ts (metadata build)
  types/        # deklarasi tipe lingkungan
  utils/        # color.ts (kontras WCAG)
assets/         # ikon & splash
scripts/        # generator aset
docs/           # sumber kebenaran produk
supabase/
  migrations/   # 0001_initial_schema.sql, 0002_auth_profile_bootstrap.sql
  tests/        # rls_profiles_test.sql (uji RLS dua akun)
```

### Autentikasi dan profil (Milestone 1)

- **Client:** satu instance Supabase di `src/lib/supabase/client.ts`, dibuat lazy. Session disimpan lewat `expo-sqlite/localStorage/install` dengan `persistSession`, `autoRefreshToken`, `flowType: 'pkce'`, dan `detectSessionInUrl: false` (aplikasi native, bukan web). Auto-refresh dihentikan saat aplikasi tidak di depan.
- **PKCE di Hermes:** `expo-crypto` dipasang dan `src/lib/crypto/webcrypto.ts` menyediakan `crypto.getRandomValues`/`TextEncoder`/`btoa` yang belum ada di Hermes; tanpa itu alur PKCE gagal dengan error kripto.
- **Proteksi rute:** [src/app/_layout.tsx](src/app/_layout.tsx) memakai `Stack.Protected` — rute privat hanya terdaftar bila sesi sudah diperiksa dan valid, dan grup `(auth)` hanya bila belum ada sesi. [src/app/index.tsx](src/app/index.tsx) adalah gerbang awal: menampilkan loading selama sesi diperiksa, lalu `<Redirect>` ke `/ringkasan` atau `/sign-in`. Tidak ada redirect berbasis `useEffect`, jadi tidak ada redirect loop. Proteksi ini hanya lapisan navigasi klien — otorisasi data tetap milik RLS di database.
- **Profil:** `public.profiles` dibuat otomatis oleh trigger `on_auth_user_created` yang memanggil fungsi `bootstrap_profile()` (migration 0002), memakai `NEW.id` dari `auth.users` — bukan identitas yang dikirim klien. Username dinormalisasi (huruf kecil, `_`), divalidasi, dan keunikannya dijaga unique index. Bila username bentrok, trigger memakai username sementara `rider_xxxxxx` dan aplikasi menampilkan banner untuk menggantinya.
- **Belum ada:** upload avatar (menunggu bucket Storage + policy), ubah email/password dari dalam aplikasi.

### Uji autentikasi dengan backend nyata

Setelah `.env.local` terisi, jalankan alur berikut di perangkat/emulator:

1. `npx expo start` lalu buka aplikasi.
2. Daftar akun baru → cek email konfirmasi → buka tautan → masuk.
3. Login, buka tab **Profil**, ubah nama tampilan/username/kota/bio, simpan, muat ulang aplikasi.
4. Coba daftarkan username yang sudah dipakai; harus muncul pesan yang jelas, bukan crash.
5. Logout; pastikan tab privat tidak bisa dibuka kembali lewat tautan langsung.
6. Kirim permintaan reset password dari layar **Lupa password** dan selesaikan alurnya.

Jalankan juga uji RLS di SQL Editor (langkah 4.6 di [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md)) untuk memastikan user A tidak dapat membaca atau mengubah profil user B.

### Aturan branch dan commit

- `main` harus selalu dapat dijalankan: `npm run typecheck` dan `npm test` hijau sebelum merge.
- Satu milestone per branch, mis. `feat/m1-auth-profil`, `fix/m2-join-klub`, `chore/perbarui-eas`.
- Commit mengikuti Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`), satu perubahan logis per commit.
- Bila keputusan teknis berubah, perbarui juga `docs/PROJECT_DECISIONS.md` dan dokumen terkait pada commit yang sama.

## Status dan disclaimer

Dokumen ini adalah baseline desain, bukan sertifikasi keselamatan berkendara, audit keamanan, atau jaminan performa jaringan. Akurasi GPS, batasan background execution, latensi audio, biaya peta, dan aturan distribusi aplikasi harus divalidasi di perangkat dan layanan yang benar-benar dipakai. Semua threshold yang tertulis merupakan target awal yang dapat diubah setelah uji lapangan.
