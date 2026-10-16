-- RodaKawan Milestone 2: akses klub privat hanya untuk anggota aktif.
--
-- Masalah yang ditutup
-- ---------------------------------------------------------------------------
-- `clubs_select_public_or_member` dan `clubs_update_admin` pada
-- `20261013022938_initial_schema.sql` memberi klausa `created_by = auth.uid()`.
-- Akibatnya pembuat klub **selamanya** dapat membaca (dan mengubah) klub privat
-- walaupun ia sudah keluar, sudah diturunkan menjadi member biasa, atau sudah
-- dikeluarkan: `created_by` tidak pernah berubah dan tidak melihat status
-- keanggotaan. Uji RLS Milestone 2 memperlihatkan akibatnya secara langsung
-- ("mantan anggota masih membaca klub privat").
--
-- Perbaikan
-- ---------------------------------------------------------------------------
-- Akses baca/tulis klub sekarang hanya mengikuti keanggotaan aktif:
--   * `is_club_member` = baris keanggotaan berstatus `active` (owner/admin/member);
--   * `is_club_admin`  = keanggotaan aktif dengan peran owner/admin.
-- Owner yang mengalihkan kepemilikan tetap punya akses karena ia menjadi anggota
-- aktif (peran `member`), dan pembuatan klub tidak terpengaruh karena
-- `create_club()` adalah fungsi definer yang mengembalikan barisnya sendiri.
--
-- Policy lama TIDAK diubah di migration lamanya (riwayat remote tidak boleh
-- bergeser); policy diganti di sini dengan nama yang sama supaya perilakunya satu
-- sumber dan mudah dibaca.

drop policy if exists "clubs_select_public_or_member" on public.clubs;
create policy "clubs_select_public_or_member" on public.clubs
  for select to authenticated using (visibility = 'public' or public.is_club_member(id));

drop policy if exists "clubs_update_admin" on public.clubs;
create policy "clubs_update_admin" on public.clubs
  for update to authenticated
  using (public.is_club_admin(id))
  with check (public.is_club_admin(id));
