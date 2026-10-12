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

## Template keputusan baru

- **ID:** ADR-XXX
- **Tanggal:** YYYY-MM-DD
- **Status:** Proposed / Accepted / Rejected / Superseded
- **Konteks:** Masalah yang perlu diputuskan.
- **Pilihan:** Alternatif realistis.
- **Keputusan:** Pilihan yang diambil.
- **Konsekuensi:** Trade-off, biaya, risiko, migration plan.
- **Referensi:** Dokumentasi/hasil benchmark relevan.
