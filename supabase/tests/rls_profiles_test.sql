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
--    termasuk ketika `motorcycle_id` diubah (dijaga policy dan foreign key komposit);
-- 12. invarian "satu kendaraan primary per pemilik" dijaga trigger dan partial unique index
--    (Milestone 2);
-- 13. pembuatan klub dan seluruh mutasi keanggotaan hanya lewat RPC keamanan-definer:
--    non-anggota tidak membaca klub privat, anggota tidak menyetujui dirinya sendiri,
--    owner terakhir tidak bisa diturunkan/dikeluarkan, klub invite_only menolak permintaan,
--    peran admin member tidak terlihat oleh anggota biasa, dan peran `anon` tidak punya
--    EXECUTE satu pun (Milestone 2).
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
  '55555555-5555-5555-5555-555555555555',
  '99999999-9999-9999-9999-999999999999'
);
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '99999999-9999-9999-9999-999999999999'
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

-- ============================================================================
-- 8. Milestone 2 — paritas objek keanggotaan klub di database development
-- ============================================================================
do $$
declare
  v_fungsi int;
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.club_role_audit') is null then
    v_missing := v_missing || 'tabel public.club_role_audit'::text;
  end if;

  select count(distinct p.proname) into v_fungsi
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'create_club',
      'request_club_membership',
      'review_club_membership',
      'set_club_member_role',
      'remove_club_member',
      'leave_club'
    );

  if v_fungsi <> 6 then
    v_missing := v_missing || format('6 fungsi RPC keanggotaan klub (ditemukan %s)', v_fungsi)::text;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clubs' and cmd = 'INSERT'
  ) then
    v_missing := v_missing || 'policy INSERT pada public.clubs (seharusnya tidak ada: lewat RPC)'::text;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'club_members'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    v_missing := v_missing || 'policy tulis pada public.club_members (seharusnya tidak ada: lewat RPC)'::text;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'club_role_audit'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    v_missing := v_missing || 'policy tulis pada public.club_role_audit (jejak audit tidak boleh bisa ditempa klien)'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (paritas skema Milestone 2): % — terapkan migration 20261016093000_club_membership_rpc.sql lebih dulu.',
      array_to_string(v_missing, ', ');
  end if;

  raise notice 'UJI: objek RPC keanggotaan klub tersedia dan tetap tanpa policy tulis klien';
end;
$$;

do $$
declare
  v_missing text[] := array[]::text[];
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'club_role_audit'
      and policyname = 'club_role_audit_select_admin'
  ) then
    v_missing := v_missing || 'policy club_role_audit_select_admin'::text;
  end if;

  if has_function_privilege('anon', 'public.create_club(text,text,text,text,text)', 'EXECUTE') then
    v_missing := v_missing || 'peran anon masih boleh EXECUTE create_club'::text;
  end if;

  if has_function_privilege('anon', 'public.request_club_membership(uuid)', 'EXECUTE') then
    v_missing := v_missing || 'peran anon masih boleh EXECUTE request_club_membership'::text;
  end if;

  if has_function_privilege('anon', 'public.review_club_membership(uuid,uuid,boolean)', 'EXECUTE') then
    v_missing := v_missing || 'peran anon masih boleh EXECUTE review_club_membership'::text;
  end if;

  if not has_function_privilege('authenticated', 'public.create_club(text,text,text,text,text)', 'EXECUTE') then
    v_missing := v_missing || 'authenticated tidak punya EXECUTE create_club'::text;
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgname = 'motorcycles_single_primary'
      and t.tgrelid = 'public.motorcycles'::regclass
      and not t.tgisinternal
  ) then
    v_missing := v_missing || 'trigger motorcycles_single_primary'::text;
  end if;

  if to_regclass('public.motorcycles_single_primary_idx') is null then
    v_missing := v_missing || 'index parsial motorcycles_single_primary_idx'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (paritas skema Milestone 2): % — terapkan migration 20261016093000_club_membership_rpc.sql dan 20261016094500_single_primary_vehicle.sql lebih dulu.',
      array_to_string(v_missing, ', ');
  end if;

  raise notice 'UJI: hak eksekusi RPC benar (anon nol, authenticated ada) dan invarian primary terpasang';
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Invarian "satu kendaraan primary per pemilik"
-- ----------------------------------------------------------------------------
do $$
declare
  v_primary uuid;
  v_count int;
begin
  insert into public.motorcycles (id, owner_id, make, model, is_primary)
  values
    (
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      '11111111-1111-1111-1111-111111111111', 'Honda', 'Vario', true
    ),
    (
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      '11111111-1111-1111-1111-111111111111', 'Yamaha', 'NMAX', false
    );

  update public.motorcycles
  set is_primary = true, updated_at = now()
  where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  select count(*) into v_count
  from public.motorcycles
  where owner_id = '11111111-1111-1111-1111-111111111111' and is_primary;

  if v_count <> 1 then
    raise exception 'UJI GAGAL: satu pemilik memiliki % kendaraan primary', v_count;
  end if;

  select id into v_primary
  from public.motorcycles
  where owner_id = '11111111-1111-1111-1111-111111111111' and is_primary;

  if v_primary <> 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' then
    raise exception 'UJI GAGAL: primary tidak berpindah ke kendaraan yang dipilih (%)', v_primary;
  end if;

  raise notice 'UJI: trigger memindahkan status primary, bukan menumpuk dua primary';
end;
$$;

-- 9b. Jaring terakhir: tanpa trigger, dua primary tetap ditolak partial unique index.
do $$
declare
  v_state text;
begin
  alter table public.motorcycles disable trigger motorcycles_single_primary;

  begin
    insert into public.motorcycles (owner_id, make, model, is_primary)
    values ('11111111-1111-1111-1111-111111111111', 'Suzuki', 'Satria', true);

    alter table public.motorcycles enable trigger motorcycles_single_primary;
    raise exception 'UJI GAGAL: database menerima dua kendaraan primary saat trigger dimatikan';
  exception
    when unique_violation then
      get stacked diagnostics v_state = returned_sqlstate;
      alter table public.motorcycles enable trigger motorcycles_single_primary;
      raise notice 'UJI: primary ganda ditolak partial unique index (SQLSTATE %)', v_state;
  end;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Klub: pembuatan, keanggotaan, peran, dan keluar
-- ----------------------------------------------------------------------------
-- Tabel konteks pengujian: id klub dihasilkan RPC, sementara pengujian berikutnya
-- berjalan dengan peran `authenticated` yang (dengan sengaja) tidak selalu boleh
-- membaca baris klub yang bersangkutan.
create table public.uji_m2_konteks (
  nama text primary key,
  club_id uuid
);
grant select, insert, update, delete on public.uji_m2_konteks to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 10a. Pembuatan klub + owner aktif + jejak audit dalam satu transaksi.
do $$
declare
  v_klub jsonb;
  v_id uuid;
  v_member public.club_members;
  v_audit int;
begin
  v_klub := public.create_club(
    'Uji Klub Privat',
    'uji-klub-privat',
    'Klub privat untuk pengujian RLS.',
    'private',
    'approval'
  );
  v_id := (v_klub ->> 'id')::uuid;
  insert into public.uji_m2_konteks (nama, club_id) values ('privat', v_id);

  if (v_klub ->> 'visibility') <> 'private' then
    raise exception 'UJI GAGAL: klub yang dibuat bukan privat (%)', v_klub ->> 'visibility';
  end if;

  if (v_klub ->> 'created_by')::uuid <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'UJI GAGAL: created_by tidak diambil dari sesi (%), bukti klien bisa memalsukan pemilik',
      v_klub ->> 'created_by';
  end if;

  select * into v_member
  from public.club_members
  where club_id = v_id and user_id = '11111111-1111-1111-1111-111111111111';

  if not found or v_member.role <> 'owner' or v_member.status <> 'active' or v_member.joined_at is null then
    raise exception 'UJI GAGAL: pembuat klub tidak menjadi owner aktif di klubnya sendiri';
  end if;

  select count(*) into v_audit
  from public.club_role_audit where club_id = v_id and action = 'club_created';

  if v_audit <> 1 then
    raise exception 'UJI GAGAL: jejak audit pembuatan klub % baris', v_audit;
  end if;

  raise notice 'UJI: create_club membuat klub, owner aktif, dan jejak audit sekaligus';

  v_klub := public.create_club('Uji Klub Publik', 'uji-klub-publik', null, 'public', 'open');
  insert into public.uji_m2_konteks (nama, club_id) values ('publik', (v_klub ->> 'id')::uuid);

  v_klub := public.create_club('Uji Klub Undangan', 'uji-klub-undangan', null, 'public', 'invite_only');
  insert into public.uji_m2_konteks (nama, club_id) values ('undangan', (v_klub ->> 'id')::uuid);
end;
$$;

-- 10b. Slug yang sudah dipakai tidak menimpa klub lama.
do $$
declare
  v_klub jsonb;
begin
  v_klub := public.create_club('Uji Klub Privat', 'uji-klub-privat', null, 'private', 'approval');

  if (v_klub ->> 'slug') = 'uji-klub-privat' then
    raise exception 'UJI GAGAL: slug duplikat diterima apa adanya';
  end if;

  raise notice 'UJI: slug bentrok diberi akhiran otomatis (%)', v_klub ->> 'slug';
end;
$$;

-- 10c. Argumen tidak sah ditolak sebelum menyentuh tabel.
do $$
begin
  begin
    perform public.create_club('X', null, null, 'public', 'open');
    raise exception 'UJI GAGAL: nama klub satu karakter diterima';
  exception
    when invalid_parameter_value then
      raise notice 'UJI: nama klub terlalu pendek ditolak (SQLSTATE 22023)';
  end;

  begin
    perform public.create_club('Klub Uji', null, null, 'rahasia', 'open');
    raise exception 'UJI GAGAL: visibilitas tidak dikenal diterima';
  exception
    when invalid_parameter_value then
      raise notice 'UJI: visibilitas tidak dikenal ditolak (SQLSTATE 22023)';
  end;
end;
$$;

-- 10d. Tanpa sesi: tidak ada baca, tidak ada eksekusi.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  v_rows int;
begin
  select count(*) into v_rows from public.clubs;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: peran anon membaca % baris klub', v_rows;
  end if;

  select count(*) into v_rows from public.club_members;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: peran anon membaca % baris keanggotaan', v_rows;
  end if;

  select count(*) into v_rows from public.club_role_audit;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: peran anon membaca % baris jejak audit', v_rows;
  end if;

  begin
    perform public.create_club('Klub Anon', 'klub-anon', null, 'public', 'open');
    raise exception 'UJI GAGAL: peran anon dapat membuat klub';
  exception
    when insufficient_privilege then
      raise notice 'UJI: anon tidak punya EXECUTE create_club (SQLSTATE 42501)';
  end;

  begin
    perform public.request_club_membership('dddddddd-0000-0000-0000-000000000000');
    raise exception 'UJI GAGAL: peran anon dapat mengajukan keanggotaan';
  exception
    when insufficient_privilege then
      raise notice 'UJI: anon tidak punya EXECUTE request_club_membership (SQLSTATE 42501)';
  end;

  begin
    insert into public.club_members (club_id, user_id, role, status)
    values (
      'dddddddd-0000-0000-0000-000000000000',
      '11111111-1111-1111-1111-111111111111',
      'owner',
      'active'
    );

    raise exception 'UJI GAGAL: peran anon menulis baris keanggotaan';
  exception
    when insufficient_privilege then
      raise notice 'UJI: anon tidak bisa menulis keanggotaan langsung (SQLSTATE 42501)';
  end;
end;
$$;

-- 10e. Non-anggota klub privat: baca ditolak, semua jalur otorisasi ditolak.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_priv uuid;
  v_pub uuid;
  v_undang uuid;
  v_rows int;
  v_status text;
begin
  select club_id into v_priv from public.uji_m2_konteks where nama = 'privat';
  select club_id into v_pub from public.uji_m2_konteks where nama = 'publik';
  select club_id into v_undang from public.uji_m2_konteks where nama = 'undangan';

  select count(*) into v_rows from public.clubs where id = v_priv;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: non-anggota membaca klub privat (% baris)', v_rows;
  end if;

  select count(*) into v_rows from public.club_members where club_id = v_priv;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: non-anggota membaca keanggotaan klub privat (% baris)', v_rows;
  end if;

  -- Kontrol positif: klub publik tetap terlihat.
  select count(*) into v_rows from public.clubs where id = v_pub;
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: klub publik tidak terbaca pengguna terautentikasi (% baris)', v_rows;
  end if;

  v_status := public.request_club_membership(v_priv);
  if v_status <> 'pending' then
    raise exception 'UJI GAGAL: permintaan ke klub privat berstatus %', v_status;
  end if;

  v_status := public.request_club_membership(v_priv);
  if v_status <> 'pending' then
    raise exception 'UJI GAGAL: permintaan ulang tidak idempoten (%)', v_status;
  end if;

  select count(*) into v_rows
  from public.club_members
  where club_id = v_priv and user_id = '22222222-2222-2222-2222-222222222222';
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: permintaan ulang membuat % baris keanggotaan', v_rows;
  end if;

  select count(*) into v_rows from public.club_members where club_id = v_priv;
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: anggota pending melihat % baris keanggotaan klub privat', v_rows;
  end if;

  begin
    perform public.review_club_membership(v_priv, '22222222-2222-2222-2222-222222222222', true);
    raise exception 'UJI GAGAL: anggota pending menyetujui permintaannya sendiri';
  exception
    when insufficient_privilege then
      raise notice 'UJI: persetujuan permintaan oleh bukan-admin ditolak (SQLSTATE 42501)';
  end;

  begin
    perform public.set_club_member_role(v_priv, '22222222-2222-2222-2222-222222222222', 'admin');
    raise exception 'UJI GAGAL: anggota mempromosikan dirinya sendiri';
  exception
    when insufficient_privilege then
      raise notice 'UJI: promosi peran oleh anggota ditolak (SQLSTATE 42501)';
  end;

  begin
    perform public.remove_club_member(v_priv, '11111111-1111-1111-1111-111111111111');
    raise exception 'UJI GAGAL: anggota mengeluarkan owner klub';
  exception
    when insufficient_privilege then
      raise notice 'UJI: pengeluaran owner oleh anggota ditolak (SQLSTATE 42501)';
  end;

  select status into v_status
  from public.club_members
  where club_id = v_priv and user_id = '22222222-2222-2222-2222-222222222222';

  if v_status <> 'pending' then
    raise exception 'UJI GAGAL: status berubah menjadi % setelah percobaan yang ditolak', v_status;
  end if;

  begin
    perform public.request_club_membership(v_undang);
    raise exception 'UJI GAGAL: klub invite_only menerima permintaan gabung';
  exception
    when insufficient_privilege then
      raise notice 'UJI: klub invite_only menolak permintaan gabung (SQLSTATE 42501)';
  end;

  v_status := public.request_club_membership(v_pub);
  if v_status <> 'active' then
    raise exception 'UJI GAGAL: klub publik/open tidak menggabungkan anggota langsung (%)', v_status;
  end if;

  select count(*) into v_rows from public.club_role_audit where club_id = v_pub;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: anggota biasa membaca % baris jejak audit', v_rows;
  end if;

  raise notice 'UJI: jalur keanggotaan non-anggota sesuai harapan (baca/tulis ditolak, gabung publik aktif)';
end;
$$;

-- 10f. Owner: persetujuan, invarian owner terakhir, dan perubahan peran.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_priv uuid;
  v_rows int;
  v_rows_updated int;
  v_status text;
  v_role text;
  v_audit int;
begin
  select club_id into v_priv from public.uji_m2_konteks where nama = 'privat';

  v_status := public.review_club_membership(v_priv, '22222222-2222-2222-2222-222222222222', true);
  if v_status <> 'active' then
    raise exception 'UJI GAGAL: persetujuan owner menghasilkan status %', v_status;
  end if;

  select count(*) into v_audit
  from public.club_role_audit
  where club_id = v_priv
    and action = 'approve'
    and subject_id = '22222222-2222-2222-2222-222222222222';

  if v_audit <> 1 then
    raise exception 'UJI GAGAL: jejak audit persetujuan % baris', v_audit;
  end if;

  begin
    perform public.review_club_membership(v_priv, '22222222-2222-2222-2222-222222222222', true);
    raise exception 'UJI GAGAL: permintaan yang sudah aktif disetujui dua kali';
  exception
    when invalid_parameter_value then
      raise notice 'UJI: persetujuan ulang ditolak karena status bukan pending (SQLSTATE 22023)';
  end;

  begin
    perform public.set_club_member_role(v_priv, '11111111-1111-1111-1111-111111111111', 'member');
    raise exception 'UJI GAGAL: owner terakhir berhasil diturunkan';
  exception
    when check_violation then
      raise notice 'UJI: owner terakhir tidak bisa diturunkan (SQLSTATE 23514)';
  end;

  begin
    perform public.remove_club_member(v_priv, '11111111-1111-1111-1111-111111111111');
    raise exception 'UJI GAGAL: owner berhasil mengeluarkan dirinya sendiri';
  exception
    when invalid_parameter_value then
      raise notice 'UJI: mengeluarkan diri sendiri dialihkan ke aksi keluar klub (SQLSTATE 22023)';
  end;

  begin
    perform public.leave_club(v_priv);
    raise exception 'UJI GAGAL: owner terakhir berhasil keluar dari klub';
  exception
    when check_violation then
      raise notice 'UJI: owner harus mengalihkan kepemilikan sebelum keluar (SQLSTATE 23514)';
  end;

  v_role := public.set_club_member_role(v_priv, '22222222-2222-2222-2222-222222222222', 'admin');
  if v_role <> 'admin' then
    raise exception 'UJI GAGAL: promosi admin menghasilkan %', v_role;
  end if;

  v_role := public.set_club_member_role(v_priv, '22222222-2222-2222-2222-222222222222', 'owner');
  if v_role <> 'owner' then
    raise exception 'UJI GAGAL: promosi owner menghasilkan %', v_role;
  end if;

  select count(*) into v_audit
  from public.club_role_audit where club_id = v_priv and action = 'role_change';

  if v_audit <> 2 then
    raise exception 'UJI GAGAL: jejak audit perubahan peran % baris (harus 2)', v_audit;
  end if;

  v_role := public.set_club_member_role(v_priv, '11111111-1111-1111-1111-111111111111', 'member');
  if v_role <> 'member' then
    raise exception 'UJI GAGAL: penurunan peran saat owner lain tersedia menghasilkan %', v_role;
  end if;

  begin
    perform public.set_club_member_role(v_priv, '22222222-2222-2222-2222-222222222222', 'member');
    raise exception 'UJI GAGAL: anggota biasa mengubah peran anggota lain';
  exception
    when insufficient_privilege then
      raise notice 'UJI: perubahan peran oleh (mantan owner yang kini) member ditolak (SQLSTATE 42501)';
  end;

  v_status := public.leave_club(v_priv);
  if v_status <> 'left' then
    raise exception 'UJI GAGAL: keluar klub menghasilkan status %', v_status;
  end if;

  -- Pembuat klub yang sudah keluar bukan lagi anggota: akses baca dan ubah harus hilang,
  -- walaupun kolom `created_by` baris klub itu masih menunjuk padanya.
  select count(*) into v_rows from public.clubs where id = v_priv;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: pembuat klub yang sudah keluar masih membaca klub privat (% baris)', v_rows;
  end if;

  update public.clubs set name = 'Uji Klub Privat (diubah mantan owner)' where id = v_priv;
  get diagnostics v_rows_updated = row_count;
  if v_rows_updated <> 0 then
    raise exception 'UJI GAGAL: pembuat klub yang sudah keluar masih mengubah klub privat (% baris)', v_rows_updated;
  end if;

  raise notice 'UJI: kepemilikan, peran, dan keluar klub berperilaku sesuai aturan (termasuk hilangnya akses created_by)';
end;
$$;

-- 10f2. Anggota ketiga: membatalkan permintaan, lalu mengajukan ulang.
reset role;

insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '99999999-9999-9999-9999-999999999999',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'uji.m2.klub@contoh.test', now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"uji_user_m2","display_name":"Uji User M2"}',
  now(), now()
)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';

do $$
declare
  v_priv uuid;
  v_status text;
  v_rows int;
begin
  select club_id into v_priv from public.uji_m2_konteks where nama = 'privat';

  v_status := public.request_club_membership(v_priv);
  if v_status <> 'pending' then
    raise exception 'UJI GAGAL: permintaan anggota ketiga berstatus %', v_status;
  end if;

  v_status := public.leave_club(v_priv);
  if v_status <> 'cancelled' then
    raise exception 'UJI GAGAL: pembatalan permintaan sendiri menghasilkan status %', v_status;
  end if;

  v_status := public.leave_club(v_priv);
  if v_status <> 'left' then
    raise exception 'UJI GAGAL: keluar klub berulang menghasilkan status %', v_status;
  end if;

  v_status := public.request_club_membership(v_priv);
  select count(*) into v_rows
  from public.club_members
  where club_id = v_priv and user_id = '99999999-9999-9999-9999-999999999999';

  if v_rows <> 1 then
    raise exception 'UJI GAGAL: pengajuan ulang membuat % baris keanggotaan', v_rows;
  end if;

  raise notice 'UJI: permintaan bisa dibatalkan, diajukan ulang, dan tidak pernah menjadi baris ganda';
end;
$$;

-- 10g. Owner kedua: keluarkan anggota, tinjau pengguna tak dikenal, dan baca daftar anggota.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_priv uuid;
  v_status text;
  v_rows int;
begin
  select club_id into v_priv from public.uji_m2_konteks where nama = 'privat';

  begin
    perform public.leave_club(v_priv);
    raise exception 'UJI GAGAL: owner dapat keluar tanpa mengalihkan kepemilikan';
  exception
    when check_violation then
      raise notice 'UJI: owner wajib mengalihkan kepemilikan sebelum keluar (SQLSTATE 23514)';
  end;

  begin
    perform public.review_club_membership(v_priv, '99999999-0000-0000-0000-000000000000', true);
    raise exception 'UJI GAGAL: permintaan pengguna tak dikenal dapat disetujui';
  exception
    when no_data_found then
      raise notice 'UJI: tinjauan untuk pengguna tak dikenal ditolak sebagai tidak ditemukan (SQLSTATE P0002)';
  end;

  v_status := public.review_club_membership(v_priv, '99999999-9999-9999-9999-999999999999', true);
  if v_status <> 'active' then
    raise exception 'UJI GAGAL: persetujuan anggota ketiga menghasilkan status %', v_status;
  end if;

  select count(*) into v_rows
  from public.club_members
  where club_id = v_priv and status = 'active';

  if v_rows <> 2 then
    raise exception 'UJI GAGAL: owner melihat % anggota aktif (harus 2)', v_rows;
  end if;

  -- Riwayat tetap tersimpan: baris anggota yang sudah keluar tidak dihapus.
  select count(*) into v_rows from public.club_members where club_id = v_priv;
  if v_rows <> 3 then
    raise exception 'UJI GAGAL: owner membaca % baris keanggotaan (harus 3 termasuk riwayat keluar)', v_rows;
  end if;

  v_status := public.remove_club_member(v_priv, '99999999-9999-9999-9999-999999999999');
  if v_status <> 'removed' then
    raise exception 'UJI GAGAL: pengeluaran anggota menghasilkan status %', v_status;
  end if;

  select count(*) into v_rows
  from public.club_members
  where club_id = v_priv
    and user_id = '99999999-9999-9999-9999-999999999999'
    and status = 'removed'
    and role = 'member';

  if v_rows <> 1 then
    raise exception 'UJI GAGAL: baris anggota yang dikeluarkan tidak berada pada status removed/member';
  end if;

  raise notice 'UJI: owner dapat menyetujui, membaca daftar anggota, dan mengeluarkan anggota';
end;
$$;

-- 10h. Anggota yang dikeluarkan kehilangan akses dan tetap tidak bisa menaikkan peran.
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';

do $$
declare
  v_priv uuid;
  v_rows int;
  v_status text;
begin
  select club_id into v_priv from public.uji_m2_konteks where nama = 'privat';

  select count(*) into v_rows from public.clubs where id = v_priv;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: anggota yang dikeluarkan masih membaca klub privat (% baris)', v_rows;
  end if;

  select count(*) into v_rows from public.club_members where club_id = v_priv;
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: anggota yang dikeluarkan melihat % baris keanggotaan', v_rows;
  end if;

  begin
    perform public.set_club_member_role(v_priv, '99999999-9999-9999-9999-999999999999', 'owner');
    raise exception 'UJI GAGAL: anggota yang dikeluarkan menaikkan perannya sendiri';
  exception
    when insufficient_privilege then
      raise notice 'UJI: anggota yang dikeluarkan tetap tidak bisa mengubah peran (SQLSTATE 42501)';
  end;

  v_status := public.request_club_membership(v_priv);
  if v_status <> 'pending' then
    raise exception 'UJI GAGAL: pengajuan ulang setelah dikeluarkan berstatus %', v_status;
  end if;

  raise notice 'UJI: anggota yang dikeluarkan kehilangan akses dan harus mengajukan ulang';
end;
$$;

-- 10i. Penolakan permintaan: anggota tetap tanpa akses dan tanpa peran istimewa.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_priv uuid;
  v_status text;
begin
  select club_id into v_priv from public.uji_m2_konteks where nama = 'privat';

  v_status := public.review_club_membership(v_priv, '99999999-9999-9999-9999-999999999999', false);
  if v_status <> 'rejected' then
    raise exception 'UJI GAGAL: penolakan permintaan menghasilkan status %', v_status;
  end if;

  begin
    perform public.remove_club_member(v_priv, '99999999-9999-9999-9999-999999999999');
    raise exception 'UJI GAGAL: anggota non-aktif dapat dikeluarkan seolah masih aktif';
  exception
    when invalid_parameter_value then
      raise notice 'UJI: pengeluaran anggota non-aktif ditolak (SQLSTATE 22023)';
  end;

  raise notice 'UJI: penolakan permintaan tercatat dan tidak memberi akses';
end;
$$;

reset role;
drop table if exists public.uji_m2_konteks;

do $$
declare
  v_audit int;
begin
  select count(*) into v_audit from public.club_role_audit;
  if v_audit < 8 then
    raise exception 'UJI GAGAL: jejak audit klub hanya % baris untuk rangkaian aksi di atas', v_audit;
  end if;

  raise notice 'UJI: jejak audit klub mencatat % perubahan (buat, gabung, setujui, tolak, peran, keluar, keluarkan)',
    v_audit;
  raise notice 'UJI RLS PROFIL LULUS: izin dan penolakan sesuai harapan (profil, follow, garasi, klub).';
end;
$$;

rollback;
