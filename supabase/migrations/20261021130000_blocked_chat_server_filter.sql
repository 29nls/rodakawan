-- ============================================================================
-- RodaKawan — Penyaringan pesan dari pengguna yang diblokir dipindahkan ke server.
--
-- Kenapa:
-- Sebelum migration ini, `chat_select_ride_member` mengirim **semua** pesan
-- ride kepada setiap anggota. Aplikasi lalu menyembunyikan isi pesan dari
-- pengguna yang ia blokir di sisi klien (`hiddenByBlock`) dan menggantinya
-- dengan teks "Pesan disembunyikan". Akibatnya isi pesan itu tetap dikirim ke
-- perangkat lewat REST **dan** lewat Postgres Changes — penyembunyian hanya
-- kosmetik, bukan jaminan privasi. Migration ini memindahkan penyaringan ke
-- policy SELECT sehingga barisnya tidak pernah meninggalkan server.
--
-- Yang berubah:
--   1. helper `public.is_blocked_by_me(p_user_id)` — `security definer`
--      (`search_path = ''`), hanya membaca `user_blocks` milik `auth.uid()`;
--   2. policy `chat_select_ride_member` diganti bentuknya: anggota ride **dan**
--      bukan pesan teks dari pengguna yang memblokir saya.
--
-- Yang **tidak** berubah:
--   - nama policy tetap, dan penjaga keanggotaan `is_ride_member` tetap ada
--     (syarat pagar ADR-060);
--   - pesan sistem (`message_type = 'system'`) tetap terlihat walau pelakunya
--     diblokir: isinya bukan pesan pribadi, dan menyembunyikan "Perjalanan
--     dimulai" hanya karena host diblokir akan menghilangkan informasi
--     keselamatan;
--   - blokir tetap satu arah dan privat: `user_blocks` hanya terbaca pemilik
--     daftar, dan pengguna yang diblokir tidak tahu ia diblokir;
--   - tidak ada baris yang dihapus: membuka blokir langsung memunculkan kembali
--     riwayat, dan moderator tetap dapat membaca konten yang dilaporkan lewat
--     `get_moderation_subject` (definer, ADR-067).
--
-- Konsekuensi yang disengaja: klien tidak lagi memuat daftar blokir dan tidak
-- lagi punya jalur untuk menerima isi pesan itu. Paginasi tetap benar karena
-- RLS diterapkan sebelum `LIMIT`; halaman bisa berisi lebih sedikit pesan, dan
-- `limit + 1` hanya menghitung baris yang terlihat.
-- ============================================================================

-- 1. Blokir hanya dibaca dari sisi pemblokir. `auth.uid()` tidak pernah menjadi
--    parameter, sehingga fungsi ini tidak bisa dipakai memeriksa hubungan
--    blokir orang lain.
create or replace function public.is_blocked_by_me(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and p_user_id is not null
    and exists (
      select 1
        from public.user_blocks ub
       where ub.blocker_id = auth.uid()
         and ub.blocked_id = p_user_id
    );
$$;

revoke all on function public.is_blocked_by_me(uuid) from public;
revoke all on function public.is_blocked_by_me(uuid) from anon;
grant execute on function public.is_blocked_by_me(uuid) to authenticated;

-- 2. Policy baca chat yang sudah ada diganti bentuknya. Dijalankan idempotent
--    agar migration aman diulang pada database yang sudah pernah menerapkannya.
drop policy if exists "chat_select_ride_member" on public.chat_messages;
create policy "chat_select_ride_member" on public.chat_messages
  for select to authenticated using (
    public.is_ride_member(ride_id)
    and not (
      message_type = 'text'
      and public.is_blocked_by_me(sender_id)
    )
  );
