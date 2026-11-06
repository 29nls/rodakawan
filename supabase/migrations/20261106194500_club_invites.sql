-- RodaKawan Fase 2 — undangan klub (invite-only) di lapisan database.
--
-- Kenapa migration baru, bukan mengubah yang lama
-- ---------------------------------------------------------------------------
-- `public.clubs.join_policy` sudah menerima nilai `invite_only` sejak
-- `20261013022938_initial_schema.sql`, dan `request_club_membership` menolak
-- permintaan bergabung ke klub seperti itu. Yang belum ada adalah jalur untuk
-- benar-benar mengundang: klub `invite_only` bisa kehilangan anggota tetapi
-- tidak pernah mendapat anggota baru. Migration ini menambahkan jalur tersebut
-- tanpa mengubah migration yang sudah diterapkan dan tanpa melonggarkan policy
-- yang sudah ada.
--
-- Model keamanan
-- ---------------------------------------------------------------------------
--   * Kode undangan **tidak** disimpan sebagai teks; yang disimpan hanya
--     SHA-256 dari bentuk ternormalisasinya (`RK` + 16 heksadesimal). Tabel yang
--     bocor tidak langsung memberi kode yang bisa dipakai.
--   * `public.club_invites` mengaktifkan RLS dan sengaja **tidak punya policy
--     satu pun**: tidak ada klien — termasuk owner/admin — yang membaca atau
--     menulis tabel ini lewat Data API. Daftar undangan dibaca lewat RPC
--     `list_club_invites` yang tidak pernah mengembalikan hash.
--   * Semua fungsi `security definer` dengan `search_path = ''`, identitas dari
--     `auth.uid()`. Grant dicabut dari `public`/`anon`; hanya `authenticated`
--     yang boleh mengeksekusi, dan otorisasinya diperiksa di dalam fungsi.
--   * Kode yang tidak dikenal, kedaluwarsa, dicabut, atau sudah habis dipakai
--     menghasilkan **satu pesan yang sama** (P0002, detail
--     `club_invite_invalid`) supaya endpoint tidak bisa dipakai menebak kode mana
--     yang pernah ada.
--   * Entropi kode 64 bit; tanpa umpan balik yang membedakan kode sah dan tidak,
--     menebaknya tidak praktis. Batas tambahan: maksimal 20 undangan aktif per
--     klub, 50 pemakaian per kode, dan masa berlaku maksimal 30 hari.
--
-- Batas yang diketahui: klien aplikasi belum memakai RPC ini.
-- `src/lib/supabase/database.generated.ts` hanya boleh diperbarui lewat
-- `npm run db:types` setelah migration diterapkan ke project development, jadi
-- layar undangan menyusul di fase berikutnya.

-- ------------------------------------------------------------------ kunci kode
-- Bentuk ternormalisasi: huruf besar, hanya alfanumerik. Pengguna boleh mengetik
-- "rk-abcd-efgh" atau "RKABCDEFGH"; keduanya menghasilkan kunci yang sama.
create or replace function public.club_invite_code_key(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'))
$$;

comment on function public.club_invite_code_key(text) is
  'Bentuk normal kode undangan klub (huruf besar, alfanumerik saja). Dipakai sebelum hashing.';

create or replace function public.club_invite_code_hash(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(public.club_invite_code_key(p_code), 'UTF8')), 'hex')
$$;

comment on function public.club_invite_code_hash(text) is
  'SHA-256 dari kunci kode undangan; satu-satunya bentuk kode yang disimpan di database.';

-- -------------------------------------------------------------------- undangan
create table if not exists public.club_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  granted_role text not null default 'member' check (granted_role in ('admin', 'member')),
  max_uses integer not null default 1 check (max_uses between 1 and 50),
  uses integer not null default 0 check (uses >= 0),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint club_invites_uses_within_max check (uses <= max_uses)
);

comment on table public.club_invites is
  'Undangan klub (Fase 2). Hanya hash kode yang disimpan; baris lahir dan berubah hanya lewat RPC definer, sehingga RLS tidak punya policy apa pun.';

create index if not exists club_invites_club_idx
  on public.club_invites(club_id, created_at desc);

alter table public.club_invites enable row level security;

-- Lapisan kedua: `anon` tidak diberi grant tabel sama sekali, walau RLS tanpa
-- policy sudah menutupnya. `authenticated` tetap punya grant baca supaya
-- pemeriksaan "nol baris" di uji SQL menguji RLS, bukan sekadar izin tabel.
revoke all on table public.club_invites from public, anon;
grant select on table public.club_invites to authenticated;

-- --------------------------------------------------------------- buat undangan
create or replace function public.create_club_invite(
  p_club_id uuid,
  p_role text default 'member',
  p_max_uses integer default 1,
  p_expires_in_hours integer default 168
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_club public.clubs;
  v_role text := coalesce(p_role, 'member');
  v_max integer := coalesce(p_max_uses, 1);
  v_hours integer := coalesce(p_expires_in_hours, 168);
  v_active integer;
  v_key text;
begin
  if v_uid is null then
    raise exception 'Harus masuk untuk membuat undangan klub.' using errcode = '42501';
  end if;

  select * into v_club from public.clubs c where c.id = p_club_id;

  if not found then
    raise exception 'Klub tidak ditemukan.' using errcode = 'P0002';
  end if;

  if not public.is_club_admin(p_club_id) then
    raise exception 'Hanya owner/admin klub yang bisa membuat kode undangan.'
      using errcode = '42501';
  end if;

  if v_role not in ('member', 'admin') then
    raise exception 'Peran undangan harus member atau admin.' using errcode = '22023';
  end if;

  -- Hanya owner yang boleh mengundang admin lain; admin tidak bisa menambah
  -- admin (sama seperti `set_club_member_role`).
  if v_role = 'admin' and not exists (
    select 1
    from public.club_members cm
    where cm.club_id = p_club_id
      and cm.user_id = v_uid
      and cm.status = 'active'
      and cm.role = 'owner'
  ) then
    raise exception 'Hanya owner yang bisa mengundang admin.' using errcode = '42501';
  end if;

  if v_max < 1 or v_max > 50 then
    raise exception 'Batas pemakaian undangan harus antara 1 dan 50.' using errcode = '22023';
  end if;

  if v_hours < 1 or v_hours > 720 then
    raise exception 'Masa berlaku undangan harus antara 1 dan 720 jam.' using errcode = '22023';
  end if;

  select count(*) into v_active
  from public.club_invites i
  where i.club_id = p_club_id
    and i.revoked_at is null
    and i.expires_at > now()
    and i.uses < i.max_uses;

  if v_active >= 20 then
    raise exception 'Klub ini sudah punya 20 undangan aktif. Cabut yang tidak terpakai lebih dulu.'
      using errcode = 'P0001', detail = 'club_invite_limit';
  end if;

  -- 16 heksadesimal dari satu UUID: 64 bit acak, cukup untuk kode yang dipakai
  -- manual dan tidak dapat ditebak dari daftar.
  v_key := 'RK' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  insert into public.club_invites (
    club_id, code_hash, granted_role, max_uses, expires_at, created_by
  )
  values (
    p_club_id,
    public.club_invite_code_hash(v_key),
    v_role,
    v_max,
    now() + make_interval(hours => v_hours),
    v_uid
  );

  return v_key;
end;
$$;

comment on function public.create_club_invite(uuid, text, integer, integer) is
  'Membuat kode undangan klub dan mengembalikan kodenya sekali (yang disimpan hanya hash). Hanya owner/admin aktif; undangan admin hanya oleh owner.';

-- -------------------------------------------------------------- cabut undangan
create or replace function public.revoke_club_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.club_invites;
begin
  if v_uid is null then
    raise exception 'Harus masuk untuk mencabut undangan klub.' using errcode = '42501';
  end if;

  select * into v_invite from public.club_invites i where i.id = p_invite_id;

  if not found then
    raise exception 'Undangan tidak ditemukan.' using errcode = 'P0002';
  end if;

  if not public.is_club_admin(v_invite.club_id) then
    raise exception 'Hanya owner/admin klub yang bisa mencabut undangan.'
      using errcode = '42501';
  end if;

  update public.club_invites i
     set revoked_at = coalesce(i.revoked_at, now())
   where i.id = p_invite_id;

  return;
end;
$$;

comment on function public.revoke_club_invite(uuid) is
  'Mencabut undangan klub (idempoten). Kode yang sudah dicabut tidak bisa dipakai lagi.';

-- --------------------------------------------------------------- daftar undangan
-- Metadata saja: `code_hash` tidak pernah keluar dari database, sehingga admin
-- pun tidak bisa memulihkan kode yang sudah dibagikan.
create or replace function public.list_club_invites(p_club_id uuid)
returns table (
  id uuid,
  granted_role text,
  max_uses integer,
  uses integer,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    i.granted_role,
    i.max_uses,
    i.uses,
    i.expires_at,
    i.revoked_at,
    i.created_by,
    i.created_at
  from public.club_invites i
  where i.club_id = p_club_id
    and public.is_club_admin(p_club_id)
  order by i.created_at desc
$$;

comment on function public.list_club_invites(uuid) is
  'Daftar undangan klub untuk owner/admin aktif, tanpa hash kode. Non-admin menerima nol baris.';

-- ---------------------------------------------------------------- pakai undangan
create or replace function public.redeem_club_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := public.club_invite_code_key(p_code);
  v_invite public.club_invites;
  v_invite_exists boolean;
  v_member public.club_members;
  v_member_exists boolean;
begin
  if v_uid is null then
    raise exception 'Harus masuk untuk memakai kode undangan.' using errcode = '42501';
  end if;

  if v_key is null or length(v_key) < 8 then
    raise exception 'Kode undangan tidak berlaku. Minta kode baru ke pengelola klub.'
      using errcode = 'P0002', detail = 'club_invite_invalid';
  end if;

  -- `for update` menahan baris sampai transaksi selesai, sehingga dua orang yang
  -- memakai kode sekali-pakai bersamaan tidak sama-sama berhasil.
  select * into v_invite
  from public.club_invites i
  where i.code_hash = public.club_invite_code_hash(p_code)
  for update;

  v_invite_exists := found;

  -- Satu pesan untuk semua kegagalan: kode tidak dikenal, kedaluwarsa, dicabut,
  -- atau sudah habis. Membedakannya akan memberi tahu penebak kode mana yang ada.
  if not v_invite_exists
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= now()
     or v_invite.uses >= v_invite.max_uses then
    raise exception 'Kode undangan tidak berlaku. Minta kode baru ke pengelola klub.'
      using errcode = 'P0002', detail = 'club_invite_invalid';
  end if;

  select * into v_member
  from public.club_members cm
  where cm.club_id = v_invite.club_id and cm.user_id = v_uid;

  v_member_exists := found;

  -- Sudah anggota aktif: kode tidak dihabiskan, jawabannya jujur.
  if v_member_exists and v_member.status = 'active' then
    return jsonb_build_object(
      'club_id', v_invite.club_id,
      'status', 'active',
      'already_member', true
    );
  end if;

  -- Owner/admin yang sudah tidak aktif tidak boleh "didaur ulang" menjadi anggota
  -- biasa lewat kode; itu jalur penurunan peran, bukan undangan.
  if v_member_exists and v_member.role <> 'member' then
    raise exception 'Peran owner/admin tidak bisa didaftarkan ulang lewat kode undangan.'
      using errcode = '42501';
  end if;

  if v_member_exists then
    update public.club_members cm
       set status = 'active',
           role = v_invite.granted_role,
           joined_at = coalesce(cm.joined_at, now()),
           updated_at = now()
     where cm.club_id = v_invite.club_id and cm.user_id = v_uid;
  else
    insert into public.club_members (club_id, user_id, role, status, joined_at)
    values (v_invite.club_id, v_uid, v_invite.granted_role, 'active', now());
  end if;

  update public.club_invites i
     set uses = i.uses + 1
   where i.id = v_invite.id;

  insert into public.club_role_audit (
    club_id, actor_id, subject_id, action, old_status, new_status, new_role
  )
  values (
    v_invite.club_id,
    v_uid,
    v_uid,
    'join',
    case when v_member_exists then v_member.status else null end,
    'active',
    v_invite.granted_role
  );

  return jsonb_build_object(
    'club_id', v_invite.club_id,
    'status', 'active',
    'already_member', false
  );
end;
$$;

comment on function public.redeem_club_invite(text) is
  'Memakai kode undangan klub: mengaktifkan keanggotaan (peran mengikuti undangan), menambah hitungan pemakaian, dan menulis jejak audit. Kode tidak sah selalu dijawab dengan pesan yang sama.';

-- ------------------------------------------------------------------------ grant
-- Helper hashing tidak dipanggil klien: hanya dari dalam fungsi definer, yang
-- berjalan sebagai pemilik fungsi.
revoke all on function public.club_invite_code_key(text) from public, anon, authenticated;
revoke all on function public.club_invite_code_hash(text) from public, anon, authenticated;

revoke all on function public.create_club_invite(uuid, text, integer, integer) from public, anon;
revoke all on function public.revoke_club_invite(uuid) from public, anon;
revoke all on function public.list_club_invites(uuid) from public, anon;
revoke all on function public.redeem_club_invite(text) from public, anon;

grant execute on function public.create_club_invite(uuid, text, integer, integer) to authenticated;
grant execute on function public.revoke_club_invite(uuid) to authenticated;
grant execute on function public.list_club_invites(uuid) to authenticated;
grant execute on function public.redeem_club_invite(text) to authenticated;
