# Rencana Milestone 3 — Perjalanan & berbagi lokasi

Status: **rencana saja (belum dimulai)**. Tanggal: 2026-10-16. Pemilik dokumen: milestone plan, bukan
catatan hasil — tidak ada satu pun baris di sini yang boleh dibaca sebagai "sudah dikerjakan".

**Gerbang masuk:** Milestone 3 tidak dimulai sebelum gerbang penerimaan Milestone 2 lulus, yaitu
seluruh checklist di bagian 5 [`docs/MILESTONE_2_REPORT.md`](MILESTONE_2_REPORT.md) dijalankan di
perangkat fisik dengan APK dari commit Milestone 2. Sampai itu terjadi, status garasi/klub adalah
**Implemented · Passed locally · Passed against dev backend · Tested on physical device: Blocked**.

## Tujuan

Anggota klub dapat membuat perjalanan, mengajak/menerima anggota lain, dan — **hanya setelah
menyatakan setuju secara eksplisit** — saling melihat posisi selama perjalanan itu berlangsung,
lalu berhenti terpantau begitu perjalanan selesai atau ia keluar.

## Di luar lingkup (jangan dikerjakan pada milestone ini)

Convoy chat, laporan hazard, PTT/voice, pemutar musik, feed aktivitas, gamifikasi, dan notifikasi push
umum. Semuanya bergantung pada model perjalanan yang sedang dibangun di sini, jadi mengerjakannya
lebih dulu berarti membangun di atas fondasi yang belum ada.

## Model data (usulan, draft — belum ada migration)

| Objek | Inti | Alasan |
| ----- | ---- | ------ |
| `rides` | `id`, `club_id`, `created_by`, `title`, `starts_at`, `status`, `visibility` | Perjalanan selalu milik satu klub (M2) supaya keanggotaan klub menjadi satu-satunya sumber izin; `status` yang diketik sebagai enum, bukan teks bebas |
| `ride_members` | `ride_id`, `user_id`, `role`, `status`, `joined_at`, `left_at` | Dipisah dari `rides` karena peran (leader/member) dan status (aktif/keluar) adalah sifat keanggotaan, bukan sifat perjalanan |
| `ride_locations` | `ride_id`, `user_id`, `point`, `recorded_at` | **Satu baris terakhir per pengguna per perjalanan** (last-known), bukan riwayat. Riwayat GPS permanen tetap nonaktif secara default (ADR-006) |

Catatan yang harus diputuskan sebelum implementasi (kandidat ADR): batas akurasi/staleness yang masih
dianggap "posisi terkini", apakah posisi disimpan atau hanya diteruskan lewat Realtime, dan bagaimana
baris lama dibersihkan setelah perjalanan berakhir.

## Status perjalanan (state machine)

`planned → active → completed`, dengan `cancelled` sebagai jalan keluar dari keduanya. Aturannya
harus ditegakkan **di database**, bukan hanya di layar: hanya leader yang boleh mengaktifkan,
menyelesaikan, atau membatalkan; tidak boleh ada perpindahan status setelah `completed`/`cancelled`.

## Izin lokasi dan persetujuan (bagian paling sensitif)

- Berbagi lokasi **opt-in per perjalanan**, bukan pengaturan sekali seumur akun; menolak tidak boleh
  menghalangi ikut perjalanan.
- Layar harus menjelaskan konsekuensinya dengan bahasa konkret, lalu tombol berbagi tampil hanya
  setelah pengguna menyatakan setuju (ADR-005).
- Perizinan sistem (foreground dulu, lalu background) diminta saat dibutuhkan dengan penjelasan
  sebelum dialog sistem muncul, dan penolakan harus ditangani sebagai keadaan normal.
- Berhenti terpantau ketika: perjalanan selesai/dibatalkan, pengguna keluar, atau pengguna mematikan
  berbagi — tanpa menunggu aplikasi dibuka kembali.
- Kanal Realtime harus **privat** (berbasis keanggotaan perjalanan) dan datanya tidak pernah dibaca
  `anon`. Riwayat lokasi tidak boleh muncul di profil publik siapa pun.

## Perangkat dan platform

- Android: layanan lokasi latar depan dengan tipe yang benar sesuai level API, plus izin notifikasi
  untuk notifikasi wajibnya.
- Perilaku saat GPS mati, sinyal hilang, atau lokasi basi harus terlihat di layar sebagai keadaan
  eksplisit, bukan marker yang diam-diam berhenti bergerak.
- Baterai dan konsumsi data diukur, bukan diperkirakan: jalankan satu perjalanan 30 menit dengan
  layar mati dan catat konsumsi baterai serta jumlah permintaan jaringan.
- iOS tidak dikerjakan lebih dulu (Android-first, ADR-003), tetapi desainnya tidak boleh mengasumsikan
  hanya Android.

## Bukti yang harus ada sebelum milestone ini dinyatakan lulus

1. Uji RLS/RPC di database development untuk setiap aturan izin di atas — **allow dan deny**, termasuk
   `anon` ditolak, non-anggota ditolak, anggota yang keluar kehilangan akses, dan status tidak bisa
   dipindahkan oleh bukan leader.
2. Aplikasi: buat/ajak/terima/keluar/selesaikan perjalanan dengan dua akun nyata di **dua perangkat
   fisik**; posisi hanya terlihat selama berbagi aktif; tracking benar-benar berhenti setelah selesai.
3. Perangkat: GPS mati, mode pesawat, keluar aplikasi, dan reboot di tengah perjalanan.
4. Pengukuran baterai/network pada perjalanan 30 menit seperti di atas, dicatat apa adanya.

## Urutan pengerjaan yang diusulkan

1. Skema + RPC + uji RLS (tanpa UI) — agar aturan izin terbukti sebelum layar bergantung padanya.
2. Layar perjalanan tanpa peta: buat, daftar anggota, keluar, selesaikan.
3. Berbagi lokasi foreground + kanal Realtime privat (satu perangkat, dua akun).
4. Latar depan/background + layar peta + indikator lokasi basi.
5. Uji perangkat dan pengukuran baterai; perbarui `docs/QA_TEST_PLAN.md` dengan kasus RIDE-xx.

Setiap langkah diperlakukan seperti Milestone 2: migration aditif, uji allow/deny, status jujur
(**Implemented** / **Passed locally** / **Passed against dev backend** / **Tested on physical device**
/ **Blocked**), dan tidak ada tombol yang tampak berfungsi tetapi belum terhubung ke apa pun.
