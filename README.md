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

## Status dan disclaimer

Dokumen ini adalah baseline desain, bukan sertifikasi keselamatan berkendara, audit keamanan, atau jaminan performa jaringan. Akurasi GPS, batasan background execution, latensi audio, biaya peta, dan aturan distribusi aplikasi harus divalidasi di perangkat dan layanan yang benar-benar dipakai. Semua threshold yang tertulis merupakan target awal yang dapat diubah setelah uji lapangan.
