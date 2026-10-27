-- ============================================================================
-- Serialisasi throttle pembuatan klub/perjalanan (lanjutan AUD-14).
--
-- `public.create_club` dan `public.create_ride` menghitung kuota lalu menulis
-- baris baru. Tanpa penguncian, dua permintaan bersamaan dari akun yang sama
-- dapat sama-sama membaca "9 baris dalam satu jam" dan sama-sama lolos,
-- sehingga kuota 10/jam terlewati.
--
-- Migration ini menambahkan trigger BEFORE INSERT pada `clubs` dan `rides`
-- yang mengambil advisory lock per (tabel, pengguna) sebelum menghitung ulang
-- kuota. Permintaan kedua menunggu sampai transaksi pertama selesai, lalu
-- melihat baris yang sudah ter-commit dan ditolak. Lock transaksional otomatis
-- dilepas saat COMMIT/ROLLBACK, jadi tidak ada lock yang tertinggal.
--
-- Sifat aditif: fungsi `create_club`/`create_ride` yang sudah diterapkan tidak
-- diubah. Trigger tetap menjadi otoritas terakhir bila ada jalur insert lain.
-- Pemanggilan tanpa sesi (service_role, `auth.uid()` null) tidak dibatasi
-- karena bukan jalur pengguna.
-- ============================================================================

-- 1. Throttle klub: maksimal 10 klub baru per jam per pembuat.
create or replace function public.enforce_club_create_throttle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_recent int;
begin
  -- Jalur administratif/service_role tidak memakai kuota pengguna.
  if v_uid is null then
    return new;
  end if;

  -- Kunci per pengguna, namespace tabel berbeda agar klub dan ride tidak
  -- saling memblokir. Nilai hash boleh bertabrakan: akibatnya hanya dua
  -- pengguna berbeda ikut terserialisasi, bukan kuota yang salah.
  perform pg_advisory_xact_lock(hashtextextended('clubs:' || v_uid::text, 0));

  select count(*)
    into v_recent
    from public.clubs c
   where c.created_by = v_uid
     and c.created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'Terlalu banyak klub dibuat dalam satu jam. Coba lagi nanti.'
      using errcode = 'P0001', detail = 'club_create_rate_limit';
  end if;

  return new;
end;
$$;

comment on function public.enforce_club_create_throttle() is
  'SECURITY DEFINER: trigger BEFORE INSERT; serialisasi + batas 10 klub/jam per pengguna (AUD-14).';

revoke all on function public.enforce_club_create_throttle() from public, anon, authenticated;

drop trigger if exists clubs_enforce_create_throttle on public.clubs;
create trigger clubs_enforce_create_throttle
before insert on public.clubs
for each row execute function public.enforce_club_create_throttle();

-- 2. Throttle perjalanan: maksimal 10 ride baru per jam per pembuat.
create or replace function public.enforce_ride_create_throttle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_recent int;
begin
  if v_uid is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rides:' || v_uid::text, 0));

  select count(*)
    into v_recent
    from public.rides r
   where r.created_by = v_uid
     and r.created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'Terlalu banyak perjalanan dibuat dalam satu jam. Coba lagi nanti.'
      using errcode = 'P0001', detail = 'ride_create_rate_limit';
  end if;

  return new;
end;
$$;

comment on function public.enforce_ride_create_throttle() is
  'SECURITY DEFINER: trigger BEFORE INSERT; serialisasi + batas 10 ride/jam per pengguna (AUD-14).';

revoke all on function public.enforce_ride_create_throttle() from public, anon, authenticated;

drop trigger if exists rides_enforce_create_throttle on public.rides;
create trigger rides_enforce_create_throttle
before insert on public.rides
for each row execute function public.enforce_ride_create_throttle();
