-- RodaKawan — uji RLS tabel public.profiles (Milestone 1)
--
-- Tujuan: membuktikan bahwa
--   1. bootstrap trigger membuat profil untuk akun baru dan menormalkan username;
--   2. user A dapat membaca dan mengubah profilnya sendiri;
--   3. user A TIDAK dapat membaca profil privat user B, dan tidak dapat menyentuh
--      baris user B (update 0 baris, insert ditolak);
--   4. username duplikat ditolak unique constraint, format salah ditolak CHECK;
--   5. peran `anon` tidak melihat satu pun baris profil;
--   6. kontrol positif: profil PUBLIK user B memang terbaca user A (kalau tidak,
--      asersi "tidak membaca profil privat" bisa lulus secara palsu);
--   7. penghapusan profil sendiri ditolak (tidak ada policy DELETE);
--   8. peran `anon` juga ditolak untuk INSERT dan UPDATE, bukan hanya SELECT.
--
-- Cara menjalankan (project development, JANGAN produksi):
--   npm run db:test            (runner Node, membaca DATABASE_URL)
--   psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_profiles_test.sql
-- atau tempelkan seluruh isi berkas ini ke Supabase Dashboard → SQL Editor.
--
-- Prasyarat peran: koneksi harus memakai kredensial pemilik/superuser database
-- (mis. `postgres` pada project Supabase development), karena blok persiapan di
-- bawah menulis ke `auth.users` dan mengubah `is_private` melewati RLS.
--
-- Seluruh perubahan dibungkus satu transaksi dan diakhiri ROLLBACK, sehingga tidak
-- ada pengguna/profil uji yang tertinggal di database.

begin;

-- 0. Bersihkan sisa uji sebelumnya (id tetap, hanya untuk keamanan pengulangan).
delete from public.profiles where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);

-- 1. Dua akun uji. Trigger 0002 harus membuat profilnya.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'uji.a@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"uji_user_a","display_name":"Uji User A"}',
    now(), now()
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'uji.b@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"uji_user_b","display_name":"Uji User B"}',
    now(), now()
  );

do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.profiles
  where id in (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222'
  );

  if v_count <> 2 then
    raise exception 'UJI GAGAL: bootstrap trigger membuat % profil (harus 2)', v_count;
  end if;

  if not exists (
    select 1 from public.profiles
    where id = '11111111-1111-1111-1111-111111111111' and username = 'uji_user_a'
  ) then
    raise exception 'UJI GAGAL: username pilihan pengguna tidak dipakai saat bootstrap';
  end if;
end;
$$;

-- 1b. Username tidak valid / sudah dipakai → tetap dibuat, memakai rider_<acak>.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'uji.c@contoh.test', now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"uji_user_a","display_name":"Uji User C"}',
  now(), now()
);

do $$
declare
  v_username text;
begin
  select username into v_username
  from public.profiles
  where id = '33333333-3333-3333-3333-333333333333';

  if v_username is null then
    raise exception 'UJI GAGAL: profil tidak dibuat saat username sudah dipakai (pendaftaran harus tetap berhasil)';
  end if;

  if v_username !~ '^rider_[a-f0-9]{10}$' then
    raise exception 'UJI GAGAL: username sementara tidak sesuai pola, dapat: %', v_username;
  end if;
end;
$$;

delete from auth.users where id = '33333333-3333-3333-3333-333333333333';

-- 2. Jadikan profil B privat supaya uji baca lintas pengguna bermakna.
update public.profiles
set is_private = true
where id = '22222222-2222-2222-2222-222222222222';

-- 3. Konteks sebagai user A (peran `authenticated` + klaim JWT).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 3a. A melihat profilnya sendiri.
do $$
declare
  v_visible int;
begin
  select count(*) into v_visible
  from public.profiles
  where id = '11111111-1111-1111-1111-111111111111';

  if v_visible <> 1 then
    raise exception 'UJI GAGAL: user A tidak dapat membaca profilnya sendiri (% baris)', v_visible;
  end if;
end;
$$;

-- 3b. A TIDAK melihat profil privat B.
do $$
declare
  v_visible int;
begin
  select count(*) into v_visible
  from public.profiles
  where id = '22222222-2222-2222-2222-222222222222';

  if v_visible <> 0 then
    raise exception 'UJI GAGAL: user A dapat membaca profil privat user B (% baris)', v_visible;
  end if;
end;
$$;

-- 3c. A dapat mengubah profilnya sendiri (1 baris).
do $$
declare
  v_rows int;
begin
  update public.profiles
  set display_name = 'Uji User A (baru)'
  where id = '11111111-1111-1111-1111-111111111111';

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: user A tidak dapat mengubah profilnya sendiri (% baris)', v_rows;
  end if;
end;
$$;

-- 3d. A TIDAK dapat mengubah profil B (0 baris, tanpa error).
do $$
declare
  v_rows int;
begin
  update public.profiles
  set display_name = 'Diretas oleh A'
  where id = '22222222-2222-2222-2222-222222222222';

  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: user A mengubah % baris milik user B', v_rows;
  end if;
end;
$$;

-- 3e. A TIDAK dapat membuat baris profil untuk B.
do $$
begin
  insert into public.profiles (id, username, display_name)
  values ('22222222-2222-2222-2222-222222222222', 'palsu_b', 'Palsu');

  raise exception 'UJI GAGAL: user A berhasil membuat/menimpa profil user B';
exception
  when insufficient_privilege then
    null; -- ditolak RLS: perilaku yang benar
end;
$$;

-- 3f. Username duplikat ditolak unique constraint.
do $$
begin
  update public.profiles
  set username = 'uji_user_b'
  where id = '11111111-1111-1111-1111-111111111111';

  raise exception 'UJI GAGAL: username duplikat diterima';
exception
  when unique_violation then
    null; -- ditolak: perilaku yang benar
end;
$$;

-- 3g. Format username salah ditolak CHECK constraint (pola karakter migration 0002).
do $$
begin
  update public.profiles
  set username = 'Huruf Besar'
  where id = '11111111-1111-1111-1111-111111111111';

  raise exception 'UJI GAGAL: format username tidak valid diterima database';
exception
  when check_violation then
    null; -- ditolak: perilaku yang benar
end;
$$;

-- 3h. A TIDAK dapat menghapus profilnya sendiri (tidak ada policy DELETE).
do $$
declare
  v_rows int;
begin
  delete from public.profiles where id = '11111111-1111-1111-1111-111111111111';

  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: user A menghapus % baris profil (policy DELETE seharusnya tidak ada)', v_rows;
  end if;
end;
$$;

-- 4. Anon tidak melihat apa pun.
reset role;
set local role anon;
set local request.jwt.claims = '{}';

do $$
declare
  v_visible bigint;
begin
  select count(*) into v_visible from public.profiles;

  if v_visible <> 0 then
    raise exception 'UJI GAGAL: peran anon melihat % baris profil', v_visible;
  end if;
end;
$$;

-- 4b. Anon juga tidak dapat mengubah profil siapa pun.
do $$
declare
  v_rows int;
begin
  update public.profiles
  set display_name = 'Diubah oleh anon'
  where id = '11111111-1111-1111-1111-111111111111';

  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: peran anon mengubah % baris profil', v_rows;
  end if;
end;
$$;

-- 4c. Anon tidak dapat membuat baris profil, walau id-nya milik akun yang ada
--     (jalur yang mencegah pembuatan profil atas nama akun orang lain).
reset role;

insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '44444444-4444-4444-4444-444444444444',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'uji.d@contoh.test', now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"uji_user_d","display_name":"Uji User D"}',
  now(), now()
);

-- Kosongkan profil akun itu (sebagai pemilik database) supaya tidak ada konflik
-- primary key/foreign key yang menyamarkan penolakan RLS.
delete from public.profiles where id = '44444444-4444-4444-4444-444444444444';

set local role anon;
set local request.jwt.claims = '{}';

do $$
declare
  v_rows int;
begin
  insert into public.profiles (id, username, display_name)
  values ('44444444-4444-4444-4444-444444444444', 'anon_baru', 'Anon');

  get diagnostics v_rows = row_count;
  raise exception 'UJI GAGAL: peran anon membuat % baris profil', v_rows;
exception
  when insufficient_privilege then
    null; -- ditolak RLS: perilaku yang benar
end;
$$;

reset role;

-- 5. Kontrol positif: profil PUBLIK user B harus terbaca user A.
--    Tanpa asersi ini, uji 3b dapat lulus walaupun policy SELECT menolak semua baris
--    (mis. policy salah ketik) — jadi kontrol positif wajib ada.
update public.profiles
set is_private = false
where id = '22222222-2222-2222-2222-222222222222';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_visible int;
begin
  select count(*) into v_visible
  from public.profiles
  where id = '22222222-2222-2222-2222-222222222222';

  if v_visible <> 1 then
    raise exception 'UJI GAGAL: user A tidak dapat membaca profil publik user B (% baris)', v_visible;
  end if;
end;
$$;

reset role;

do $$
begin
  raise notice 'UJI RLS PROFIL LULUS: izin dan penolakan sesuai harapan.';
end;
$$;

rollback;
