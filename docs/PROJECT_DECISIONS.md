# Project Decision Log

Gunakan log ini untuk merekam keputusan yang mempengaruhi data, dependency native, biaya layanan, privasi, atau pengalaman inti.

| ID | Keputusan | Status | Alasan / catatan |
|---|---|---|---|
| ADR-001 | Nama kerja produk adalah RodaKawan | Sementara | Nama final belum dipilih; jangan mengunci identitas visual/domain. |
| ADR-002 | Mobile app memakai React Native + Expo + TypeScript | Disetujui awal | Sesuai rencana pengembangan tanpa Android Studio lokal. |
| ADR-003 | Android-first, desain tetap lintas platform | Usulan | Mengurangi kompleksitas rilis awal. Validasi kebutuhan iOS. |
| ADR-004 | Supabase menjadi backend awal | Usulan | Auth, Postgres, RLS, Realtime, Storage dan Edge Functions dalam satu ekosistem. |
| ADR-005 | Location-sharing hanya untuk ride aktif dan opt-in | Wajib | Meminimalkan kebocoran lokasi dan ambiguitas consent. |
| ADR-006 | Riwayat GPS permanen nonaktif secara default | Wajib | Privasi dan kontrol data. |
| ADR-007 | Voice PTT dan local music ditunda ke P2 | Usulan kuat | Native audio dan background complexity tidak boleh memblokir MVP. |
| ADR-008 | LiveKit dievaluasi untuk WebRTC PTT | Belum final | Butuh proof-of-concept, biaya, dan device/headset compatibility tests. |
| ADR-009 | Peta/tiles provider dipilih setelah uji biaya dan lisensi | Belum final | Hindari ketergantungan pada demo tiles atau quota yang tidak cocok untuk produksi. |

## Keputusan Milestone 0 (implementasi fondasi)

| ID | Keputusan | Status | Alasan / catatan |
|---|---|---|---|
| ADR-010 | Expo SDK 57 (React Native 0.86.3, React 19.2.3) + TypeScript strict, Branch default `npm`, Node ≥ 22.13 | Disetujui | Mengikuti template resmi SDK 57. Rute Expo Router diletakkan di `src/app` sesuai struktur aplikasi pada ARCHITECTURE.md bagian 3. |
| ADR-011 | `react-native-reanimated` 4.5.1 dan `react-native-worklets` 0.10.1 dipasang eksplisit (versi SDK 57) | Disetujui | Keduanya dibutuhkan transitif oleh expo-router. Tanpa pin versi, npm menarik 4.7.1/0.13.0 yang tidak cocok dengan `expo-modules-core` SDK 57 dan membuat layar gagal dirender. |
| ADR-012 | `react-dom` 19.2.3 dipin sebagai dependency | Disetujui | Peer wajib `@radix-ui/*` yang dibawa expo-router; versinya harus sama dengan React yang dipin Expo agar resolusi npm tidak konflik. Target produk tetap Android-first dan web tidak diaktifkan (`platforms: ["android", "ios"]`). |
| ADR-013 | Header layar dibuat sendiri (`ScreenHeader`) alih-alih header native stack | Disetujui | Warna/tipografi mengikuti design system dan menghindari permukaan native tambahan sebelum milestone navigasi peta. Perilaku kembali memakai `router.back()`. |
| ADR-014 | Pengujian: `jest-expo` (preset Android) + `@testing-library/react-native` 14; plugin `react-native-worklets/plugin` dimatikan pada `NODE_ENV=test` | Disetujui | `render` RTL 14 bersifat asynchronous dan plugin worklets menyuntikkan pemeriksaan Reanimated yang gagal di Jest. Konfigurasi build Metro/APK tidak berubah. |
| ADR-015 | Nama paket Android `com.rodakawan.app` | Sementara | Wajib diganti sebelum rilis Play Store bila identitas final berbeda; penggantian setelah dirilis Google Play berarti identitas aplikasi baru. |
| ADR-016 | Aset ikon/splash dibuat dari kode (`scripts/generate-assets.mjs`) | Sementara | Memudahkan regenerasi saat identitas visual (ADR-001) final; tidak ada dependency gambar tambahan. |

## Keputusan Milestone 1 (auth, profil, privasi dasar)

| ID | Keputusan | Status | Alasan / catatan |
|---|---|---|---|
| ADR-017 | `@supabase/supabase-js` 2.x dipakai apa adanya (bukan `@supabase/ssr`) dengan **satu** client di `src/lib/supabase/client.ts` | Disetujui | Target hanya Android/iOS (native), bukan web. Client dibuat lazy agar impor tidak crash saat env belum diisi, dan hanya ada satu instance supaya listener auth tidak ganda. |
| ADR-018 | Session disimpan dengan `expo-sqlite/localStorage/install` (tanpa `AsyncStorage`), opsi `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false`, `flowType: 'pkce'` | Disetujui | Pola resmi Supabase untuk React Native. `detectSessionInUrl` dimatikan karena aplikasi native tidak menerima session dari URL halaman; callback email ditangani manual lewat deep link (ADR-021). `AsyncStorage` tidak dipasang karena `expo-sqlite` sudah menyediakan `localStorage`, sehingga session tidak butuh dependency kedua. |
| ADR-019 | Proteksi rute memakai `Stack.Protected` di `src/app/_layout.tsx` (rute privat hanya terdaftar bila ada sesi, grup `(auth)` hanya bila tidak ada sesi), plus gerbang `<Redirect>` di `src/app/index.tsx`; tidak memakai `useEffect`/`router.replace` | Disetujui | Menghindari redirect loop dan frame layar privat yang sempat terlihat saat session dipulihkan: rute privat tidak pernah dirender tanpa sesi, bukan sekadar dialihkan setelahnya. Ini hanya lapisan navigasi klien; otorisasi data tetap RLS. |
| ADR-020 | Profil dibuat oleh trigger `on_auth_user_created` (`after insert on auth.users`) yang memanggil fungsi `public.bootstrap_profile()` (`SECURITY DEFINER`, `set search_path = ''`, `execute` dicabut dari `public`) pada migration `20261013023038_auth_profile_bootstrap.sql` | Disetujui | Identitas berasal dari `NEW.id` di `auth.users`, bukan dari payload klien. Unique index username tetap menjadi otoritas keunikan; bila username bentrok/tidak valid, profil tetap dibuat dengan `rider_<acak>` (ADR-021). |
| ADR-021 | Username yang bentrok saat registrasi memakai username sementara berawalan `rider_`, bukan menggagalkan pendaftaran | Disetujui | Supabase Auth tidak bisa mengembalikan error unik dari database publik. Tidak ada kolom penanda di database: aplikasi mendeteksi awalan `rider_` lewat `isGeneratedUsername()` (`src/features/profile/validation.ts`), memblokir pengguna memilih awalan itu, dan menampilkan banner agar username diganti. |
| ADR-022 | Alur email (konfirmasi, reset password) memakai deep link `rodakawan://auth/callback` dan layar `/reset-password` dengan `linkParams.ts` untuk mem-parse token PKCE/`access_token` | Disetujui | Diperlukan untuk Android tanpa server web. Token dari URL tidak pernah ditulis ke log. |
| ADR-023 | **Belum ada** upload avatar; tidak ada tombol/fungsi upload palsu | Disetujui | Bucket Storage dan policy belum ada (Milestone 2). Struktur profil sudah siap menampung `avatar_url` tanpa perubahan schema. |
| ADR-024 | Test fitur auth/profil memakai fake client (`src/test-support/fakeSupabase.ts`) yang **disuntikkan sebagai argumen** ke fungsi api; test navigasi memakai `jest.mock` pada `@/lib/supabase/client` dan modul api | Disetujui | Karena setiap fungsi api menerima client sebagai parameter, test tidak perlu mengganti modul untuk sebagian besar kasus. Test tetap deterministik dan tidak menyentuh jaringan; RLS tetap diuji terpisah lewat SQL. |
| ADR-025 | Plugin `expo-sqlite` dibuat no-op khusus Jest (`src/test-support/sqliteLocalStorageShim.js`) | Disetujui | `expo-sqlite` memanggil native module saat impor sehingga Jest gagal sebelum test berjalan. Konfigurasi runtime aplikasi tidak berubah. |

## Keputusan Milestone 1.5 (verifikasi, hardening, CI)

| ID | Keputusan | Status | Alasan / catatan |
|---|---|---|---|
| ADR-026 | Auto-refresh token diselaraskan dengan `AppState` **setelah** `client.auth.initialize()` selesai, listener dikembalikan sebagai fungsi pembersih, dan promise `startAutoRefresh()`/`stopAutoRefresh()` selalu di-`catch` | Disetujui | `auth-js` menyalakan ticker sendiri saat client dibuat di lingkungan non-browser (`_handleVisibilityChange()` menganggap React Native selalu foreground) **setelah** pemulihan session. Menyesuaikan sebelum itu tidak berpengaruh, jadi ticker bisa tetap berjalan saat aplikasi di background. Kebersihan listener dan penanganan promise mencegah handler ganda dan unhandled rejection. Diuji di `src/lib/__tests__/supabaseClient.test.ts`. |
| ADR-027 | Uji RLS dijalankan lewat runner Node `npm run db:test` dengan devDependency `pg`, membaca `DATABASE_URL` dari environment | Disetujui | Tidak butuh pemasangan `psql` di Windows/CI, dan tidak menaruh password di baris perintah proses (berbeda dari `psql "$DATABASE_URL"`). Runner hanya melaporkan lulus bila notice penanda dari server diterima, sehingga berkas yang terpotong tidak bisa menghasilkan "hijau palsu". `pg` hanya dipakai script Node dan tidak pernah masuk bundel aplikasi. |
| ADR-028 | CI dipecah menjadi job `quality` (tanpa secret, berjalan pada push/PR) dan job `database-rls` (hanya `workflow_dispatch` + secret `DB_TEST_DATABASE_URL`) | Disetujui | Unit test dan bundel harus lulus tanpa backend, jadi tidak ada alasan memberi CI akses database. Uji integrasi RLS dipisahkan agar database development tidak tersentuh oleh push/PR biasa dan tidak pernah memakai kredensial produksi. |
| ADR-029 | Uji RLS ditambah kontrol positif (profil publik user B **harus** terbaca user A), penolakan `DELETE`, dan penolakan `INSERT`/`UPDATE` oleh `anon` | Disetujui | Tanpa kontrol positif, asersi "tidak membaca profil privat" bisa lulus walaupun policy `SELECT` salah total. `DELETE` dan penulisan oleh `anon` sebelumnya tidak diuji walaupun tidak ada policy-nya. RLS tetap tidak dilonggarkan. |
| ADR-030 | Grant pada `public.profiles` dibiarkan seperti default Supabase (tidak ada policy `to authenticated` untuk `anon`, dan `REVOKE DELETE` tidak ditambahkan pada migration ini) | Disetujui | RLS sudah menolak semua operasi tanpa policy yang cocok, jadi tidak ada celah yang perlu ditutup sekarang. Pembatasan grant menyeluruh direncanakan sebagai pekerjaan tersendiri di catatan akhir migration awal, agar tidak ada perubahan hak akses yang tersembunyi di milestone ini. |

## Keputusan Milestone 1.5 lanjutan (adopsi Supabase CLI)

| ID | Keputusan | Status | Alasan / catatan |
|---|---|---|---|
| ADR-031 | Berkas migration dinamai ulang mengikuti konvensi CLI: `0001_initial_schema.sql` → `20261013022938_initial_schema.sql` dan `0002_auth_profile_bootstrap.sql` → `20261013023038_auth_profile_bootstrap.sql` | Disetujui | CLI memakai awalan versi sebagai identitas migration. Karena **belum ada** migration yang diterapkan di database mana pun saat penamaan ulang dilakukan, tidak ada riwayat remote yang perlu diperbaiki (`migration repair` tidak diperlukan). Setelah ini, penomoran ulang migration yang sudah diterapkan harus disertai `migration repair`. |
| ADR-032 | Connection string CLI dibaca dari berkas `.env.db` yang diabaikan Git, dan **bukan** dari `.env`/`.env.local` | Disetujui | `.env` dan `.env.local` dibaca Expo, sehingga variabel `EXPO_PUBLIC_*` di dalamnya masuk ke bundel aplikasi. `.env.db` tidak dibaca Expo, jadi password database tidak pernah ikut ke bundel, `npm run db:test` (dan perintah CLI) dapat membacanya otomatis, dan nilainya tidak perlu muncul di baris perintah proses. |
| ADR-033 | Project development memakai database bersih yang terpisah dari project lama | Disetujui | Project yang terkonfigurasi sebelumnya berisi tabel `profiles` buatan tangan (hanya `id`, `username`, `role`, `created_at`) tanpa objek lain dari migration awal. `CREATE TABLE IF NOT EXISTS` akan melewatinya secara diam-diam lalu gagal di policy yang menyebut `is_private`, sehingga migration tidak boleh dijalankan di atas project itu. |
| ADR-034 | Connection string untuk CLI dan `npm run db:test` memakai host **session pooler** (`aws-0-<region>.pooler.supabase.com`, user `postgres.<ref>`) dengan `sslmode=require`, dan runner `db-test.mjs` menerapkan `require` dengan semantik libpq (enkripsi aktif, CA tidak diverifikasi) | Disetujui | Host langsung `db.<ref>.supabase.co` hanya punya record AAAA (tanpa IPv4) sehingga `npm run db:test` gagal `ENOTFOUND` sebelum sempat menguji apa pun. Sejak `pg-connection-string` 2.14, `node-postgres` memetakan `sslmode=require` ke `verify-full`, sedangkan pooler Supabase memakai CA internal → `SELF_SIGNED_CERT_IN_CHAIN`. Nilai `require` tetap standar sehingga satu URL yang sama bisa dipakai `npx supabase --db-url` dan `psql`, sementara terjemahannya ke opsi client hanya ada di runner (dan dicetak sebagai catatan satu baris agar penurunan verifikasi itu tidak tersembunyi). `sslmode=verify-full` tetap tersedia bila CA project dipasang lewat `sslrootcert`. |
| ADR-035 | Project development RodaKawan dibuat terpisah (region Singapore) dan kedua migration diterapkan ke sana lewat CLI; `public.profiles` di project itu kini benar-benar tabel buatan migration | Disetujui | Project lama dipakai bersama aplikasi lain dan `public.profiles`-nya berbeda (ADR-033), sehingga uji RLS tidak mungkin lulus di sana — `bootstrap_profile()` gagal `42703 column "display_name" does not exist`. Setelah pindah, seluruh skema terverifikasi (18 tabel, 51 policy, 9 kolom `profiles`, RLS aktif di semua tabel, trigger `on_auth_user_created` dan `profiles_touch_updated_at`) dan `npm run db:test` lulus dengan notice `UJI RLS PROFIL LULUS`. Project ref dan kredensial hanya berada di `.env`/`.env.db` (diabaikan Git) dan di `supabase/.temp/`, bukan di dokumen ini. |

## Template keputusan baru

- **ID:** ADR-XXX
- **Tanggal:** YYYY-MM-DD
- **Status:** Proposed / Accepted / Rejected / Superseded
- **Konteks:** Masalah yang perlu diputuskan.
- **Pilihan:** Alternatif realistis.
- **Keputusan:** Pilihan yang diambil.
- **Konsekuensi:** Trade-off, biaya, risiko, migration plan.
- **Referensi:** Dokumentasi/hasil benchmark relevan.
