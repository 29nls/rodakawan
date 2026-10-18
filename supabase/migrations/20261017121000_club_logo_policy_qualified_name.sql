-- Perbaikan policy Storage logo klub: kualifikasi `objects.name`.
--
-- Kenapa migration tersendiri
-- ---------------------------------------------------------------------------
-- `20261017120000_private_photo_storage.sql` sudah diterapkan ke project
-- development, jadi isinya tidak diubah. Policy klub di migration itu menulis
-- `storage.foldername(name)` di dalam subquery terhadap `public.clubs`, dan
-- `clubs` juga punya kolom `name`. PostgreSQL menyelesaikan nama yang tidak
-- dikualifikasi ke kolom terdekat, sehingga yang dibaca adalah **nama tampilan
-- klub**, bukan nama objek Storage. Akibatnya folder `<club_id>/...` tidak pernah
-- cocok dan anggota klub tidak bisa membaca logonya sendiri.
--
-- Uji Storage menangkapnya (owner klub publik membaca 0 baris), lalu policy
-- diperbaiki di sini dengan `storage.foldername(objects.name)`. `objects.name`
-- adalah nama tabel di dalam policy `storage.objects`; qualifier ini tidak
-- bergantung pada alias tabel lain di subquery.
--
-- Policy kendaraan tidak terpengaruh karena subquery-nya hanya menyentuh
-- `public.motorcycles`, yang tidak punya kolom `name` — tetapi nama objek di
-- sana juga sudah dikualifikasi oleh planner sebagai `objects.name`.

drop policy if exists club_logos_select_allowed on storage.objects;
create policy club_logos_select_allowed on storage.objects
  for select to authenticated
  using (
    bucket_id = 'club-logos'
    and exists (
      select 1
      from public.clubs c
      where c.id::text = (storage.foldername(objects.name))[1]
        and (c.visibility = 'public' or public.is_club_member(c.id))
    )
  );

drop policy if exists club_logos_insert_admin on storage.objects;
create policy club_logos_insert_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'club-logos'
    and exists (
      select 1
      from public.clubs c
      where c.id::text = (storage.foldername(objects.name))[1]
        and public.is_club_admin(c.id)
    )
  );

drop policy if exists club_logos_update_admin on storage.objects;
create policy club_logos_update_admin on storage.objects
  for update to authenticated
  using (
    bucket_id = 'club-logos'
    and exists (
      select 1
      from public.clubs c
      where c.id::text = (storage.foldername(objects.name))[1]
        and public.is_club_admin(c.id)
    )
  )
  with check (
    bucket_id = 'club-logos'
    and exists (
      select 1
      from public.clubs c
      where c.id::text = (storage.foldername(objects.name))[1]
        and public.is_club_admin(c.id)
    )
  );

drop policy if exists club_logos_delete_admin on storage.objects;
create policy club_logos_delete_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'club-logos'
    and exists (
      select 1
      from public.clubs c
      where c.id::text = (storage.foldername(objects.name))[1]
        and public.is_club_admin(c.id)
    )
  );
