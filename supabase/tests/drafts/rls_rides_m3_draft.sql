-- db:test notice: UJI RLS PERJALANAN M3 LULUS
--
-- ============================================================================
-- DRAFT — uji RLS/RPC Milestone 3 (perjalanan dan berbagi lokasi).
--
-- BERKAS INI SENGAJA TIDAK TERDAFTAR di `DEFAULT_TEST_FILES`
-- (`scripts/db-test.mjs`). Ia membutuhkan draf
-- `supabase/drafts/milestone_3_ride_state.sql` yang belum boleh diterapkan
-- sebelum gerbang uji perangkat fisik Milestone 2 lulus. Menjalankannya tanpa
-- draf itu akan berhenti dengan pesan paritas yang jelas, bukan gagal samar.
--
-- Cara menjalankan setelah draf diterapkan di database scratch/development:
--   1. Terapkan draf (JANGAN di produksi):
--        npx supabase db execute --file supabase/drafts/milestone_3_ride_state.sql
--      atau tempel isinya ke SQL Editor database scratch.
--   2. Jalankan hanya berkas ini (tidak lewat daftar default):
--        npm run db:test -- --file supabase/tests/drafts/rls_rides_m3_draft.sql
--
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi tidak
-- ada pengguna/klub/perjalanan uji yang tertinggal.
--
-- Yang dibuktikan:
--   1. non-anggota klub dan `anon` tidak membaca perjalanan klub privat;
--   2. anggota klub yang belum berbagi tetap bisa ikut (consent terpisah);
--   3. hanya host yang boleh memindahkan status;
--   4. `anon` tidak punya EXECUTE pada RPC M3;
--   5. transisi `planned -> active -> completed` berjalan, status final tidak
--      bisa dibuka kembali;
--   6. lokasi hanya bisa ditulis pemilik yang sedang berbagi di ride aktif;
--   7. mematikan berbagi, keluar, dan menyelesaikan ride menghapus baris lokasi;
--   8. `anon` dan non-anggota tidak membaca `ride_locations`.
-- ============================================================================

begin;

-- 0. Paritas draf: berhenti dengan pesan jelas bila draf belum diterapkan.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.transition_ride(uuid,text)') is null then
    v_missing := v_missing || 'fungsi public.transition_ride(uuid,text)'::text;
  end if;

  if to_regprocedure('public.set_ride_location_sharing(uuid,boolean)') is null then
    v_missing := v_missing || 'fungsi public.set_ride_location_sharing(uuid,boolean)'::text;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'ride_members_clear_location'
      and tgrelid = 'public.ride_members'::regclass
      and not tgisinternal
  ) then
    v_missing := v_missing || 'trigger ride_members_clear_location'::text;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'rides_clear_locations'
      and tgrelid = 'public.rides'::regclass
      and not tgisinternal
  ) then
    v_missing := v_missing || 'trigger rides_clear_locations'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (draf M3 belum diterapkan): objek berikut belum ada — %. Terapkan supabase/drafts/milestone_3_ride_state.sql di database scratch lebih dulu; jangan menerapkannya ke database sebelum gerbang Milestone 2 lulus.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Konteks uji. Tabel ini hanya hidup di dalam transaksi dan ikut ROLLBACK.
create table public.uji_m3_konteks (
  nama text primary key,
  club_id uuid,
  ride_id uuid
);
grant select, insert, update, delete on public.uji_m3_konteks to authenticated;

-- 2. Tiga akun: A host, B anggota klub, C non-anggota.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm3.a@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m3_user_a","display_name":"M3 User A"}',
    now(), now()
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm3.b@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m3_user_b","display_name":"M3 User B"}',
    now(), now()
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm3.c@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m3_user_c","display_name":"M3 User C"}',
    now(), now()
  );

-- 3. Klub privat dibuat A; B bergabung lewat RPC; C sengaja tidak bergabung.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_club jsonb;
begin
  v_club := public.create_club(
    'Uji Ride M3',
    'uji-ride-m3',
    'Klub untuk draf uji Milestone 3.',
    'private',
    'approval'
  );
  insert into public.uji_m3_konteks (nama, club_id)
  values ('klub', (v_club ->> 'id')::uuid);
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.uji_m3_konteks where nama = 'klub';
  perform public.request_club_membership(v_club);
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.uji_m3_konteks where nama = 'klub';
  perform public.review_club_membership(
    v_club,
    '22222222-2222-2222-2222-222222222222',
    true
  );
end;
$$;

-- 4. Perjalanan klub `planned` dengan A sebagai host dan B sebagai anggota.
--    Insert langsung dilakukan sebagai superuser karena belum ada RPC create_ride.
reset role;

insert into public.rides (id, club_id, created_by, title, status, visibility)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  club_id,
  '11111111-1111-1111-1111-111111111111',
  'Uji Ride M3',
  'planned',
  'club'
from public.uji_m3_konteks
where nama = 'klub';

update public.uji_m3_konteks
set ride_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
where nama = 'klub';

insert into public.ride_members (ride_id, user_id, role, status, sharing_location)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'host', 'joined', false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'rider', 'joined', false);

-- 5. Non-anggota dan anon tidak membaca perjalanan/lokasi.
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_rides int;
  v_locations int;
begin
  select count(*) into v_rides from public.rides
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_rides <> 0 then
    raise exception 'UJI GAGAL: non-anggota membaca % perjalanan klub privat', v_rides;
  end if;

  select count(*) into v_locations from public.ride_locations
  where ride_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_locations <> 0 then
    raise exception 'UJI GAGAL: non-anggota membaca % baris lokasi', v_locations;
  end if;
end;
$$;

set local role anon;
set local request.jwt.claims = '{}';

do $$
declare
  v_rides int;
  v_locations int;
begin
  select count(*) into v_rides from public.rides
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_rides <> 0 then
    raise exception 'UJI GAGAL: anon membaca % perjalanan', v_rides;
  end if;

  select count(*) into v_locations from public.ride_locations
  where ride_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_locations <> 0 then
    raise exception 'UJI GAGAL: anon membaca % baris lokasi', v_locations;
  end if;
end;
$$;

-- 6. Anggota klub boleh membaca perjalanan, tetapi belum berbagi lokasi.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_rides int;
  v_locations int;
  v_sharing boolean;
begin
  select count(*) into v_rides from public.rides
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_rides <> 1 then
    raise exception 'UJI GAGAL: anggota klub membaca % perjalanan (harus 1)', v_rides;
  end if;

  select sharing_location into v_sharing from public.ride_members
  where ride_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and user_id = '22222222-2222-2222-2222-222222222222';
  if v_sharing is not false then
    raise exception 'UJI GAGAL: consent awal bukan false (mendapat %)', v_sharing;
  end if;

  -- Ride masih planned: policy `is_ride_active_member` harus menutup lokasi.
  select count(*) into v_locations from public.ride_locations
  where ride_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_locations <> 0 then
    raise exception 'UJI GAGAL: lokasi terbaca sebelum ride aktif (% baris)', v_locations;
  end if;
end;
$$;

-- 7. Host mengaktifkan perjalanan; started_at diisi server.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride public.rides;
begin
  v_ride := public.transition_ride('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active');
  if v_ride.status <> 'active' then
    raise exception 'UJI GAGAL: status setelah aktivasi adalah %', v_ride.status;
  end if;
  if v_ride.started_at is null then
    raise exception 'UJI GAGAL: started_at tidak diisi saat ride diaktifkan';
  end if;
end;
$$;

-- 8. Anggota biasa dan non-anggota tidak boleh memindahkan status.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    perform public.transition_ride('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'completed');
    raise exception 'UJI GAGAL: anggota biasa dapat menyelesaikan perjalanan';
  exception
    when insufficient_privilege then
      null; -- ditolak RPC: perilaku yang benar
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
begin
  begin
    perform public.transition_ride('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'completed');
    raise exception 'UJI GAGAL: non-anggota dapat memindahkan status perjalanan';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

-- 9. `anon` tidak punya EXECUTE; `authenticated` punya.
set local role anon;
set local request.jwt.claims = '{}';

do $$
begin
  if has_function_privilege('anon', 'public.transition_ride(uuid,text)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon masih boleh EXECUTE transition_ride';
  end if;
  if has_function_privilege('anon', 'public.set_ride_location_sharing(uuid,boolean)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon masih boleh EXECUTE set_ride_location_sharing';
  end if;
  if not has_function_privilege('authenticated', 'public.transition_ride(uuid,text)', 'EXECUTE') then
    raise exception 'UJI GAGAL: authenticated tidak boleh EXECUTE transition_ride';
  end if;
  if not has_function_privilege('authenticated', 'public.set_ride_location_sharing(uuid,boolean)', 'EXECUTE') then
    raise exception 'UJI GAGAL: authenticated tidak boleh EXECUTE set_ride_location_sharing';
  end if;
end;
$$;

-- 10. Consent: B menyalakan berbagi lalu boleh menulis lokasinya sendiri.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_enabled boolean;
  v_rows int;
begin
  v_enabled := public.set_ride_location_sharing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
  if v_enabled is not true then
    raise exception 'UJI GAGAL: consent tidak tersimpan (mendapat %)', v_enabled;
  end if;

  insert into public.ride_locations (ride_id, user_id, latitude, longitude, recorded_at)
  values (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '22222222-2222-2222-2222-222222222222',
    -6.2,
    106.8,
    now()
  );
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: anggota yang berbagi gagal menulis lokasi (% baris)', v_rows;
  end if;
end;
$$;

-- 11. Host yang belum berbagi, non-anggota, dan penulis lokasi orang lain ditolak.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  begin
    insert into public.ride_locations (ride_id, user_id, latitude, longitude, recorded_at)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-1111-1111-111111111111',
      -6.2,
      106.8,
      now()
    );
    raise exception 'UJI GAGAL: host menulis lokasi tanpa consent';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
begin
  begin
    insert into public.ride_locations (ride_id, user_id, latitude, longitude, recorded_at)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-3333-3333-333333333333',
      -6.2,
      106.8,
      now()
    );
    raise exception 'UJI GAGAL: non-anggota menulis lokasi';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    insert into public.ride_locations (ride_id, user_id, latitude, longitude, recorded_at)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-1111-1111-111111111111',
      -6.2,
      106.8,
      now()
    );
    raise exception 'UJI GAGAL: anggota menulis lokasi atas nama pengguna lain';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

-- 12. Mematikan berbagi menghapus baris lokasi.
do $$
declare
  v_rows int;
begin
  perform public.set_ride_location_sharing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

  select count(*) into v_rows from public.ride_locations
  where ride_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and user_id = '22222222-2222-2222-2222-222222222222';
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: lokasi masih ada setelah berbagi dimatikan (% baris)', v_rows;
  end if;
end;
$$;

-- 13. Keluar dari perjalanan juga menghapus lokasi.
reset role;
update public.ride_members
set status = 'left', updated_at = now()
where ride_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = '22222222-2222-2222-2222-222222222222';

do $$
declare
  v_rows int;
begin
  select count(*) into v_rows from public.ride_locations
  where ride_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and user_id = '22222222-2222-2222-2222-222222222222';
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: lokasi masih ada setelah anggota keluar (% baris)', v_rows;
  end if;
end;
$$;

-- 14. Bergabung kembali, berbagi lagi, lalu ride diselesaikan: semua lokasi hilang.
update public.ride_members
set status = 'joined', sharing_location = true, updated_at = now()
where ride_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = '22222222-2222-2222-2222-222222222222';

insert into public.ride_locations (ride_id, user_id, latitude, longitude, recorded_at)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '22222222-2222-2222-2222-222222222222',
  -6.21,
  106.81,
  now()
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride public.rides;
begin
  v_ride := public.transition_ride('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'completed');
  if v_ride.status <> 'completed' or v_ride.ended_at is null then
    raise exception 'UJI GAGAL: ride tidak selesai dengan benar (%, ended_at %)',
      v_ride.status, v_ride.ended_at;
  end if;
end;
$$;

reset role;

do $$
declare
  v_rows int;
begin
  select count(*) into v_rows from public.ride_locations
  where ride_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: lokasi masih ada setelah ride selesai (% baris)', v_rows;
  end if;
end;
$$;

-- 15. Status final tidak bisa dibuka kembali.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  begin
    perform public.transition_ride('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active');
    raise exception 'UJI GAGAL: ride completed dapat kembali active';
  exception
    when check_violation then
      null;
  end;
end;
$$;

do $$
begin
  begin
    perform public.transition_ride('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cancelled');
    raise exception 'UJI GAGAL: ride completed dapat berubah menjadi cancelled';
  exception
    when check_violation then
      null;
  end;
end;
$$;

-- 16. Setelah selesai, anggota tidak bisa lagi menyalakan berbagi.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    perform public.set_ride_location_sharing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
    raise exception 'UJI GAGAL: consent bisa dinyalakan pada ride yang sudah selesai';
  exception
    when check_violation then
      null;
  end;
end;
$$;

do $$
begin
  raise notice 'UJI RLS PERJALANAN M3 LULUS: state machine, consent, dan pembersihan lokasi sesuai harapan';
end;
$$;

rollback;
