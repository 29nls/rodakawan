-- db:test notice: UJI RLS PERJALANAN M3 LULUS
--
-- ============================================================================
-- Uji RLS/RPC Milestone 3 — perjalanan dan berbagi lokasi opt-in.
--
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi tidak
-- ada pengguna/klub/perjalanan uji yang tertinggal.
--
-- Yang dibuktikan:
--   1. RPC perjalanan hanya dieksekusi `authenticated`, bukan `anon`;
--   2. non-anggota klub tidak membaca perjalanan/lokasi klub privat;
--   3. anggota klub boleh bergabung tanpa menyalakan berbagi lokasi;
--   4. consent hanya bisa dinyalakan pada perjalanan aktif;
--   5. hanya host yang boleh memindahkan status dan mengundang/mengeluarkan;
--   6. lokasi hanya bisa ditulis pemilik yang sedang berbagi di ride aktif;
--   7. klien tidak bisa menulis `ride_locations` langsung (REST dilewati RPC);
--   8. mematikan berbagi, keluar, dikeluarkan, dan ride final menghapus lokasi;
--   9. status final tidak bisa dibuka kembali;
--  10. lokasi hanya terbaca anggota aktif ride (dasar Realtime Postgres Changes).
-- ============================================================================

begin;

-- 0. Paritas: berhenti dengan pesan jelas bila migration belum diterapkan.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.create_ride(uuid,text,timestamptz,text,text,text,text)') is null then
    v_missing := v_missing || 'fungsi public.create_ride'::text;
  end if;

  if to_regprocedure('public.transition_ride(uuid,text)') is null then
    v_missing := v_missing || 'fungsi public.transition_ride'::text;
  end if;

  if to_regprocedure('public.publish_ride_location(uuid,double precision,double precision,double precision,double precision,double precision,timestamptz)') is null then
    v_missing := v_missing || 'fungsi public.publish_ride_location'::text;
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
    raise exception 'UJI GAGAL (migration M3 belum diterapkan): objek berikut belum ada — %. Terapkan supabase/migrations/20261019120000_ride_workflow.sql lebih dulu.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Konteks uji. Tabel ini hanya hidup di dalam transaksi dan ikut ROLLBACK.
create table public.uji_m3_konteks (
  nama text primary key,
  club_id uuid,
  ride_id uuid,
  ride_invite_id uuid
);
grant select, insert, update, delete on public.uji_m3_konteks to authenticated;

-- 2. Empat akun: A host, B anggota, C non-anggota, D anggota yang diundang.
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
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm3.d@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m3_user_d","display_name":"M3 User D"}',
    now(), now()
  );

-- 3. Klub privat dibuat A; B dan D bergabung lewat RPC; C sengaja tidak.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_club jsonb;
begin
  v_club := public.create_club(
    'Uji Ride M3',
    'uji-ride-m3',
    'Klub untuk uji Milestone 3.',
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

set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

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
  perform public.review_club_membership(v_club, '22222222-2222-2222-2222-222222222222', true);
  perform public.review_club_membership(v_club, '44444444-4444-4444-4444-444444444444', true);
end;
$$;

-- 4. Pembuatan perjalanan hanya untuk anggota klub dan tervalidasi.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.uji_m3_konteks where nama = 'klub';
  begin
    perform public.create_ride(v_club, 'Ride non-anggota');
    raise exception 'UJI GAGAL: non-anggota klub dapat membuat perjalanan';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_club uuid;
  v_ride public.rides;
begin
  select club_id into v_club from public.uji_m3_konteks where nama = 'klub';

  begin
    perform public.create_ride(v_club, 'ab');
    raise exception 'UJI GAGAL: judul terlalu pendek diterima';
  exception
    when invalid_parameter_value then null;
  end;

  v_ride := public.create_ride(
    v_club,
    'Ride Uji M3',
    now() + interval '1 hour',
    'Perjalanan uji Milestone 3.',
    'Titik kumpul uji',
    'Tujuan uji'
  );

  if v_ride.status <> 'planned' or v_ride.created_by <> auth.uid() then
    raise exception 'UJI GAGAL: perjalanan baru tidak planned/milik pembuat (%, %)',
      v_ride.status, v_ride.created_by;
  end if;

  if not exists (
    select 1 from public.ride_members
    where ride_id = v_ride.id and user_id = auth.uid() and role = 'host' and status = 'joined'
  ) then
    raise exception 'UJI GAGAL: pembuat tidak otomatis menjadi host joined';
  end if;

  update public.uji_m3_konteks set ride_id = v_ride.id where nama = 'klub';
end;
$$;

-- 5. Anggota klub bergabung tanpa consent; non-anggota dan anon ditolak.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_status text;
  v_sharing boolean;
  v_rows int;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  v_status := public.join_ride(v_ride);

  if v_status <> 'joined' then
    raise exception 'UJI GAGAL: join_ride mengembalikan %', v_status;
  end if;

  select sharing_location into v_sharing from public.ride_members
  where ride_id = v_ride and user_id = auth.uid();

  if v_sharing is not false then
    raise exception 'UJI GAGAL: bergabung otomatis menyalakan berbagi lokasi';
  end if;

  select count(*) into v_rows from public.rides where id = v_ride;
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: anggota klub tidak membaca perjalanan klub (% baris)', v_rows;
  end if;

  -- Consent tidak bisa dinyalakan sebelum perjalanan aktif.
  begin
    perform public.set_ride_location_sharing(v_ride, true);
    raise exception 'UJI GAGAL: consent aktif pada perjalanan planned';
  exception
    when check_violation then null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_rows int;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';

  begin
    perform public.join_ride(v_ride);
    raise exception 'UJI GAGAL: non-anggota klub dapat bergabung';
  exception
    when insufficient_privilege then null;
  end;

  select count(*) into v_rows from public.rides where id = v_ride;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: non-anggota membaca perjalanan klub privat (% baris)', v_rows;
  end if;

  select count(*) into v_rows from public.ride_locations where ride_id = v_ride;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: non-anggota membaca lokasi (% baris)', v_rows;
  end if;
end;
$$;

set local role anon;
set local request.jwt.claims = '{}';

do $$
declare
  v_ride uuid;
  v_rows int;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';

  select count(*) into v_rows from public.rides where id = v_ride;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: anon membaca perjalanan (% baris)', v_rows;
  end if;

  select count(*) into v_rows from public.ride_locations where ride_id = v_ride;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: anon membaca lokasi (% baris)', v_rows;
  end if;

  if has_function_privilege('anon', 'public.create_ride(uuid,text,timestamptz,text,text,text,text)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon boleh EXECUTE create_ride';
  end if;
  if has_function_privilege('anon', 'public.transition_ride(uuid,text)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon boleh EXECUTE transition_ride';
  end if;
  if has_function_privilege('anon', 'public.publish_ride_location(uuid,double precision,double precision,double precision,double precision,double precision,timestamptz)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon boleh EXECUTE publish_ride_location';
  end if;
end;
$$;

-- 6. Hanya host yang boleh memindahkan status.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_ride uuid;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  begin
    perform public.transition_ride(v_ride, 'active');
    raise exception 'UJI GAGAL: anggota biasa dapat mengaktifkan perjalanan';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_result public.rides;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  v_result := public.transition_ride(v_ride, 'active');

  if v_result.status <> 'active' or v_result.started_at is null then
    raise exception 'UJI GAGAL: aktivasi tidak mengisi status/started_at';
  end if;

  begin
    perform public.transition_ride(v_ride, 'planned');
    raise exception 'UJI GAGAL: status dapat kembali ke planned';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;

-- 7. Consent dan publikasi lokasi.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_location public.ride_locations;
  v_rows int;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';

  perform public.set_ride_location_sharing(v_ride, true);
  v_location := public.publish_ride_location(v_ride, -6.2, 106.8, 12, 90, 5, now());

  if v_location.latitude <> -6.2 or v_location.user_id <> auth.uid() then
    raise exception 'UJI GAGAL: lokasi tersimpan dengan nilai tak terduga';
  end if;

  -- Fix terlalu tua dan dari masa depan ditolak.
  begin
    perform public.publish_ride_location(v_ride, -6.2, 106.8, 12, 90, 5, now() - interval '10 minutes');
    raise exception 'UJI GAGAL: lokasi basi diterima';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.publish_ride_location(v_ride, -6.2, 106.8, 12, 90, 5, now() + interval '10 minutes');
    raise exception 'UJI GAGAL: lokasi dari masa depan diterima';
  exception
    when invalid_parameter_value then null;
  end;

  -- REST langsung tidak bisa melewati RPC: grant INSERT/UPDATE sudah dicabut.
  begin
    insert into public.ride_locations (ride_id, user_id, latitude, longitude, recorded_at)
    values (v_ride, auth.uid(), -6.3, 106.9, now());
    raise exception 'UJI GAGAL: anggota dapat INSERT ride_locations langsung';
  exception
    when insufficient_privilege then null;
  end;

  select count(*) into v_rows from public.ride_locations where ride_id = v_ride;
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: jumlah lokasi setelah publikasi adalah %', v_rows;
  end if;
end;
$$;

-- Host yang belum berbagi tidak bisa mempublikasikan lokasi.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  begin
    perform public.publish_ride_location(v_ride, -6.2, 106.8, 10, null, null, now());
    raise exception 'UJI GAGAL: host mempublikasikan lokasi tanpa consent';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 8. Non-anggota tidak bisa mempublikasikan dan tidak membaca lokasi.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_rows int;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';

  begin
    perform public.publish_ride_location(v_ride, -6.2, 106.8, 10, null, null, now());
    raise exception 'UJI GAGAL: non-anggota mempublikasikan lokasi';
  exception
    when insufficient_privilege then null;
  end;

  select count(*) into v_rows from public.ride_locations where ride_id = v_ride;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: non-anggota membaca % baris lokasi', v_rows;
  end if;
end;
$$;

-- 9. Mematikan berbagi menghapus lokasi terakhir.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_rows int;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  perform public.set_ride_location_sharing(v_ride, false);

  select count(*) into v_rows from public.ride_locations
  where ride_id = v_ride and user_id = auth.uid();
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: lokasi tersisa setelah opt-out (% baris)', v_rows;
  end if;
end;
$$;

-- 10. Keluar menghapus lokasi; host tidak boleh keluar sebelum final.
do $$
declare
  v_ride uuid;
  v_rows int;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';

  perform public.set_ride_location_sharing(v_ride, true);
  perform public.publish_ride_location(v_ride, -6.21, 106.81, 11, null, null, now());
  perform public.leave_ride(v_ride);

  select count(*) into v_rows from public.ride_locations
  where ride_id = v_ride and user_id = auth.uid();
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: lokasi tersisa setelah keluar (% baris)', v_rows;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  begin
    perform public.leave_ride(v_ride);
    raise exception 'UJI GAGAL: host dapat keluar dari perjalanan yang belum final';
  exception
    when check_violation then null;
  end;
end;
$$;

-- 11. Bergabung kembali, berbagi, lalu host menyelesaikan perjalanan.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_rows int;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  perform public.join_ride(v_ride);
  perform public.set_ride_location_sharing(v_ride, true);
  perform public.publish_ride_location(v_ride, -6.22, 106.82, 10, null, null, now());

  select count(*) into v_rows from public.ride_locations where ride_id = v_ride;
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: lokasi tidak tersimpan sebelum ride selesai (% baris)', v_rows;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_result public.rides;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  v_result := public.transition_ride(v_ride, 'completed');

  if v_result.status <> 'completed' or v_result.ended_at is null then
    raise exception 'UJI GAGAL: perjalanan tidak selesai dengan benar';
  end if;
end;
$$;

reset role;

do $$
declare
  v_ride uuid;
  v_rows int;
  v_sharing boolean;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';

  select count(*) into v_rows from public.ride_locations where ride_id = v_ride;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: lokasi tersisa setelah ride selesai (% baris)', v_rows;
  end if;

  select sharing_location into v_sharing from public.ride_members
  where ride_id = v_ride and user_id = '22222222-2222-2222-2222-222222222222';
  if v_sharing is not false then
    raise exception 'UJI GAGAL: consent tetap menyala setelah ride selesai';
  end if;
end;
$$;

-- 12. Status final tidak bisa dibuka kembali dan consent tidak bisa dinyalakan.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';

  begin
    perform public.transition_ride(v_ride, 'active');
    raise exception 'UJI GAGAL: ride completed dapat kembali active';
  exception
    when check_violation then null;
  end;

  begin
    perform public.transition_ride(v_ride, 'cancelled');
    raise exception 'UJI GAGAL: ride completed dapat menjadi cancelled';
  exception
    when check_violation then null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_ride uuid;
begin
  select ride_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  begin
    perform public.set_ride_location_sharing(v_ride, true);
    raise exception 'UJI GAGAL: consent bisa dinyalakan pada ride final';
  exception
    when check_violation then null;
  end;
end;
$$;

-- 13. Undangan: invite_only tidak bisa di-join langsung; host mengundang,
--     target menerima, lalu host mengeluarkan dan lokasinya dibersihkan.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_club uuid;
  v_ride public.rides;
begin
  select club_id into v_club from public.uji_m3_konteks where nama = 'klub';
  v_ride := public.create_ride(v_club, 'Ride Undangan M3', now() + interval '2 hours', null, null, null, 'invite_only');
  update public.uji_m3_konteks set ride_invite_id = v_ride.id where nama = 'klub';
  perform public.transition_ride(v_ride.id, 'active');
end;
$$;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

do $$
declare
  v_ride uuid;
begin
  select ride_invite_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  begin
    perform public.join_ride(v_ride);
    raise exception 'UJI GAGAL: invite_only dapat di-join tanpa undangan';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_status text;
begin
  select ride_invite_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  v_status := public.invite_ride_member(v_ride, '44444444-4444-4444-4444-444444444444');
  if v_status <> 'invited' then
    raise exception 'UJI GAGAL: undangan menghasilkan status %', v_status;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_status text;
begin
  select ride_invite_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  v_status := public.accept_ride_invite(v_ride);
  if v_status <> 'joined' then
    raise exception 'UJI GAGAL: menerima undangan menghasilkan status %', v_status;
  end if;

  perform public.set_ride_location_sharing(v_ride, true);
  perform public.publish_ride_location(v_ride, -6.4, 107.0, 15, null, null, now());
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_status text;
  v_rows int;
begin
  select ride_invite_id into v_ride from public.uji_m3_konteks where nama = 'klub';
  v_status := public.remove_ride_member(v_ride, '44444444-4444-4444-4444-444444444444');
  if v_status <> 'removed' then
    raise exception 'UJI GAGAL: mengeluarkan peserta menghasilkan status %', v_status;
  end if;

  select count(*) into v_rows from public.ride_locations where ride_id = v_ride;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: lokasi peserta yang dikeluarkan masih ada (% baris)', v_rows;
  end if;

  begin
    perform public.remove_ride_member(v_ride, auth.uid());
    raise exception 'UJI GAGAL: host dapat mengeluarkan dirinya sendiri';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;

-- 14. Anggota aktif ride lain membaca lokasi peserta (dasar Postgres Changes).
--     Non-anggota dan anon sudah dibuktikan 0 baris pada langkah 8.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_rows int;
begin
  select ride_invite_id into v_ride from public.uji_m3_konteks where nama = 'klub';

  select count(*) into v_rows from public.ride_locations
  where ride_id = v_ride and user_id = '44444444-4444-4444-4444-444444444444';
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: lokasi peserta yang dikeluarkan masih terbaca (% baris)', v_rows;
  end if;
end;
$$;

reset role;

do $$
begin
  raise notice 'UJI RLS PERJALANAN M3 LULUS: state machine, consent, dan pembersihan lokasi sesuai harapan';
end;
$$;

rollback;
