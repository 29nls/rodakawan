-- ============================================================================
-- RodaKawan — throttle jalur tulis berbiaya (AUD-14 lanjutan).
--
-- Kenapa di database
-- ---------------------------------------------------------------------------
-- Pemeriksaan di UI tidak mengikat: klien yang dimodifikasi dapat memanggil RPC
-- langsung berulang kali. Ketiga fungsi di bawah adalah `security definer`, jadi
-- batasnya harus berada di dalam fungsi yang sama yang menulis baris.
--
-- Batas yang dipilih (bisa diubah lewat migration baru; jangan sunting migration
-- ini setelah diterapkan):
--   create_club           10 klub baru  / 1 jam   / pengguna
--   create_ride           10 ride baru  / 1 jam   / pengguna
--   publish_ride_location minimum 2 detik antara dua publikasi sukses
--                          untuk (ride, user) yang sama — maksimum 30/menit
--
-- Angka ini longgar untuk pemakaian wajar: satu orang jarang membuat lebih dari
-- beberapa klub/ride dalam sejam, dan klien mengirim lokasi paling cepat setiap
-- 15 detik (atau saat bergerak 25 m). Tujuannya menahan skrip massal, bukan
-- membatasi perjalanan normal.
--
-- Penolakan memakai SQLSTATE P0001 + detail `<scope>_rate_limit`, sama seperti
-- rate limit AUD-14 sebelumnya, supaya klien memetakan kode — bukan mencocokkan
-- teks pesan.
--
-- Identitas selalu `auth.uid()`, tidak pernah kolom dari payload. Pemanggilan
-- tanpa sesi (service_role) tidak dibatasi karena bukan jalur pengguna.
--
-- Throttle lokasi disimpan di `ride_members.last_location_published_at`, bukan
-- tabel riwayat: tidak ada koordinat yang disimpan, dan baris itu sudah dikunci
-- `for update` oleh `publish_ride_location`. Kolom direset saat consent dimatikan
-- atau peserta keluar/dikeluarkan, sehingga izin berbagi yang sah tidak
-- mewarisi tunggakan throttle. Klien tidak punya policy UPDATE pada
-- `ride_members`, jadi kolom ini tidak bisa diubah lewat REST.
--
-- Migration ini aditif: tidak mengubah policy, tanda tangan fungsi, atau data.
-- ============================================================================

-- 1. State throttle lokasi. NULL = belum pernah publikasi (atau state direset).
alter table public.ride_members
  add column if not exists last_location_published_at timestamptz;

comment on column public.ride_members.last_location_published_at is
  'Waktu publikasi lokasi terakhir yang berhasil; dipakai throttle 2 detik publish_ride_location (AUD-14).';

-- Dipakai oleh hitungan throttle create_club (10/jam per pembuat).
create index if not exists clubs_creator_created_idx
  on public.clubs(created_by, created_at desc);

-- 2. Saat consent mati atau peserta keluar/dikeluarkan, lokasi terakhir dihapus
--    DAN state throttle direset. Tanpa reset, izin berbagi yang dinyalakan lagi
--    akan ditolak oleh tunggakan publikasi sebelumnya.
create or replace function public.clear_ride_location_on_opt_out()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sharing_location = false or new.status <> 'joined' then
    delete from public.ride_locations
     where ride_id = new.ride_id and user_id = new.user_id;

    update public.ride_members
       set last_location_published_at = null
     where ride_id = new.ride_id
       and user_id = new.user_id
       and last_location_published_at is not null;
  end if;
  return new;
end;
$$;

comment on function public.clear_ride_location_on_opt_out() is
  'AFTER UPDATE ride_members: hapus lokasi terakhir dan reset throttle publikasi saat consent mati/keluar (AUD-14, ADR-065).';

-- Trigger sudah ada dari 20261019120000; create or replace di atas cukup.
-- Definisi ulang di sini hanya untuk membuat migration ini dapat dibaca mandiri
-- bila trigger belum ada pada project yang dimigrasikan dari nol.
drop trigger if exists ride_members_clear_location on public.ride_members;
create trigger ride_members_clear_location
after update of sharing_location, status on public.ride_members
for each row execute function public.clear_ride_location_on_opt_out();

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

-- 5. Publikasi lokasi: minimum 2 detik antara dua publikasi sukses untuk
--    (ride, user) yang sama. Baris `ride_members` sudah dikunci `for update`,
--    jadi dua permintaan bersamaan tidak dapat sama-sama lolos.
create or replace function public.publish_ride_location(
  p_ride_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision default null,
  p_heading_deg double precision default null,
  p_speed_mps double precision default null,
  p_recorded_at timestamptz default now()
)
returns public.ride_locations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.ride_members;
  v_ride public.rides;
  v_recorded_at timestamptz := coalesce(p_recorded_at, now());
  v_location public.ride_locations;
begin
  if v_uid is null then
    raise exception 'mengirim lokasi membutuhkan sesi' using errcode = '42501';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'perjalanan tidak ditemukan' using errcode = 'P0002';
  end if;

  select * into v_member
  from public.ride_members
  where ride_id = p_ride_id and user_id = v_uid
  for update;

  if not found or v_member.status <> 'joined' then
    raise exception 'bukan anggota aktif perjalanan ini' using errcode = '42501';
  end if;

  if v_ride.status <> 'active' then
    raise exception 'lokasi hanya dapat dikirim pada perjalanan aktif' using errcode = '23514';
  end if;

  if v_member.sharing_location is not true then
    raise exception 'berbagi lokasi belum dinyalakan untuk perjalanan ini' using errcode = '42501';
  end if;

  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then
    raise exception 'lintang tidak valid' using errcode = '22023';
  end if;

  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'bujur tidak valid' using errcode = '22023';
  end if;

  if p_accuracy_m is not null and (p_accuracy_m < 0 or p_accuracy_m > 1000) then
    raise exception 'akurasi lokasi di luar batas' using errcode = '22023';
  end if;

  if p_heading_deg is not null and (p_heading_deg < 0 or p_heading_deg >= 360) then
    raise exception 'arah lokasi di luar batas' using errcode = '22023';
  end if;

  if p_speed_mps is not null and (p_speed_mps < 0 or p_speed_mps > 120) then
    raise exception 'kecepatan lokasi di luar batas' using errcode = '22023';
  end if;

  -- Tolak fix yang terlalu tua atau berasal dari masa depan: marker "live"
  -- tidak boleh dibangun dari posisi lama yang disajikan sebagai terkini.
  if v_recorded_at < now() - interval '5 minutes' then
    raise exception 'lokasi terlalu lama untuk dikirim' using errcode = '22023';
  end if;

  if v_recorded_at > now() + interval '1 minute' then
    raise exception 'waktu lokasi berada di masa depan' using errcode = '22023';
  end if;

  -- AUD-14: cegah banjir pembaruan. Klien normal mengirim paling cepat setiap
  -- 15 detik; 2 detik hanya menahan pengulangan agresif dan tetap memberi ruang
  -- untuk pengiriman ulang saat bergerak 25 m.
  if v_member.last_location_published_at is not null
     and v_member.last_location_published_at > now() - interval '2 seconds' then
    raise exception 'Terlalu sering mengirim lokasi. Tunggu beberapa detik lalu coba lagi.'
      using errcode = 'P0001', detail = 'location_publish_rate_limit';
  end if;

  insert into public.ride_locations (
    ride_id,
    user_id,
    latitude,
    longitude,
    accuracy_m,
    heading_deg,
    speed_mps,
    recorded_at,
    updated_at
  )
  values (
    p_ride_id,
    v_uid,
    p_latitude,
    p_longitude,
    p_accuracy_m,
    p_heading_deg,
    p_speed_mps,
    v_recorded_at,
    now()
  )
  on conflict (ride_id, user_id) do update
    set latitude = excluded.latitude,
        longitude = excluded.longitude,
        accuracy_m = excluded.accuracy_m,
        heading_deg = excluded.heading_deg,
        speed_mps = excluded.speed_mps,
        recorded_at = excluded.recorded_at,
        updated_at = now()
  returning * into v_location;

  update public.ride_members
     set last_location_published_at = now()
   where ride_id = p_ride_id
     and user_id = v_uid;

  return v_location;
end;
$$;

comment on function public.publish_ride_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) is
  'SECURITY DEFINER: publikasi lokasi terakhir; minimum 2 detik antar publikasi per (ride,user) (AUD-14).';

revoke all on function public.publish_ride_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) from public, anon;
grant execute on function public.publish_ride_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) to authenticated;
