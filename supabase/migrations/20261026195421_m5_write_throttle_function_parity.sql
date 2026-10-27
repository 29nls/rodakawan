-- ============================================================================
-- Paritas fungsi throttle jalur tulis dengan repo.
--
-- Latar: project development sempat menerima revisi antara dari
-- `20261026184430_m5_write_throttles.sql` yang mengunci baris `profiles`
-- (`select ... for update`) sebelum menghitung kuota. Revisi final di repo
-- tidak memakai lock profil; serialisasi dilakukan oleh trigger advisory lock
-- di `20261026191105_m5_write_throttle_serialization.sql`.
--
-- Migration ini **tidak** mengubah perilaku yang diinginkan: ia menulis ulang
-- `create_club`/`create_ride` persis seperti definisi final di repo, supaya
-- project development tidak berbeda dari project baru yang dibangun dari nol.
-- Tidak ada migration lama yang disunting.
--
-- Setelah ini, dua permintaan serentak harus menunggu advisory lock throttle,
-- bukan row lock `profiles`.
-- ============================================================================

-- 3. Buat klub: maksimal 10 klub baru per jam per pengguna.
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
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_base text;
  v_slug text;
  v_counter int := 1;
  v_recent int;
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

  -- AUD-14: batasi pembuatan klub. Dihitung dari baris yang benar-benar
  -- tersimpan, jadi percobaan yang gagal validasi tidak menghabiskan kuota.
  select count(*)
    into v_recent
    from public.clubs c
   where c.created_by = v_uid
     and c.created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'Terlalu banyak klub dibuat dalam satu jam. Coba lagi nanti.'
      using errcode = 'P0001', detail = 'club_create_rate_limit';
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

comment on function public.create_club(text, text, text, text, text) is
  'SECURITY DEFINER: membuat klub; maksimal 10 klub baru per jam per pengguna (AUD-14).';

revoke all on function public.create_club(text, text, text, text, text) from public, anon;
grant execute on function public.create_club(text, text, text, text, text) to authenticated;

-- 4. Buat perjalanan: maksimal 10 ride baru per jam per pengguna.
create or replace function public.create_ride(
  p_club_id uuid,
  p_title text,
  p_starts_at timestamptz default null,
  p_description text default null,
  p_meeting_label text default null,
  p_destination_label text default null,
  p_visibility text default 'club'
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_meeting text := nullif(btrim(coalesce(p_meeting_label, '')), '');
  v_destination text := nullif(btrim(coalesce(p_destination_label, '')), '');
  v_visibility text := coalesce(p_visibility, 'club');
  v_recent int;
  v_ride public.rides;
begin
  if v_uid is null then
    raise exception 'membuat perjalanan membutuhkan sesi' using errcode = '42501';
  end if;

  if p_club_id is null then
    raise exception 'perjalanan harus milik satu klub' using errcode = '22023';
  end if;

  if not public.is_club_member(p_club_id) then
    raise exception 'hanya anggota aktif klub yang boleh membuat perjalanan' using errcode = '42501';
  end if;

  if char_length(v_title) < 3 or char_length(v_title) > 120 then
    raise exception 'judul perjalanan harus 3-120 karakter' using errcode = '22023';
  end if;

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'deskripsi perjalanan maksimal 2000 karakter' using errcode = '22023';
  end if;

  if v_visibility not in ('club', 'invite_only', 'public') then
    raise exception 'visibilitas perjalanan tidak dikenal: %', v_visibility using errcode = '22023';
  end if;

  -- AUD-14: batasi pembuatan ride. Dihitung dari baris yang benar-benar
  -- tersimpan, jadi percobaan yang gagal validasi tidak menghabiskan kuota.
  select count(*)
    into v_recent
    from public.rides r
   where r.created_by = v_uid
     and r.created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'Terlalu banyak perjalanan dibuat dalam satu jam. Coba lagi nanti.'
      using errcode = 'P0001', detail = 'ride_create_rate_limit';
  end if;

  insert into public.rides (
    club_id,
    created_by,
    title,
    description,
    activity_type,
    status,
    visibility,
    starts_at,
    meeting_label,
    destination_label
  )
  values (
    p_club_id,
    v_uid,
    v_title,
    v_description,
    'motorcycle',
    'planned',
    v_visibility,
    p_starts_at,
    v_meeting,
    v_destination
  )
  returning * into v_ride;

  insert into public.ride_members (ride_id, user_id, role, status, joined_at, sharing_location)
  values (v_ride.id, v_uid, 'host', 'joined', now(), false);

  return v_ride;
end;
$$;

comment on function public.create_ride(uuid, text, timestamptz, text, text, text, text) is
  'SECURITY DEFINER: membuat perjalanan; maksimal 10 ride baru per jam per pengguna (AUD-14).';

revoke all on function public.create_ride(uuid, text, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.create_ride(uuid, text, timestamptz, text, text, text, text) to authenticated;
