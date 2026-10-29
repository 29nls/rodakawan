-- db:test notice: UJI KATALOG RLS LULUS
--
-- Pagar katalog untuk checklist keamanan Milestone 5: membuktikan keadaan
-- database yang tidak terlihat oleh uji aplikasi maupun policy per tabel.
--
-- Yang diperiksa
-- ---------------------------------------------------------------------------
-- a. Setiap tabel (dan tabel partisi) di schema `public` mengaktifkan RLS.
--    Tabel tanpa RLS tidak dilindungi policy apa pun; bila tabel itu terekspos
--    lewat Data API, seluruh barisnya terbaca.
-- b. Tidak ada fungsi `security definer` di `public` yang bisa dieksekusi
--    `PUBLIC`/`anon` kecuali daftar pengecualian tertulis di berkas ini,
--    lengkap dengan alasannya. Grant bawaan PostgreSQL untuk fungsi baru
--    adalah `PUBLIC`, jadi fungsi definer tanpa `revoke` adalah endpoint publik
--    meskipun tidak pernah dipanggil klien.
-- c. Setiap `security definer` memakai `search_path` kosong. Kunci ini
--    diterapkan lewat migration `20261024003227_m5_catalog_hardening.sql`
--    (sudah dijalankan ke development); uji ini gagal bila ada fungsi definer
--    baru yang tidak mengunci `search_path`, supaya aturan itu tidak melunak
--    diam-diam.
-- d. Setiap view di `public` memakai `security_invoker = true` supaya RLS
--    tabel dasarnya tetap berlaku (view tanpa opsi itu berjalan sebagai
--    pemilik view dan melewati RLS).
-- e. `chat_messages` dan `ride_locations` ada di publikasi
--    `supabase_realtime` dan RLS-nya aktif — Realtime Postgres Changes tetap
--    tunduk pada RLS, tetapi tabel yang tidak dipublikasikan tidak akan
--    mengirim perubahan sama sekali.
--
-- Detektor diuji-diri (tabel, fungsi, dan view probe yang sengaja tidak aman)
-- sebelum dipakai, supaya "nol temuan" tidak berarti "detektornya buta".
-- Seluruh berkas berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi
-- tabel/fungsi/view probe dan perubahan grant tidak tertinggal.

begin;

-- ---------------------------------------------------------------------------
-- a. RLS pada semua tabel public + uji-diri detektor.
-- ---------------------------------------------------------------------------
create table public.uji_katalog_probe (id int);

do $$
declare
  v_tanpa text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
  into v_tanpa
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;

  if v_tanpa is null or position('uji_katalog_probe' in v_tanpa) = 0 then
    raise exception
      'UJI GAGAL (detektor RLS buta): tabel probe tanpa RLS tidak terdeteksi. Periksa query pg_class di supabase/tests/rls_catalog_test.sql.';
  end if;

  if v_tanpa <> 'uji_katalog_probe' then
    raise exception
      'UJI GAGAL (RLS tidak aktif): tabel public tanpa RLS — %. Aktifkan RLS lewat migration baru sebelum tabel itu diekspos.',
      v_tanpa;
  end if;
end;
$$;

drop table public.uji_katalog_probe;

do $$
declare
  v_tanpa text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
  into v_tanpa
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;

  if v_tanpa is not null then
    raise exception
      'UJI GAGAL (RLS tidak aktif): tabel public tanpa RLS — %. Aktifkan RLS lewat migration baru, bukan dengan melonggarkan policy.',
      v_tanpa;
  end if;

  raise notice 'UJI: seluruh tabel public mengaktifkan RLS';
end;
$$;

-- ---------------------------------------------------------------------------
-- b. Fungsi security definer yang terbuka untuk PUBLIC/anon.
-- ---------------------------------------------------------------------------
create function pg_temp.uji_definer_terbuka()
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
    and (
      p.proacl is null
      or exists (
        select 1
        from aclexplode(p.proacl) a
        where a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee = 'anon'::regrole)
      )
    )
$$;

-- c. Fungsi security definer tanpa search_path kosong.
create function pg_temp.uji_definer_search_path()
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
$$;

-- d. View public tanpa security_invoker.
create function pg_temp.uji_view_tanpa_invoker()
returns table (view_name text)
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and not coalesce('security_invoker=true' = any(c.reloptions), false)
$$;

-- Probe: satu fungsi definer dengan grant bawaan PUBLIC dan search_path
-- 'public', serta satu view tanpa security_invoker. Ketiganya harus tertangkap.
create function public.uji_katalog_probe_definer()
returns int
language sql
security definer
set search_path = public
as $$ select 1 $$;

create view public.uji_katalog_probe_view as select 1 as x;

do $$
begin
  if not exists (
    select 1 from pg_temp.uji_definer_terbuka()
    where signature = 'public.uji_katalog_probe_definer()'
  ) then
    raise exception
      'UJI GAGAL (detektor definer buta): fungsi probe dengan grant PUBLIC tidak terdeteksi.';
  end if;

  if not exists (
    select 1 from pg_temp.uji_definer_search_path()
    where signature = 'public.uji_katalog_probe_definer()'
  ) then
    raise exception
      'UJI GAGAL (detektor search_path buta): fungsi probe dengan search_path=public tidak terdeteksi.';
  end if;

  if not exists (
    select 1 from pg_temp.uji_view_tanpa_invoker()
    where view_name = 'uji_katalog_probe_view'
  ) then
    raise exception
      'UJI GAGAL (detektor view buta): view probe tanpa security_invoker tidak terdeteksi.';
  end if;

  raise notice 'UJI: detektor definer, search_path, dan view menangkap probe yang sengaja tidak aman';
end;
$$;

drop function public.uji_katalog_probe_definer();
drop view public.uji_katalog_probe_view;

do $$
declare
  v_terbuka text;
  v_sig text;
  -- Kosong sejak migration 20261028031237: enam helper RLS terakhir yang
  -- masih membuka EXECUTE untuk `anon` telah dicabut, dan asersi dua sisi
  -- (anon ditolak, authenticated tetap diizinkan) ditambahkan di
  -- supabase/tests/rls_catalog_hardening_test.sql. Jangan menambah entri baru
  -- di sini tanpa migration yang mencabutnya kembali.
  v_izin_anon text[] := array[]::text[];
  v_allowed text[] := v_izin_anon;
begin
  select string_agg(signature, ', ' order by signature)
  into v_terbuka
  from pg_temp.uji_definer_terbuka() o
  where not (o.signature = any(v_allowed));

  if v_terbuka is not null then
    raise exception
      'UJI GAGAL (fungsi definer terbuka): % dapat dieksekusi PUBLIC/anon. Cabut EXECUTE lewat migration baru, atau tambahkan pengecualian beralasan di supabase/tests/rls_catalog_test.sql.',
      v_terbuka;
  end if;

  -- Anti-usang: setiap entri pengecualian harus benar-benar masih terbuka.
  -- Fungsi trigger (`bootstrap_profile`, `clear_ride_location_on_opt_out`,
  -- `clear_ride_locations_on_finish`) sudah dicabut `EXECUTE`-nya oleh
  -- migration 20261024003227, dan enam helper RLS (`can_publish_ride_location`,
  -- `is_club_admin`, `is_club_member`, `is_ride_active_member`, `is_ride_host`,
  -- `is_ride_member`) oleh migration 20261028031237 — tidak ada satupun yang
  -- boleh ada di daftar ini lagi.
  foreach v_sig in array v_allowed loop
    if not exists (
      select 1 from pg_temp.uji_definer_terbuka() o
      where o.signature = v_sig
    ) then
      raise exception
        'UJI GAGAL (daftar pengecualian usang): % tidak lagi terbuka untuk PUBLIC/anon. Hapus entri itu dari daftar di supabase/tests/rls_catalog_test.sql.',
        v_sig;
    end if;
  end loop;

  raise notice 'UJI: tidak ada fungsi definer yang terbuka ke PUBLIC/anon di luar pengecualian beralasan';
end;
$$;

-- ---------------------------------------------------------------------------
-- c. search_path kosong pada semua security definer.
-- ---------------------------------------------------------------------------
do $$
declare
  v_buruk text;
  v_sig text;
  v_tunggu text[] := array[]::text[];
begin
  select string_agg(signature, ', ' order by signature)
  into v_buruk
  from pg_temp.uji_definer_search_path() o
  where not (o.signature = any(v_tunggu));

  if v_buruk is not null then
    raise exception
      'UJI GAGAL (search_path definer): % tidak memakai search_path = ''''. Kunci lewat migration baru, jangan menghapus pemeriksaan ini.',
      v_buruk;
  end if;

  foreach v_sig in array v_tunggu loop
    if not exists (
      select 1 from pg_temp.uji_definer_search_path() o
      where o.signature = v_sig
    ) then
      raise exception
        'UJI GAGAL (daftar tunggu usang): % sudah memakai search_path kosong. Hapus entri itu dari daftar tunggu di supabase/tests/rls_catalog_test.sql.',
        v_sig;
    end if;
  end loop;

  raise notice 'UJI: seluruh security definer memakai search_path kosong';
end;
$$;

-- ---------------------------------------------------------------------------
-- d. View public memakai security_invoker.
-- ---------------------------------------------------------------------------
do $$
declare
  v_view text;
begin
  select string_agg(view_name, ', ' order by view_name)
  into v_view
  from pg_temp.uji_view_tanpa_invoker();

  if v_view is not null then
    raise exception
      'UJI GAGAL (view melewati RLS): view public berikut tidak memakai security_invoker = true — %. Perbaiki lewat migration baru; jangan memberi akses langsung ke tabel dasarnya sebagai kompensasi.',
      v_view;
  end if;

  raise notice 'UJI: seluruh view public memakai security_invoker';
end;
$$;

-- ---------------------------------------------------------------------------
-- e. Tabel realtime ada di publikasi dan RLS-nya aktif.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabel text;
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception
      'UJI GAGAL (realtime): publikasi supabase_realtime tidak ada. Buat publikasi itu sebelum mengandalkan Postgres Changes.';
  end if;

  foreach v_tabel in array array['chat_messages', 'ride_locations'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_tabel
    ) then
      raise exception
        'UJI GAGAL (realtime): tabel % tidak ada di publikasi supabase_realtime, sehingga klien tidak akan menerima perubahannya.',
        v_tabel;
    end if;

    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_tabel
        and c.relrowsecurity
    ) then
      raise exception
        'UJI GAGAL (realtime): tabel % ada di publikasi tetapi RLS-nya tidak aktif. Jangan menambah policy baca yang lebih longgar; aktifkan RLS-nya.',
        v_tabel;
    end if;
  end loop;

  raise notice 'UJI: chat_messages dan ride_locations dipublikasikan ke supabase_realtime dengan RLS aktif';
end;
$$;

do $$
begin
  raise notice 'UJI KATALOG RLS LULUS: semua tabel public ber-RLS, tidak ada definer yang terbuka ke PUBLIC/anon di luar pengecualian beralasan, search_path definer terkunci semua, view memakai security_invoker, dan tabel realtime terpublikasi dengan RLS aktif.';
end;
$$;

rollback;
