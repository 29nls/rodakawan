-- ============================================================================
-- DRAFT — Milestone 3: transisi status perjalanan dan pembersihan lokasi.
--
-- BERKAS INI BUKAN MIGRATION DAN TIDAK BOLEH DITERAPKAN SEKARANG.
-- Letaknya sengaja di `supabase/drafts/`, bukan `supabase/migrations/`, supaya
-- `npx supabase db push` tidak pernah melihatnya. Pindahkan ke
-- `supabase/migrations/<timestamp>_ride_state_consent.sql` HANYA setelah:
--   1. gerbang uji perangkat fisik Milestone 2 lulus, dan
--   2. uji di `supabase/tests/drafts/rls_rides_m3_draft.sql` dijalankan di
--      database scratch/development sampai hijau.
--
-- Yang ditambahkan draf ini (skema dasar `rides`, `ride_members`, dan
-- `ride_locations` sudah ada sejak migration awal):
--   - RPC `transition_ride` yang menegakkan state machine di database;
--   - RPC `set_ride_location_sharing` untuk consent per perjalanan;
--   - trigger yang menghapus lokasi saat consent dimatikan, anggota keluar,
--     atau perjalanan selesai/dibatalkan.
--
-- Tidak ada tabel atau policy baru di sini. Policy `ride_locations` yang sudah
-- ada tetap menjadi penjaga baca/tulis; draf ini hanya menambah jalur mutasi
-- yang aman dan pembersihan yang tidak bisa dilakukan klien.
-- ============================================================================

-- 1. State machine: hanya host yang boleh memindahkan status, dan status final
--    tidak bisa dibuka kembali.
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

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

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
         started_at = case when p_next = 'active' then coalesce(started_at, now()) else started_at end,
         ended_at = case when p_next in ('completed', 'cancelled') then now() else ended_at end
   where id = p_ride_id
   returning * into v_ride;

  return v_ride;
end;
$$;

revoke all on function public.transition_ride(uuid, text) from public;
revoke all on function public.transition_ride(uuid, text) from anon;
grant execute on function public.transition_ride(uuid, text) to authenticated;

-- 2. Consent per perjalanan. Ini satu-satunya jalur bagi klien untuk mengubah
--    `ride_members.sharing_location`; tidak ada policy UPDATE langsung.
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
begin
  if v_uid is null then
    raise exception 'berbagi lokasi membutuhkan sesi' using errcode = '42501';
  end if;

  if p_enabled is null then
    raise exception 'nilai berbagi lokasi tidak boleh null' using errcode = '22023';
  end if;

  select * into v_member
  from public.ride_members
  where ride_id = p_ride_id and user_id = v_uid
  for update;

  if not found or v_member.status <> 'joined' then
    raise exception 'bukan anggota aktif perjalanan ini' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.rides
    where id = p_ride_id and status in ('completed', 'cancelled')
  ) then
    raise exception 'perjalanan sudah selesai' using errcode = '23514';
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

-- 3. Consent mati atau anggota keluar/removed = lokasi terakhirnya dihapus.
--    Tanpa trigger ini, baris lama tetap ada dan bisa dibaca host setelah
--    anggota berhenti berbagi.
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

-- 4. Perjalanan selesai/dibatalkan = seluruh lokasi perjalanan dihapus.
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
  end if;
  return new;
end;
$$;

drop trigger if exists rides_clear_locations on public.rides;
create trigger rides_clear_locations
after update of status on public.rides
for each row execute function public.clear_ride_locations_on_finish();
