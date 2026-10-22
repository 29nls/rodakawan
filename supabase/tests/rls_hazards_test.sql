-- db:test notice: UJI RLS LAKUAN M4 LULUS
-- ============================================================================
-- Uji RLS/RPC Milestone 4 — laporan bahaya jalan.
-- ============================================================================
-- Desain yang diuji (lihat supabase/migrations/20261020090000_hazard_reports_m4.sql
-- dan MILESTONE_4_PLAN bagian 2): laporan bahaya bersifat GLOBAL per area —
-- bukan di-scope ke klub/perjalanan. `ride_id` hanya konteks opsional, dan
-- pelapor hanya harus peserta ride BILA menautkan laporan ke ride tertentu.
-- Seluruh tulis melewati RPC `security definer`; jalur tulis langsung dicabut.
--
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi tidak
-- ada pengguna/laporan uji yang tertinggal.
--
-- Pola penangkapan galat: blok inner menangkap SQLSTATE yang diharapkan lalu
-- `return`/null; bila RPC justru SUKSES, baris `raise exception 'UJI GAGAL ...'`
-- (SQLSTATE P0001) ditembak dan TIDAK tertangkap handler (khusus SQLSTATE itu),
-- sehingga kegagalan uji selalu terlihat jelas — tidak ada "hijau palsu".
-- ============================================================================

begin;

-- 0. Paritas: berhenti dengan pesan jelas bila migration belum diterapkan.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.create_hazard(text, text, double precision, double precision, text, uuid, uuid)') is null then
    v_missing := v_missing || 'fungsi public.create_hazard'::text;
  end if;

  if to_regprocedure('public.update_hazard(uuid, text, text)') is null then
    v_missing := v_missing || 'fungsi public.update_hazard'::text;
  end if;

  if to_regprocedure('public.remove_hazard(uuid)') is null then
    v_missing := v_missing || 'fungsi public.remove_hazard'::text;
  end if;

  if to_regprocedure('public.confirm_hazard(uuid)') is null then
    v_missing := v_missing || 'fungsi public.confirm_hazard'::text;
  end if;

  if to_regprocedure('public.hazard_expiry_seconds(text)') is null then
    v_missing := v_missing || 'fungsi public.hazard_expiry_seconds'::text;
  end if;

  if to_regprocedure('public.expire_hazard_reports()') is null then
    v_missing := v_missing || 'fungsi public.expire_hazard_reports'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (migration M4 belum diterapkan): objek berikut belum ada — %. Terapkan supabase/migrations/20261020090000_hazard_reports_m4.sql lebih dulu.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Tabel konteks uji hanya hidup di dalam transaksi dan ikut ROLLBACK.
create table public.uji_m4_konteks (
  nama text primary key,
  id uuid
);
grant select, insert, update, delete on public.uji_m4_konteks to authenticated;

-- 2. Lima akun: A host+anggota ride, B anggota ride, C orang luar, D pelapor
--    rate-limit, E pelapor duplikat/edit/hapus/kedaluwarsa.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m4hz.a@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"m4hz_a","display_name":"M4Hz A"}',now(),now()),
  ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m4hz.b@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"m4hz_b","display_name":"M4Hz B"}',now(),now()),
  ('33333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m4hz.c@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"m4hz_c","display_name":"M4Hz C"}',now(),now()),
  ('44444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m4hz.d@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"m4hz_d","display_name":"M4Hz D"}',now(),now()),
  ('55555555-5555-4555-8555-555555555555','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m4hz.e@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"m4hz_e","display_name":"M4Hz E"}',now(),now());

-- 3. Konteks ride: A membuat klub + perjalanan (A otomatis host `joined`);
--    B bergabung ke klub (disetujui A) lalu ke perjalanan. C/D/E orang luar.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_club jsonb;
  v_ride public.rides;
begin
  v_club := public.create_club('Uji Hazard M4','uji-hazard-m4','Klub untuk uji hazard Milestone 4.','private','approval');
  insert into public.uji_m4_konteks (nama, id) values ('klub', (v_club ->> 'id')::uuid);

  v_ride := public.create_ride((v_club ->> 'id')::uuid, 'Ride Hazard M4', now() + interval '1 hour', 'Perjalanan uji hazard.', 'Titik kumpul', 'Tujuan');
  insert into public.uji_m4_konteks (nama, id) values ('ride', v_ride.id);
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
begin
  perform public.request_club_membership((select id from public.uji_m4_konteks where nama = 'klub'));
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
begin
  perform public.review_club_membership((select id from public.uji_m4_konteks where nama = 'klub'), '22222222-2222-4222-8222-222222222222', true);
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
begin
  perform public.join_ride((select id from public.uji_m4_konteks where nama = 'ride'));
end;
$$;

-- 4. Laporan GLOBAL: pengguna terautentikasi membuat laporan tanpa konteks ride;
--    `expires_at` dihitung server dari `created_at` + kebijakan kategori.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_h public.hazard_reports;
begin
  -- `p_client_report_id` bertipe uuid (lihat tanda tangan create_hazard di
  -- migration), jadi nilainya HARUS literal UUID yang valid — string teks
  -- seperti 'a-client-001' ditolak PostgreSQL dengan SQLSTATE 22P02 saat
  -- argumen itu di-cast ke uuid.
  v_h := public.create_hazard('pothole','moderate',-6.2,106.8,'Lubang global',null,'a1111111-2222-4333-8444-555555555555');

  if v_h.id is null then
    raise exception 'UJI GAGAL: laporan global tidak dibuat';
  end if;

  -- pothole = 86400 detik (24 jam) per hazard_expiry_seconds; fungsi itu sendiri
  -- di-revoke dari authenticated, jadi angka kebijakannya dipakai langsung di sini.
  if v_h.expires_at <> v_h.created_at + interval '24 hours' then
    raise exception 'UJI GAGAL: expires_at tidak dihitung server (created=%, expires=%)', v_h.created_at, v_h.expires_at;
  end if;

  insert into public.uji_m4_konteks (nama, id) values ('h_a_global', v_h.id);
end;
$$;

-- 5. Idempotensi: client_report_id sama + pelapor sama → baris yang sama.
do $$
declare
  v_first uuid;
  v_again public.hazard_reports;
begin
  select id into v_first from public.uji_m4_konteks where nama = 'h_a_global';
  -- UUID yang SAMA dengan section 4: itu inti uji idempotensi — kunci
  -- idempotensi sama + pelapor sama harus mengembalikan baris yang sama.
  v_again := public.create_hazard('pothole','moderate',-6.2,106.8,'Ulang', null, 'a1111111-2222-4333-8444-555555555555');

  if v_again.id is distinct from v_first then
    raise exception 'UJI GAGAL: idempotensi client_report_id tidak mengembalikan baris yang sama';
  end if;
end;
$$;

-- 6. Rate limit 5 laporan / 10 menit / pelapor (D). Percobaan ke-6 ditolak P0001.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare
  v_i int;
  v_state text := null;
  v_detail text := null;
begin
  for v_i in 1..6 loop
    begin
      perform public.create_hazard('pothole','moderate', -5.0 + (v_i * 0.02), 107.0, 'Rate limit', null, null);
    exception when others then
      get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
      exit when v_state = 'P0001';
    end;
  end loop;

  if v_state is distinct from 'P0001' or v_detail is distinct from 'hazard_rate_limit' then
    raise exception 'UJI GAGAL: rate limit create_hazard tidak terdeteksi (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 7. Duplikat terdekat: kategori sama dalam ±50 m / 10 menit ditolak 23505.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_h public.hazard_reports;
  v_state text := null;
  v_detail text := null;
begin
  v_h := public.create_hazard('crash','high',-7.0,108.0,'Kecelakaan pertama',null,null);
  insert into public.uji_m4_konteks (nama, id) values ('h_e_dup', v_h.id);

  begin
    perform public.create_hazard('crash','high',-7.0001,108.0001,'Duplikat dekat',null,null);
    raise exception 'UJI GAGAL: duplikat terdekat diterima';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '23505' or v_detail is distinct from 'hazard_duplicate_nearby' then
    raise exception 'UJI GAGAL: duplikat salah ditangani (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 8. Koordinat di luar rentang ditolak 22023.
do $$
declare
  v_state text := null;
  v_detail text := null;
begin
  begin
    perform public.create_hazard('pothole','moderate',99.0,106.8,'Lintang salah',null,null);
    raise exception 'UJI GAGAL: koordinat di luar rentang diterima';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '22023' or v_detail is distinct from 'hazard_invalid_coordinates' then
    raise exception 'UJI GAGAL: validasi koordinat salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 9. Penautan ke ride: hanya peserta ride. Orang luar (C) ditolak 42501; host
--    ride (A) dapat menautkan.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_ride from public.uji_m4_konteks where nama = 'ride';

  begin
    perform public.create_hazard('pothole','moderate',-6.9,107.9,'Taut ride', v_ride, null);
    raise exception 'UJI GAGAL: non-peserta ride menautkan laporan ke ride';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '42501' or v_detail is distinct from 'hazard_ride_not_member' then
    raise exception 'UJI GAGAL: penautan ride salah ditangani (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_h public.hazard_reports;
begin
  select id into v_ride from public.uji_m4_konteks where nama = 'ride';
  v_h := public.create_hazard('pothole','moderate',-6.25,106.85,'Taut ride host', v_ride, null);
  if v_h.ride_id is distinct from v_ride then
    raise exception 'UJI GAGAL: host ride tidak dapat menautkan laporannya';
  end if;
  insert into public.uji_m4_konteks (nama, id) values ('h_a_ride', v_h.id);
end;
$$;

-- 10. Hanya pelapor yang dapat mengubah laporannya.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_h public.hazard_reports;
begin
  v_h := public.create_hazard('flood','info',-7.1,108.1,'Untuk edit',null,null);
  insert into public.uji_m4_konteks (nama, id) values ('h_e_edit', v_h.id);
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_h uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_h from public.uji_m4_konteks where nama = 'h_e_edit';

  begin
    perform public.update_hazard(v_h, 'high', 'Dicoba orang lain');
    raise exception 'UJI GAGAL: pengguna lain mengubah laporan orang';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '42501' or v_detail is distinct from 'hazard_not_reporter' then
    raise exception 'UJI GAGAL: update lintas-pelapor salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_h uuid;
  v_u public.hazard_reports;
begin
  select id into v_h from public.uji_m4_konteks where nama = 'h_e_edit';
  v_u := public.update_hazard(v_h, 'high', 'Diperbarui pelapor');
  if v_u.severity <> 'high' then
    raise exception 'UJI GAGAL: pelapor tidak dapat mengubah severity laporannya';
  end if;
end;
$$;

-- 11. Jendela edit 15 menit: setelah lewat, pelapor sendiri ditolak 23514.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_h public.hazard_reports;
begin
  v_h := public.create_hazard('flood','info',-7.2,108.2,'Untuk jendela edit',null,null);
  insert into public.uji_m4_konteks (nama, id) values ('h_e_win', v_h.id);
end;
$$;

reset role;
do $$
declare v_id uuid;
begin
  select id into v_id from public.uji_m4_konteks where nama = 'h_e_win';
  update public.hazard_reports set created_at = now() - interval '16 minutes' where id = v_id;
end;
$$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_h uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_h from public.uji_m4_konteks where nama = 'h_e_win';
  begin
    perform public.update_hazard(v_h, 'high', 'Terlambat');
    raise exception 'UJI GAGAL: update setelah jendela 15 menit diterima';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '23514' or v_detail is distinct from 'hazard_edit_window' then
    raise exception 'UJI GAGAL: jendela edit salah ditangani (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 12. Hapus: hanya pelapor; status `removed`; jendela 15 menit berlaku.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_h public.hazard_reports;
begin
  v_h := public.create_hazard('flood','info',-7.3,108.3,'Untuk hapus',null,null);
  insert into public.uji_m4_konteks (nama, id) values ('h_e_rm', v_h.id);
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_h uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_h from public.uji_m4_konteks where nama = 'h_e_rm';
  begin
    perform public.remove_hazard(v_h);
    raise exception 'UJI GAGAL: pengguna lain menghapus laporan orang';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '42501' or v_detail is distinct from 'hazard_not_reporter' then
    raise exception 'UJI GAGAL: hapus lintas-pelapor salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_h uuid;
  v_r public.hazard_reports;
begin
  select id into v_h from public.uji_m4_konteks where nama = 'h_e_rm';
  v_r := public.remove_hazard(v_h);
  if v_r.status <> 'removed' then
    raise exception 'UJI GAGAL: remove_hazard tidak menyetel status removed (%)', v_r.status;
  end if;
end;
$$;

-- 13. Laporan kedaluwarsa: tidak terbaca sebagai aktif oleh non-pelapor, tetap
--     terbaca pelapor; konfirmasi ditolak 23514.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_h public.hazard_reports;
begin
  v_h := public.create_hazard('pothole','info',-7.5,108.5,'Untuk kedaluwarsa',null,null);
  insert into public.uji_m4_konteks (nama, id) values ('h_e_exp', v_h.id);
end;
$$;

reset role;
do $$
declare v_id uuid;
begin
  select id into v_id from public.uji_m4_konteks where nama = 'h_e_exp';
  -- pothole kedaluwarsa 24 jam; mundurkan 25 jam supaya expires_at <= now().
  update public.hazard_reports set created_at = now() - interval '25 hours' where id = v_id;
end;
$$;
set local role authenticated;

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_n int;
begin
  select id into v_id from public.uji_m4_konteks where nama = 'h_e_exp';
  select count(*) into v_n from public.hazard_reports where id = v_id;
  if v_n <> 0 then
    raise exception 'UJI GAGAL: non-pelapor masih membaca laporan kedaluwarsa sebagai aktif';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_n int;
begin
  select id into v_id from public.uji_m4_konteks where nama = 'h_e_exp';
  select count(*) into v_n from public.hazard_reports where id = v_id;
  if v_n <> 1 then
    raise exception 'UJI GAGAL: pelapor tidak membaca laporan kedaluwarsa miliknya sendiri';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_id from public.uji_m4_konteks where nama = 'h_e_exp';
  begin
    perform public.confirm_hazard(v_id);
    raise exception 'UJI GAGAL: konfirmasi laporan kedaluwarsa diterima';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '23514' or v_detail is distinct from 'hazard_expired' then
    raise exception 'UJI GAGAL: konfirmasi kedaluwarsa salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 14. Konfirmasi: satu per pengguna per laporan; duplikat ditolak 23505.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_total int;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_id from public.uji_m4_konteks where nama = 'h_a_global';

  v_total := public.confirm_hazard(v_id);
  if v_total < 1 then
    raise exception 'UJI GAGAL: konfirmasi pertama tidak menghasilkan hitungan >= 1';
  end if;

  begin
    perform public.confirm_hazard(v_id);
    raise exception 'UJI GAGAL: konfirmasi duplikat diterima';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '23505' or v_detail is distinct from 'hazard_already_confirmed' then
    raise exception 'UJI GAGAL: konfirmasi duplikat salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 15. Jalur tulis langsung dicabut: INSERT REST oleh authenticated ditolak.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
begin
  begin
    insert into public.hazard_reports (reporter_id, category, severity, latitude, longitude)
    values (auth.uid(), 'pothole', 'info', -6.0, 106.0);
    raise exception 'UJI GAGAL: INSERT langsung ke hazard_reports diterima';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- 16. Anon: tidak membaca dan tidak menulis.
set local role anon;
set local request.jwt.claims = '{}';
do $$
declare
  v_n int;
  v_state text := null;
begin
  select count(*) into v_n from public.hazard_reports;
  if v_n > 0 then
    raise exception 'UJI GAGAL: anon membaca % laporan hazard', v_n;
  end if;

  begin
    perform public.create_hazard('pothole','moderate',-6.0,106.0,'Anon',null,null);
    raise exception 'UJI GAGAL: anon membuat laporan hazard';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
  end;

  if v_state is distinct from '42501' then
    raise exception 'UJI GAGAL: anon create_hazard seharusnya 42501 (state=%)', v_state;
  end if;
end;
$$;

reset role;

do $$
begin
  raise notice 'UJI RLS LAKUAN M4 LULUS: hazard RLS, RPC, expiry, konfirmasi, rate limit, dan jalur tulis tertutup semuanya lolos';
end;
$$;

rollback;
