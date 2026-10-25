-- db:test notice: UJI RATE LIMIT DATABASE LULUS
-- ============================================================================
-- Uji rate limit database untuk follow, laporan moderasi, dan permintaan
-- gabung klub (AUD-14; migration 20261025013131_m5_rate_limits.sql).
-- ============================================================================
-- Yang dibuktikan:
--   1. Lima belas baris pertama di bawah batas diterima; percobaan berikutnya
--      di jendela 10 menit ditolak P0001 dengan detail yang bisa dipetakan
--      klien, bukan pesan teks.
--   2. Batas berlaku per pengguna, bukan global: pengguna lain pada saat yang
--      sama tetap bisa melakukan aksi yang sama.
--   3. Jalur REST langsung ke `public.content_reports` ikut tertutup — bukan
--      hanya RPC `report_content`.
--   4. Baris yang ditolak tidak tersimpan (tidak ada "setengah sukses").
--
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi
-- tidak ada pengguna/laporan/klub uji yang tertinggal.
-- ============================================================================

begin;

-- 0. Paritas: berhenti dengan pesan jelas bila migration belum diterapkan.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.enforce_follow_rate_limit()') is null then
    v_missing := v_missing || 'fungsi public.enforce_follow_rate_limit'::text;
  end if;

  if to_regprocedure('public.enforce_content_report_rate_limit()') is null then
    v_missing := v_missing || 'fungsi public.enforce_content_report_rate_limit'::text;
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'follows'
       and t.tgname = 'follows_rate_limit'
       and not t.tgisinternal
  ) then
    v_missing := v_missing || 'trigger follows_rate_limit'::text;
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'content_reports'
       and t.tgname = 'content_reports_rate_limit'
       and not t.tgisinternal
  ) then
    v_missing := v_missing || 'trigger content_reports_rate_limit'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (migration rate limit belum diterapkan): objek berikut belum ada — %. Terapkan supabase/migrations/20261025013131_m5_rate_limits.sql lebih dulu.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Tabel konteks uji hanya hidup di dalam transaksi dan ikut ROLLBACK.
create table public.uji_rate_limit_konteks (
  nama text primary key,
  id uuid
);
grant select, insert, update, delete on public.uji_rate_limit_konteks to authenticated;

-- 2. Dua belas akun: A pembuat klub/laporan bahaya, B pemohon gabung,
--    C..K target follow, L pelapor moderasi.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b7000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a1@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a1","display_name":"Rate Limit A1"}',now(),now()),
  ('b7000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a2@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a2","display_name":"Rate Limit A2"}',now(),now()),
  ('b7000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a3@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a3","display_name":"Rate Limit A3"}',now(),now()),
  ('b7000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a4@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a4","display_name":"Rate Limit A4"}',now(),now()),
  ('b7000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a5@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a5","display_name":"Rate Limit A5"}',now(),now()),
  ('b7000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a6@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a6","display_name":"Rate Limit A6"}',now(),now()),
  ('b7000000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a7@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a7","display_name":"Rate Limit A7"}',now(),now()),
  ('b7000000-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a8@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a8","display_name":"Rate Limit A8"}',now(),now()),
  ('b7000000-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a9@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a9","display_name":"Rate Limit A9"}',now(),now()),
  ('b7000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a10@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a10","display_name":"Rate Limit A10"}',now(),now()),
  ('b7000000-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a11@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a11","display_name":"Rate Limit A11"}',now(),now()),
  ('b7000000-0000-4000-8000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rl.a12@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"rl_a12","display_name":"Rate Limit A12"}',now(),now());

set local role authenticated;

-- 3. Follow: A mengikuti sepuluh profil (allow), percobaan ke-11 ditolak.
--    Jalur yang diuji adalah INSERT REST langsung, bukan RPC.
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_targets uuid[] := array[
    'b7000000-0000-4000-8000-000000000002'::uuid,
    'b7000000-0000-4000-8000-000000000003'::uuid,
    'b7000000-0000-4000-8000-000000000004'::uuid,
    'b7000000-0000-4000-8000-000000000005'::uuid,
    'b7000000-0000-4000-8000-000000000006'::uuid,
    'b7000000-0000-4000-8000-000000000007'::uuid,
    'b7000000-0000-4000-8000-000000000008'::uuid,
    'b7000000-0000-4000-8000-000000000009'::uuid,
    'b7000000-0000-4000-8000-00000000000a'::uuid,
    'b7000000-0000-4000-8000-00000000000b'::uuid
  ];
  v_i int;
  v_state text := null;
  v_detail text := null;
begin
  for v_i in 1..10 loop
    insert into public.follows (follower_id, followed_id)
    values (auth.uid(), v_targets[v_i]);
  end loop;

  begin
    insert into public.follows (follower_id, followed_id)
    values (auth.uid(), 'b7000000-0000-4000-8000-00000000000c');
    raise exception 'UJI GAGAL: follow ke-11 dalam 10 menit tidak ditolak';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from 'P0001' or v_detail is distinct from 'follow_rate_limit' then
    raise exception 'UJI GAGAL: rate limit follow tidak terdeteksi (state=%, detail=%)', v_state, v_detail;
  end if;

  if (select count(*) from public.follows f where f.follower_id = auth.uid()) <> 10 then
    raise exception 'UJI GAGAL: jumlah follow tersimpan bukan 10 setelah penolakan';
  end if;
end;
$$;

-- 4. Batas per pengguna: B, yang belum melakukan follow apa pun, tetap bisa.
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.follows (follower_id, followed_id)
  values (auth.uid(), 'b7000000-0000-4000-8000-000000000003');

  if not exists (
    select 1 from public.follows f
     where f.follower_id = auth.uid()
       and f.followed_id = 'b7000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'UJI GAGAL: rate limit follow milik A ikut menolak pengguna B';
  end if;
end;
$$;

-- 5. A membuat enam klub (baris owner tidak boleh menghabiskan kuota gabung).
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_club jsonb;
  v_i int;
begin
  for v_i in 1..6 loop
    v_club := public.create_club(
      'Uji Rate Limit ' || v_i::text,
      'uji-rl-' || v_i::text,
      'Klub untuk uji rate limit database.',
      'private',
      'approval'
    );

    insert into public.uji_rate_limit_konteks (nama, id)
    values ('klub_' || v_i::text, (v_club ->> 'id')::uuid);
  end loop;
end;
$$;

-- 6. Permintaan gabung: lima diterima, keenam ditolak.
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare
  v_i int;
  v_status text;
  v_state text := null;
  v_detail text := null;
begin
  for v_i in 1..5 loop
    v_status := public.request_club_membership(
      (select id from public.uji_rate_limit_konteks where nama = 'klub_' || v_i::text)
    );

    if v_status is distinct from 'pending' then
      raise exception 'UJI GAGAL: status permintaan klub % adalah %, bukan pending', v_i, v_status;
    end if;
  end loop;

  begin
    perform public.request_club_membership(
      (select id from public.uji_rate_limit_konteks where nama = 'klub_6')
    );
    raise exception 'UJI GAGAL: permintaan gabung ke-6 dalam 10 menit tidak ditolak';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from 'P0001' or v_detail is distinct from 'club_join_rate_limit' then
    raise exception 'UJI GAGAL: rate limit gabung klub tidak terdeteksi (state=%, detail=%)', v_state, v_detail;
  end if;

  if (
    select count(*) from public.club_members cm
     where cm.user_id = auth.uid() and cm.role = 'member'
  ) <> 5 then
    raise exception 'UJI GAGAL: jumlah permintaan klub tersimpan bukan 5 setelah penolakan';
  end if;
end;
$$;

-- 7. A membuat satu laporan bahaya sebagai target laporan moderasi.
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_hazard public.hazard_reports;
begin
  v_hazard := public.create_hazard(
    'pothole', 'moderate', -6.3, 106.9, 'Target uji rate limit', null, null
  );

  insert into public.uji_rate_limit_konteks (nama, id)
  values ('hazard', v_hazard.id);
end;
$$;

-- 8. Laporan moderasi: sepuluh lewat RPC diterima, kesebelas ditolak — baik
--    lewat RPC maupun INSERT REST langsung.
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-00000000000c","role":"authenticated"}';
do $$
declare
  v_target uuid := (select id from public.uji_rate_limit_konteks where nama = 'hazard');
  v_i int;
  v_state text := null;
  v_detail text := null;
begin
  for v_i in 1..10 loop
    perform public.report_content('hazard', v_target, 'spam', 'Uji rate limit ' || v_i::text);
  end loop;

  begin
    perform public.report_content('hazard', v_target, 'spam', 'ke-11 lewat RPC');
    raise exception 'UJI GAGAL: laporan RPC ke-11 dalam 10 menit tidak ditolak';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from 'P0001' or v_detail is distinct from 'report_rate_limit' then
    raise exception 'UJI GAGAL: rate limit laporan RPC tidak terdeteksi (state=%, detail=%)', v_state, v_detail;
  end if;

  v_state := null;
  v_detail := null;

  begin
    insert into public.content_reports (reporter_id, target_type, target_id, reason, details)
    values (auth.uid(), 'hazard', v_target, 'spam', 'ke-11 lewat REST');
    raise exception 'UJI GAGAL: INSERT REST ke-11 tidak ditolak';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from 'P0001' or v_detail is distinct from 'report_rate_limit' then
    raise exception 'UJI GAGAL: rate limit laporan jalur REST tidak terdeteksi (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 9. Batas laporan juga per pelapor: A11 yang belum melapor tetap bisa.
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-00000000000b","role":"authenticated"}';
do $$
declare
  v_target uuid := (select id from public.uji_rate_limit_konteks where nama = 'hazard');
begin
  perform public.report_content('hazard', v_target, 'spam', 'Satu laporan pengguna lain');

  if (
    select count(*) from public.content_reports r
     where r.reporter_id = auth.uid()
  ) <> 1 then
    raise exception 'UJI GAGAL: rate limit laporan milik A12 ikut menolak pengguna lain';
  end if;
end;
$$;

-- 10. Jumlah akhir: penolakan tidak menyimpan baris tambahan.
reset role;
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.follows f
   where f.follower_id = 'b7000000-0000-4000-8000-000000000001';

  if v_count <> 10 then
    raise exception 'UJI GAGAL: follow A tersimpan %, seharusnya 10', v_count;
  end if;

  select count(*) into v_count
    from public.content_reports r
   where r.reporter_id = 'b7000000-0000-4000-8000-00000000000c';

  if v_count <> 10 then
    raise exception 'UJI GAGAL: laporan A12 tersimpan %, seharusnya 10', v_count;
  end if;

  select count(*) into v_count
    from public.club_members cm
   where cm.user_id = 'b7000000-0000-4000-8000-000000000002'
     and cm.role = 'member';

  if v_count <> 5 then
    raise exception 'UJI GAGAL: permintaan klub A2 tersimpan %, seharusnya 5', v_count;
  end if;
end;
$$;

do $$
begin
  raise notice 'UJI RATE LIMIT DATABASE LULUS: follow 10/10 menit, laporan 10/10 menit (RPC dan REST), gabung klub 5/10 menit; batas per pengguna dan penolakan tidak menyimpan baris';
end;
$$;

rollback;
