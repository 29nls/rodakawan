-- RodaKawan: foto profil (avatar) di bucket privat dengan policy owner-only.
--
-- Kenapa bucket terpisah dari `vehicle-photos`
-- ---------------------------------------------------------------------------
-- Pola otorisasinya sama dengan foto kendaraan (ADR-056/ADR-059), tetapi audiens
-- dan bentuk path-nya berbeda: avatar hanya punya satu folder per pengguna
-- (`<user_id>/<berkas>`) dan tidak bergantung pada baris entitas lain seperti
-- kendaraan atau klub. Bucket terpisah membuat policy-nya tetap sederhana: kalau
-- digabung ke `vehicle-photos`, setiap policy kendaraan harus mengecualikan
-- bucket lain, dan satu kesalahan penulisan bisa membuka foto kendaraan.
--
--   avatars : privat (`public = false`), maksimal 2 MiB, hanya JPEG/PNG/WEBP.
--             SELECT/INSERT/UPDATE/DELETE hanya untuk folder pemiliknya, yaitu
--             `(storage.foldername(name))[1] = auth.uid()::text`. Tidak ada
--             policy untuk `anon`, sehingga tidak ada jalur baca tanpa sesi.
--
-- Path adalah bagian dari otorisasi: objek di folder pengguna lain tidak pernah
-- cocok dengan policy, dan tidak ada URL objek permanen — tampilan memakai signed
-- URL berumur pendek yang dibuat saat halaman dibuka.
--
-- Soal nama kolom: `public.profiles.avatar_url` sudah ada sejak migration awal.
-- Kolom itu kini menyimpan **path objek** (`<user_id>/<berkas>`) di bucket privat,
-- bukan URL publik seperti yang tersirat dari namanya; CHECK di bawah menjaga
-- bentuknya, dan nilainya tidak pernah dirender langsung sebagai URL. Nama kolom
-- sengaja tidak diubah supaya migration ini tidak menulis ulang skema yang sudah
-- dipakai tipe generated (`database.generated.ts`).
--
-- Migration ditulis idempoten untuk bucket dan policy (`on conflict`/`drop policy
-- if exists`) seperti migration Storage sebelumnya; constraint ditambahkan sekali.

-- 1. Bucket privat beserta batas ukuran dan tipe berkas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'avatars',
    'avatars',
    false,
    2097152,
    array['image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Avatar: owner-only untuk seluruh operasi.
drop policy if exists avatars_select_owner on storage.objects;
create policy avatars_select_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_insert_owner on storage.objects;
create policy avatars_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_update_owner on storage.objects;
create policy avatars_update_owner on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE tidak mensyaratkan baris profil masih ada: setelah profil dihapus
-- (atau saat pembersihan objek lama), pemilik tetap harus bisa menghapus
-- objeknya sendiri. Yang dijaga hanya foldernya.
drop policy if exists avatars_delete_owner on storage.objects;
create policy avatars_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3. Path yang ditautkan kolom harus berada di folder pengguna itu sendiri.
--    Tanpa CHECK, pengguna sah masih bisa menautkan avatar_url ke objek milik
--    orang lain (kolomnya hanya teks), lalu aplikasi meminta signed URL untuknya.
alter table public.profiles
  add constraint profiles_avatar_path_owner
  check (
    avatar_url is null
    or (
      split_part(avatar_url, '/', 1) = id::text
      and split_part(avatar_url, '/', 2) <> ''
    )
  );

comment on column public.profiles.avatar_url is
  'Path objek di bucket privat avatars (<user_id>/<berkas>), bukan URL publik. Tampilan memakai signed URL berumur pendek.';
