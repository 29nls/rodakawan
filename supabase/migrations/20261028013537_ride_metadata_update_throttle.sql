-- Throttle perubahan metadata perjalanan (AUD-14).
--
-- `update_ride` sebelumnya membatasi host pada ride berstatus planned, tetapi
-- tidak membatasi frekuensi perubahan. Karena endpoint ini adalah SECURITY
-- DEFINER yang dapat dipanggil berulang melalui RPC, terapkan batas pada
-- transaksi tulis yang sama. Batas 20 perubahan per perjalanan per pengguna
-- dalam 10 menit longgar untuk koreksi jadwal, tetapi menghentikan pembanjiran.
--
-- Perubahan dihitung di trigger BEFORE UPDATE dalam transaksi yang sama. Lock
-- advisory per (ride, pengguna) menserialisasi update bersamaan; transaksi yang
-- ditolak rollback, termasuk perubahan baris rides. Identitas berasal dari
-- auth.uid(), bukan payload. Jalur administratif tanpa sesi tidak dibatasi.
-- Migration aditif; migration yang sudah diterapkan tidak diubah.

create table if not exists public.ride_update_throttle_windows (
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null,
  window_started_at timestamptz not null,
  update_count integer not null check (update_count > 0),
  primary key (ride_id, user_id)
);

alter table public.ride_update_throttle_windows enable row level security;
revoke all on table public.ride_update_throttle_windows from public, anon, authenticated;

create or replace function public.enforce_ride_update_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_window public.ride_update_throttle_windows;
begin
  if v_uid is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ride-update:' || new.id::text || ':' || v_uid::text, 0)
  );

  select *
    into v_window
    from public.ride_update_throttle_windows w
   where w.ride_id = new.id
     and w.user_id = v_uid
   for update;

  if not found or v_window.window_started_at <= now() - interval '10 minutes' then
    insert into public.ride_update_throttle_windows (
      ride_id, user_id, window_started_at, update_count
    ) values (new.id, v_uid, now(), 1)
    on conflict (ride_id, user_id) do update
      set window_started_at = excluded.window_started_at,
          update_count = excluded.update_count;
    return new;
  end if;

  if v_window.update_count >= 20 then
    raise exception 'Terlalu banyak perubahan perjalanan dalam waktu singkat. Tunggu beberapa menit, lalu coba lagi.'
      using errcode = 'P0001', detail = 'ride_update_rate_limit';
  end if;

  update public.ride_update_throttle_windows
     set update_count = update_count + 1
   where ride_id = new.id
     and user_id = v_uid;

  return new;
end;
$$;

comment on function public.enforce_ride_update_rate_limit() is
  'BEFORE UPDATE public.rides: maksimal 20 perubahan metadata per perjalanan per pengguna tiap 10 menit (AUD-14).';

revoke all on function public.enforce_ride_update_rate_limit() from public, anon, authenticated;

drop trigger if exists rides_update_rate_limit on public.rides;
create trigger rides_update_rate_limit
  before update of title, description, starts_at, meeting_label, destination_label
  on public.rides
  for each row
  when (
    old.title is distinct from new.title
    or old.description is distinct from new.description
    or old.starts_at is distinct from new.starts_at
    or old.meeting_label is distinct from new.meeting_label
    or old.destination_label is distinct from new.destination_label
  )
  execute function public.enforce_ride_update_rate_limit();
