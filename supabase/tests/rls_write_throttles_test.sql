-- db:test notice: UJI RATE LIMIT TULIS M5 LULUS
-- ============================================================================
-- Uji throttle jalur tulis AUD-14 lanjutan
-- (`20261026184430_m5_write_throttles.sql`).
-- ============================================================================
-- Yang dibuktikan:
--   1. Pembuatan klub: 10 klub pertama diterima, ke-11 ditolak P0001 dengan
--      detail yang dapat dipetakan klien; baris yang ditolak tidak tersimpan.
--   2. Pembuatan ride: 10 ride pertama diterima, ke-11 ditolak; batas berlaku
--      per pengguna, bukan global.
--   3. Publikasi lokasi: publikasi pertama diterima, publikasi kedua yang
--      terlalu cepat ditolak dan tidak menimpa koordinat lama; setelah jeda
--      minimum, publikasi berikutnya diterima.
--   4. Reset throttle saat consent/keanggotaan berubah: mematikan berbagi
--      menghapus lokasi terakhir dan mengosongkan last_location_published_at,
--      sehingga menyalakan berbagi lagi dapat langsung memublikasikan posisi.
--   5. Pembersihan saat peserta keluar dan perjalanan selesai tetap dibuktikan
--      oleh `rls_rides_test.sql` (lokasi dan consent).
--
-- Serialisasi permintaan serentak TIDAK dapat dibuktikan dalam satu transaksi
-- seperti berkas ini. Bukti terpisah ada di
-- `scripts/db-write-throttle-concurrency.mjs` (`npm run db:test:concurrency`),
-- yang memakai dua koneksi dan dua transaksi paralel lalu membersihkan data.
--
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi
-- tidak ada klub/ride/lokasi/pengguna uji yang tertinggal.
-- ============================================================================

begin;

-- 0. Paritas: berhenti dengan pesan jelas bila migration belum diterapkan.
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'ride_members'
       and column_name = 'last_location_published_at'
  ) then
    raise exception 'UJI GAGAL (migration throttle belum diterapkan): kolom public.ride_members.last_location_published_at belum ada. Terapkan supabase/migrations/20261026184430_m5_write_throttles.sql lebih dulu.';
  end if;
end;
$$;

-- 1. Konteks uji hanya hidup di dalam transaksi dan ikut ROLLBACK.
create table public.uji_m5_throttle_konteks (
  nama text primary key,
  id uuid
);
grant select, insert, update, delete on public.uji_m5_throttle_konteks to authenticated;

-- 2. Dua akun: A membuat klub/ride sampai batas, B membuktikan batas per pengguna.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'c8000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm5t.a@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m5t_a","display_name":"Throttle A"}',
    now(), now()
  ),
  (
    'c8000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm5t.b@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m5t_b","display_name":"Throttle B"}',
    now(), now()
  );

set local role authenticated;
set local request.jwt.claims = '{"sub":"c8000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- 3. Klub: 10 diterima, ke-11 ditolak.
do $$
declare
  v_club jsonb;
  v_i int;
  v_state text := null;
  v_detail text := null;
  v_denied boolean := false;
begin
  for v_i in 1..10 loop
    v_club := public.create_club(
      'Klub Throttle ' || v_i::text,
      'uji-throttle-' || v_i::text,
      'Klub untuk uji throttle jalur tulis.',
      'private',
      'approval'
    );

    insert into public.uji_m5_throttle_konteks (nama, id)
    values ('klub_' || v_i::text, (v_club ->> 'id')::uuid);
  end loop;

  begin
    perform public.create_club(
      'Klub Throttle 11',
      'uji-throttle-11',
      'Klub yang harus ditolak throttle.',
      'private',
      'approval'
    );
  exception when others then
    v_denied := true;
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if not v_denied then
    raise exception 'UJI GAGAL: klub ke-11 dalam satu jam tidak ditolak';
  end if;

  if v_state is distinct from 'P0001' or v_detail is distinct from 'club_create_rate_limit' then
    raise exception 'UJI GAGAL: throttle klub tidak terdeteksi (state=%, detail=%)', v_state, v_detail;
  end if;

  if (
    select count(*)
      from public.clubs c
     where c.created_by = auth.uid()
  ) <> 10 then
    raise exception 'UJI GAGAL: jumlah klub tersimpan bukan 10 setelah penolakan';
  end if;
end;
$$;

-- 4. Batas klub per pengguna: B tetap boleh membuat klub.
set local request.jwt.claims = '{"sub":"c8000000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare
  v_club jsonb;
begin
  v_club := public.create_club(
    'Klub Throttle B',
    'uji-throttle-b',
    'Klub B untuk membuktikan batas per pengguna.',
    'private',
    'approval'
  );

  insert into public.uji_m5_throttle_konteks (nama, id)
  values ('klub_b', (v_club ->> 'id')::uuid);
end;
$$;

-- 5. Ride: A membuat 10 ride, ke-11 ditolak. B membuat satu ride di klubnya.
set local request.jwt.claims = '{"sub":"c8000000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  v_club uuid;
  v_ride public.rides;
  v_i int;
  v_state text := null;
  v_detail text := null;
  v_denied boolean := false;
begin
  select id into v_club from public.uji_m5_throttle_konteks where nama = 'klub_1';

  for v_i in 1..10 loop
    v_ride := public.create_ride(
      v_club,
      'Ride Throttle ' || v_i::text,
      now() + interval '1 hour',
      'Ride untuk uji throttle jalur tulis.',
      'Titik kumpul',
      'Tujuan'
    );

    if v_i = 1 then
      insert into public.uji_m5_throttle_konteks (nama, id)
      values ('ride_1', v_ride.id);
    end if;
  end loop;

  begin
    perform public.create_ride(
      v_club,
      'Ride Throttle 11',
      now() + interval '1 hour',
      'Ride yang harus ditolak throttle.',
      'Titik kumpul',
      'Tujuan'
    );
  exception when others then
    v_denied := true;
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if not v_denied then
    raise exception 'UJI GAGAL: ride ke-11 dalam satu jam tidak ditolak';
  end if;

  if v_state is distinct from 'P0001' or v_detail is distinct from 'ride_create_rate_limit' then
    raise exception 'UJI GAGAL: throttle ride tidak terdeteksi (state=%, detail=%)', v_state, v_detail;
  end if;

  if (
    select count(*)
      from public.rides r
     where r.created_by = auth.uid()
  ) <> 10 then
    raise exception 'UJI GAGAL: jumlah ride tersimpan bukan 10 setelah penolakan';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"c8000000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare
  v_club uuid;
  v_ride public.rides;
begin
  select id into v_club from public.uji_m5_throttle_konteks where nama = 'klub_b';
  v_ride := public.create_ride(
    v_club,
    'Ride Throttle B',
    now() + interval '1 hour',
    'Ride B untuk membuktikan batas per pengguna.',
    'Titik kumpul',
    'Tujuan'
  );

  if v_ride.id is null then
    raise exception 'UJI GAGAL: B tidak bisa membuat ride setelah A mencapai batas';
  end if;
end;
$$;

-- 6. Lokasi: publikasi pertama diterima, pengulangan terlalu cepat ditolak.
set local request.jwt.claims = '{"sub":"c8000000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_location public.ride_locations;
  v_state text := null;
  v_detail text := null;
  v_denied boolean := false;
begin
  select id into v_ride from public.uji_m5_throttle_konteks where nama = 'ride_1';

  perform public.transition_ride(v_ride, 'active');
  perform public.set_ride_location_sharing(v_ride, true);

  v_location := public.publish_ride_location(v_ride, -6.2, 106.8, 12, 90, 5, now());

  if v_location.latitude <> -6.2 or v_location.longitude <> 106.8 then
    raise exception 'UJI GAGAL: lokasi pertama tersimpan dengan nilai tak terduga';
  end if;

  begin
    perform public.publish_ride_location(v_ride, -6.3, 106.9, 12, 90, 5, now());
  exception when others then
    v_denied := true;
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if not v_denied then
    raise exception 'UJI GAGAL: publikasi lokasi kedua yang terlalu cepat tidak ditolak';
  end if;

  if v_state is distinct from 'P0001' or v_detail is distinct from 'location_publish_rate_limit' then
    raise exception 'UJI GAGAL: throttle lokasi tidak terdeteksi (state=%, detail=%)', v_state, v_detail;
  end if;

  select *
    into v_location
    from public.ride_locations
   where ride_id = v_ride and user_id = auth.uid();

  if v_location.latitude <> -6.2 or v_location.longitude <> 106.8 then
    raise exception 'UJI GAGAL: publikasi yang ditolak menimpa lokasi lama';
  end if;
end;
$$;

-- 7. Setelah jeda minimum, publikasi berikutnya diterima. Timestamp dimajukan
--    sebagai owner database (bukan lewat REST) supaya uji tidak memperlambat
--    suite dengan pg_sleep.
reset role;

do $$
declare
  v_ride uuid;
begin
  select id into v_ride from public.uji_m5_throttle_konteks where nama = 'ride_1';

  update public.ride_members
     set last_location_published_at = now() - interval '3 seconds'
   where ride_id = v_ride
     and user_id = 'c8000000-0000-4000-8000-000000000001';
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c8000000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_location public.ride_locations;
begin
  select id into v_ride from public.uji_m5_throttle_konteks where nama = 'ride_1';

  v_location := public.publish_ride_location(v_ride, -6.4, 107.0, 12, 90, 5, now());

  if v_location.latitude <> -6.4 or v_location.longitude <> 107.0 then
    raise exception 'UJI GAGAL: publikasi setelah jeda minimum ditolak atau salah simpan';
  end if;
end;
$$;

-- 8. Opt-out mereset throttle: lokasi terakhir hilang, lalu sharing yang
--    dinyalakan lagi dapat langsung mengirim posisi tanpa menunggu jendela
--    publikasi sebelumnya.
do $$
declare
  v_ride uuid;
  v_location public.ride_locations;
  v_rows int;
  v_last timestamptz;
begin
  select id into v_ride from public.uji_m5_throttle_konteks where nama = 'ride_1';

  perform public.set_ride_location_sharing(v_ride, false);

  select count(*) into v_rows
    from public.ride_locations
   where ride_id = v_ride and user_id = auth.uid();
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: lokasi tersisa setelah consent dimatikan (% baris)', v_rows;
  end if;

  select last_location_published_at into v_last
    from public.ride_members
   where ride_id = v_ride and user_id = auth.uid();
  if v_last is not null then
    raise exception 'UJI GAGAL: throttle lokasi tidak direset saat consent dimatikan';
  end if;

  perform public.set_ride_location_sharing(v_ride, true);
  v_location := public.publish_ride_location(v_ride, -6.5, 107.1, 12, 90, 5, now());

  if v_location.latitude <> -6.5 or v_location.longitude <> 107.1 then
    raise exception 'UJI GAGAL: publikasi setelah opt-out lalu opt-in ditolak throttle lama';
  end if;
end;
$$;

do $$
begin
  raise notice 'UJI RATE LIMIT TULIS M5 LULUS: klub/ride/publikasi lokasi dibatasi per pengguna, penolakan tidak menulis data, dan opt-out mereset throttle.';
end;
$$;

rollback;
