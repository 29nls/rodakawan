# Rencana Milestone 4 — Laporan bahaya jalan & chat konvoi

Status: **Diimplementasikan (kode); migration M4 sudah diterapkan ke project development (17/17
paritas), tetapi uji SQL RLS-nya belum dijalankan live (menunggu kredensial DB).** Rencana ditulis
2026-10-20; implementasi
21 Oktober 2026. Pemilik produk memilih jalur 2 di bawah: keputusan peta (ADR-064) dan uji perangkat
khusus M3 **ditunda eksplisit**, dan M4 dikerjakan **tanpa marker peta**.

Yang sudah ada di repository:

- migration `supabase/migrations/20261020090000_hazard_reports_m4.sql` (bahaya),
  `20261020100000_convoy_chat_m4.sql` (chat, pesan sistem),
  `20261021120000_moderation_dashboard.sql` (moderasi), dan
  `20261021130000_blocked_chat_server_filter.sql` (filter blokir) — **sudah diterapkan** ke project
development (terverifikasi lewat `npx supabase migration list --linked`: 17 local = remote);
- `src/features/hazards/{api,errors,geo,labels}.ts` + tab `src/app/(tabs)/hazards.tsx`;
- `src/features/chat/{api,errors}.ts` + `src/features/chat/ChatPanel.tsx`, dipasang di
  `src/app/ride.tsx`;
- `src/features/moderation/{api,errors}.ts` (RPC `report_content`);
- uji Jest: 29 test hazard, 25 test API chat, 9 test panel chat, 6 test layar Peringatan;
- berkas uji SQL `supabase/tests/rls_hazards_test.sql` dan `supabase/tests/rls_chat_test.sql`
  (**belum dieksekusi** karena tidak ada target database yang terkonfirmasi).

Status per butir: Implemented = ya; Passed locally (Jest/typecheck/lint) = ya; Passed against dev
backend = **belum**; Tested on physical device = **belum**; Deferred by owner = peta + uji perangkat M3.

Detail keputusan ada di ADR-066 (`docs/PROJECT_DECISIONS.md`) dan langkah penerapan di
`docs/SETUP_GUIDE.md` bagian 4.

**Gerbang masuk.** M4 hanya dimulai setelah salah satu dari dua hal terjadi:

1. ADR-064 (provider peta) **disetujui** dan uji perangkat khusus M3 (dua perangkat, izin dicabut,
   GPS mati/mode pesawat, force-stop/reboot, baterai 30 menit) selesai; atau
2. pemilik produk menyatakan secara eksplisit bahwa kedua hal itu **ditunda** dan M4 boleh berjalan
   tanpa marker peta (chat dan daftar laporan tetap bisa dikerjakan lebih dulu).

Sampai itu terjadi, dokumen ini hanya bahan keputusan.

## 1. Yang sudah ada di skema (jangan dibuat ulang)

| Objek | Isi sekarang | Kekurangan untuk M4 |
| --- | --- | --- |
| `public.hazard_reports` | `category` (`pothole`,`crash`,`traffic`,`weather`,`flood`,`road_block`,`traffic_enforcement`,`other`), `severity` (`info`,`moderate`,`high`,`critical`), `latitude`/`longitude` dengan CHECK, `status` (`active`,`expired`,`dismissed`,`removed`,`resolved`), `expires_at`, `ride_id` opsional, `reporter_id` | Tidak ada policy `UPDATE`/`DELETE`, tidak ada RPC tulis, `expires_at` diisi klien, tidak ada konfirmasi/duplikat/rate limit |
| `public.chat_messages` | `ride_id`, `sender_id`, `message_type` (`text`,`system`), `content` 1–2000 karakter, `edited_at`, `deleted_at` | Tidak ada idempotency key, tidak ada rate limit, tidak ada pesan sistem otomatis, tidak ada paginasi keyset di API |
| `public.content_reports` | `target_type` sudah menerima `hazard` dan `chat_message`, alasan terbatas, status moderasi | Belum ada RPC/jalur UI untuk melaporkan |
| `public.user_blocks` | blocker/blocked | Belum dipakai untuk menyembunyikan pesan pengguna yang diblokir (keputusan produk) |
| Policy chat | `chat_select_ride_member` memakai `is_ride_member` (`ride_members.status = 'joined'`), insert/update/delete hanya milik sendiri dan hanya `message_type = 'text'` | Perlu uji eksplisit bahwa peserta yang `left`/`removed` **tidak** membaca dan `anon` ditolak |

Helper yang sudah tersedia: `is_ride_member`, `is_ride_active_member`, `is_ride_host`. Pagar
ADR-060 (`rls_policy_guard_test.sql`) hanya memindai tabel ber-`club_id`/`ride_id`, jadi tabel baru
`hazard_confirmations` (kunci `hazard_id`) tidak menambah pengecualian, tetapi setiap policy baru
pada `hazard_reports`/`chat_messages` tetap harus lolos pagar itu bila menyentuh kolom kepemilikan.

## 2. Laporan bahaya jalan

### 2.1 Aturan produk yang harus diputuskan lebih dulu

| Pertanyaan | Usulan awal (butuh persetujuan) |
| --- | --- |
| Cakupan laporan | Global per area (bukan hanya peserta ride); `ride_id` hanya konteks opsional |
| Masa berlaku per kategori | `crash` 2 jam, `traffic` 1 jam, `traffic_enforcement` 2 jam, `road_block` 4 jam, `weather` 3 jam, `flood` 6 jam, `pothole` 24 jam, `other` 2 jam — dihitung **server** dari `created_at` |
| Siapa boleh mengubah/menghapus | Pelapor boleh mengubah `description`/`severity` dalam 15 menit; penghapusan hanya pelapor atau moderator (status `removed`, bukan hard delete) |
| Konfirmasi "masih ada" | Satu konfirmasi per pengguna per laporan; konfirmasi tidak memperpanjang `expires_at` kecuali keputusan produk mengizinkan |
| Presisi koordinat | Simpan koordinat laporan (bukan posisi pelapor); UI menampilkan perkiraan area, bukan jejak |

### 2.2 Perubahan skema (aditif)

1. `alter table public.hazard_reports add column if not exists client_report_id uuid` +
   `unique (reporter_id, client_report_id)` — retry tidak membuat laporan ganda.
2. Tabel baru `public.hazard_confirmations (hazard_id, user_id, created_at, primary key (hazard_id, user_id))`
   dengan FK `on delete cascade` ke `hazard_reports`, RLS aktif, policy `SELECT` untuk
   `authenticated` bila laporan masih aktif, `INSERT` hanya `user_id = auth.uid()`, tanpa `UPDATE`
   dan tanpa `DELETE` (konfirmasi tidak bisa dicabut; keputusan produk).
3. Index tambahan `hazard_reports(category, created_at desc)` untuk deteksi duplikat.

### 2.3 RPC (semua `security definer`, `set search_path = ''`, grant hanya `authenticated`)

| RPC | Aturan |
| --- | --- |
| `create_hazard(p_category, p_severity, p_lat, p_lng, p_description, p_ride_id, p_client_report_id)` | Validasi kategori/severity di server; hitung `expires_at`; tolak bila ada laporan kategori sama dalam radius ±50 m dan 10 menit terakhir oleh pengguna mana pun; batas 5 laporan / 10 menit / pengguna; `reporter_id = auth.uid()` |
| `update_hazard(p_hazard_id, p_severity, p_description)` | Hanya pelapor, hanya `status = 'active'`, hanya dalam 15 menit sejak `created_at` |
| `remove_hazard(p_hazard_id)` | Pelapor (15 menit) atau moderator; set `status = 'removed'`, tidak menghapus baris |
| `confirm_hazard(p_hazard_id)` | Laporan harus `active` dan belum kedaluwarsa; maksimal 10 konfirmasi/jam/pengguna; duplikat ditolak `23505` |
| `expire_hazard_reports()` | Menandai `status = 'expired'` untuk `expires_at <= now()`; dipanggil dari API sebelum daftar dimuat, atau lewat cron Supabase bila pemilik project mengaktifkannya |

Pembacaan tetap memakai filter `status = 'active' and expires_at > now()` sehingga laporan
kedaluwarsa tidak pernah tampil sebagai aktif walaupun sapuan belum berjalan.

### 2.4 Rate limit dan anti-duplikat

- Dihitung di database (bukan hanya UI), memakai `created_at` dan koordinat yang tersimpan.
- Pesan galat dipetakan ke Bahasa Indonesia yang bisa ditindaklanjuti: "Laporan serupa baru saja
  dikirim di sekitar titik ini." dan "Terlalu banyak laporan dalam waktu singkat. Coba lagi nanti."
- Tidak ada penghapusan otomatis data pelapor; hanya status laporan yang berubah.

### 2.5 UI (setelah backend lulus uji)

- Layar daftar/filter laporan (kategori, severity, jarak, hanya yang aktif) — **tanpa** peta selama
  ADR-064 belum disetujui.
- Form laporan dengan pemilih kategori, severity, deskripsi opsional, dan tombol "Gunakan lokasi saat
  ini" yang **meminta izin hanya saat ditekan** (pola yang sama dengan berbagi lokasi perjalanan).
- Tombol konfirmasi "Masih ada" dan laporan penyalahgunaan lewat `content_reports`.
- Setelah peta tersedia: marker laporan sebagai layer terpisah dari marker peserta, dengan warna
  menurut severity dan label kedaluwarsa.

## 3. Chat konvoi

### 3.1 Model dan perubahan (aditif)

1. `alter table public.chat_messages add column if not exists client_message_id uuid` +
   `unique (ride_id, sender_id, client_message_id)` — retry setelah jaringan putus tidak menggandakan
   pesan.
2. Tidak mengubah `message_type`, `content`, `edited_at`, `deleted_at` yang sudah ada.
3. Index `chat_messages(ride_id, created_at desc, id desc)` untuk paginasi keyset.

### 3.2 RPC dan aturan

| RPC | Aturan |
| --- | --- |
| `send_chat_message(p_ride_id, p_content, p_client_message_id)` | Harus `is_ride_active_member`; ride belum `completed`/`cancelled`; `content` 1–2000 karakter setelah trim; maksimal 20 pesan / 60 detik / pengguna; duplikat `client_message_id` mengembalikan baris yang sudah ada, bukan galat |
| `edit_chat_message(p_message_id, p_content)` | Hanya pengirim, hanya `message_type = 'text'`, maksimal 15 menit sejak `created_at`, mengisi `edited_at` |
| `delete_chat_message(p_message_id)` | Hanya pengirim, soft delete (`deleted_at`), isi tidak ditampilkan lagi |
| `report_chat_message(p_message_id, p_reason, p_details)` | Menulis ke `content_reports` (`target_type = 'chat_message'`); tidak menghapus pesan |

### 3.3 Pesan sistem

- Trigger `after update of status on public.rides` dan trigger pada `ride_members`
  (insert/update status) menyisipkan baris `message_type = 'system'`:
  "Perjalanan dimulai", "Perjalanan selesai", "Perjalanan dibatalkan", "<nama> bergabung",
  "<nama> keluar", "<nama> dikeluarkan".
- `sender_id` diisi pelaku aksi (`auth.uid()` di konteks pemanggil, fallback `rides.created_by`),
  sehingga policy `INSERT` yang ada tidak perlu dilonggarkan.
- Konten sistem dibatasi ≤ 200 karakter dan tidak pernah memuat koordinat.

### 3.4 Realtime dan paginasi

- **Postgres Changes** pada `chat_messages` dengan filter `ride_id=eq.<uuid>`, konsisten dengan
  ADR-065: setiap baris tetap melewati RLS `chat_select_ride_member`, jadi non-anggota dan `anon`
  tidak menerima apa pun. Broadcast kanal privat tidak dipakai karena policy `realtime.messages`
  tidak dapat dibuat lewat koneksi migration project development.
- Muat riwayat 50 pesan terakhir, lalu keyset (`created_at`, `id`) untuk halaman berikutnya.
- Setelah reconnect, muat ulang halaman terakhir dan buang pesan ganda berdasarkan `id`; jangan
  mengandalkan event realtime yang mungkin terlewat.
- Indikator "menyambung ulang" ditampilkan eksplisit; tidak ada pesan yang diklaim terkirim sebelum
  server mengembalikan barisnya.

### 3.5 Moderasi

- Laporan pesan masuk ke `content_reports`; moderator (belum ada peran global — keputusan produk)
  menandai `reviewed`/`removed`.
- Pesan yang dilaporkan tetap terlihat sampai ditinjau; tidak ada penghapusan otomatis berdasarkan
  jumlah laporan (mencegah penyalahgunaan).
- Pesan pengguna yang diblokir: usulan menyembunyikan di klien, bukan lewat RLS, karena RLS per
  baris akan membocorkan keberadaan blokir dan memperumit paginasi. Butuh keputusan produk.
  **Diputuskan 21 Oktober 2026 (ADR-068):** penyaringan dipindahkan ke policy `chat_select_ride_member`
  di server, karena penyembunyian di klien berarti isi pesan tetap terkirim lewat REST dan realtime.
  Pesan sistem tetap terlihat, dan paginasi tetap benar karena RLS diterapkan sebelum `LIMIT`.

## 4. Uji yang wajib ada (allow **dan** deny)

`supabase/tests/rls_hazards_test.sql` dan `supabase/tests/rls_chat_test.sql` (keduanya terdaftar di
`DEFAULT_TEST_FILES`, masing-masing dengan direktif notice sendiri):

**Hazard**
- `anon` tidak membaca dan tidak menulis.
- Pengguna terautentikasi membuat laporan; `expires_at` dihitung server, bukan dari klien.
- Laporan kedaluwarsa tidak terbaca sebagai aktif oleh pengguna lain, tetapi tetap terbaca pelapor.
- Duplikat dalam radius/waktu ditolak; laporan di luar radius diterima.
- Rate limit 5/10 menit ditegakkan; percobaan ke-6 ditolak.
- Pelapor lain tidak dapat mengubah/menghapus laporan orang lain.
- `confirm_hazard` duplikat ditolak; konfirmasi pada laporan kedaluwarsa ditolak.
- Koordinat di luar rentang ditolak CHECK.

**Chat**
- Anggota aktif membaca dan menulis; `anon` dan non-anggota ditolak.
- Peserta `left`/`removed` **tidak** membaca pesan setelah keluar; host tetap bisa membaca.
- Ride `completed`/`cancelled` tidak menerima pesan baru.
- `client_message_id` yang sama tidak membuat baris kedua.
- Rate limit 20/60 detik ditegakkan.
- Mengubah/menghapus pesan orang lain ditolak; mengubah pesan `system` ditolak.
- `content_reports` untuk `chat_message` hanya bisa dibuat oleh pelapor untuk dirinya sendiri.

**Pagar ADR-060** harus tetap hijau: policy baru tidak boleh memberi akses lewat kolom kepemilikan
tanpa penjaga keanggotaan pada tabel wadah, dan daftar pengecualian tidak boleh membusuk.

## 5. Uji aplikasi (Jest)

- Service hazard: pemetaan galat RPC (duplikat, rate limit, kedaluwarsa), konfirmasi idempoten,
  filter kategori.
- Service chat: paginasi keyset, deduplikasi event realtime, retry dengan `client_message_id` yang
  sama, soft delete.
- Komponen: form laporan (validasi + label aksesibilitas), daftar laporan (kedaluwarsa tidak tampil
  aktif), daftar pesan (kirim, gagal, coba lagi, pesan sistem), dan keadaan "menyambung ulang".
- Tidak ada test yang hanya menguji jalur sukses palsu: setiap kasus galat memeriksa pesan yang
  dilihat pengguna dan memastikan tidak ada baris/aksi yang diklaim berhasil.

## 6. Urutan pengerjaan

1. Putuskan aturan produk di bagian 2.1 dan pilih jalur gerbang (peta disetujui atau ditunda).
2. Migration aditif: kolom idempotency, tabel konfirmasi, RPC hazard + chat, trigger pesan sistem.
3. Uji RLS/RPC allow/deny; jalankan `npm run db:test` (semua berkas) dan pastikan pagar ADR-060 hijau.
4. Lapisan API + unit test (fake client), lalu komponen + test komponen.
5. Uji terhadap backend development dengan dua akun nyata.
6. Uji perangkat fisik: dua HP untuk chat, GPS mati/mode pesawat untuk laporan, baterai 30 menit.
7. Baru setelah peta tersedia: marker laporan dan marker peserta di layer terpisah.

## 7. Kriteria penerimaan

| # | Kriteria | Bukti yang diperlukan |
| - | -------- | --------------------- |
| 1 | Laporan dibuat, diubah, dihapus sesuai peran | Uji RPC allow/deny; bukan hanya tombol tersembunyi |
| 2 | Laporan kedaluwarsa tidak aktif | Uji SQL + uji komponen; tidak ada marker/label "aktif" untuk baris kedaluwarsa |
| 3 | Duplikat dan rate limit ditolak dengan pesan jelas | Uji RPC + uji service |
| 4 | Chat hanya untuk anggota aktif | Uji RLS: `anon`, non-anggota, peserta `left`/`removed` = 0 baris |
| 5 | Retry tidak menggandakan pesan | Uji `client_message_id` + uji service |
| 6 | Pesan sistem muncul untuk mulai/selesai/batal/anggota berubah | Uji trigger |
| 7 | Moderasi tersedia | Uji `content_reports` untuk pesan dan laporan |
| 8 | Tidak ada kebocoran lokasi pelapor | Koordinat laporan saja; tidak ada riwayat perjalanan pelapor |
| 9 | Realtime tidak membocorkan baris | Dua akun: anggota menerima, non-anggota tidak |

## 8. Di luar lingkup M4

PTT/voice, pemutar musik, feed aktivitas, gamifikasi, notifikasi push umum, peta offline, dan
peringatan berbasis suara. Semuanya tetap ditunda sesuai ADR-007 dan roadmap.

## 9. Risiko dan keputusan terbuka

- **Marker peta bergantung pada ADR-064.** Tanpa persetujuan provider, M4 hanya bisa sampai daftar
  dan filter — jangan memasang dependency peta lebih dulu.
- **Masa berlaku per kategori** adalah angka usulan, bukan kebijakan yang disetujui.
- **Moderator** belum ada peran global; M4 butuh keputusan apakah moderasi dilakukan lewat dashboard
  Supabase untuk sementara.
- **Blokir pengguna di chat** belum diputuskan (klien vs RLS).
- **Cron/sapuan kedaluwarsa** bergantung pada izin pemilik project; tanpa itu status dihitung saat
  dibaca dan `expire_hazard_reports()` dipanggil malas dari API.
