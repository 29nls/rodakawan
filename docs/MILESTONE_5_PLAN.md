# Rencana Milestone 5 — Push, polish, dan beta

Status: **rencana saja (belum ada implementasi M5 di repository).** Ditulis 22 Oktober 2026 setelah
Milestone 4 dinyatakan **lulus di backend** (Database RLS run #19, commit `1aa1480` — 7 berkas uji,
7 lulus) dan **belum lulus di perangkat** (lihat `docs/QA_TEST_PLAN.md` bagian 8a dan 8d).

Dokumen ini tidak mengulang lingkup lama. Sumber kebenaran produk tetap
[`docs/PRD.md`](PRD.md) (FR-09, PRD §12) dan urutan milestone tetap di
[`docs/ROADMAP.md`](ROADMAP.md).

## 1. Titik awal yang sebenarnya

| Bukti | Status |
| --- | --- |
| SQL RLS/RPC M4 (hazard, chat, moderasi, filter blokir) | **Lulus terhadap backend development** — Database RLS #19 |
| `npm run db:test` di mesin lokal | **Gagal** — `.env.db` menunjuk `localhost`, `ECONNREFUSED` (0 lulus, 7 tidak dijalankan) |
| UI hazard/chat, realtime dua perangkat, moderasi dengan akun nyata | **Belum** — daftar periksa di QA_TEST_PLAN 8d |
| Klien notifikasi (`expo-notifications`), crash reporting, kebijakan privasi, hapus akun | **Belum ada di repository** |

Artinya: M5 tidak boleh dimulai dengan menganggap M4 tuntas. Yang boleh dimulai adalah pekerjaan yang
**tidak** bergantung pada hasil uji perangkat M4.

## 2. Urutan prioritas

| Prioritas | Item M5 | Butuh pihak ketiga? | Catatan ketergantungan |
| --- | --- | --- | --- |
| P0 | **Hapus akun + kebijakan privasi + kontak dukungan** | Tidak | Wajib untuk aplikasi berakun di Play Store; butuh keputusan produk soal `on delete restrict` (lihat §4) |
| P0 | **Loading/offline/error/empty state yang konsisten** | Tidak | Bisa dikerjakan per layar tanpa menambah dependency; sebaiknya menunggu temuan uji perangkat M4 |
| P0 | **Checklist keamanan & rilis beta** | Tidak | Menutup butir yang masih terbuka di `docs/SECURITY_PRIVACY.md` §9 |
| P1 | **Push notification** (undangan, perubahan status perjalanan, pesan konvoi) | **Ya** — kredensial push (FCM) + `expo-notifications` | Menambah modul native → butuh APK baru; harus diputuskan setelah uji perangkat M4 |
| P1 | **Kategori & preferensi notifikasi** | Tidak (mengikuti P1 di atas) | Butuh tabel preferensi + RLS uji sendiri |
| P1 | **Crash/error monitoring tanpa lokasi presisi** | **Ya** — layanan monitoring | Harus menyaring properti lokasi sebelum dikirim |
| P2 | **Android device matrix + accessibility pass** | Tidak | Butuh perangkat nyata; jadwalkan bersama uji perangkat M4 |

Alasan urutannya: dua item P0 pertama tidak menambah dependency, tidak menambah izin Android, dan
tidak bergantung pada keputusan vendor — jadi bisa jalan sementara uji perangkat M4 masih terbuka.
Push dan crash monitoring **ditunda** karena keduanya menambah modul native (APK baru) atau layanan
pihak ketiga, dan akan lebih murah dikerjakan setelah M4 terbukti di perangkat.

## 3. Yang tetap ditunda (Milestone 3)

Jangan dikerjakan di M5 dan jangan dicatat lulus:

- pemilihan final provider/renderer peta (ADR-064 masih **Proposed**);
- uji live-location dua perangkat khusus;
- izin lokasi ditolak, GPS mati, force-stop, reboot;
- uji baterai/jaringan 30 menit.

M5 **tidak boleh** menambah dependency peta native atau memilih provider berbayar. Layar yang
membutuhkan peta tetap menyatakan "peta belum tersedia" dan menampilkan daftar posisi.

## 4. Irisan vertikal pertama yang dipilih

**Hapus akun (permintaan + pelaksanaan) dengan kebijakan retensi yang eksplisit.**

Alasan memilih ini, bukan push notification:

1. Ini syarat kebijakan Play Store untuk aplikasi berakun dan syarat rilis beta, sehingga tidak bisa
   ditunda sampai setelah beta.
2. Seluruhnya bisa dikerjakan dengan stack yang sudah ada (RPC + layar + uji SQL), tanpa vendor baru,
   tanpa izin Android baru, dan tanpa APK native tambahan.
3. Ia menyentuh invarian keamanan yang sudah ada (`security definer`, `search_path = ''`, grant hanya
   `authenticated`, audit) sehingga bisa diuji dengan pola yang sama seperti M4.

**Keputusan produk yang dibutuhkan lebih dulu** (jangan diputuskan sendiri oleh implementasi):
`public.hazard_reports.reporter_id` memakai `on delete restrict` ke `public.profiles`, begitu pula
relasi kepemilikan lain. Hard delete profil karena itu akan gagal atau memaksa menghapus riwayat
keselamatan orang lain. Pilihan yang perlu disetujui:

- **A. Anonimisasi** — profil ditandai terhapus, data pribadi (`username`, `display_name`,
  `avatar_url`, detail privat kendaraan, foto) dihapus/dinullkan, konten publik dipertahankan tanpa
  identitas. Riwayat laporan bahaya tetap sah untuk keselamatan pengguna lain.
- **B. Hard delete berantai** — semua konten pengguna ikut terhapus, termasuk laporan bahaya dan pesan
  konvoi yang mungkin masih dibaca peserta lain.

Rekomendasi: **A**, karena laporan bahaya adalah data keselamatan bersama dan `content_reports`/
`moderation_actions` adalah jejak audit yang tidak boleh hilang.

**Cakupan irisan (kecil dan bisa direview):**

1. Migration baru (aditif, satu berkas): kolom penanda `deleted_at` pada `profiles` bila memilih A,
   RPC `delete_my_account()` — `security definer`, `search_path = ''`, identitas dari `auth.uid()`,
   idempoten (panggilan kedua tidak gagal), dan pencabutan akses Storage atas objek milik pengguna.
2. Satu layar: `src/app/account-delete.tsx` dengan penjelasan konsekuensi, konfirmasi ketik ulang
   username, status proses, dan hasil akhir; tautan dari tab Profil.
3. Uji SQL baru `supabase/tests/rls_account_delete_test.sql` dengan direktif
   `-- db:test notice: UJI HAPUS AKUN LULUS`, ditambahkan ke `DEFAULT_TEST_FILES` **dan** ke
   pemeriksaan notice di `.github/workflows/database-rls.yml`.
4. Uji Jest untuk layar dan pemetaan galat (`src/features/account/__tests__/`).
5. Kebijakan privasi & kontak dukungan sebagai halaman statis di aplikasi (`src/app/privacy.tsx`)
   yang menyebut data apa yang disimpan, berapa lama, dan cara meminta penghapusan.

**Kriteria penerimaan irisan ini:**

- Pengguna A memanggil RPC untuk akunnya sendiri → berhasil dan idempoten; pengguna B memanggilnya
  untuk A → ditolak; `anon` ditolak.
- Setelah penghapusan, sesi berakhir, profil tidak lagi terbaca publik, dan foto/avatar tidak bisa
  diambil lewat signed URL.
- Laporan bahaya milik A tetap ada untuk pengguna lain tetapi tanpa identitas (bila memilih A).
- `npm run db:test:lint`, `npm test -- --ci`, dan `npm run test:scripts` hijau; job Database RLS
  menjalankan berkas baru dan menerima notice-nya.
- Tidak ada data lokasi presisi di log, pesan galat, atau audit.

**Yang belum termasuk irisan ini:** push notification, crash monitoring, dan seluruh M6.

## 5. Rancangan data notifikasi (desain saja, belum diterapkan)

Ditulis 22 Oktober 2026 setelah memeriksa skema yang **sudah ada**, karena prasangka awalnya salah:
tabel notifikasi tidak perlu dibuat.

| Objek | Keadaan sebenarnya |
| --- | --- |
| `public.notifications` | **Sudah ada** sejak `20261013022938_initial_schema.sql`: `recipient_id`, `actor_id`, `kind` (sudah memuat `ride_invite`, `ride_started`, `ride_ended`, `club_join_request`, `club_join_approved`, `like`, `comment`, `follow`, `follow_back`, `system`), `entity_type`/`entity_id`, `payload`, `read_at`. RLS: penerima boleh SELECT dan menandai dibaca; **tidak ada** policy INSERT karena penulisan hanya lewat backend tepercaya |
| `public.push_tokens` | **Sudah ada** di migration yang sama: `user_id`, `token` unik, `platform` (`android`/`ios`/`other`), `device_label`, `last_seen_at`. RLS penuh untuk pemilik baris (`select/insert/update/delete ... = auth.uid()`), jadi pendaftaran token tidak butuh RPC baru |
| `public.notification_preferences` | **Belum ada.** Inilah satu-satunya tabel yang benar-benar hilang: tanpa ia, "matikan notifikasi" hanya bisa berarti mencabut token |
| Pengirim | **Belum ada.** Rencana: Edge Function ber-service-role, karena kunci FCM tidak boleh masuk bundel dan penerima harus diturunkan dari `ride_members`, bukan dari payload klien |
| Klien | **Belum ada.** `expo-notifications` belum menjadi dependency; menambahkannya berarti modul native baru → APK baru + izin Android |

Draf badan migration ada di [`supabase/drafts/m5_notification_preferences.sql`](../supabase/drafts/m5_notification_preferences.sql).
Ia **bukan** migration: tidak dijalankan `npm run db:test`, tidak dibaca `db:types`, dan tidak memicu build
APK (ADR-074). Isinya: tabel preferensi (tiga kategori + jam tenang), RLS pemilik saja, trigger
`touch_updated_at`, dan daftar keputusan yang harus diambil sebelum ia menjadi migration — idempotensi
pengiriman, penanda token mati, dan zona waktu jam tenang. Keputusan strateginya ada di ADR-075
(status **Proposed**).

**Urutan yang disarankan saat M5 dikerjakan:** preferensi + layar pengaturan (tanpa dependency baru) →
Edge Function pengirim + token nyata (butuh kredensial FCM) → pengujian dua perangkat dengan
`expo-notifications` di development build, karena Expo Go tidak mendukung push penuh.

## 6. Definisi "M5 selesai"

M5 baru boleh ditutup bila seluruh butir P0 di §2 selesai **dan** M4 sudah punya bukti perangkat
(QA_TEST_PLAN 8d), **dan** job Database RLS tetap hijau dengan berkas uji baru. Status yang dipakai
tetap empat tingkat yang sama: **Passed locally**, **Passed against dev backend**,
**Tested on physical device**, **Blocked** — jangan ada yang digabung.
