-- ============================================================================
-- RodaKawan — Milestone 3: alur perjalanan dan berbagi lokasi opt-in.
--
-- Skema dasar (`rides`, `ride_members`, `ride_locations`) sudah ada sejak
-- `20261013022938_initial_schema.sql`. Migration ini **tidak** membuat tabel
-- baru dan tidak menambah riwayat GPS: `ride_locations` tetap satu baris
-- terakhir per `(ride_id, user_id)` (ADR-006, ADR-065).
--
-- Yang ditambahkan:
--   1. RPC pembuatan/pengubahan perjalanan (`create_ride`, `update_ride`);
--   2. RPC keanggotaan (`invite_ride_member`, `accept_ride_invite`, `join_ride`,
--      `leave_ride`, `remove_ride_member`);
--   3. RPC state machine (`transition_ride`) yang menolak transisi ilegal dan
--      hanya menerima host;
--   4. RPC consent (`set_ride_location_sharing`) dan publikasi lokasi
--      (`publish_ride_location`) dengan validasi umur/akurasi/koordinat;
--   5. trigger yang menghapus lokasi saat consent mati, anggota keluar/dikeluarkan,
--      atau perjalanan selesai/dibatalkan.
--
-- Tidak ada policy INSERT/UPDATE langsung yang baru untuk `rides` maupun
-- `ride_members`; seluruh mutasi melewati RPC `security definer` dengan
-- `search_path = ''` dan grant hanya untuk `authenticated`.
--
-- Realtime: aplikasi menerima posisi lewat **Postgres Changes** pada
-- `public.ride_locations`, yang otomatis tunduk pada policy SELECT
-- `ride_locations_select_active_member`. Broadcast pada kanal privat Supabase
-- membutuhkan policy pada `realtime.messages`, dan tabel itu dimiliki
-- `supabase_realtime_admin` sehingga tidak dapat diubah lewat koneksi migration
-- project development (ADR-065). Jalur Postgres Changes tidak memperluas
-- akses: baris lokasi hanya terkirim bila policy SELECT mengizinkannya.
-- ============================================================================

-- 1. Buat perjalanan klub. Pembuat langsung menjadi host yang `joined`.
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

revoke all on function public.create_ride(uuid, text, timestamptz, text, text, text, text) from public;
revoke all on function public.create_ride(uuid, text, timestamptz, text, text, text, text) from anon;
grant execute on function public.create_ride(uuid, text, timestamptz, text, text, text, text) to authenticated;

-- 2. Ubah metadata perjalanan. Hanya host dan hanya sebelum perjalanan dimulai.
create or replace function public.update_ride(
  p_ride_id uuid,
  p_title text,
  p_description text default null,
  p_starts_at timestamptz default null,
  p_meeting_label text default null,
  p_destination_label text default null
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_ride public.rides;
begin
  if auth.uid() is null then
    raise exception 'mengubah perjalanan membutuhkan sesi' using errcode = '42501';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'perjalanan tidak ditemukan' using errcode = 'P0002';
  end if;

  if not public.is_ride_host(p_ride_id) then
    raise exception 'hanya host yang boleh mengubah perjalanan' using errcode = '42501';
  end if;

  if v_ride.status <> 'planned' then
    raise exception 'metadata hanya dapat diubah sebelum perjalanan dimulai' using errcode = '23514';
  end if;

  if char_length(v_title) < 3 or char_length(v_title) > 120 then
    raise exception 'judul perjalanan harus 3-120 karakter' using errcode = '22023';
  end if;

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'deskripsi perjalanan maksimal 2000 karakter' using errcode = '22023';
  end if;

  update public.rides
     set title = v_title,
         description = v_description,
         starts_at = p_starts_at,
         meeting_label = nullif(btrim(coalesce(p_meeting_label, '')), ''),
         destination_label = nullif(btrim(coalesce(p_destination_label, '')), ''),
         updated_at = now()
   where id = p_ride_id
   returning * into v_ride;

  return v_ride;
end;
$$;

revoke all on function public.update_ride(uuid, text, text, timestamptz, text, text) from public;
revoke all on function public.update_ride(uuid, text, text, timestamptz, text, text) from anon;
grant execute on function public.update_ride(uuid, text, text, timestamptz, text, text) to authenticated;

-- 3. Undang anggota klub. Target harus anggota aktif klub yang sama.
create or replace function public.invite_ride_member(p_ride_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_target_club uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'mengundang peserta membutuhkan sesi' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'peserta yang diundang tidak boleh kosong' using errcode = '22023';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'perjalanan tidak ditemukan' using errcode = 'P0002';
  end if;

  if not public.is_ride_host(p_ride_id) then
    raise exception 'hanya host yang boleh mengundang peserta' using errcode = '42501';
  end if;

  if v_ride.status not in ('planned', 'active') then
    raise exception 'perjalanan sudah final' using errcode = '23514';
  end if;

  select club_id into v_target_club
  from public.club_members
  where user_id = p_user_id
    and club_id = v_ride.club_id
    and status = 'active';

  if v_target_club is null or v_target_club is distinct from v_ride.club_id then
    raise exception 'peserta harus anggota aktif klub perjalanan ini' using errcode = '42501';
  end if;

  insert into public.ride_members (ride_id, user_id, role, status, sharing_location)
  values (p_ride_id, p_user_id, 'rider', 'invited', false)
  on conflict (ride_id, user_id) do update
    set status = case
                   when ride_members.status = 'joined' then 'joined'
                   else 'invited'
                 end,
        sharing_location = false,
        updated_at = now()
  returning status into v_status;

  return v_status;
end;
$$;

revoke all on function public.invite_ride_member(uuid, uuid) from public;
revoke all on function public.invite_ride_member(uuid, uuid) from anon;
grant execute on function public.invite_ride_member(uuid, uuid) to authenticated;

-- 4. Terima undangan. Hanya target undangan, dan klubnya harus masih aktif.
create or replace function public.accept_ride_invite(p_ride_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_member public.ride_members;
begin
  if v_uid is null then
    raise exception 'menerima undangan membutuhkan sesi' using errcode = '42501';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'perjalanan tidak ditemukan' using errcode = 'P0002';
  end if;

  if v_ride.status not in ('planned', 'active') then
    raise exception 'perjalanan sudah final' using errcode = '23514';
  end if;

  if not public.is_club_member(v_ride.club_id) then
    raise exception 'keanggotaan klub Anda tidak aktif' using errcode = '42501';
  end if;

  select * into v_member
  from public.ride_members
  where ride_id = p_ride_id and user_id = v_uid
  for update;

  if not found or v_member.status <> 'invited' then
    raise exception 'tidak ada undangan aktif untuk akun ini' using errcode = '42501';
  end if;

  update public.ride_members
     set status = 'joined',
         joined_at = now(),
         sharing_location = false,
         updated_at = now()
   where ride_id = p_ride_id and user_id = v_uid;

  return 'joined';
end;
$$;

revoke all on function public.accept_ride_invite(uuid) from public;
revoke all on function public.accept_ride_invite(uuid) from anon;
grant execute on function public.accept_ride_invite(uuid) to authenticated;

-- 5. Gabung sendiri. `invite_only` wajib lewat undangan; consent tidak disentuh.
create or replace function public.join_ride(p_ride_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_member public.ride_members;
begin
  if v_uid is null then
    raise exception 'bergabung membutuhkan sesi' using errcode = '42501';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'perjalanan tidak ditemukan' using errcode = 'P0002';
  end if;

  if v_ride.status not in ('planned', 'active') then
    raise exception 'perjalanan sudah final' using errcode = '23514';
  end if;

  if v_ride.club_id is null or not public.is_club_member(v_ride.club_id) then
    raise exception 'hanya anggota aktif klub yang boleh bergabung' using errcode = '42501';
  end if;

  select * into v_member
  from public.ride_members
  where ride_id = p_ride_id and user_id = v_uid
  for update;

  if found and v_member.status = 'joined' then
    return 'joined';
  end if;

  if found and v_member.status = 'invited' then
    update public.ride_members
       set status = 'joined',
           joined_at = coalesce(joined_at, now()),
           sharing_location = false,
           updated_at = now()
     where ride_id = p_ride_id and user_id = v_uid;
    return 'joined';
  end if;

  if v_ride.visibility = 'invite_only' then
    raise exception 'perjalanan ini hanya dapat diikuti lewat undangan' using errcode = '42501';
  end if;

  insert into public.ride_members (ride_id, user_id, role, status, joined_at, sharing_location)
  values (p_ride_id, v_uid, 'rider', 'joined', now(), false)
  on conflict (ride_id, user_id) do update
    set status = 'joined',
        joined_at = coalesce(public.ride_members.joined_at, now()),
        sharing_location = false,
        updated_at = now();

  return 'joined';
end;
$$;

revoke all on function public.join_ride(uuid) from public;
revoke all on function public.join_ride(uuid) from anon;
grant execute on function public.join_ride(uuid) to authenticated;

-- 6. Keluar. Host tidak boleh meninggalkan perjalanan yang belum final.
create or replace function public.leave_ride(p_ride_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_member public.ride_members;
begin
  if v_uid is null then
    raise exception 'keluar perjalanan membutuhkan sesi' using errcode = '42501';
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
    raise exception 'akun ini bukan peserta aktif perjalanan' using errcode = '42501';
  end if;

  if v_member.role = 'host' and v_ride.status in ('planned', 'active') then
    raise exception 'host harus menyelesaikan atau membatalkan perjalanan sebelum keluar'
      using errcode = '23514';
  end if;

  update public.ride_members
     set status = 'left',
         sharing_location = false,
         updated_at = now()
   where ride_id = p_ride_id and user_id = v_uid;

  return 'left';
end;
$$;

revoke all on function public.leave_ride(uuid) from public;
revoke all on function public.leave_ride(uuid) from anon;
grant execute on function public.leave_ride(uuid) to authenticated;

-- 7. Keluarkan peserta. Hanya host; host tidak dapat mengeluarkan dirinya sendiri.
create or replace function public.remove_ride_member(p_ride_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_target public.ride_members;
begin
  if v_uid is null then
    raise exception 'mengeluarkan peserta membutuhkan sesi' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'peserta yang dikeluarkan tidak boleh kosong' using errcode = '22023';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'perjalanan tidak ditemukan' using errcode = 'P0002';
  end if;

  if not public.is_ride_host(p_ride_id) then
    raise exception 'hanya host yang boleh mengeluarkan peserta' using errcode = '42501';
  end if;

  if p_user_id = v_uid then
    raise exception 'host tidak dapat mengeluarkan dirinya sendiri' using errcode = '22023';
  end if;

  select * into v_target
  from public.ride_members
  where ride_id = p_ride_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'peserta tidak ditemukan di perjalanan ini' using errcode = 'P0002';
  end if;

  if v_target.role = 'host' then
    raise exception 'host tidak dapat dikeluarkan' using errcode = '22023';
  end if;

  update public.ride_members
     set status = 'removed',
         sharing_location = false,
         updated_at = now()
   where ride_id = p_ride_id and user_id = p_user_id;

  return 'removed';
end;
$$;

revoke all on function public.remove_ride_member(uuid, uuid) from public;
revoke all on function public.remove_ride_member(uuid, uuid) from anon;
grant execute on function public.remove_ride_member(uuid, uuid) to authenticated;

-- 8. State machine. `planned -> active -> completed`, `cancelled` dari keduanya.
--    `completed`/`cancelled` final; hanya host yang boleh memindahkan status.
create or replace function public.transition_ride(p_ride_id uuid, p_next text)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
begin
  if auth.uid() is null then
    raise exception 'transisi perjalanan membutuhkan sesi' using errcode = '42501';
  end if;

  if p_next is null or p_next not in ('active', 'completed', 'cancelled') then
    raise exception 'status tujuan tidak dikenal: %', p_next using errcode = '22023';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'perjalanan tidak ditemukan' using errcode = 'P0002';
  end if;

  if not public.is_ride_host(p_ride_id) then
    raise exception 'hanya host yang boleh mengubah status perjalanan' using errcode = '42501';
  end if;

  if v_ride.status in ('completed', 'cancelled') then
    raise exception 'perjalanan sudah final (%)', v_ride.status using errcode = '23514';
  end if;

  if not (
    (v_ride.status = 'planned' and p_next in ('active', 'cancelled'))
    or (v_ride.status = 'active' and p_next in ('completed', 'cancelled'))
  ) then
    raise exception 'transisi % -> % tidak diizinkan', v_ride.status, p_next using errcode = '23514';
  end if;

  update public.rides
     set status = p_next,
         started_at = case
                        when p_next = 'active' then coalesce(started_at, now())
                        else started_at
                      end,
         ended_at = case
                      when p_next in ('completed', 'cancelled') then now()
                      else ended_at
                    end,
         updated_at = now()
   where id = p_ride_id
   returning * into v_ride;

  return v_ride;
end;
$$;

revoke all on function public.transition_ride(uuid, text) from public;
revoke all on function public.transition_ride(uuid, text) from anon;
grant execute on function public.transition_ride(uuid, text) to authenticated;

-- 9. Consent per perjalanan. Satu-satunya jalur menyalakan berbagi.
create or replace function public.set_ride_location_sharing(
  p_ride_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.ride_members;
  v_ride public.rides;
begin
  if v_uid is null then
    raise exception 'berbagi lokasi membutuhkan sesi' using errcode = '42501';
  end if;

  if p_enabled is null then
    raise exception 'nilai berbagi lokasi tidak boleh null' using errcode = '22023';
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

  if v_ride.status in ('completed', 'cancelled') then
    raise exception 'perjalanan sudah selesai' using errcode = '23514';
  end if;

  if p_enabled and v_ride.status <> 'active' then
    raise exception 'berbagi lokasi hanya dapat dinyalakan saat perjalanan aktif'
      using errcode = '23514';
  end if;

  update public.ride_members
     set sharing_location = p_enabled,
         updated_at = now()
   where ride_id = p_ride_id and user_id = v_uid;

  return p_enabled;
end;
$$;

revoke all on function public.set_ride_location_sharing(uuid, boolean) from public;
revoke all on function public.set_ride_location_sharing(uuid, boolean) from anon;
grant execute on function public.set_ride_location_sharing(uuid, boolean) to authenticated;

-- 10. Publikasi lokasi terakhir. Klien tidak lagi menulis tabel langsung.
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

  return v_location;
end;
$$;

revoke all on function public.publish_ride_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) from public;
revoke all on function public.publish_ride_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) from anon;
grant execute on function public.publish_ride_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) to authenticated;

-- 11. Klien tidak menulis `ride_locations` langsung; semua lewat
--     `publish_ride_location`, sehingga validasi umur/koordinat tidak bisa
--     dilewati dengan REST biasa. Baca dan hapus baris sendiri tetap diizinkan
--     oleh policy yang sudah ada.
drop policy if exists "ride_locations_insert_active_sharer" on public.ride_locations;
drop policy if exists "ride_locations_update_active_sharer" on public.ride_locations;
revoke insert, update on public.ride_locations from authenticated;
revoke insert, update on public.ride_locations from anon;

-- 12. Consent mati atau anggota keluar/dikeluarkan = lokasi terakhirnya dihapus.
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
  end if;
  return new;
end;
$$;

drop trigger if exists ride_members_clear_location on public.ride_members;
create trigger ride_members_clear_location
after update of sharing_location, status on public.ride_members
for each row execute function public.clear_ride_location_on_opt_out();

-- 13. Perjalanan final = seluruh lokasi dihapus dan consent dimatikan.
create or replace function public.clear_ride_locations_on_finish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed', 'cancelled')
     and new.status is distinct from old.status then
    delete from public.ride_locations where ride_id = new.id;
    update public.ride_members
       set sharing_location = false,
           updated_at = now()
     where ride_id = new.id and sharing_location = true;
  end if;
  return new;
end;
$$;

drop trigger if exists rides_clear_locations on public.rides;
create trigger rides_clear_locations
after update of status on public.rides
for each row execute function public.clear_ride_locations_on_finish();

