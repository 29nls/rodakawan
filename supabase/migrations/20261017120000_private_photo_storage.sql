-- RodaKawan Milestone 2 (lanjutan): foto kendaraan dan logo klub di Supabase Storage.
--
-- Kenapa bucket terpisah
-- ---------------------------------------------------------------------------
-- Foto kendaraan dan logo klub punya audiens yang berbeda, jadi tidak boleh berbagi
-- satu bucket dengan satu policy:
--
--   vehicle-photos : hanya pemilik kendaraan yang boleh membaca, mengunggah,
--                    mengganti, dan menghapus objeknya. Foto bukan data publik
--                    walaupun profil pemiliknya publik.
--   club-logos     : boleh dibaca anggota aktif klub dan siapa pun yang boleh
--                    melihat klub publik; hanya owner/admin aktif yang boleh
--                    menulis.
--
-- Keduanya **privat** (`public = false`). Tidak ada URL objek permanen yang bisa
-- dipakai tanpa signed URL, sehingga tautan yang bocor tidak membuka foto.
--
-- Bentuk path adalah bagian dari otorisasi, bukan sekadar kerapian:
--
--   vehicle-photos/<owner_id>/<motorcycle_id>/<file>
--   club-logos/<club_id>/<file>
--
-- Policy membaca segmen pertama lewat `storage.foldername(name)`, sehingga objek
-- di folder pengguna/klub lain tidak pernah cocok. `storage.objects` sudah
-- mengaktifkan RLS; policy di bawah hanya diberikan kepada `authenticated`,
-- jadi peran `anon` tidak memiliki jalur baca/tulis sama sekali.
--
-- Batas ukuran dan tipe juga ditegakkan bucket, bukan hanya aplikasi:
--   - foto kendaraan maksimal 5 MiB
--   - logo klub maksimal 2 MiB
--   - hanya image/jpeg, image/png, dan image/webp
--
-- Migration ini juga menambahkan CHECK pada kolom penunjuk path. Tanpa itu,
-- pengguna yang sah masih bisa menautkan `photo_path`/`logo_path` ke objek milik
-- orang lain (kolomnya hanya teks), lalu aplikasi meminta signed URL untuk objek
-- itu. Dengan CHECK, database menolak path yang tidak berada di folder entitasnya.
--
-- Catatan implementasi: migration ditulis idempoten untuk bucket dan policy saja
-- (`on conflict`/`drop policy if exists`), karena project development pernah
-- diperiksa memiliki 0 bucket. Constraint tetap ditambahkan sekali; migration
-- Supabase tidak dijalankan dua kali pada database yang sama.

-- 1. Bucket privat beserta batas ukuran dan tipe berkas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'vehicle-photos',
    'vehicle-photos',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'club-logos',
    'club-logos',
    false,
    2097152,
    array['image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Foto kendaraan: owner-only untuk seluruh operasi.
drop policy if exists vehicle_photos_select_owner on storage.objects;
create policy vehicle_photos_select_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists vehicle_photos_insert_owner on storage.objects;
create policy vehicle_photos_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.motorcycles m
      where m.id::text = (storage.foldername(name))[2]
        and m.owner_id = auth.uid()
    )
  );

drop policy if exists vehicle_photos_update_owner on storage.objects;
create policy vehicle_photos_update_owner on storage.objects
  for update to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.motorcycles m
      where m.id::text = (storage.foldername(name))[2]
        and m.owner_id = auth.uid()
    )
  );

-- DELETE sengaja tidak mensyaratkan kendaraan masih ada: setelah kendaraan
-- dihapus, pemilik tetap harus bisa membersihkan objeknya (atau file yatim akan
-- tertinggal selamanya). Yang dijaga adalah folder pemiliknya.
drop policy if exists vehicle_photos_delete_owner on storage.objects;
create policy vehicle_photos_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3. Logo klub: baca untuk anggota aktif atau klub publik; tulis hanya owner/admin.
drop policy if exists club_logos_select_allowed on storage.objects;
create policy club_logos_select_allowed on storage.objects
  for select to authenticated
  using (
    bucket_id = 'club-logos'
    and exists (
      select 1
      from public.clubs c
      where c.id::text = (storage.foldername(name))[1]
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
      where c.id::text = (storage.foldername(name))[1]
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
      where c.id::text = (storage.foldername(name))[1]
        and public.is_club_admin(c.id)
    )
  )
  with check (
    bucket_id = 'club-logos'
    and exists (
      select 1
      from public.clubs c
      where c.id::text = (storage.foldername(name))[1]
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
      where c.id::text = (storage.foldername(name))[1]
        and public.is_club_admin(c.id)
    )
  );

-- 4. Path yang ditautkan kolom harus berada di folder entitasnya sendiri.
--    Ini menutup kasus "unggah ke folder sendiri lalu tautkan ke baris orang lain".
alter table public.motorcycles
  add constraint motorcycles_photo_path_owner
  check (
    photo_path is null
    or (
      split_part(photo_path, '/', 1) = owner_id::text
      and split_part(photo_path, '/', 2) = id::text
      and split_part(photo_path, '/', 3) <> ''
    )
  );

alter table public.clubs
  add constraint clubs_logo_path_owner
  check (
    logo_path is null
    or (
      split_part(logo_path, '/', 1) = id::text
      and split_part(logo_path, '/', 2) <> ''
    )
  );
