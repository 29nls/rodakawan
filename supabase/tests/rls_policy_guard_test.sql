-- db:test notice: UJI POLICY OWNER-GUARD LULUS
--
-- Pagar otomatis: policy RLS pada tabel "wadah" tidak boleh memberi akses lewat
-- kolom kepemilikan saja, tanpa penjaga keanggotaan.
--
-- Kenapa ada
-- ---------------------------------------------------------------------------
-- Insiden nyata yang memicu pagar ini: policy `rides_select_allowed` sempat
-- memuat klausa `created_by = auth.uid()` yang berdiri sendiri, sehingga pembuat
-- perjalanan klub **tetap membaca** perjalanannya setelah keluar/dikeluarkan dari
-- klub (audit policy 17 Oktober 2026; ditutup oleh migration
-- `20261017090000_ride_access_requires_club_membership.sql`). Kesalahan seperti
-- itu tidak terlihat oleh typecheck, lint, maupun uji aplikasi: hanya katalog
-- database yang tahu bentuk policy. Karena itu pemeriksaannya dijalankan di sini,
-- pada CI `database-rls`, setiap kali berkas `supabase/**` berubah.
--
-- Aturan yang dipakai
-- ---------------------------------------------------------------------------
-- 1. Hanya policy pada tabel **wadah** yang diperiksa, yaitu tabel `public` yang
--    punya kolom `club_id` atau `ride_id` (lihat `tabel_wadah`). Baris di tabel
--    seperti itu dimiliki bersama anggota wadah, jadi kepemilikan baris
--    (`created_by`, `author_id`, `owner_id`, `user_id`, `sender_id`,
--    `reporter_id`, `blocker_id`, `recipient_id`, `follower_id`, `followed_id`)
--    **tidak** cukup sebagai dasar akses: keanggotaan aktif yang harus memutuskan.
--    Menambah kolom wadah lain cukup menambah namanya di satu tempat itu.
-- 2. Tabel yang memang milik pribadi (`motorcycles`, `motorcycle_private_details`,
--    `push_tokens`, `notifications`, `user_blocks`, `profiles`, `follows`, dan
--    bucket Storage) sengaja tidak masuk daftar wadah: di sana barisnya memang
--    hanya milik sendiri, dan lalu lintasnya diuji di `rls_profiles_test.sql`.
-- 3. Sebuah policy lolos bila ekspresinya (USING dan WITH CHECK digabung) memuat
--    penjaga keanggotaan: `is_club_member`, `is_club_admin`, `is_ride_member`,
--    `is_ride_active_member`, `is_ride_host`, `can_publish_ride_location`, atau
--    subquery ke `club_members`/`ride_members`. Menggabungkan USING + WITH CHECK
--    disengaja: policy UPDATE yang `USING`-nya longgar tetapi `WITH CHECK`-nya
--    berpenjaga tidak bisa menghasilkan baris yang melanggar penjaga itu.
-- 4. Pengecualian harus **tertulis** beserta alasannya di
--    `uji_guard_pengecualian` — dan daftar itu ikut diperiksa: entri yang sudah
--    tidak diperlukan lagi (policy kembali berpenjaga, hilang, atau berganti
--    bentuk) menggagalkan uji supaya daftar tidak membusuk. Yang boleh masuk ke
--    sini hanya akses atas baris **milik sendiri** yang tidak membuka data
--    pengguna lain — bukan alasan "sudah lama begitu".
-- 5. Detektornya sendiri diuji di sini: tabel probe dengan satu policy tanpa
--    penjaga (harus tertangkap) dan satu dengan penjaga (tidak boleh tertangkap).
--    Tanpa uji-diri itu, "nol temuan" bisa berarti "detektornya buta".
--
-- Seluruh berkas berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi tidak
-- ada tabel, policy, atau baris uji yang tertinggal di database.

begin;

-- 1a. Semua policy pada tabel wadah, beserta ekspresinya apa adanya.
create function public.uji_policy_wadah()
returns table (tabel text, policy text, perintah text, ekspresi text)
language sql
stable
set search_path = pg_catalog
as $$
  with tabel_wadah as (
    select c.relname as nama_tabel
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attnum > 0
      and not a.attisdropped
      and a.attname = any (array['club_id', 'ride_id'])
    group by c.relname
  )
  select
    p.tablename::text,
    p.policyname::text,
    p.cmd::text,
    btrim(
      regexp_replace(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), '\s+', ' ', 'g')
    )
  from pg_policies p
  join tabel_wadah w on w.nama_tabel = p.tablename
  where p.schemaname = 'public'
  order by p.tablename, p.policyname;
$$;

comment on function public.uji_policy_wadah() is
  'UJI (transaksi sementara): seluruh policy pada tabel wadah beserta ekspresi USING/WITH CHECK-nya.';

-- 1b. Detektor: yang memakai kolom kepemilikan tanpa penjaga keanggotaan.
create function public.uji_temuan_owner_tanpa_guard()
returns table (tabel text, policy text, perintah text, ekspresi text)
language sql
stable
set search_path = pg_catalog
as $$
  select w.tabel, w.policy, w.perintah, w.ekspresi
  from public.uji_policy_wadah() w
  where (
      w.ekspresi ~* '(created_by|author_id|owner_id|user_id|sender_id|reporter_id|blocker_id|recipient_id|follower_id|followed_id)\s*=\s*\(?auth\.uid\(\)'
      or w.ekspresi ~* 'auth\.uid\(\)\s*=\s*\(?(created_by|author_id|owner_id|user_id|sender_id|reporter_id|blocker_id|recipient_id|follower_id|followed_id)'
    )
    and w.ekspresi !~* '(is_club_member|is_club_admin|is_ride_member|is_ride_active_member|is_ride_host|can_publish_ride_location|from\s+club_members|from\s+ride_members)';
$$;

comment on function public.uji_temuan_owner_tanpa_guard() is
  'UJI (transaksi sementara): policy wadah yang memberi akses lewat kolom kepemilikan tanpa penjaga keanggotaan.';

-- 2. Pengecualian yang disetujui, lengkap dengan alasannya.
create table public.uji_guard_pengecualian (
  tabel text not null,
  policy text not null,
  alasan text not null,
  primary key (tabel, policy)
);

-- Dua pengecualian wajib Milestone 4 (ADR-066) tinggal dua: jalur tulis
-- `chat_messages` (policy `chat_insert_self_member`/`chat_update_own_text`/
-- `chat_delete_own`) dan `hazard_reports` (`hazards_insert_self`) sudah dicabut
-- dan diganti RPC `security definer`, sehingga keduanya tidak lagi punya policy
-- tulis tanpa penjaga keanggotaan.
insert into public.uji_guard_pengecualian (tabel, policy, alasan) values
  (
    'ride_locations',
    'ride_locations_delete_self',
    'DELETE baris lokasi milik sendiri. Setelah keluar dari perjalanan, pengguna justru harus tetap dapat membersihkan riwayat lokasinya; tidak ada baris pengguna lain yang dijangkau policy ini.'
  ),
  (
    'hazard_reports',
    'hazards_select_current_or_reporter',
    'SELECT laporan hazard aktif — data keselamatan jalan yang memang harus terbaca pengguna terautentikasi mana pun, terlepas dari keanggotaan perjalanan/klub. Cabang `reporter_id = auth.uid()` hanya menambahkan laporan milik sendiri yang sudah tidak aktif (mis. kedaluwarsa) supaya pelapor tetap bisa melihat dan mengoreksinya.'
  );

-- 3. Uji-diri detektor: probe negatif (harus tertangkap) dan positif (tidak boleh).
create table public.uji_guard_probe (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  club_id uuid
);

alter table public.uji_guard_probe enable row level security;

create policy uji_probe_tanpa_guard on public.uji_guard_probe
  for select to authenticated
  using (author_id = auth.uid());

create policy uji_probe_dengan_guard on public.uji_guard_probe
  for select to authenticated
  using (author_id = auth.uid() and public.is_club_member(club_id));

do $$
declare
  v_jumlah int;
  v_nama text;
begin
  if not exists (
    select 1
    from public.uji_policy_wadah()
    where tabel = 'uji_guard_probe'
  ) then
    raise exception
      'UJI GAGAL (uji-diri detektor): tabel probe tidak terdeteksi sebagai tabel wadah, jadi detektor tidak pernah memeriksanya.';
  end if;

  select count(*), min(policy) into v_jumlah, v_nama
  from public.uji_temuan_owner_tanpa_guard()
  where tabel = 'uji_guard_probe';

  if v_jumlah <> 1 or v_nama is distinct from 'uji_probe_tanpa_guard' then
    raise exception
      'UJI GAGAL (uji-diri detektor): policy probe tanpa penjaga seharusnya tepat satu temuan "uji_probe_tanpa_guard", dapat % temuan (%). Detektor buta atau terlalu longgar.',
      v_jumlah, coalesce(v_nama, 'tidak ada');
  end if;

  raise notice 'UJI: detektor menangkap policy probe tanpa penjaga dan mengabaikan probe yang berpenjaga';
end;
$$;

-- 4. Asersi pada katalog sungguhan: tidak ada temuan di luar daftar pengecualian.
do $$
declare
  v_temuan record;
  v_alasan text;
  v_terlarang int := 0;
  v_diperiksa int;
  v_dikecualikan int;
  v_daftar text := '';
begin
  select count(*) into v_diperiksa
  from public.uji_policy_wadah()
  where tabel not like 'uji\_%';

  select count(*) into v_dikecualikan from public.uji_guard_pengecualian;

  for v_temuan in
    select * from public.uji_temuan_owner_tanpa_guard()
    where tabel not like 'uji\_%'
  loop
    select alasan into v_alasan
    from public.uji_guard_pengecualian e
    where e.tabel = v_temuan.tabel and e.policy = v_temuan.policy;

    if v_alasan is null then
      v_terlarang := v_terlarang + 1;
      v_daftar := v_daftar || format(
        '%s.%s [%s] {%s}; ',
        v_temuan.tabel,
        v_temuan.policy,
        v_temuan.perintah,
        v_temuan.ekspresi
      );
    end if;
  end loop;

  if v_terlarang > 0 then
    raise exception
      'UJI GAGAL (policy owner tanpa guard): % policy memberi akses lewat kolom kepemilikan pada tabel wadah tanpa penjaga keanggotaan — %. Tambahkan penjaga keanggotaan (is_club_member/is_club_admin/is_ride_member/…) atau, bila memang hanya baris sendiri yang terbuka, daftarkan sebagai pengecualian beserta alasannya di supabase/tests/rls_policy_guard_test.sql.',
      v_terlarang, v_daftar;
  end if;

  raise notice 'UJI: % policy wadah diperiksa, % temuan kepemilikan tanpa penjaga — semuanya sudah terdaftar sebagai pengecualian beralasan',
    v_diperiksa, v_dikecualikan;
end;
$$;

-- 5. Daftar pengecualian tidak boleh membusuk.
do $$
declare
  e record;
  v_masih_perlu int;
begin
  for e in select * from public.uji_guard_pengecualian order by tabel, policy loop
    select count(*) into v_masih_perlu
    from public.uji_temuan_owner_tanpa_guard() t
    where t.tabel = e.tabel and t.policy = e.policy;

    if v_masih_perlu <> 1 then
      raise exception
        'UJI GAGAL (pengecualian usang): % . % tidak lagi persis seperti saat dikecualikan (policy hilang, sudah berpenjaga, atau berubah bentuk). Hapus entri itu dari daftar pengecualian di supabase/tests/rls_policy_guard_test.sql.',
        e.tabel, e.policy;
    end if;
  end loop;

  raise notice 'UJI: seluruh entri pengecualian masih diperlukan dan masih berbentuk sama';
end;
$$;

-- 6. Penjaga keanggotaan pada daftar token harus benar-benar dipakai policy,
--    supaya daftar itu tidak menua tanpa ketahuan (mis. fungsi berganti nama).
do $$
declare
  v_token text;
  v_hilang text[] := array[]::text[];
begin
  foreach v_token in array array[
    'is_club_member',
    'is_club_admin',
    'is_ride_member',
    'is_ride_active_member',
    'is_ride_host'
  ]
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~* v_token
    ) then
      v_hilang := v_hilang || v_token;
    end if;
  end loop;

  if array_length(v_hilang, 1) is not null then
    raise exception
      'UJI GAGAL (daftar penjaga usang): penjaga berikut tidak dipakai policy mana pun — %. Perbarui daftar token di supabase/tests/rls_policy_guard_test.sql agar tidak ada policy yang lolos diam-diam.',
      array_to_string(v_hilang, ', ');
  end if;

  raise notice 'UJI: seluruh penjaga keanggotaan pada daftar token masih dipakai policy';
end;
$$;

do $$
begin
  raise notice 'UJI POLICY OWNER-GUARD LULUS: policy wadah tidak memberi akses lewat kolom kepemilikan tanpa penjaga keanggotaan (detektor diuji-diri, pengecualian diperiksa anti-usang).';
end;
$$;

rollback;
