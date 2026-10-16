-- RodaKawan Milestone 2: RPC keanggotaan klub + jejak audit peran.
--
-- Kenapa migration baru, bukan mengubah yang lama
-- ---------------------------------------------------------------------------
-- `20261013022938_initial_schema.sql` sudah tercatat di database remote dan
-- memang **tidak** mendefinisikan policy INSERT untuk `public.clubs` maupun
-- policy INSERT/UPDATE/DELETE untuk `public.club_members`; komentarnya menunjuk
-- ke RPC yang belum ada. Migration itu tidak diubah (riwayat remote tidak boleh
-- bergeser maknanya); operasi yang hilang dikirim sebagai migration baru ini.
--
-- Batas yang dijaga di sini
-- ---------------------------------------------------------------------------
--   * Pembuatan klub dan pembuatan baris owner terjadi dalam satu transaksi.
--   * Semua fungsi SECURITY DEFINER, `set search_path = public`, dan memakai
--     `auth.uid()` sebagai identitas — tidak ada `user_id` yang dipercaya dari
--     klien kecuali sebagai *target* operasi admin.
--   * Perubahan yang ditolak berhenti dengan `raise exception` (bukan `return`
--     sukses palsu) memakai errcode standar:
--         42501 = tidak berwenang            → not_authorized
--         22023 = nilai argumen tidak sah    → invalid_data
--         23514 = melanggar invarian peran   → invalid_data
--         23505 = slug sudah dipakai         → conflict
--         P0002 = baris tidak ditemukan      → not_found
--   * `anon` tidak diberi EXECUTE satu pun; seluruh fungsi hanya untuk
--     `authenticated` (lihat catatan ACL pada 20261013140200).
--   * Perubahan peran/status ditulis ke `public.club_role_audit`, tabel yang
--     tidak punya policy INSERT sehingga hanya bisa diisi fungsi definer.
--
-- Cakupan yang belum ada di sini: penyimpanan foto (bucket + policy Storage).
-- Belum ada UI unggah foto, jadi tidak ada policy Storage yang dibuat asal-asalan.

-- ----------------------------------------------------------------- jejak audit
create table if not exists public.club_role_audit (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  subject_id uuid references public.profiles(id) on delete set null,
  action text not null check (
    action in (
      'club_created',
      'join',
      'request',
      'request_cancelled',
      'approve',
      'reject',
      'role_change',
      'remove',
      'leave'
    )
  ),
  old_role text check (old_role is null or old_role in ('owner', 'admin', 'member')),
  new_role text check (new_role is null or new_role in ('owner', 'admin', 'member')),
  old_status text check (
    old_status is null or old_status in ('pending', 'active', 'rejected', 'removed', 'left')
  ),
  new_status text check (
    new_status is null or new_status in ('pending', 'active', 'rejected', 'removed', 'left')
  ),
  created_at timestamptz not null default now()
);

create index if not exists club_role_audit_club_idx
  on public.club_role_audit(club_id, created_at desc);

alter table public.club_role_audit enable row level security;

-- Hanya owner/admin klub yang boleh membaca jejak audit klubnya. Tidak ada policy
-- INSERT/UPDATE/DELETE: baris audit hanya lahir dari fungsi definer di bawah.
drop policy if exists "club_role_audit_select_admin" on public.club_role_audit;
create policy "club_role_audit_select_admin" on public.club_role_audit
  for select to authenticated using (public.is_club_admin(club_id));

-- ---------------------------------------------------------------- buat klub
create or replace function public.create_club(
  p_name text,
  p_slug text default null,
  p_description text default null,
  p_visibility text default 'public',
  p_join_policy text default 'approval'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_base text;
  v_slug text;
  v_counter int := 1;
  v_club public.clubs;
begin
  if v_uid is null then
    raise exception 'Harus masuk untuk membuat klub.' using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'Nama klub harus 2-100 karakter.' using errcode = '22023';
  end if;

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'Deskripsi klub maksimal 2000 karakter.' using errcode = '22023';
  end if;

  if p_visibility not in ('public', 'private') then
    raise exception 'Visibilitas klub tidak dikenal.' using errcode = '22023';
  end if;

  if p_join_policy not in ('open', 'approval', 'invite_only') then
    raise exception 'Kebijakan bergabung tidak dikenal.' using errcode = '22023';
  end if;

  -- Klub selalu terhubung ke baris profil pembuatnya; tanpa profil, insert akan
  -- gagal sebagai galat foreign key yang sulit dibaca pengguna.
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Profil akun ini belum ada, jadi klub belum bisa dibuat.' using errcode = '23503';
  end if;

  v_base := lower(coalesce(nullif(btrim(coalesce(p_slug, '')), ''), v_name));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := btrim(v_base, '-');

  if char_length(v_base) < 3 then
    v_base := 'klub-' || substr(md5(v_name), 1, 6);
  end if;

  -- Sisakan ruang untuk akhiran angka supaya slug tetap <= 80 karakter.
  v_base := left(v_base, 72);
  v_slug := v_base;

  while exists (select 1 from public.clubs c where c.slug = v_slug) loop
    v_counter := v_counter + 1;

    if v_counter > 50 then
      raise exception 'Slug klub tidak tersedia; ubah nama klub.' using errcode = '23505';
    end if;

    v_slug := left(v_base, 72 - char_length(v_counter::text) - 1) || '-' || v_counter::text;
  end loop;

  insert into public.clubs (name, slug, description, visibility, join_policy, created_by)
  values (v_name, v_slug, v_description, p_visibility, p_join_policy, v_uid)
  returning * into v_club;

  insert into public.club_members (club_id, user_id, role, status, joined_at)
  values (v_club.id, v_uid, 'owner', 'active', now());

  insert into public.club_role_audit (club_id, actor_id, subject_id, action, new_role, new_status)
  values (v_club.id, v_uid, v_uid, 'club_created', 'owner', 'active');

  return to_jsonb(v_club);
end;
$$;

-- --------------------------------------------- ajukan / langsung bergabung
create or replace function public.request_club_membership(p_club_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_club public.clubs;
  v_member public.club_members;
  v_status text;
  v_old_status text;
begin
  if v_uid is null then
    raise exception 'Harus masuk untuk bergabung ke klub.' using errcode = '42501';
  end if;

  select * into v_club from public.clubs c where c.id = p_club_id;

  if not found then
    raise exception 'Klub tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_club.join_policy = 'invite_only' then
    raise exception 'Klub ini hanya menerima anggota lewat undangan.' using errcode = '42501';
  end if;

  select * into v_member
  from public.club_members cm
  where cm.club_id = p_club_id and cm.user_id = v_uid;

  if found then
    v_old_status := v_member.status;

    -- Sudah anggota aktif: permintaan ulang tidak mengubah apa pun.
    if v_member.status = 'active' then
      return 'active';
    end if;

    -- Owner/admin yang sedang nonaktif tidak boleh diturunkan diam-diam menjadi
    -- member biasa lewat jalur permintaan ini.
    if v_member.role <> 'member' then
      raise exception 'Peran owner/admin tidak bisa didaftarkan ulang lewat jalur ini.'
        using errcode = '42501';
    end if;
  end if;

  -- Klub privat selalu butuh persetujuan; klub publik mengikuti join_policy.
  v_status := case
    when v_club.visibility = 'public' and v_club.join_policy = 'open' then 'active'
    else 'pending'
  end;

  if found then
    update public.club_members
      set status = v_status,
          role = 'member',
          joined_at = case when v_status = 'active' then coalesce(joined_at, now()) else null end,
          updated_at = now()
      where club_id = p_club_id and user_id = v_uid;
  else
    insert into public.club_members (club_id, user_id, role, status, joined_at)
    values (
      p_club_id,
      v_uid,
      'member',
      v_status,
      case when v_status = 'active' then now() else null end
    );
  end if;

  insert into public.club_role_audit (
    club_id, actor_id, subject_id, action, old_status, new_status, new_role
  )
  values (
    p_club_id,
    v_uid,
    v_uid,
    case when v_status = 'active' then 'join' else 'request' end,
    v_old_status,
    v_status,
    'member'
  );

  return v_status;
end;
$$;

-- ---------------------------------------------- setujui / tolak permintaan
create or replace function public.review_club_membership(
  p_club_id uuid,
  p_user_id uuid,
  p_approve boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.club_members;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Harus masuk untuk meninjau permintaan.' using errcode = '42501';
  end if;

  if p_user_id is null or p_approve is null then
    raise exception 'Permintaan tidak lengkap.' using errcode = '22023';
  end if;

  if not public.is_club_admin(p_club_id) then
    raise exception 'Hanya owner/admin klub yang boleh meninjau permintaan.'
      using errcode = '42501';
  end if;

  select * into v_member
  from public.club_members cm
  where cm.club_id = p_club_id and cm.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Permintaan itu tidak ada di klub ini.' using errcode = 'P0002';
  end if;

  if v_member.role <> 'member' then
    raise exception 'Peran owner/admin tidak ditinjau lewat alur persetujuan.'
      using errcode = '42501';
  end if;

  if v_member.status <> 'pending' then
    raise exception 'Tidak ada permintaan yang menunggu untuk anggota itu.'
      using errcode = '22023';
  end if;

  v_status := case when p_approve then 'active' else 'rejected' end;

  update public.club_members
    set status = v_status,
        joined_at = case when p_approve then coalesce(joined_at, now()) else null end,
        updated_at = now()
    where club_id = p_club_id and user_id = p_user_id;

  insert into public.club_role_audit (
    club_id, actor_id, subject_id, action, old_status, new_status
  )
  values (
    p_club_id,
    v_uid,
    p_user_id,
    case when p_approve then 'approve' else 'reject' end,
    'pending',
    v_status
  );

  return v_status;
end;
$$;

-- ------------------------------------------------------- ubah peran anggota
create or replace function public.set_club_member_role(
  p_club_id uuid,
  p_user_id uuid,
  p_role text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.club_members;
  v_member public.club_members;
  v_other_owners int;
begin
  if v_uid is null then
    raise exception 'Harus masuk untuk mengubah peran.' using errcode = '42501';
  end if;

  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'Peran tidak dikenal.' using errcode = '22023';
  end if;

  select * into v_actor
  from public.club_members cm
  where cm.club_id = p_club_id and cm.user_id = v_uid and cm.status = 'active';

  -- Hanya owner yang boleh memberi/mencabut peran: admin tidak bisa menaikkan
  -- dirinya sendiri maupun orang lain (kebutuhan role escalation Milestone 2).
  if not found or v_actor.role <> 'owner' then
    raise exception 'Hanya owner klub yang boleh mengubah peran anggota.'
      using errcode = '42501';
  end if;

  select * into v_member
  from public.club_members cm
  where cm.club_id = p_club_id and cm.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Anggota itu tidak ada di klub ini.' using errcode = 'P0002';
  end if;

  if v_member.status <> 'active' then
    raise exception 'Hanya anggota aktif yang bisa diubah perannya.' using errcode = '22023';
  end if;

  if v_member.role = p_role then
    return p_role;
  end if;

  -- Invarian: klub tidak pernah kehilangan owner terakhirnya.
  if v_member.role = 'owner' then
    select count(*) into v_other_owners
    from public.club_members cm
    where cm.club_id = p_club_id
      and cm.status = 'active'
      and cm.role = 'owner'
      and cm.user_id <> p_user_id;

    if v_other_owners = 0 then
      raise exception 'Owner terakhir tidak bisa diturunkan; angkat owner lain lebih dulu.'
        using errcode = '23514';
    end if;
  end if;

  update public.club_members
    set role = p_role, updated_at = now()
    where club_id = p_club_id and user_id = p_user_id;

  insert into public.club_role_audit (
    club_id, actor_id, subject_id, action, old_role, new_role
  )
  values (p_club_id, v_uid, p_user_id, 'role_change', v_member.role, p_role);

  return p_role;
end;
$$;

-- ------------------------------------------------------------ keluarkan anggota
create or replace function public.remove_club_member(p_club_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.club_members;
  v_member public.club_members;
begin
  if v_uid is null then
    raise exception 'Harus masuk untuk mengeluarkan anggota.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Anggota tidak dikenal.' using errcode = '22023';
  end if;

  select * into v_actor
  from public.club_members cm
  where cm.club_id = p_club_id and cm.user_id = v_uid and cm.status = 'active';

  if not found or v_actor.role not in ('owner', 'admin') then
    raise exception 'Hanya owner/admin klub yang boleh mengeluarkan anggota.'
      using errcode = '42501';
  end if;

  select * into v_member
  from public.club_members cm
  where cm.club_id = p_club_id and cm.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Anggota itu tidak ada di klub ini.' using errcode = 'P0002';
  end if;

  if v_member.user_id = v_uid then
    raise exception 'Untuk keluar dari klub, gunakan aksi keluar klub.' using errcode = '22023';
  end if;

  if v_member.role = 'owner' then
    raise exception 'Owner tidak bisa dikeluarkan.' using errcode = '23514';
  end if;

  if v_member.role = 'admin' and v_actor.role <> 'owner' then
    raise exception 'Hanya owner yang boleh mengeluarkan admin.' using errcode = '42501';
  end if;

  if v_member.status <> 'active' then
    raise exception 'Anggota itu tidak sedang aktif di klub ini.' using errcode = '22023';
  end if;

  update public.club_members
    set status = 'removed', role = 'member', joined_at = null, updated_at = now()
    where club_id = p_club_id and user_id = p_user_id;

  insert into public.club_role_audit (
    club_id, actor_id, subject_id, action, old_role, old_status, new_status, new_role
  )
  values (
    p_club_id, v_uid, p_user_id, 'remove', v_member.role, 'active', 'removed', 'member'
  );

  return 'removed';
end;
$$;

-- ------------------------------------------------- keluar / batalkan permintaan
create or replace function public.leave_club(p_club_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.club_members;
begin
  if v_uid is null then
    raise exception 'Harus masuk untuk keluar dari klub.' using errcode = '42501';
  end if;

  select * into v_member
  from public.club_members cm
  where cm.club_id = p_club_id and cm.user_id = v_uid
  for update;

  if not found then
    raise exception 'Anda bukan anggota klub ini.' using errcode = 'P0002';
  end if;

  -- Permintaan yang belum disetujui dibatalkan tanpa menghapus riwayatnya.
  if v_member.status = 'pending' then
    update public.club_members
      set status = 'left', role = 'member', joined_at = null, updated_at = now()
      where club_id = p_club_id and user_id = v_uid;

    insert into public.club_role_audit (
      club_id, actor_id, subject_id, action, old_status, new_status
    )
    values (p_club_id, v_uid, v_uid, 'request_cancelled', 'pending', 'left');

    return 'cancelled';
  end if;

  if v_member.status <> 'active' then
    -- Sudah keluar/dikeluarkan: tidak ada yang perlu diubah, tetapi tetap idempoten.
    return v_member.status;
  end if;

  if v_member.role = 'owner' then
    raise exception 'Owner tidak bisa keluar sebelum mengalihkan kepemilikan klub.'
      using errcode = '23514';
  end if;

  update public.club_members
    set status = 'left', role = 'member', joined_at = null, updated_at = now()
    where club_id = p_club_id and user_id = v_uid;

  insert into public.club_role_audit (
    club_id, actor_id, subject_id, action, old_role, old_status, new_status, new_role
  )
  values (p_club_id, v_uid, v_uid, 'leave', v_member.role, 'active', 'left', 'member');

  return 'left';
end;
$$;

-- ------------------------------------------------------------ hak eksekusi
-- Supabase memberi EXECUTE ke anon/authenticated lewat default privileges, jadi
-- grant untuk peran tanpa sesi harus dicabut eksplisit (lihat 20261013140200).
revoke all on function public.create_club(text, text, text, text, text) from public, anon;
revoke all on function public.request_club_membership(uuid) from public, anon;
revoke all on function public.review_club_membership(uuid, uuid, boolean) from public, anon;
revoke all on function public.set_club_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_club_member(uuid, uuid) from public, anon;
revoke all on function public.leave_club(uuid) from public, anon;

grant execute on function public.create_club(text, text, text, text, text) to authenticated;
grant execute on function public.request_club_membership(uuid) to authenticated;
grant execute on function public.review_club_membership(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_club_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_club_member(uuid, uuid) to authenticated;
grant execute on function public.leave_club(uuid) to authenticated;
