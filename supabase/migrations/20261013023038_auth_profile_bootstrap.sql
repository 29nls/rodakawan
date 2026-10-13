-- RodaKawan Milestone 1: bootstrap profil, penguatan aturan profil, dan hak akses.
--
-- Kenapa trigger, bukan pembuatan profil dari klien?
-- * `public.profiles.id` adalah target foreign key hampir seluruh tabel lain
--   (motorcycles, clubs, rides, chat, hazard, dst.). Setiap akun harus punya
--   baris profil agar fitur berikutnya tidak gagal karena FK.
-- * Pembuatan profil saat fase "belum ada sesi" (email konfirmasi menyala) tidak
--   mungkin dilakukan klien, jadi titik yang dapat dipercaya adalah pembuatan akun
--   di `auth.users`.
-- * Metadata pengguna TIDAK dipakai untuk otorisasi apa pun; hanya nilai awal.
--
-- Perilaku aman yang dipilih:
-- * Username dinormalkan (huruf kecil, hanya [a-z0-9_]) dan divalidasi panjang 3-30.
-- * Bila username permintaan tidak valid atau sudah dipakai, profil tetap dibuat
--   dengan username sementara `rider_<acak>` sehingga pendaftaran TIDAK gagal dan
--   tidak ada profil ganda (primary key = auth.users.id).
-- * Aplikasi memberi tahu pengguna bahwa username-nya masih sementara dan harus
--   diganti di layar Profil (lihat src/app/(tabs)/profile.tsx).
--
-- Migration ini idempotent dan tidak menghapus data.

-- 1. Fungsi bootstrap profil -------------------------------------------------
create or replace function public.bootstrap_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_username text;
  v_username text;
  v_display_name text;
  v_attempt int := 0;
begin
  v_requested_username := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_requested_username := regexp_replace(v_requested_username, '[^a-z0-9_]', '', 'g');

  if v_requested_username ~ '^[a-z0-9_]{3,30}$' then
    v_username := v_requested_username;
  else
    v_username := null;
  end if;

  v_display_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if v_display_name = '' then
    v_display_name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;
  if v_display_name is null or char_length(v_display_name) > 80 then
    v_display_name := 'Pengguna RodaKawan';
  end if;

  -- Usaha pertama: pakai username pilihan pengguna.
  if v_username is not null then
    begin
      insert into public.profiles (id, username, display_name)
      values (new.id, v_username, v_display_name);
      return new;
    exception
      when unique_violation then
        -- Username sudah dipakai akun lain: lanjut ke username sementara.
        null;
    end;
  end if;

  -- Username sementara; diulang bila kebetulan bertabrakan.
  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.profiles (id, username, display_name)
      values (
        new.id,
        'rider_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
        v_display_name
      );
      return new;
    exception
      when unique_violation then
        if v_attempt >= 5 then
          raise;
        end if;
    end;
  end loop;
end;
$$;

comment on function public.bootstrap_profile() is
  'AFTER INSERT auth.users: membuat baris public.profiles dengan username tervalidasi atau username sementara rider_<acak>.';

-- Trigger hanya boleh dijalankan oleh trigger, bukan dipanggil langsung klien.
revoke all on function public.bootstrap_profile() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.bootstrap_profile();

-- 2. Kolom updated_at selalu diisi server -------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.touch_updated_at() is
  'BEFORE UPDATE: menulis updated_at dari waktu server agar klien tidak bisa memalsukannya.';

revoke all on function public.touch_updated_at() from public;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row
  execute function public.touch_updated_at();

-- 3. Penguatan format username -------------------------------------------------
-- Panjang sudah dibatasi pada migration awal (20261013022938_initial_schema.sql); di sini
-- ditambahkan pola karakter
-- supaya aturan "huruf kecil, angka, garis bawah" juga dijamin database.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_username_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_format
      check (username ~ '^[a-z0-9_]{3,30}$');
  end if;
end;
$$;

-- 4. Catatan hak akses ---------------------------------------------------------
-- RLS pada public.profiles (migration awal, 20261013022938_initial_schema.sql) sudah membatasi:
-- * SELECT: pemilik, profil publik, atau pengikut (tidak ada policy untuk anon);
-- * INSERT/UPDATE: hanya baris dengan id = auth.uid();
-- * DELETE: tidak ada policy (penghapusan akun ditangani backend, Milestone 5).
-- Tidak ada policy yang dilonggarkan pada migration ini.
