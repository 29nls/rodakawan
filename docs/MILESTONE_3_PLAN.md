# Rencana Milestone 3 — Perjalanan & berbagi lokasi

Status: **rencana saja (belum dimulai, belum ada perubahan kode/migration)**. Tanggal: 2026-10-19.
Dokumen ini bukan catatan hasil. Tidak ada satu pun baris di sini yang boleh dibaca sebagai "sudah
dikerjakan".

**Gerbang masuk:** Milestone 3 tidak dimulai sebelum gerbang penerimaan Milestone 2 lulus, yaitu
seluruh checklist bagian 5 [`MILESTONE_2_REPORT.md`](MILESTONE_2_REPORT.md) dijalankan di perangkat
fisik dengan APK `v0.1.0-build20` (baseline audit: `v0.1.0-build19`) dan dua akun nyata. Sampai itu
terjadi, status garasi/klub adalah
**Implemented · Passed locally · Passed against dev backend · Tested on physical device: Blocked**,
dan tidak ada kode live-location yang ditulis.

Dua keputusan lain juga menggantung dan harus selesai sebelum layar peta dibangun:

1. **Pemilik produk menyatakan M2 lulus di perangkat.** Tanpa itu, milestone ini tetap di tahap
   rencana.
2. **Penyedia peta/tile dipilih** — lihat [`MAP_PROVIDER_DECISION.md`](MAP_PROVIDER_DECISION.md) dan
   ADR-064. Jangan menambahkan dependency peta sebelum keputusan itu dicatat.

## Tujuan

Anggota klub dapat membuat perjalanan, mengajak/menerima anggota lain, dan — **hanya setelah
menyatakan setuju secara eksplisit** — saling melihat posisi selama perjalanan itu berlangsung,
lalu berhenti terpantau begitu perjalanan selesai, ia keluar, atau ia mematikan berbagi.

## Di luar lingkup (jangan dikerjakan pada milestone ini)

Convoy chat, laporan hazard, PTT/voice, pemutar musik, feed aktivitas, gamifikasi, dan notifikasi push
umum. Semuanya bergantung pada model perjalanan yang sedang dibangun di sini.

## Model data yang sudah ada

Skema awal **sudah** memuat `rides`, `ride_members`, `ride_locations`, `chat_messages`, dan
`hazard_reports`, beserta helper `is_ride_member`, `is_ride_host`, `is_ride_active_member`, dan
`can_publish_ride_location`. Milestone 3 **tidak** membuat tabel live-location baru dari nol; ia
melengkapi dan memperketat yang sudah ada.

| Objek | Inti | Catatan |
| ----- | ---- | ------- |
| `rides` | `club_id`, `created_by`, `title`, `status`, `visibility`, `started_at`, `ended_at` | `status` sudah dibatasi CHECK ke `planned/active/completed/cancelled`; perpindahan status belum dijaga RPC |
| `ride_members` | `ride_id`, `user_id`, `role`, `status`, `sharing_location` | `sharing_location` adalah consent per perjalanan; `status` `joined/left/removed` |
| `ride_locations` | satu baris terakhir per `(ride_id, user_id)` | Primary key sudah `(ride_id, user_id)` — last-known, bukan riwayat. Riwayat GPS permanen tetap nonaktif (ADR-006) |

## Status perjalanan (state machine)

`planned → active → completed`, dengan `cancelled` sebagai jalan keluar dari `planned`/`active`.
Aturan harus ditegakkan **di database**, bukan hanya di layar:

- hanya `host` (atau owner/admin klub, bila keputusan itu diambil) yang boleh mengaktifkan,
  menyelesaikan, atau membatalkan;
- `completed` dan `cancelled` bersifat final — tidak ada perpindahan kembali ke `active`;
- `started_at`/`ended_at` diisi server, bukan klien;
- transisi ditolak dengan SQLSTATE yang bisa dipetakan UI, bukan gagal diam-diam.

Rancangan RPC: `start_ride(p_ride_id)`, `complete_ride(p_ride_id)`, `cancel_ride(p_ride_id)` dengan
`security definer`, `set search_path = ''`, dan grant hanya `authenticated`. `anon` tidak boleh
memiliki `EXECUTE` (pola ADR-041).

## RPC keanggotaan dan otorisasi klub

Semua mutasi perjalanan lewat RPC; tidak ada policy `INSERT`/`UPDATE` langsung untuk klien (sudah
begitu di skema awal).

| RPC | Aturan |
| --- | --- |
| `create_ride(p_club_id, p_title, …)` | Pemanggil harus `is_club_member(p_club_id)`; `created_by = auth.uid()`; pembuat langsung menjadi `ride_members.role = 'host'`, `status = 'joined'`; `club_id` wajib (perjalanan selalu milik klub pada M3) |
| `join_ride(p_ride_id)` | Harus anggota klub perjalanan; `visibility` `club`/`public` boleh langsung, `invite_only` butuh undangan/kode (keputusan); menolak bila ride `completed`/`cancelled`; tidak menyentuh `sharing_location` |
| `leave_ride(p_ride_id)` | Set `status = 'left'`, hapus baris `ride_locations`; host terakhir harus menyelesaikan perjalanan atau mengalihkan host lebih dulu |
| `invite_ride_member(p_ride_id, p_user_id)` | Hanya host; target harus anggota klub; `status = 'invited'` |
| `accept_ride_invite(p_ride_id)` | Hanya target undangan; `status = 'joined'` |

Otorisasi klub adalah satu-satunya sumber izin: jangan menambahkan pengecualian `created_by` yang
berdiri sendiri — pola itulah yang pernah membuat mantan anggota masih membaca perjalanan klub
(`rides_select_allowed`, ditutup `20261017090000`) dan sekarang dijaga
`rls_policy_guard_test.sql` (ADR-060).

## Realtime, last-known, dan indikator basi

- Kanal **privat** per perjalanan (mis. `ride:<id>`), otorisasi mengikuti keanggotaan; `anon` tidak
  bisa subscribe. Uji dengan dua akun: anggota menerima, non-anggota tidak.
- `ride_locations` menyimpan **satu baris terakhir** per `(ride_id, user_id)`; tidak ada tabel
  riwayat. Bila kelak ada kebutuhan riwayat, itu keputusan produk baru (ADR-006).
- Ambang "basi" harus konstanta yang diuji (usulan awal 60 detik sejak `recorded_at`): marker berubah
  warna/label, dan UI menyebut "lokasi terakhir HH:MM" alih-alih menampilkan posisi seolah terkini.
- Status yang harus terlihat: `menunggu izin`, `izin ditolak`, `GPS mati`, `tidak ada sinyal`,
  `lokasi basi`, `berbagi dihentikan`. Jangan menyembunyikan keadaan ini di balik marker diam.

## Invarian privasi (wajib, diuji allow **dan** deny)

1. Tidak ada berbagi lokasi tanpa persetujuan eksplisit **per perjalanan** (`sharing_location = true`).
2. Menolak berbagi tidak boleh menghalangi ikut perjalanan — keanggotaan dan consent adalah dua
   kolom/aksi terpisah.
3. `anon` dan non-anggota tidak dapat membaca `ride_locations` (RLS, bukan filter UI).
4. Hanya leader/host berwenang yang dapat memindahkan status perjalanan.
5. Perjalanan `completed`/`cancelled` tidak dapat kembali `active`.
6. Riwayat GPS persisten nonaktif secara default; satu baris last-known per pengguna.
7. Tracking berhenti saat pengguna keluar, mematikan berbagi, atau perjalanan berakhir — baris
   lokasinya dihapus, bukan hanya disembunyikan.
8. GPS mati, izin ditolak, kehilangan jaringan, lokasi basi, dan pembatasan baterai tampil sebagai
   keadaan UI yang eksplisit.

## Draf migration dan uji RLS/RPC

Dua berkas berikut adalah **draft**, bukan migration aktif:

- [`supabase/drafts/milestone_3_ride_state.sql`](../supabase/drafts/milestone_3_ride_state.sql) —
  RPC `transition_ride` (state machine di database), RPC `set_ride_location_sharing` (consent per
  perjalanan), dan dua trigger yang menghapus `ride_locations` saat consent dimatikan, anggota
  keluar, atau perjalanan selesai/dibatalkan. Tidak ada tabel atau policy baru.
- [`supabase/tests/drafts/rls_rides_m3_draft.sql`](../supabase/tests/drafts/rls_rides_m3_draft.sql) —
  uji allow/deny untuk `anon`, non-anggota, anggota, host, consent, dan pembersihan lokasi. Berkas ini
  **tidak** terdaftar di `DEFAULT_TEST_FILES`; menjalankannya tanpa draf akan berhenti dengan pesan
  paritas yang jelas.

Cara menjalankan setelah gerbang M2 lulus dan draf diterapkan ke database **scratch/development**
(bukan produksi):

```powershell
# 1. Terapkan draf ke database scratch (jangan ke project produksi).
npx supabase db execute --file supabase/drafts/milestone_3_ride_state.sql

# 2. Jalankan hanya uji draf ini, bukan seluruh daftar default.
npm run db:test -- --file supabase/tests/drafts/rls_rides_m3_draft.sql
```

Validasi 19 Oktober 2026: draf dan ujinya dijalankan bersama dalam **satu transaksi yang di-ROLLBACK**
terhadap project development — 77 perintah, notice `UJI RLS PERJALANAN M3 LULUS` diterima, lalu
diperiksa bahwa tidak ada fungsi, trigger, tabel konteks, atau baris ride uji yang tertinggal. Ini
membuktikan perilaku draf, bukan menerapkannya secara permanen.

Jangan menyalin draf ke `supabase/migrations/` atau menambahkannya ke `DEFAULT_TEST_FILES` sebelum
gerbang M2 lulus. `scripts/__tests__/milestone-3-draft.test.mjs` memeriksa bahwa tidak ada migration
aktif yang memuat RPC M3 dan berkas uji draf tidak masuk daftar runner, sehingga aktivasi tidak bisa
terjadi diam-diam.

## Perangkat dan platform

- Android: foreground location service dengan tipe yang benar sesuai API level, plus izin notifikasi
  untuk notifikasi wajibnya. Background location diminta **setelah** foreground dan setelah
  penjelasan, bukan saat aplikasi pertama dibuka.
- Perilaku GPS mati, sinyal hilang, atau lokasi basi harus terlihat sebagai keadaan eksplisit, bukan
  marker yang diam-diam berhenti bergerak.
- Baterai dan konsumsi data **diukur**, bukan diperkirakan: satu perjalanan 30 menit dengan layar
  mati, catat konsumsi baterai, jumlah request jaringan, dan ukuran data.

## Urutan pengerjaan

1. Uji RLS/RPC untuk skema yang ada + draft di atas (tanpa UI), allow dan deny.
2. RPC transisi status + trigger pembersihan lokasi; uji bahwa `completed` tidak bisa kembali aktif.
3. Layar perjalanan tanpa peta: buat, daftar anggota, keluar, selesaikan.
4. Consent per perjalanan + berbagi foreground; kanal Realtime privat.
5. Background location + layar peta (setelah provider dipilih) + indikator basi/offline.
6. Uji dua perangkat fisik dan pengukuran baterai/network; tambahkan kasus RIDE-xx ke
   [`QA_TEST_PLAN.md`](QA_TEST_PLAN.md).

## Kriteria penerimaan Milestone 3

Semua harus dibuktikan, bukan diasumsikan:

| # | Kriteria | Bukti yang diperlukan |
| - | -------- | --------------------- |
| 1 | Buat/ajak/terima/keluar/selesaikan perjalanan | Dua akun nyata, dua perangkat fisik |
| 2 | Status hanya berubah oleh host yang sah | Uji RLS/RPC: anggota biasa ditolak, `anon` ditolak |
| 3 | `completed`/`cancelled` final | Uji RPC: transisi balik ke `active` ditolak |
| 4 | Consent eksplisit per perjalanan | Uji: tanpa `sharing_location`, tidak ada baris lokasi yang bisa ditulis/dibaca |
| 5 | Menolak berbagi tetap bisa ikut | Uji aplikasi: join sukses, lokasi tidak terkirim |
| 6 | Non-anggota/`anon` tidak membaca lokasi | Uji RLS `SELECT` = 0 baris |
| 7 | Tracking berhenti saat keluar/opt-out/selesai | Uji trigger: baris `ride_locations` hilang; aplikasi berhenti mengirim |
| 8 | Lokasi basi/offline/GPS mati terlihat | Tangkapan layar + logcat di perangkat |
| 9 | Baterai/network terukur | Catatan 30 menit: persentase baterai, jumlah request, ukuran data |

## Bukti yang harus ada sebelum milestone dinyatakan lulus

1. Uji RLS/RPC di database development untuk setiap aturan di atas — **allow dan deny**, termasuk
   `anon`, non-anggota, anggota yang keluar, dan bukan host.
2. Aplikasi: alur lengkap dengan dua akun di **dua perangkat fisik**.
3. Perangkat: GPS mati, mode pesawat, aplikasi di background, dan reboot di tengah perjalanan.
4. Pengukuran baterai/network 30 menit, dicatat apa adanya.

Setiap langkah diperlakukan seperti Milestone 2: migration aditif, uji allow/deny, status jujur
(**Implemented** / **Passed locally** / **Passed against dev backend** / **Tested on physical
device** / **Blocked**), dan tidak ada tombol yang tampak berfungsi tetapi belum terhubung.
