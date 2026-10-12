# Data Model, API & Realtime Contract

## 1. Domain utama

Entitas MVP:

- `profiles`: data profil publik yang aman untuk pengguna terautentikasi.
- `motorcycles`: informasi garasi yang boleh ditampilkan sesuai visibilitas.
- `motorcycle_private_details`: plat dan detail privat milik owner saja.
- `clubs`, `club_members`: komunitas dan peran.
- `rides`, `ride_members`: perjalanan dan peserta.
- `ride_locations`: posisi terakhir yang disimpan untuk initial map/reconnect.
- `chat_messages`: pesan perjalanan yang persisten.
- `hazard_reports`: laporan kondisi jalan dengan masa berlaku.
- `follows`, `club_posts`, `post_comments`, `post_reactions`: fase sosial.
- `notifications`, `push_tokens`: notifikasi dan endpoint perangkat.

SQL awal ada pada `supabase/migrations/0001_initial_schema.sql`. Skema perlu direview dan dijalankan di project development sebelum dipakai.

## 2. Kebijakan identitas

- Semua FK pemilik mengarah ke `auth.users.id`.
- Gunakan UUID untuk ID data.
- Simpan timestamp sebagai `timestamptz` (UTC).
- Data sensitif tidak dicampur di tabel yang dibaca sebagai profil publik.
- Semua tabel exposed API mengaktifkan RLS dan memiliki policy allow/deny yang diuji.
- Operasi multi-table yang mengubah status membership/ride sebaiknya melalui Edge Function/RPC transaksional.

## 3. Kontrak backend konseptual

Ini adalah pembagian operasi/logical API. Nama endpoint final dapat berupa Supabase RPC atau Edge Functions; jangan menambahkan server terpisah tanpa kebutuhan jelas.

| Operasi | Akses | Tanggung jawab server |
|---|---|---|
| Create profile | User autentikasi | Validasi username dan metadata profil. |
| Update profile | Pemilik | Hanya field profil yang diizinkan. |
| Create club | User autentikasi | Validasi nama/slug dan buat owner membership secara atomik. |
| Request/join club | User autentikasi | Terapkan public/private policy, cegah duplicate membership. |
| Create ride | Creator/anggota sesuai aturan | Validasi creator/club membership; buat host sebagai ride member. |
| Join ride | User autentikasi | Validasi status, invitation/code, dan kebijakan ride. |
| Start/end ride | Host/admin | Transisi status valid, kirim system event, tutup session tracking saat selesai. |
| Publish location | Peserta ride aktif | Validasi payload, cap rate, otorisasi ride, update last-known state bila dibutuhkan. |
| Send chat message | Peserta ride aktif | Validasi panjang pesan, rate limit dan status perjalanan. |
| Create hazard | User autentikasi | Validasi kategori, coordinates, expiry default dan rate limit. |
| Upload media | Pemilik konten | Signed/authorized storage path, validasi ukuran dan tipe. |
| Create voice token | Peserta ride yang berwenang | Validasi role/status dan terbitkan token WebRTC berumur pendek. |
| Send notification | Backend | Ambil recipient berdasarkan hak akses; tidak menerima daftar penerima arbitrer dari client. |

## 4. Realtime topic dan event

Semua topic terkait ride harus privat dan authorization-nya berdasarkan membership ride. Jangan menggunakan topic publik untuk data lokasi.

| Topic contoh | Event | Isi |
|---|---|---|
| `ride:<rideId>:locations` | `location.updated` | userId, koordinat, accuracy, heading/speed opsional, recordedAt. |
| `ride:<rideId>:presence` | join/leave/status | userId, online, sharing state; tidak untuk sample GPS frekuensi tinggi. |
| `ride:<rideId>:chat` | `chat.message_created` | messageId, senderId, createdAt; isi pesan boleh dibaca lewat row yang terlindungi. |
| `ride:<rideId>:system` | `ride.started`, `ride.ended`, `member.removed` | ID event dan metadata minimum. |

Supabase Presence cocok untuk status yang jarang berubah seperti online/offline, bukan untuk setiap perpindahan GPS. Gunakan Broadcast untuk update posisi cepat; Postgres menyimpan source-of-truth yang memang perlu dipersistenkan.

### Payload lokasi yang diusulkan

```json
{
  "type": "location.updated",
  "rideId": "uuid",
  "userId": "uuid",
  "lat": -6.2,
  "lng": 106.8167,
  "accuracyM": 12,
  "headingDeg": 175,
  "speedMps": 8.4,
  "recordedAt": "2026-10-12T08:15:00Z"
}
```

Validasi server: koordinat dalam rentang valid, recordedAt tidak terlalu jauh dari waktu server, membership aktif, rate limit wajar. Jangan percaya `userId` dari payload tanpa mencocokkan dengan sesi authenticated.

### Payload chat

```json
{
  "type": "chat.message_created",
  "messageId": "uuid",
  "rideId": "uuid",
  "senderId": "uuid",
  "createdAt": "2026-10-12T08:16:00Z"
}
```

Teks pesan diambil dari row yang dilindungi RLS. Batasi panjang, sanitasi rendering, dan cegah spam.

## 5. State machine perjalanan

```text
planned ──start by host──> active ──end by host──> completed
   └────────cancel by host/admin──────────────> cancelled
```

- Tidak boleh mengubah `completed` kembali ke `active` lewat update client biasa.
- Ride `active` memiliki participant membership dan private channel.
- Saat complete/cancel, backend memblokir location writes baru, menutup PTT session bila ada, dan mencegah join baru sesuai kebijakan.
- Event dan perubahan state harus idempotent, karena retry jaringan dapat mengirim request dua kali.

## 6. Expiry laporan bahaya

| Kategori | Default usulan | Catatan |
|---|---:|---|
| Kemacetan | 45 menit | Kedaluwarsa lebih cepat bila kondisi lalu lintas berubah. |
| Kecelakaan/bahaya aktif | 2 jam | Informasi mungkin usang; tampilkan timestamp. |
| Operasi/hambatan lalu lintas | 30–60 menit | Moderasi dan komunikasi harus mendorong kepatuhan terhadap aturan. |
| Genangan/cuaca berbahaya | 2 jam | Kondisi berubah cepat; update/confirm membantu. |
| Lubang/kerusakan jalan | 7 hari | Perlu cara menandai sudah diperbaiki atau tidak valid. |

Nilai ini konfigurasi awal dan harus disesuaikan menurut lokasi dan hasil pilot. Setelah expiry, report tidak muncul sebagai aktif meskipun row disimpan untuk audit terbatas.

## 7. Pagination, filtering dan indeks

- Gunakan cursor pagination untuk chat/feed; jangan memuat seluruh riwayat.
- Indeks FK yang digunakan policy/join/filter.
- Indeks hazard pada status/expiry serta lokasi bila PostGIS dipasang dan memang dibutuhkan.
- Pertimbangkan PostGIS untuk pencarian radius, tetapi jangan menambah extension tanpa migration/test.
- Batasi query berulang ketika peta bergerak; query viewport diberi debounce.

## 8. Kesalahan dan idempotency

API return categories yang disarankan: `UNAUTHENTICATED`, `NOT_AUTHORIZED`, `RIDE_NOT_ACTIVE`, `VALIDATION_ERROR`, `RATE_LIMITED`, `CONFLICT`, `TEMPORARY_UNAVAILABLE`.

Operasi create/join/start/end yang mungkin diulang perlu idempotency key atau state precondition. Retry hanya untuk operasi yang aman diulang; jangan membuat ulang message/report setiap retry.
