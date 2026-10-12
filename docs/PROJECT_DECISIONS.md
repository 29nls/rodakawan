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
| ADR-018 | Session disimpan dengan `expo-sqlite/localStorage/install` + `AsyncStorage`, opsi `persistSession`, `autoRefreshToken`, `detectSessionInUrl: false` | Disetujui | Pola resmi Supabase untuk React Native. `detectSessionInUrl` dimatikan karena aplikasi native tidak menerima session dari URL halaman; callback email ditangani manual lewat deep link (ADR-021). |
| ADR-019 | Proteksi rute memakai `<Redirect>` di dalam `src/app/(auth)/_layout.tsx` dan `src/app/(tabs)/_layout.tsx`, bukan `useEffect`/`router.replace` | Disetujui | Menghindari redirect loop dan frame layar privat yang sempat terlihat saat session dipulihkan. Ini hanya kenyamanan navigasi; otorisasi data tetap RLS. |
| ADR-020 | Profil dibuat oleh trigger database `handle_new_user` (`SECURITY DEFINER`, `search_path` dipin, hak minimum) pada migration `0002_auth_profile_bootstrap.sql` | Disetujui | Identitas berasal dari `NEW.id` di `auth.users`, bukan dari payload klien. Tidak ada endpoint aplikasi yang boleh membuat/mengganti baris profil. Unique index username tetap menjadi otoritas keunikan. |
| ADR-021 | Username yang bentrok saat registrasi memakai username sementara berawalan `rider_`, bukan menggagalkan pendaftaran | Disetujui | Supabase Auth tidak bisa mengembalikan error unik dari database publik. Aplikasi menandai `profile.username_is_placeholder` dan menampilkan banner di tab Profil supaya pengguna menggantinya. |
| ADR-022 | Alur email (konfirmasi, reset password) memakai deep link `rodakawan://auth/callback` dan layar `/reset-password` dengan `linkParams.ts` untuk mem-parse token PKCE/`access_token` | Disetujui | Diperlukan untuk Android tanpa server web. Token dari URL tidak pernah ditulis ke log. |
| ADR-023 | **Belum ada** upload avatar; tidak ada tombol/fungsi upload palsu | Disetujui | Bucket Storage dan policy belum ada (Milestone 2). Struktur profil sudah siap menampung `avatar_url` tanpa perubahan schema. |
| ADR-024 | Test fitur auth/profil memakai fake client (`src/test-support/fakeSupabase.ts`) yang menggantikan `src/lib/supabase/client.ts` lewat `moduleNameMapper` | Disetujui | Test tetap deterministik dan tidak menyentuh jaringan. Fake hanya meniru permukaan yang dipakai aplikasi; RLS tetap diuji terpisah lewat SQL. |
| ADR-025 | Plugin `expo-sqlite` dibuat no-op khusus Jest (`src/test-support/sqliteLocalStorageShim.js`) | Disetujui | `expo-sqlite` memanggil native module saat impor sehingga Jest gagal sebelum test berjalan. Konfigurasi runtime aplikasi tidak berubah. |

## Template keputusan baru

- **ID:** ADR-XXX
- **Tanggal:** YYYY-MM-DD
- **Status:** Proposed / Accepted / Rejected / Superseded
- **Konteks:** Masalah yang perlu diputuskan.
- **Pilihan:** Alternatif realistis.
- **Keputusan:** Pilihan yang diambil.
- **Konsekuensi:** Trade-off, biaya, risiko, migration plan.
- **Referensi:** Dokumentasi/hasil benchmark relevan.
