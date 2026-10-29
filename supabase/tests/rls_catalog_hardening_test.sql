-- db:test notice: UJI KATALOG HARDENING LULUS
--
-- Pagar katalog "hardening" untuk gerbang beta Milestone 5.
--
-- Kenapa berkas ini ada
-- ---------------------------------------------------------------------------
-- `rls_catalog_test.sql` sudah memeriksa keadaan yang terlihat: RLS aktif pada
-- semua tabel, `search_path` definer terkunci, view memakai `security_invoker`,
-- dan tabel realtime terpublikasi. Berkas ini menambahkan tiga hal yang belum
-- dijaga di sana:
--
--   a. **Fungsi publik yang dapat dieksekusi `PUBLIC`/`anon`** — bukan hanya
--      `security definer`. Grant bawaan PostgreSQL untuk fungsi baru adalah
--      PUBLIC, jadi helper biasa pun bisa menjadi endpoint tanpa sesi. Enam
--      helper RLS sempat terbuka; grant `anon`-nya dicabut migration
--      `20261028031237_revoke_anon_rls_helper_execute.sql`. Pengecualian yang
--      tersisa ditulis beserta alasannya dan diperiksa anti-usang.
--   b. **Bucket Storage publik** — bucket publik melewati seluruh policy baca
--      karena objeknya dapat diunduh tanpa token. Ketiga bucket aplikasi harus
--      tetap privat.
--   c. **Data sensitif benar-benar tidak terbaca `anon`** — bukan hanya
--      "grant-nya dicabut", tetapi diuji dengan baris nyata: pemilik membaca
--      satu baris, `anon` membaca nol baris. Tanpa baris fixture, asersi nol
--      akan lulus secara palsu pada tabel kosong.
--
-- Setiap detektor diuji-diri lebih dulu dengan objek probe yang sengaja tidak
-- aman (tabel tanpa RLS, fungsi definer tanpa `search_path`, fungsi terbuka,
-- view tanpa `security_invoker`, bucket publik). Probe aman juga disertakan agar
-- detektor tidak sekadar "menuduh semuanya". Setelah uji-diri, seluruh probe
-- dihapus dan detektor dijalankan pada katalog sungguhan.
--
-- Seluruh berkas berjalan dalam satu transaksi dan diakhiri ROLLBACK; tidak ada
-- tabel/fungsi/view/bucket/pengguna uji yang tertinggal.
--
-- Cara menjalankan (project development, JANGAN produksi):
--   npm run db:test -- --file supabase/tests/rls_catalog_hardening_test.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Detektor katalog.
-- ---------------------------------------------------------------------------
create function pg_temp.uji_tabel_tanpa_rls()
returns table (tabel text)
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
  order by 1
$$;

create function pg_temp.uji_definer_tanpa_search_path()
returns table (signature text)
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
      where cfg ~ '^search_path=("")?$'
    )
  order by 1
$$;

create function pg_temp.uji_fungsi_terbuka()
returns table (signature text)
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      p.proacl is null
      or exists (
        select 1
        from aclexplode(p.proacl) a
        where a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee = 'anon'::regrole)
      )
    )
  order by 1
$$;

create function pg_temp.uji_view_tanpa_invoker()
returns table (view_name text)
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and not coalesce('security_invoker=true' = any(c.reloptions), false)
  order by 1
$$;

create function pg_temp.uji_bucket_publik()
returns table (bucket text)
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select b.id::text
  from storage.buckets b
  where b.public
  order by 1
$$;

-- ---------------------------------------------------------------------------
-- 2. Uji-diri: objek probe yang sengaja tidak aman dan yang aman.
-- ---------------------------------------------------------------------------
create table public.uji_hardening_probe_tanpa_rls (id int);

create table public.uji_hardening_probe_rls (id int);
alter table public.uji_hardening_probe_rls enable row level security;

create function public.uji_hardening_probe_definer()
returns int
language sql
security definer
set search_path = public
as $$ select 1 $$;

create function public.uji_hardening_probe_aman()
returns int
language sql
security definer
set search_path = ''
as $$ select 1 $$;
revoke all on function public.uji_hardening_probe_aman() from public, anon, authenticated;

create view public.uji_hardening_probe_view as select 1 as x;

create view public.uji_hardening_probe_view_aman with (security_invoker = true) as select 1 as x;

insert into storage.buckets (id, name, public)
values
  ('uji-hardening-probe-publik', 'uji-hardening-probe-publik', true),
  ('uji-hardening-probe-privat', 'uji-hardening-probe-privat', false);

do $$
declare
  v_nama text;
begin
  if not exists (
    select 1 from pg_temp.uji_tabel_tanpa_rls() t
    where t.tabel = 'uji_hardening_probe_tanpa_rls'
  ) then
    raise exception
      'UJI GAGAL (uji-diri RLS): tabel probe tanpa RLS tidak terdeteksi — detektor buta.';
  end if;

  if exists (
    select 1 from pg_temp.uji_tabel_tanpa_rls() t
    where t.tabel = 'uji_hardening_probe_rls'
  ) then
    raise exception
      'UJI GAGAL (uji-diri RLS): tabel probe yang RLS-nya aktif ikut tertuduh — detektor terlalu longgar.';
  end if;

  if not exists (
    select 1 from pg_temp.uji_definer_tanpa_search_path() d
    where d.signature = 'public.uji_hardening_probe_definer()'
  ) then
    raise exception
      'UJI GAGAL (uji-diri search_path): fungsi definer dengan search_path=public tidak terdeteksi.';
  end if;

  if exists (
    select 1 from pg_temp.uji_definer_tanpa_search_path() d
    where d.signature = 'public.uji_hardening_probe_aman()'
  ) then
    raise exception
      'UJI GAGAL (uji-diri search_path): fungsi definer dengan search_path='''' ikut tertuduh.';
  end if;

  if not exists (
    select 1 from pg_temp.uji_fungsi_terbuka() f
    where f.signature = 'public.uji_hardening_probe_definer()'
  ) then
    raise exception
      'UJI GAGAL (uji-diri grant): fungsi probe dengan grant PUBLIC tidak terdeteksi.';
  end if;

  if exists (
    select 1 from pg_temp.uji_fungsi_terbuka() f
    where f.signature = 'public.uji_hardening_probe_aman()'
  ) then
    raise exception
      'UJI GAGAL (uji-diri grant): fungsi probe yang grant-nya dicabut ikut tertuduh.';
  end if;

  if not exists (
    select 1 from pg_temp.uji_view_tanpa_invoker() v
    where v.view_name = 'uji_hardening_probe_view'
  ) then
    raise exception
      'UJI GAGAL (uji-diri view): view probe tanpa security_invoker tidak terdeteksi.';
  end if;

  if exists (
    select 1 from pg_temp.uji_view_tanpa_invoker() v
    where v.view_name = 'uji_hardening_probe_view_aman'
  ) then
    raise exception
      'UJI GAGAL (uji-diri view): view probe dengan security_invoker ikut tertuduh.';
  end if;

  select string_agg(b.bucket, ', ' order by b.bucket)
  into v_nama
  from pg_temp.uji_bucket_publik() b
  where b.bucket like 'uji-hardening-probe-%';

  if v_nama is distinct from 'uji-hardening-probe-publik' then
    raise exception
      'UJI GAGAL (uji-diri bucket): bucket publik probe tidak terdeteksi tepat satu (hasil: %).',
      coalesce(v_nama, 'tidak ada');
  end if;

  raise notice 'UJI: detektor RLS, search_path, grant, view, dan bucket menangkap probe tidak aman dan mengabaikan probe aman';
end;
$$;

-- Probe tidak boleh ikut dinilai pada katalog sungguhan.
drop view public.uji_hardening_probe_view_aman;
drop view public.uji_hardening_probe_view;
drop function public.uji_hardening_probe_aman();
drop function public.uji_hardening_probe_definer();
drop table public.uji_hardening_probe_rls;
drop table public.uji_hardening_probe_tanpa_rls;
-- Bucket tidak boleh di-DELETE langsung dari `storage.buckets` (Supabase
-- memblokirnya dengan `storage.protect_delete()`; objek harus lewat Storage
-- API). Cukup jadikan probe publik kembali privat; seluruh baris probe hilang
-- saat transaksi ini ROLLBACK.
update storage.buckets
set public = false
where id = 'uji-hardening-probe-publik';

-- ---------------------------------------------------------------------------
-- 3. Pengecualian grant `anon`/PUBLIC, lengkap dengan alasannya.
-- ---------------------------------------------------------------------------
-- Sejak migration 20261028031237 enam helper RLS (`can_publish_ride_location`,
-- `is_club_admin`, `is_club_member`, `is_ride_active_member`, `is_ride_host`,
-- `is_ride_member`) tidak lagi membuka EXECUTE untuk `anon`; mereka sengaja
-- tidak terdaftar di sini. Asersi dua sisi anon/authenticated ada di bagian 4.
create temporary table uji_hardening_izin_anon (
  signature text primary key,
  alasan text not null check (char_length(alasan) > 40)
);

insert into uji_hardening_izin_anon (signature, alasan) values
  (
    'public.touch_updated_at()',
    'Fungsi trigger yang hanya mengisi NEW.updated_at. Tidak dapat dipanggil langsung di luar konteks trigger; grant PUBLIC adalah bawaan PostgreSQL, bukan jalur data.'
  );

-- ---------------------------------------------------------------------------
-- 4. Asersi katalog sungguhan.
-- ---------------------------------------------------------------------------
do $$
declare
  v_daftar text;
begin
  select string_agg(t.tabel, ', ' order by t.tabel)
  into v_daftar
  from pg_temp.uji_tabel_tanpa_rls() t;

  if v_daftar is not null then
    raise exception
      'UJI GAGAL (RLS tidak aktif): tabel public tanpa RLS — %. Aktifkan RLS lewat migration baru; UI bukan batas keamanan.',
      v_daftar;
  end if;

  select string_agg(d.signature, ', ' order by d.signature)
  into v_daftar
  from pg_temp.uji_definer_tanpa_search_path() d;

  if v_daftar is not null then
    raise exception
      'UJI GAGAL (search_path definer): % tidak memakai search_path = ''''. Kunci lewat migration baru.',
      v_daftar;
  end if;

  raise notice 'UJI: seluruh tabel public ber-RLS dan seluruh security definer mengunci search_path';
end;
$$;

do $$
declare
  v_terlarang text;
  v_usang text;
  v_sig text;
begin
  select string_agg(f.signature, ', ' order by f.signature)
  into v_terlarang
  from pg_temp.uji_fungsi_terbuka() f
  where not exists (
    select 1 from uji_hardening_izin_anon i where i.signature = f.signature
  );

  if v_terlarang is not null then
    raise exception
      'UJI GAGAL (fungsi terbuka): % dapat dieksekusi PUBLIC/anon. Cabut EXECUTE dari public/anon lewat migration baru, atau daftarkan pengecualian beralasan di supabase/tests/rls_catalog_hardening_test.sql.',
      v_terlarang;
  end if;

  -- Anti-usang: setiap pengecualian harus benar-benar masih terbuka. Kalau
  -- grant dicabut kelak, entri lama harus dihapus, bukan dibiarkan menua.
  for v_sig in
    select signature from uji_hardening_izin_anon order by signature
  loop
    if not exists (
      select 1 from pg_temp.uji_fungsi_terbuka() f where f.signature = v_sig
    ) then
      v_usang := concat_ws(', ', v_usang, v_sig);
    end if;
  end loop;

  if v_usang is not null then
    raise exception
      'UJI GAGAL (pengecualian usang): % tidak lagi terbuka untuk PUBLIC/anon. Hapus entri itu dari daftar di supabase/tests/rls_catalog_hardening_test.sql.',
      v_usang;
  end if;

  raise notice 'UJI: tidak ada fungsi public yang terbuka ke PUBLIC/anon di luar pengecualian beralasan';
end;
$$;

-- Asersi dua sisi atas migration 20261028031237: mencabut grant `anon` tidak
-- boleh mengubah akses `authenticated`, karena policy RLS (termasuk policy
-- Storage logo klub) memanggil keenam helper itu saat pengguna login membaca
-- baris. Kedua arah wajib lulus — menutup anon tanpa menjaga login akan
-- merusak keanggotaan klub/perjalanan di produksi.
do $$
declare
  v_sig text;
  v_helper text[] := array[
    'public.can_publish_ride_location(uuid)',
    'public.is_club_admin(uuid)',
    'public.is_club_member(uuid)',
    'public.is_ride_active_member(uuid)',
    'public.is_ride_host(uuid)',
    'public.is_ride_member(uuid)'
  ];
begin
  foreach v_sig in array v_helper loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception
        'UJI GAGAL (helper masih terbuka): anon masih boleh EXECUTE %.',
        v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception
        'UJI GAGAL (akses login hilang): authenticated kehilangan EXECUTE %; policy RLS yang memanggilnya akan gagal. Kembalikan grant lewat migration baru.',
        v_sig;
    end if;
  end loop;

  raise notice 'UJI: enam helper RLS tertutup untuk anon dan tetap terbuka untuk authenticated';
end;
$$;

do $$
declare
  v_view text;
  v_bucket text;
begin
  select string_agg(v.view_name, ', ' order by v.view_name)
  into v_view
  from pg_temp.uji_view_tanpa_invoker() v;

  if v_view is not null then
    raise exception
      'UJI GAGAL (view melewati RLS): view public tanpa security_invoker — %. Perbaiki lewat migration baru; jangan memberi akses langsung ke tabel dasarnya sebagai kompensasi.',
      v_view;
  end if;

  select string_agg(b.bucket, ', ' order by b.bucket)
  into v_bucket
  from pg_temp.uji_bucket_publik() b;

  if v_bucket is not null then
    raise exception
      'UJI GAGAL (bucket publik): bucket Storage berikut dapat diunduh tanpa token — %. Jadikan privat dan akses lewat signed URL/policy.',
      v_bucket;
  end if;

  raise notice 'UJI: tidak ada view tanpa security_invoker dan tidak ada bucket Storage publik';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Data sensitif: pemilik melihat satu baris, `anon` melihat nol baris.
--    Fixture dibuat di dalam transaksi dan tidak pernah di-commit.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'aaaaaaaa-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'uji.katalog.hardening@contoh.test', now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"uji_katalog_hardening","display_name":"Uji Katalog Hardening"}',
  now(), now()
);

insert into public.motorcycles (id, owner_id, make, model)
values (
  'bbbbbbbb-1111-4111-8111-111111111111',
  'aaaaaaaa-1111-4111-8111-111111111111',
  'Honda', 'Uji'
);

insert into public.motorcycle_private_details (motorcycle_id, owner_id, plate_number, private_notes)
values (
  'bbbbbbbb-1111-4111-8111-111111111111',
  'aaaaaaaa-1111-4111-8111-111111111111',
  'B 9999 UJI',
  'catatan privat untuk uji katalog'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  v_baris int;
begin
  select count(*) into v_baris
  from public.motorcycle_private_details
  where owner_id = 'aaaaaaaa-1111-4111-8111-111111111111';

  if v_baris <> 1 then
    raise exception
      'UJI GAGAL (kontrol positif): pemilik membaca % baris detail privat (harus 1). Tanpa kontrol ini, asersi anon nol bisa lulus pada tabel kosong.',
      v_baris;
  end if;
end;
$$;

reset role;
set local role anon;
set local request.jwt.claims = '{}';

do $$
declare
  v_baris int;
  v_peran text;
begin
  select current_user into v_peran;
  if v_peran <> 'anon' then
    raise exception
      'UJI GAGAL (peran anon): sesi uji berjalan sebagai %, bukan anon. Asersi baca di bawah tidak membuktikan apa pun.',
      v_peran;
  end if;

  select count(*) into v_baris
  from public.motorcycle_private_details;

  if v_baris <> 0 then
    raise exception
      'UJI GAGAL (data sensitif): anon membaca % baris public.motorcycle_private_details. Nomor polisi/catatan privat tidak boleh terbaca tanpa sesi.',
      v_baris;
  end if;
end;
$$;

reset role;

do $$
begin
  raise notice 'UJI KATALOG HARDENING LULUS: semua tabel public ber-RLS, definer mengunci search_path, fungsi terbuka hanya yang terdaftar beralasan, view memakai security_invoker, tidak ada bucket publik, dan anon membaca nol baris detail privat.';
end;
$$;

rollback;
