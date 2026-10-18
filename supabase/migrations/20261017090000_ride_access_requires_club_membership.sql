-- RodaKawan: akses `public.rides` mengikuti keanggotaan container-nya.
--
-- Masalah yang ditutup
-- ---------------------------------------------------------------------------
-- `rides_select_allowed` dari `20261013022938_initial_schema.sql` memuat klausa
--
--   created_by = auth.uid()
--
-- tanpa syarat apa pun. Untuk perjalanan yang menempel ke klub (`club_id is not
-- null`), klausa itu membuat pembuat perjalanan **selamanya** membaca barisnya —
-- judul, jadwal, titik temu — setelah ia keluar, dikeluarkan, atau ditolak dari
-- klub. Ini pola yang sama dengan `created_by` pada `public.clubs` yang ditutup
-- di `20261016100000_club_membership_owns_private_access.sql`, dan setelah
-- migration itu ia satu-satunya klausa `created_by` yang tersisa di seluruh
-- policy `public`.
--
-- Sebelum diperbaiki, hal ini dibuktikan langsung di database development:
-- pengguna yang membuat perjalanan `visibility='club'` di klub privat lalu keluar
-- dari klub tetap membaca baris perjalanan itu (`PROBE ride klub oleh A`), padahal
-- ia tidak lagi melihat klub, post, komentar, maupun pesan klub tersebut.
--
-- Model yang dipakai sekarang
-- ---------------------------------------------------------------------------
--   * `visibility='public'`          → semua pengguna terautentikasi (fitur publik).
--   * `club_id is null` (tanpa klub) → pembuat atau peserta aktif perjalanan.
--   * `club_id is not null`          → **wajib** anggota aktif klub itu, ditambah
--                                      salah satu: terlihat oleh klub
--                                      (`visibility='club'`), peserta aktif, atau
--                                      pembuatnya.
--
-- Artinya `created_by` tidak lagi membuka apa pun sendirian: pada perjalanan klub
-- ia hanya berlaku selama klubnya masih menganggap pengguna itu anggota aktif.
-- Untuk perjalanan tanpa klub, kepemilikan tetap dasar yang sah karena tidak ada
-- container lain yang bisa dipakai.
--
-- Yang sengaja TIDAK diubah
-- ---------------------------------------------------------------------------
--   * Peserta yang masih `joined` **dan** masih anggota aktif klub tetap membaca
--     perjalanan klub; keanggotaan perjalanan adalah container perjalanan itu
--     sendiri, bukan pengganti keanggotaan klub.
--   * `ride_members`, `ride_locations`, dan `chat_messages` tidak disentuh: ketiga
--     tabel itu sudah memakai `is_ride_member`/`is_ride_active_member`, yang hanya
--     menerima `status='joined'` (dan `rides.status='active'` untuk lokasi).
--   * Pembuatan perjalanan tetap tanpa policy INSERT; RPC pembuatannya (yang juga
--     membuat baris host `ride_members`) belum ada dan direncanakan di
--     `docs/MILESTONE_3_PLAN.md`.
--
-- Migration ini diganti dengan nama policy yang sama supaya perilakunya satu
-- sumber; migration lama tidak diubah karena sudah tercatat di database remote.

drop policy if exists "rides_select_allowed" on public.rides;

create policy "rides_select_allowed" on public.rides
  for select to authenticated using (
    -- Perjalanan publik memang untuk semua pengguna terautentikasi.
    visibility = 'public'
    -- Perjalanan tanpa klub: hanya pembuat dan peserta aktifnya.
    or (club_id is null and (created_by = auth.uid() or public.is_ride_member(id)))
    -- Perjalanan milik klub: keanggotaan klub aktif adalah syarat, bukan opsional.
    or (
      club_id is not null
      and public.is_club_member(club_id)
      and (
        visibility = 'club'
        or public.is_ride_member(id)
        or created_by = auth.uid()
      )
    )
  );
