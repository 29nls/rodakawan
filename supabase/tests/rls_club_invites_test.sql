-- db:test notice: UJI UNDANGAN KLUB LULUS
--
-- ============================================================================
-- Uji RLS/RPC Fase 2 — undangan klub untuk mode tanpa akun.
--
-- Kenapa berkas ini ada
-- ---------------------------------------------------------------------------
-- Klub `join_policy = 'invite_only'` sebelumnya hanya bisa kehilangan anggota:
-- `request_club_membership` menolak permintaan bergabung dan tidak ada jalur
-- undangan sama sekali. Migration `20261106194500_club_invites.sql` menambahkan
-- tabel `public.club_invites` (hanya hash kode) dan empat RPC definer. Berkas ini
-- membuktikan batas yang dijaga jalur tersebut, bukan sekadar bentuk tabelnya.
--
-- Yang dibuktikan
-- ---------------------------------------------------------------------------
--   1. RPC undangan hanya dapat dieksekusi `authenticated`; `anon` tidak punya
--      grant tabel maupun fungsi, dan pemeriksaan itu diuji dengan hak akses
--      nyata (`has_function_privilege`/`has_table_privilege`).
--   2. `public.club_invites` tanpa policy: anggota biasa membaca nol baris,
--      termasuk anggota aktif — daftar hanya lewat RPC untuk admin.
--   3. Non-admin (bahkan anggota aktif) tidak bisa membuat atau mencabut
--      undangan; undangan berperan admin hanya bisa dibuat owner.
--   4. Kode sekali-pakai hanya berhasil sekali; pemakai kedua ditolak dengan
--      pesan yang sama seperti kode tidak dikenal (tanpa membocorkan sebabnya).
--   5. Kode yang dicabut dan kode yang kedaluwarsa ditolak dengan pesan yang
--      sama; kode sah mengaktifkan keanggotaan dan menulis jejak audit.
--   6. Kode tidak pernah tersimpan sebagai teks: yang tersimpan hash 64 heksa,
--      dan RPC daftar tidak mengembalikan kolom hash.
--   7. Batas argumen (peran, jumlah pemakaian, masa berlaku) ditolak sebagai
--      `invalid_data`, bukan diterima lalu dipotong diam-diam.
--
-- Seluruh berkas berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi tidak
-- ada pengguna/klub/undangan uji yang tertinggal.
--
-- Cara menjalankan (project development, JANGAN produksi):
--   npm run db:test -- --file supabase/tests/rls_club_invites_test.sql
-- ============================================================================

begin;

-- 0. Paritas: berhenti dengan pesan jelas bila migration belum diterapkan.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.club_invites') is null then
    v_missing := v_missing || 'tabel public.club_invites'::text;
  end if;

  if to_regprocedure('public.create_club_invite(uuid,text,integer,integer)') is null then
    v_missing := v_missing || 'fungsi public.create_club_invite'::text;
  end if;

  if to_regprocedure('public.revoke_club_invite(uuid)') is null then
    v_missing := v_missing || 'fungsi public.revoke_club_invite'::text;
  end if;

  if to_regprocedure('public.list_club_invites(uuid)') is null then
    v_missing := v_missing || 'fungsi public.list_club_invites'::text;
  end if;

  if to_regprocedure('public.redeem_club_invite(text)') is null then
    v_missing := v_missing || 'fungsi public.redeem_club_invite'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (migration Fase 2 belum diterapkan): objek berikut belum ada — %. Terapkan supabase/migrations/20261106194500_club_invites.sql lebih dulu.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Konteks uji. Tabel ini hanya hidup di dalam transaksi dan ikut ROLLBACK.
create table public.uji_f2_konteks (
  nama text primary key,
  club_id uuid,
  nilai text
);
grant select, insert, update, delete on public.uji_f2_konteks to authenticated;

-- 2. Enam akun: A owner, B anggota yang kemudian jadi admin, C/D/E/F orang asing.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'f2.a@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"f2_user_a","display_name":"F2 User A"}',
    now(), now()
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'f2.b@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"f2_user_b","display_name":"F2 User B"}',
    now(), now()
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'f2.c@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"f2_user_c","display_name":"F2 User C"}',
    now(), now()
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'f2.d@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"f2_user_d","display_name":"F2 User D"}',
    now(), now()
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'f2.e@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"f2_user_e","display_name":"F2 User E"}',
    now(), now()
  ),
  (
    '66666666-6666-6666-6666-666666666666',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'f2.f@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"f2_user_f","display_name":"F2 User F"}',
    now(), now()
  );

-- 3. A membuat klub privat dengan kebijakan invite_only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_club jsonb;
begin
  v_club := public.create_club(
    'Klub Undangan Uji',
    'klub-undangan-uji',
    'Klub untuk menguji jalur undangan.',
    'private',
    'invite_only'
  );

  if v_club ->> 'id' is null then
    raise exception 'UJI GAGAL (fixture): create_club tidak mengembalikan id klub.';
  end if;

  insert into public.uji_f2_konteks (nama, club_id)
  values ('club', (v_club ->> 'id')::uuid);
end;
$$;

-- 4. Bentuk katalog dan grant: bukan sekadar "tabelnya ada".
reset role;

do $$
declare
  v_policy int;
  v_rls boolean;
  v_leak text;
begin
  if has_function_privilege('anon', 'public.create_club_invite(uuid,text,integer,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.revoke_club_invite(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_club_invites(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.redeem_club_invite(text)', 'EXECUTE') then
    raise exception 'UJI GAGAL (anon): fungsi undangan klub dapat dieksekusi tanpa sesi.';
  end if;

  if has_table_privilege('anon', 'public.club_invites', 'SELECT')
     or has_table_privilege('anon', 'public.club_invites', 'INSERT') then
    raise exception 'UJI GAGAL (anon): anon masih punya grant pada public.club_invites.';
  end if;

  if not has_function_privilege('authenticated', 'public.redeem_club_invite(text)', 'EXECUTE') then
    raise exception 'UJI GAGAL: authenticated seharusnya boleh mengeksekusi redeem_club_invite.';
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c
  where c.oid = 'public.club_invites'::regclass;

  if v_rls is not true then
    raise exception 'UJI GAGAL: RLS tidak aktif pada public.club_invites.';
  end if;

  select count(*) into v_policy
  from pg_policies
  where schemaname = 'public' and tablename = 'club_invites';

  if v_policy <> 0 then
    raise exception 'UJI GAGAL: public.club_invites seharusnya tanpa policy (jalur tulis hanya RPC definer), ditemukan %.', v_policy;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_leak
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'club_invite_code_key',
      'club_invite_code_hash',
      'create_club_invite',
      'revoke_club_invite',
      'list_club_invites',
      'redeem_club_invite'
    )
    and not exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
      where cfg ~ '^search_path=("")?$'
    );

  if v_leak is not null then
    raise exception 'UJI GAGAL: fungsi undangan klub tidak mengunci search_path = '''' — %.', v_leak;
  end if;
end;
$$;

-- 5. A membuat undangan sekali-pakai. Kode hanya dikembalikan sekali.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_code text;
begin
  v_code := public.create_club_invite(
    (select club_id from public.uji_f2_konteks where nama = 'club'),
    'member',
    1,
    24
  );

  if v_code is null or v_code !~ '^RK[0-9A-F]{16}$' then
    raise exception 'UJI GAGAL: bentuk kode undangan tidak sesuai (%).', coalesce(v_code, 'null');
  end if;

  insert into public.uji_f2_konteks (nama, nilai) values ('kode1', v_code);
end;
$$;

-- 6. Orang asing tidak membaca tabel undangan, tidak bisa membuat undangan, lalu
--    berhasil memakai kode sah.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  select count(*) into v_rows from public.club_invites;

  if v_rows <> 0 then
    raise exception 'UJI GAGAL (RLS): non-admin membaca % baris undangan klub.', v_rows;
  end if;
end;
$$;

do $$
begin
  begin
    perform public.create_club_invite(
      (select club_id from public.uji_f2_konteks where nama = 'club'),
      'member',
      1,
      24
    );
    raise exception 'UJI GAGAL: orang asing berhasil membuat undangan klub.';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

do $$
declare
  v_hasil jsonb;
begin
  v_hasil := public.redeem_club_invite((select nilai from public.uji_f2_konteks where nama = 'kode1'));

  if v_hasil ->> 'status' is distinct from 'active' then
    raise exception 'UJI GAGAL: kode sah tidak mengaktifkan keanggotaan (%).', v_hasil::text;
  end if;

  if (v_hasil ->> 'already_member')::boolean is not false then
    raise exception 'UJI GAGAL: pemakaian pertama kode dilaporkan sebagai already_member.';
  end if;

  if not exists (
    select 1 from public.club_members cm
    where cm.club_id = (select club_id from public.uji_f2_konteks where nama = 'club')
      and cm.user_id = '33333333-3333-3333-3333-333333333333'
      and cm.status = 'active'
      and cm.role = 'member'
  ) then
    raise exception 'UJI GAGAL: keanggotaan aktif tidak terbentuk setelah kode dipakai.';
  end if;
end;
$$;

-- 7. Memakai kode yang sama lagi: jawaban jujur "sudah anggota", hitungan tidak
--    bertambah; orang lain ditolak karena kode sekali-pakai sudah habis.
do $$
declare
  v_hasil jsonb;
begin
  v_hasil := public.redeem_club_invite((select nilai from public.uji_f2_konteks where nama = 'kode1'));

  if (v_hasil ->> 'already_member')::boolean is not true then
    raise exception 'UJI GAGAL: pemakaian ulang oleh anggota aktif tidak dikenali.';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

do $$
declare
  v_hasil jsonb;
begin
  begin
    v_hasil := public.redeem_club_invite((select nilai from public.uji_f2_konteks where nama = 'kode1'));
    raise exception 'UJI GAGAL: kode sekali-pakai diterima dua kali (%).', coalesce(v_hasil::text, 'null');
  exception
    when sqlstate 'P0002' then
      null;
  end;
end;
$$;

reset role;

do $$
declare
  v_uses int;
begin
  select coalesce(sum(i.uses), 0) into v_uses
  from public.club_invites i
  where i.club_id = (select club_id from public.uji_f2_konteks where nama = 'club');

  if v_uses <> 1 then
    raise exception 'UJI GAGAL: hitungan pemakaian seharusnya 1 (kode kedua ditolak dan anggota aktif tidak menghabiskan kode), dapat %.', v_uses;
  end if;
end;
$$;

-- 8. Undangan dua pemakaian: B dan D masuk, lalu A mengangkat B menjadi admin.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  insert into public.uji_f2_konteks (nama, nilai)
  values (
    'kode2',
    public.create_club_invite(
      (select club_id from public.uji_f2_konteks where nama = 'club'),
      'member',
      2,
      24
    )
  );
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  perform public.redeem_club_invite((select nilai from public.uji_f2_konteks where nama = 'kode2'));
end;
$$;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

do $$
begin
  perform public.redeem_club_invite((select nilai from public.uji_f2_konteks where nama = 'kode2'));
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  perform public.set_club_member_role(
    (select club_id from public.uji_f2_konteks where nama = 'club'),
    '22222222-2222-2222-2222-222222222222',
    'admin'
  );
end;
$$;

-- 9. Admin boleh mengundang anggota, tetapi tidak boleh mengundang admin.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    perform public.create_club_invite(
      (select club_id from public.uji_f2_konteks where nama = 'club'),
      'admin',
      1,
      24
    );
    raise exception 'UJI GAGAL: admin klub berhasil membuat undangan berperan admin.';
  exception
    when insufficient_privilege then
      null;
  end;

  insert into public.uji_f2_konteks (nama, nilai)
  values (
    'kode3',
    public.create_club_invite(
      (select club_id from public.uji_f2_konteks where nama = 'club'),
      'member',
      1,
      24
    )
  );
end;
$$;

set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

do $$
begin
  perform public.redeem_club_invite((select nilai from public.uji_f2_konteks where nama = 'kode3'));
end;
$$;

-- 10. Kode yang dicabut dan kode yang kedaluwarsa ditolak dengan pesan yang sama.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_id uuid;
begin
  insert into public.uji_f2_konteks (nama, nilai)
  values (
    'kode4',
    public.create_club_invite(
      (select club_id from public.uji_f2_konteks where nama = 'club'),
      'member',
      1,
      24
    )
  );

  select i.id into v_id
  from public.club_invites i
  where i.code_hash = public.club_invite_code_hash(
    (select nilai from public.uji_f2_konteks where nama = 'kode4')
  );

  if v_id is null then
    raise exception 'UJI GAGAL: kode yang baru dibuat tidak tersimpan sebagai hash.';
  end if;

  perform public.revoke_club_invite(v_id);

  insert into public.uji_f2_konteks (nama, nilai)
  values (
    'kode5',
    public.create_club_invite(
      (select club_id from public.uji_f2_konteks where nama = 'club'),
      'member',
      1,
      24
    )
  );
end;
$$;

reset role;

update public.club_invites i
   set expires_at = now() - interval '1 hour'
 where i.code_hash = public.club_invite_code_hash(
   (select nilai from public.uji_f2_konteks where nama = 'kode5')
 );

set local role authenticated;
set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

do $$
begin
  begin
    perform public.redeem_club_invite((select nilai from public.uji_f2_konteks where nama = 'kode4'));
    raise exception 'UJI GAGAL: kode yang sudah dicabut masih bisa dipakai.';
  exception
    when sqlstate 'P0002' then
      null;
  end;

  begin
    perform public.redeem_club_invite((select nilai from public.uji_f2_konteks where nama = 'kode5'));
    raise exception 'UJI GAGAL: kode yang sudah kedaluwarsa masih bisa dipakai.';
  exception
    when sqlstate 'P0002' then
      null;
  end;
end;
$$;

-- 11. Batas argumen ditolak sebagai invalid_data, bukan dipotong diam-diam.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_club uuid := (select club_id from public.uji_f2_konteks where nama = 'club');
begin
  begin
    perform public.create_club_invite(v_club, 'owner', 1, 24);
    raise exception 'UJI GAGAL: undangan berperan owner diterima.';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.create_club_invite(v_club, 'member', 51, 24);
    raise exception 'UJI GAGAL: batas pemakaian 51 diterima.';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.create_club_invite(v_club, 'member', 1, 0);
    raise exception 'UJI GAGAL: masa berlaku 0 jam diterima.';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.create_club_invite(v_club, 'member', 1, 721);
    raise exception 'UJI GAGAL: masa berlaku 721 jam diterima.';
  exception
    when invalid_parameter_value then
      null;
  end;
end;
$$;

-- 12. Kode sah terakhir: F masuk, jejak audit tertulis, dan kode asli tidak
--     pernah tersimpan sebagai teks.
do $$
begin
  insert into public.uji_f2_konteks (nama, nilai)
  values (
    'kode6',
    public.create_club_invite(
      (select club_id from public.uji_f2_konteks where nama = 'club'),
      'member',
      1,
      24
    )
  );
end;
$$;

set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

do $$
declare
  v_hasil jsonb;
begin
  v_hasil := public.redeem_club_invite((select nilai from public.uji_f2_konteks where nama = 'kode6'));

  if v_hasil ->> 'status' is distinct from 'active' then
    raise exception 'UJI GAGAL: kode sah terakhir tidak mengaktifkan keanggotaan.';
  end if;

  if not exists (
    select 1 from public.club_members cm
    where cm.club_id = (select club_id from public.uji_f2_konteks where nama = 'club')
      and cm.user_id = '66666666-6666-6666-6666-666666666666'
      and cm.status = 'active'
      and cm.joined_at is not null
  ) then
    raise exception 'UJI GAGAL: joined_at tidak terisi untuk anggota baru.';
  end if;
end;
$$;

reset role;

do $$
declare
  v_plain int;
  v_hash_ok int;
  v_audit int;
begin
  select count(*) into v_plain
  from public.club_invites i
  where i.code_hash = (select nilai from public.uji_f2_konteks where nama = 'kode6');

  if v_plain <> 0 then
    raise exception 'UJI GAGAL: kode undangan tersimpan sebagai teks biasa.';
  end if;

  select count(*) into v_hash_ok
  from public.club_invites i
  where i.code_hash = public.club_invite_code_hash(
    (select nilai from public.uji_f2_konteks where nama = 'kode6')
  );

  if v_hash_ok <> 1 then
    raise exception 'UJI GAGAL: hash kode tidak dapat ditemukan setelah pemakaian (%).', v_hash_ok;
  end if;

  select count(*) into v_audit
  from public.club_role_audit a
  where a.club_id = (select club_id from public.uji_f2_konteks where nama = 'club')
    and a.subject_id = '66666666-6666-6666-6666-666666666666'
    and a.action = 'join';

  if v_audit <> 1 then
    raise exception 'UJI GAGAL: jejak audit "join" untuk pemakai kode tidak tertulis (%).', v_audit;
  end if;

  if exists (
    select 1 from public.club_invites i
    where i.code_hash !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'UJI GAGAL: ada baris undangan yang hash-nya bukan 64 heksadesimal.';
  end if;
end;
$$;

-- 13. Daftar undangan: admin melihat, anggota biasa tidak; kolom hash tidak ada.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  select count(*) into v_rows
  from public.list_club_invites((select club_id from public.uji_f2_konteks where nama = 'club'));

  if v_rows < 6 then
    raise exception 'UJI GAGAL: admin klub hanya melihat % undangan, seharusnya seluruh undangan klub.', v_rows;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

do $$
declare
  v_rows int;
  v_table_rows int;
begin
  select count(*) into v_rows
  from public.list_club_invites((select club_id from public.uji_f2_konteks where nama = 'club'));

  if v_rows <> 0 then
    raise exception 'UJI GAGAL: anggota biasa (non-admin) melihat % undangan klub lewat RPC.', v_rows;
  end if;

  -- Lapisan kedua: tabelnya sendiri tetap tidak terbaca klien mana pun.
  select count(*) into v_table_rows from public.club_invites;

  if v_table_rows <> 0 then
    raise exception 'UJI GAGAL: anggota aktif membaca % baris public.club_invites langsung.', v_table_rows;
  end if;
end;
$$;

reset role;

do $$
declare
  v_result text;
begin
  select pg_get_function_result(p.oid) into v_result
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'list_club_invites';

  if v_result is null or position('code_hash' in v_result) > 0 then
    raise exception 'UJI GAGAL: RPC daftar undangan mengembalikan kolom hash (%).', coalesce(v_result, 'null');
  end if;
end;
$$;

raise notice 'UJI UNDANGAN KLUB LULUS';

rollback;
