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
-- 8. peran `anon` juga ditolak untuk INSERT dan UPDATE, bukan hanya SELECT;
-- 9. follow ke profil privat TIDAK memberi akses baca. Permintaan berstatus `pending`
--    sampai pemilik profil menerimanya, termasuk bila klien menulis status `accepted`
--    sendiri (status ditentukan server);
-- 10. pemilik profil dapat menerima permintaan (`accept_follow_request`) dan mencabut akses
--    (DELETE), sedangkan UPDATE langsung pada `public.follows` selalu 0 baris;
-- 11. detail privat kendaraan hanya dapat dibuat/diubah untuk kendaraan milik sendiri,
--    termasuk ketika `motorcycle_id` diubah (dijaga policy dan foreign key komposit).
--
-- Cakupan berkas ini lebih luas dari namanya: ia adalah rangkaian uji RLS Milestone 1/1.6
-- untuk `public.profiles`, `public.follows`, dan `public.motorcycle_private_details`.
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
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555'
);
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555'
);

-- 0b. Paritas skema: pastikan migration Milestone 1.6 sudah diterapkan sebelum menguji.
--     Tanpa blok ini, berkas yang dijalankan di database lama gagal dengan error yang
--     membingungkan (mis. `column f.status does not exist`) alih-alih pesan yang jelas.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'follows' and column_name = 'status'
  ) then
    v_missing := v_missing || 'kolom public.follows.status'::text;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'accept_follow_request'
  ) then
    v_missing := v_missing || 'fungsi public.accept_follow_request(uuid)'::text;
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgname = 'follows_set_status' and t.tgrelid = 'public.follows'::regclass and not t.tgisinternal
  ) then
    v_missing := v_missing || 'trigger follows_set_status'::text;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'motorcycle_private_details_bike_owner_fkey'
      and conrelid = 'public.motorcycle_private_details'::regclass
  ) then
    v_missing := v_missing || 'foreign key motorcycle_private_details_bike_owner_fkey'::text;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'follows' and cmd = 'UPDATE'
  ) then
    v_missing := v_missing || 'policy UPDATE pada public.follows (seharusnya tidak ada)'::text;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'follows' and policyname = 'follows_delete_either_party'
  ) then
    v_missing := v_missing || 'policy follows_delete_either_party'::text;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'motorcycle_private_details'
      and policyname = 'motorcycle_private_update_owner'
  ) then
    v_missing := v_missing || 'policy motorcycle_private_update_owner'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (paritas skema): objek berikut belum ada — %. Terapkan migration Milestone 1.6 lebih dulu: 20261013140000_follow_consent_private_profiles.sql dan 20261013140100_private_vehicle_details_owner_integrity.sql.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Dua akun uji. Trigger bootstrap profil harus membuat barisnya.
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

-- 3g. Format username salah ditolak CHECK constraint (pola karakter dari migration bootstrap profil).
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

-- 6. Privasi profil: follow sendiri tidak memberi akses ------------------------
--    Skenario yang dulu bocor: A membuat baris `public.follows` untuk dirinya sendiri ke
--    profil privat B, lalu langsung bisa membaca profil B.
reset role;

update public.profiles
set is_private = true
where id = '22222222-2222-2222-2222-222222222222';

-- Akun uji ketiga (C) untuk membuktikan klien tidak bisa memaksa status 'accepted'.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '55555555-5555-5555-5555-555555555555',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'uji.e@contoh.test', now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"uji_user_e","display_name":"Uji User E"}',
  now(), now()
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 6a. A boleh membuat permintaan follow ke profil privat B.
do $$
begin
  insert into public.follows (follower_id, followed_id)
  values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

exception
  when insufficient_privilege then
    raise exception 'UJI GAGAL: user A tidak dapat membuat permintaan follow (status pending seharusnya boleh)';
end;
$$;

-- 6b. Status ditentukan server: permintaan ke profil privat = 'pending'.
do $$
declare
  v_status text;
begin
  select status into v_status
  from public.follows
  where follower_id = '11111111-1111-1111-1111-111111111111'
    and followed_id = '22222222-2222-2222-2222-222222222222';

  if v_status <> 'pending' then
    raise exception 'UJI GAGAL: status follow ke profil privat = % (harus pending)', coalesce(v_status, 'null');
  end if;
end;
$$;

-- 6c. INTI PERBAIKAN: A tetap TIDAK dapat membaca profil privat B.
do $$
declare
  v_visible int;
begin
  select count(*) into v_visible
  from public.profiles
  where id = '22222222-2222-2222-2222-222222222222';

  if v_visible <> 0 then
    raise exception 'UJI GAGAL: user A mendapat akses profil privat B hanya dengan membuat relasi follow sendiri (% baris)',
      v_visible;
  end if;
end;
$$;

-- 6d. A tidak dapat menerima permintaannya sendiri.
do $$
declare
  v_accepted boolean;
begin
  select public.accept_follow_request('11111111-1111-1111-1111-111111111111') into v_accepted;

  if v_accepted then
    raise exception 'UJI GAGAL: user A menerima permintaan follow-nya sendiri';
  end if;
end;
$$;

-- 6e. Klien tidak dapat memaksa status 'accepted' dengan menulisnya sendiri.
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

do $$
declare
  v_status text;
  v_visible int;
begin
  insert into public.follows (follower_id, followed_id, status)
  values (
    '55555555-5555-5555-5555-555555555555',
    '22222222-2222-2222-2222-222222222222',
    'accepted'
  );

  select status into v_status
  from public.follows
  where follower_id = '55555555-5555-5555-5555-555555555555'
    and followed_id = '22222222-2222-2222-2222-222222222222';

  if v_status <> 'pending' then
    raise exception 'UJI GAGAL: klien dapat menulis status % pada follow ke profil privat', v_status;
  end if;

  select count(*) into v_visible
  from public.profiles
  where id = '22222222-2222-2222-2222-222222222222';

  if v_visible <> 0 then
    raise exception 'UJI GAGAL: user C mendapat akses profil privat B lewat status accepted yang ditulis sendiri';
  end if;
end;
$$;

-- 6f. Pemilik profil melihat permintaan dan menerimanya (jalur yang benar).
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_pending int;
  v_accepted boolean;
begin
  select count(*) into v_pending
  from public.follows
  where followed_id = '22222222-2222-2222-2222-222222222222' and status = 'pending';

  if v_pending <> 2 then
    raise exception 'UJI GAGAL: pemilik profil melihat % permintaan pending (harus 2)', v_pending;
  end if;

  select public.accept_follow_request('11111111-1111-1111-1111-111111111111') into v_accepted;
  if not v_accepted then
    raise exception 'UJI GAGAL: pemilik profil tidak dapat menerima permintaan follow yang sah';
  end if;

  select public.accept_follow_request('11111111-1111-1111-1111-111111111111') into v_accepted;
  if v_accepted then
    raise exception 'UJI GAGAL: permintaan yang sudah diterima dapat diterima ulang (harus false)';
  end if;
end;
$$;

-- 6g. Kontrol positif: setelah disetujui, A memang dapat membaca profil B.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_visible int;
begin
  select count(*) into v_visible
  from public.profiles
  where id = '22222222-2222-2222-2222-222222222222';

  if v_visible <> 1 then
    raise exception 'UJI GAGAL: user A tetap tidak dapat membaca profil B setelah disetujui (% baris)',
      v_visible;
  end if;
end;
$$;

-- 6h. User C (belum disetujui) tetap tidak dapat membaca profil privat B.
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

do $$
declare
  v_visible int;
begin
  select count(*) into v_visible
  from public.profiles
  where id = '22222222-2222-2222-2222-222222222222';

  if v_visible <> 0 then
    raise exception 'UJI GAGAL: user C (permintaan belum disetujui) membaca profil privat B (% baris)',
      v_visible;
  end if;
end;
$$;

-- 6i. Tidak ada policy UPDATE: pemilik profil maupun pengikut tidak dapat mengubah baris
--     secara langsung (penerimaan hanya lewat accept_follow_request).
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.follows
  set status = 'accepted'
  where follower_id = '55555555-5555-5555-5555-555555555555'
    and followed_id = '22222222-2222-2222-2222-222222222222';

  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: pemilik profil mengubah status lewat UPDATE langsung (% baris)', v_rows;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  -- Percobaan memalsukan pemilik relasi: mengubah follower_id milik A menjadi user C.
  update public.follows
  set follower_id = '55555555-5555-5555-5555-555555555555'
  where follower_id = '11111111-1111-1111-1111-111111111111'
    and followed_id = '22222222-2222-2222-2222-222222222222';

  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: pengikut dapat mengubah follower_id (% baris)', v_rows;
  end if;
end;
$$;

-- 6j. Pemilik profil mencabut akses dengan menghapus relasi; akses A hilang kembali.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  delete from public.follows where followed_id = '22222222-2222-2222-2222-222222222222';

  get diagnostics v_rows = row_count;
  if v_rows <> 2 then
    raise exception 'UJI GAGAL: pemilik profil menghapus % relasi (harus 2: menolak C dan mencabut A)', v_rows;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_visible int;
begin
  select count(*) into v_visible
  from public.profiles
  where id = '22222222-2222-2222-2222-222222222222';

  if v_visible <> 0 then
    raise exception 'UJI GAGAL: akses A tidak hilang setelah relasi follow dihapus pemilik profil (% baris)',
      v_visible;
  end if;
end;
$$;

-- 6k. Pengikut tetap dapat membatalkan permintaannya sendiri (DELETE).
do $$
declare
  v_rows int;
begin
  insert into public.follows (follower_id, followed_id)
  values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

  delete from public.follows
  where follower_id = '11111111-1111-1111-1111-111111111111'
    and followed_id = '22222222-2222-2222-2222-222222222222';

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: pengikut tidak dapat membatalkan permintaannya sendiri (% baris)', v_rows;
  end if;
end;
$$;

-- 6l. Peran anon tidak punya akses ke public.follows.
reset role;
set local role anon;
set local request.jwt.claims = '{}';

do $$
declare
  v_visible bigint;
begin
  select count(*) into v_visible from public.follows;

  if v_visible <> 0 then
    raise exception 'UJI GAGAL: peran anon melihat % baris pada public.follows', v_visible;
  end if;
end;
$$;

do $$
begin
  insert into public.follows (follower_id, followed_id)
  values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

  raise exception 'UJI GAGAL: peran anon membuat baris pada public.follows';
exception
  when insufficient_privilege then
    null; -- ditolak RLS: perilaku yang benar
end;
$$;

-- 6m. Peran anon tidak dapat menerima permintaan follow. Hasilnya boleh berupa penolakan
--     (EXECUTE tidak diberikan) atau `false` (tidak ada auth.uid()), yang penting bukan `true`.
do $$
declare
  v_result boolean := null;
  v_denied boolean := false;
begin
  begin
    select public.accept_follow_request('55555555-5555-5555-5555-555555555555') into v_result;
  exception
    when insufficient_privilege then
      v_denied := true;
    when undefined_function then
      v_denied := true;
  end;

  if not v_denied and coalesce(v_result, false) then
    raise exception 'UJI GAGAL: peran anon dapat menerima permintaan follow';
  end if;
end;
$$;

-- 7. Detail privat kendaraan hanya untuk kendaraan milik sendiri ----------------
--    Perbaikan Milestone 1.6: policy UPDATE dulu tidak memeriksa kepemilikan kendaraan,
--    sehingga `motorcycle_id` bisa dipindahkan ke kendaraan orang lain.
reset role;

-- `aaaa...` = kendaraan pertama A (dipakai untuk baris detail privat),
-- `cccc...` = kendaraan kedua A TANPA baris detail (mengisolasi policy dari primary key),
-- `bbbb...` = kendaraan milik B.
insert into public.motorcycles (id, owner_id, make, model)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Honda', 'Vario 125'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'Suzuki', 'Satria'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Yamaha', 'NMAX 155');

-- 7a. Kontrol positif: A membuat detail privat untuk kendaraannya sendiri.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  insert into public.motorcycle_private_details (motorcycle_id, owner_id, plate_number)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'B 1234 XYZ');

exception
  when insufficient_privilege then
    raise exception 'UJI GAGAL: user A tidak dapat membuat detail privat untuk kendaraannya sendiri';
end;
$$;

do $$
declare
  v_visible int;
begin
  select count(*) into v_visible
  from public.motorcycle_private_details
  where owner_id = '11111111-1111-1111-1111-111111111111';

  if v_visible <> 1 then
    raise exception 'UJI GAGAL: user A membaca % baris detail privatnya sendiri (harus 1)', v_visible;
  end if;
end;
$$;

-- 7b/7c. User B tidak dapat membaca atau mengubah detail privat milik A.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_visible int;
  v_rows int;
begin
  select count(*) into v_visible
  from public.motorcycle_private_details
  where owner_id = '11111111-1111-1111-1111-111111111111';

  if v_visible <> 0 then
    raise exception 'UJI GAGAL: user B membaca % baris detail privat user A', v_visible;
  end if;

  update public.motorcycle_private_details
  set plate_number = 'D 0000 B'
  where owner_id = '11111111-1111-1111-1111-111111111111';

  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: user B mengubah % baris detail privat user A', v_rows;
  end if;
end;
$$;

-- 7d. B tidak dapat membuat detail privat untuk kendaraan A.
--     Dua jalur diuji: (i) owner_id milik B sendiri (ditolak foreign key komposit & policy),
--     (ii) owner_id milik A (ditolak policy `owner_id = auth.uid()` — foreign key tetap puas).
do $$
declare
  v_state text;
begin
  insert into public.motorcycle_private_details (motorcycle_id, owner_id, plate_number)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'D 9999 ZZ');

  raise exception 'UJI GAGAL: user B membuat detail privat untuk kendaraan user A';
exception
  when insufficient_privilege then
    get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'UJI: insert lintas pengguna ditolak policy (SQLSTATE %)', v_state;
  when foreign_key_violation then
    get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'UJI: insert lintas pengguna ditolak foreign key komposit (SQLSTATE %)', v_state;
  when unique_violation then
    raise exception 'UJI GAGAL: user B menulis baris untuk kendaraan user A dan hanya tertahan primary key, bukan policy/foreign key';
end;
$$;

-- Kasus yang hanya bisa ditahan policy: kendaraan milik A, pemilik baris juga A, dan belum ada
-- baris detail untuk kendaraan itu — foreign key puas, primary key bebas.
do $$
begin
  insert into public.motorcycle_private_details (motorcycle_id, owner_id, plate_number)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'D 9999 ZZ');

  raise exception 'UJI GAGAL: user B membuat baris dengan owner_id milik user A';
exception
  when insufficient_privilege then
    null; -- ditolak policy owner_id = auth.uid(): perilaku yang benar
end;
$$;

-- 7e. A tidak dapat memindahkan detail privatnya ke kendaraan B (`motorcycle_id` diubah).
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_state text;
begin
  update public.motorcycle_private_details
  set motorcycle_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  where owner_id = '11111111-1111-1111-1111-111111111111';

  raise exception 'UJI GAGAL: user A memindahkan detail privatnya ke kendaraan user B';
exception
  when insufficient_privilege then
    get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'UJI: pemindahan motorcycle_id ditolak policy (SQLSTATE %)', v_state;
  when foreign_key_violation then
    get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'UJI: pemindahan motorcycle_id ditolak foreign key komposit (SQLSTATE %)', v_state;
end;
$$;

-- 7f. Baris tidak berubah setelah percobaan di atas, dan A tetap dapat memperbarui datanya.
do $$
declare
  v_bike uuid;
  v_rows int;
begin
  select motorcycle_id into v_bike
  from public.motorcycle_private_details
  where owner_id = '11111111-1111-1111-1111-111111111111';

  if v_bike <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' then
    raise exception 'UJI GAGAL: motorcycle_id berubah menjadi % setelah percobaan ditolak', v_bike;
  end if;

  update public.motorcycle_private_details
  set plate_number = 'B 1234 XYZ (baru)'
  where motorcycle_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: pemilik tidak dapat memperbarui detail privatnya sendiri (% baris)', v_rows;
  end if;
end;
$$;

-- 7g. Invarian struktur: walaupun RLS dilewati (koneksi pemilik database), baris yang
--     pemiliknya tidak cocok dengan pemilik kendaraan tetap ditolak foreign key komposit.
reset role;

do $$
declare
  v_state text;
begin
  insert into public.motorcycle_private_details (motorcycle_id, owner_id, plate_number)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'X 0000 A');

  raise exception 'UJI GAGAL: database menerima detail privat dengan pemilik berbeda dari pemilik kendaraan';
exception
  when foreign_key_violation then
    get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'UJI: invarian pemilik ditolak foreign key komposit (SQLSTATE %)', v_state;
end;
$$;

-- 7h. Kontrol positif invarian: baris dengan pemilik yang cocok diterima.
do $$
begin
  insert into public.motorcycle_private_details (motorcycle_id, owner_id, plate_number)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'D 5678 B');

exception
  when others then
    raise exception 'UJI GAGAL: baris yang sah (pemilik cocok dengan kendaraan) ditolak: %', sqlerrm;
end;
$$;

delete from public.motorcycle_private_details
where motorcycle_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

reset role;

do $$
begin
  raise notice 'UJI RLS PROFIL LULUS: izin dan penolakan sesuai harapan (profil, follow, garasi).';
end;
$$;

rollback;
