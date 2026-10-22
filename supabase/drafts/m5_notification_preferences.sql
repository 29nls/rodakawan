-- DRAF Milestone 5 — preferensi notifikasi per pengguna.
--
-- BERKAS INI BELUM DITERAPKAN dan bukan migration. Ia ada di `supabase/drafts/`
-- karena skema yang menyentuh kebijakan produk (kategori apa yang boleh dikirim,
-- apakah jam tenang dihormati) harus disetujui dulu, dan migration yang sudah
-- diterapkan tidak boleh disunting. Draf M3 dulu juga tinggal di direktori ini dan
-- dihapus (`554a507`) saat isinya menjadi migration — pola yang sama dipakai di sini.
-- `npm run db:test`, `db:test:lint`, dan `db:types` hanya membaca
-- `supabase/migrations` + `supabase/tests`, jadi berkas ini tidak ikut dijalankan
-- dan tidak memicu build APK (ADR-074).
--
-- Yang SUDAH ada di `20261013022938_initial_schema.sql` dan karena itu TIDAK
-- dibuat ulang di sini:
--   * `public.notifications` — `recipient_id`, `actor_id`, `kind`
--     (`ride_invite`, `ride_started`, `ride_ended`, `club_join_request`,
--     `club_join_approved`, `like`, `comment`, `follow`, `follow_back`, `system`),
--     `entity_type`, `entity_id`, `payload`, `read_at`; RLS: penerima boleh
--     SELECT dan menandai sudah dibaca, **tidak ada** policy INSERT (hanya
--     backend tepercaya yang menulis).
--   * `public.push_tokens` — `user_id`, `token unique`, `platform`
--     (`android`/`ios`/`other`), `device_label`, `last_seen_at`; RLS: pengguna
--     penuh atas barisnya sendiri.
--
-- Yang belum ada: preferensi. Tanpa tabel ini, satu-satunya cara "mematikan
-- notifikasi" adalah menghapus token — padahal pengguna biasanya hanya ingin
-- mematikan satu kategori, bukan mencabut seluruh perangkat.
--
-- Isi berkas ini adalah **badan migration** apa adanya (tanpa BEGIN/COMMIT
-- sendiri), supaya bisa disalin utuh menjadi migration baru setelah keputusan
-- produk di bawah diambil.

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Kategori yang dikirim M5. Menambah kategori berarti menambah kolom baru
  -- dengan DEFAULT eksplisit, bukan melonggarkan CHECK di bawah.
  ride_invites boolean not null default true,
  ride_status boolean not null default true,
  chat_activity boolean not null default false,
  -- Jam tenang dalam waktu lokal perangkat dikirim sebagai UTC offset-aware
  -- `time`; null pada keduanya berarti tidak ada jam tenang.
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now(),
  constraint notification_preferences_quiet_hours_pair
    check ((quiet_hours_start is null) = (quiet_hours_end is null)),
  constraint notification_preferences_quiet_hours_window
    check (quiet_hours_start <> quiet_hours_end)
);

comment on table public.notification_preferences is
  'Preferensi notifikasi per pengguna (M5). Baris dibuat malas saat pengguna pertama kali mengubah pengaturan; tidak adanya baris berarti semua DEFAULT di atas.';

alter table public.notification_preferences enable row level security;

-- Pemilik satu-satunya yang boleh membaca dan menulis preferensinya. Tidak ada
-- policy DELETE: mematikan notifikasi bukan menghapus baris, dan profil yang
-- dihapus sudah ikut menghapus baris ini lewat `on delete cascade`.
create policy "notification_preferences_select_self" on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());
create policy "notification_preferences_insert_self" on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());
create policy "notification_preferences_update_self" on public.notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- Jalur tulis memakai tabel langsung (SELECT/INSERT/UPDATE policy di atas),
-- bukan RPC: tidak ada batas laju, idempotensi, atau nilai turunan yang perlu
-- ditegakkan server, jadi menambah `security definer` hanya menambah permukaan.
-- Upsert dari klien (`insert ... on conflict (user_id) do update`) bekerja karena
-- INSERT dan UPDATE dua-duanya diizinkan untuk `authenticated`.
--
-- PENGIRIM (belum ada di repo ini, direncanakan sebagai Edge Function):
--   1. baca `notification_preferences` penerima; tidak ada baris = DEFAULT;
--   2. lewati kategori yang dimatikan dan jam tenang (kecuali `system`);
--   3. tulis baris `public.notifications` (backend-only) sebagai catatan;
--   4. kirim lewat Expo Push API ke setiap `push_tokens` penerima;
--   5. hapus baris token yang ditolak penyedia (`DeviceNotRegistered`), karena
--      token itu tidak bisa dipakai lagi oleh siapa pun.
--
-- KEPUTUSAN YANG HARUS DIAMBIL SEBELUM INI MENJADI MIGRATION:
--   * `push_tokens` sekarang tidak punya `revoked_at`/`last_seen` yang bisa
--     dipakai membedakan token mati dari token yang belum pernah dipakai.
--     Menambahkannya = satu migration terpisah, aditif.
--   * Idempotensi pengiriman belum punya tempat: unique parsial
--     `(recipient_id, kind, entity_id)` pada `notifications` akan menolak
--     notifikasi sah berulang untuk entitas yang sama (mis. dua perubahan status
--     pada satu perjalanan). Alternatifnya tabel `notification_deliveries`
--     ber-`dedupe_key`, dan itu perlu diputuskan bersama idempotensi RPC
--     `rides`.
--   * `chat_activity` sengaja DEFAULT false: pesan konvoi sudah realtime, dan
--     notifikasi per pesan berisiko membanjiri perangkat saat konvoi ramai.
--   * Jam tenang disimpan sebagai `time` tanpa zona; kalau nanti perlu dihormati
--     lintas zona, ganti ke `timestamptz` per pengguna atau simpan zona IANA —
--     keduanya perubahan skema, bukan penafsiran di sisi pengirim.
