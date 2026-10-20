-- ============================================================================
-- RodaKawan — Milestone 4 (bagian A): laporan bahaya jalan.
--
-- Skema dasar `public.hazard_reports` sudah ada sejak
-- `20261013022938_initial_schema.sql` (kategori, severity, koordinat, status,
-- expiry, `ride_id` konteks opsional). Migration ini **tidak** membuat tabel
-- laporan baru dan tidak mengubah CHECK yang sudah ada.
--
-- Yang ditambahkan (aditif + pengetatan jalur tulis):
--   1. kolom idempotency `client_report_id` + unique index
--      `(reporter_id, client_report_id)` — retry setelah jaringan putus tidak
--      membuat laporan ganda;
--   2. tabel `public.hazard_confirmations` (konfirmasi "masih ada", satu baris
--      per pengguna per laporan, tidak bisa dicabut);
--   3. kebijakan masa berlaku per kategori sebagai **fungsi server**
--      `hazard_expiry_seconds` — angka versi kebijakan produk yang tercatat di
--      ADR-066, dapat diubah lewat migration berikutnya;
--   4. trigger `before insert/update` yang menghitung ulang `expires_at` dari
--      `created_at` dan membuatnya tidak berubah sesudahnya, sehingga nilai
--      expiry yang dikirim klien tidak pernah dipercaya;
--   5. RPC `create_hazard`, `update_hazard`, `remove_hazard`, `confirm_hazard`,
--      dan `expire_hazard_reports` — seluruh validasi, rate limit, deteksi
--      duplikat, dan status transisi ada di database (bukan hanya di UI);
--   6. pencabutan INSERT/UPDATE/DELETE langsung pada `hazard_reports` dan
--      pembuatan `hazard_confirmations`, plus pemusnahan policy
--      `hazards_insert_self` (ADR-066): meniru keputusan ADR-065 untuk
--      `ride_locations`. Dengan jalur tulis langsung terbuka, rate limit dan
--      aturan expiry bisa dilewati lewat REST biasa.
--
-- Kebijakan baca tidak berubah: policy `hazards_select_current_or_reporter`
-- tetap menjadi satu-satunya jalur baca, sehingga laporan kedaluwarsa/dihapus
-- tidak pernah terlihat sebagai aktif. Daftar pengecualian pagar ADR-060 di
-- `supabase/tests/rls_policy_guard_test.sql` ikut diperbarui (empat → dua).
--
-- Setiap pesan galat memakai `detail = '<tag>'` sebagai kontrak mesin yang
-- dipetakan aplikasi ke `AppError` (lihat `src/features/hazards/errors.ts`);
-- teks pesan sendiri sudah Bahasa Indonesia yang bisa ditindaklanjuti.
-- ============================================================================

-- 1. Idempotency key per pelapor. Unique index parsial: banyak baris NULL
--    (laporan yang dibuat sebelum migration) tetap sah.
alter table public.hazard_reports
  add column if not exists client_report_id uuid;

create unique index if not exists hazard_reports_reporter_client_uidx
  on public.hazard_reports(reporter_id, client_report_id)
  where client_report_id is not null;

-- Index untuk deteksi duplikat (kategori + waktu) dan pencarian radius.
create index if not exists hazard_reports_category_created_idx
  on public.hazard_reports(category, created_at desc);

-- 2. Konfirmasi "masih ada". Satu baris per pengguna per laporan; sengaja tanpa
--    UPDATE dan tanpa DELETE: konfirmasi tidak dicabut dan tidak memperpanjang
--    `expires_at` (keputusan produk, MILESTONE_4_PLAN bagian 2.1).
create table if not exists public.hazard_confirmations (
  hazard_id uuid not null references public.hazard_reports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (hazard_id, user_id)
);

create index if not exists hazard_confirmations_user_created_idx
  on public.hazard_confirmations(user_id, created_at desc);

alter table public.hazard_confirmations enable row level security;

-- Baca: baris konfirmasi laporan yang masih aktif (untuk menampilkan jumlah),
-- atau baris milik sendiri (untuk menandai "sudah dikonfirmasi") walaupun
-- laporannya sudah tidak aktif. Tidak ada policy INSERT/UPDATE/DELETE:
-- seluruh tulis lewat `confirm_hazard`, sehingga batas 10 konfirmasi/jam/pengguna
-- tidak bisa dilewati.
drop policy if exists "hazard_confirmations_select_active_or_own" on public.hazard_confirmations;
create policy "hazard_confirmations_select_active_or_own" on public.hazard_confirmations
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.hazard_reports h
      where h.id = hazard_confirmations.hazard_id
        and h.status = 'active'
        and h.expires_at > now()
    )
  );

revoke insert, update, delete on public.hazard_confirmations from authenticated, anon;

-- 3. Kebijakan masa berlaku per kategori (detik), dihitung server dari
--    `created_at`. Versi kebijakan: ADR-066. Jangan mengubah angka ini tanpa
--    ADR baru; tambahkan migration tersendiri bila kebijakan berubah.
create or replace function public.hazard_expiry_seconds(p_category text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case btrim(coalesce(p_category, ''))
    when 'traffic' then 3600
    when 'crash' then 7200
    when 'traffic_enforcement' then 7200
    when 'road_block' then 14400
    when 'weather' then 10800
    when 'flood' then 21600
    when 'pothole' then 86400
    else 7200
  end::integer;
$$;

revoke all on function public.hazard_expiry_seconds(text) from public;
revoke all on function public.hazard_expiry_seconds(text) from anon;
revoke all on function public.hazard_expiry_seconds(text) from authenticated;

-- 4. `expires_at` dihitung server pada INSERT dan tidak berubah sesudahnya.
--    Trigger ini adalah jaring pengaman kedua: walaupun kelak ada jalur tulis
--    lain, klien tidak pernah menentukan masa berlaku.
create or replace function public.hazard_reports_server_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.expires_at := new.created_at
      + make_interval(secs => public.hazard_expiry_seconds(new.category));
    return new;
  end if;

  if new.expires_at is distinct from old.expires_at then
    raise exception 'masa berlaku laporan dihitung server dan tidak dapat diubah'
      using errcode = '42501', detail = 'hazard_expiry_immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists hazard_reports_expiry_guard on public.hazard_reports;
create trigger hazard_reports_expiry_guard
before insert or update of expires_at on public.hazard_reports
for each row execute function public.hazard_reports_server_expiry();

revoke all on function public.hazard_reports_server_expiry() from public;
revoke all on function public.hazard_reports_server_expiry() from anon;
revoke all on function public.hazard_reports_server_expiry() from authenticated;

-- 5. RPC tulis. Semua `security definer` + `search_path = ''`, grant hanya
--    `authenticated`, dengan `reporter_id`/`sender` selalu diambil dari
--    `auth.uid()` — klien tidak pernah mengirim identitas pelapor.

-- 5a. Buat laporan. Urutan pemeriksaan disengaja: sesi → validasi → idempotency
--     (retry mengembalikan baris yang sudah ada, bukan galat) → rate limit
--     5 laporan / 10 menit / pelapor → duplikat 50 m / 10 menit / kategori.
create or replace function public.create_hazard(
  p_category text,
  p_severity text,
  p_latitude double precision,
  p_longitude double precision,
  p_description text default null,
  p_ride_id uuid default null,
  p_client_report_id uuid default null
)
returns public.hazard_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_category text := btrim(coalesce(p_category, ''));
  v_severity text := btrim(coalesce(p_severity, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_existing public.hazard_reports;
  v_hazard public.hazard_reports;
  v_recent int;
  v_duplicate uuid;
  -- Radius deteksi duplikat (meter) dan jendela waktu (menit) — ADR-066.
  v_dup_radius_m constant double precision := 50;
  v_dup_window constant interval := interval '10 minutes';
begin
  if v_uid is null then
    raise exception 'mengirim laporan bahaya membutuhkan sesi'
      using errcode = '42501', detail = 'hazard_unauthenticated';
  end if;

  if v_category not in (
    'pothole', 'crash', 'traffic', 'weather', 'flood', 'road_block',
    'traffic_enforcement', 'other'
  ) then
    raise exception 'kategori laporan tidak dikenal: %', v_category
      using errcode = '22023', detail = 'hazard_invalid_category';
  end if;

  if v_severity not in ('info', 'moderate', 'high', 'critical') then
    raise exception 'tingkat keparahan tidak dikenal: %', v_severity
      using errcode = '22023', detail = 'hazard_invalid_severity';
  end if;

  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then
    raise exception 'lintang laporan tidak valid'
      using errcode = '22023', detail = 'hazard_invalid_coordinates';
  end if;

  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'bujur laporan tidak valid'
      using errcode = '22023', detail = 'hazard_invalid_coordinates';
  end if;

  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'deskripsi laporan maksimal 1000 karakter'
      using errcode = '22023', detail = 'hazard_invalid_description';
  end if;

  -- Konteks perjalanan bersifat opsional; bila diisi, pelapor harus memang
  -- pesertanya supaya `ride_id` tidak bisa dipakai menautkan laporan sembarangan.
  if p_ride_id is not null then
    if not exists (select 1 from public.rides where id = p_ride_id) then
      raise exception 'perjalanan untuk laporan ini tidak ditemukan'
        using errcode = 'P0002', detail = 'hazard_ride_not_found';
    end if;

    if not public.is_ride_member(p_ride_id) then
      raise exception 'hanya peserta perjalanan yang dapat menautkan laporan ke perjalanan itu'
        using errcode = '42501', detail = 'hazard_ride_not_member';
    end if;
  end if;

  if p_client_report_id is not null then
    select * into v_existing
      from public.hazard_reports
     where reporter_id = v_uid
       and client_report_id = p_client_report_id;

    if found then
      return v_existing;
    end if;
  end if;

  select count(*) into v_recent
    from public.hazard_reports
   where reporter_id = v_uid
     and created_at >= now() - interval '10 minutes';

  if v_recent >= 5 then
    raise exception 'Terlalu banyak laporan dalam waktu singkat. Coba lagi nanti.'
      using errcode = 'P0001', detail = 'hazard_rate_limit';
  end if;

  -- Prefilter kotak + haversine (tanpa PostGIS) untuk radius ±50 m.
  -- Laporan yang sudah lewat `expires_at` tetapi belum tersapu tidak boleh
  -- memblokir laporan baru sebagai "duplikat": kondisinya sudah tidak berlaku.
  select id into v_duplicate
    from public.hazard_reports
   where category = v_category
     and status = 'active'
     and expires_at > now()
     and created_at >= now() - v_dup_window
     and abs(latitude - p_latitude) <= v_dup_radius_m / 111320.0
     and abs(longitude - p_longitude)
         <= v_dup_radius_m / greatest(111320.0 * cos(radians(p_latitude)), 1.0)
     and (2 * 6371000 * asin(least(1.0, sqrt(
           sin(radians(latitude - p_latitude) / 2) * sin(radians(latitude - p_latitude) / 2)
           + cos(radians(latitude)) * cos(radians(p_latitude))
             * sin(radians(longitude - p_longitude) / 2) * sin(radians(longitude - p_longitude) / 2)
         )))) <= v_dup_radius_m
   limit 1;

  if v_duplicate is not null then
    raise exception 'Laporan serupa baru saja dikirim di sekitar titik ini.'
      using errcode = '23505', detail = 'hazard_duplicate_nearby';
  end if;

  begin
    insert into public.hazard_reports (
      reporter_id,
      ride_id,
      category,
      description,
      severity,
      latitude,
      longitude,
      expires_at,
      client_report_id
    )
    values (
      v_uid,
      p_ride_id,
      v_category,
      v_description,
      v_severity,
      p_latitude,
      p_longitude,
      now() + make_interval(secs => public.hazard_expiry_seconds(v_category)),
      p_client_report_id
    )
    returning * into v_hazard;
  exception when unique_violation then
    -- Balapan retry: baris sudah dibuat sesi sendiri yang lain.
    if p_client_report_id is not null then
      select * into v_existing
        from public.hazard_reports
       where reporter_id = v_uid
         and client_report_id = p_client_report_id;

      if found then
        return v_existing;
      end if;
    end if;

    raise;
  end;

  return v_hazard;
end;
$$;

revoke all on function public.create_hazard(text, text, double precision, double precision, text, uuid, uuid) from public;
revoke all on function public.create_hazard(text, text, double precision, double precision, text, uuid, uuid) from anon;
grant execute on function public.create_hazard(text, text, double precision, double precision, text, uuid, uuid) to authenticated;

-- 5b. Ubah deskripsi/keparahan. Hanya pelapor, hanya laporan `active`, hanya
--     dalam 15 menit sejak `created_at` (MILESTONE_4_PLAN bagian 2.1).
create or replace function public.update_hazard(
  p_hazard_id uuid,
  p_severity text,
  p_description text default null
)
returns public.hazard_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_severity text := btrim(coalesce(p_severity, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_hazard public.hazard_reports;
begin
  if v_uid is null then
    raise exception 'mengubah laporan membutuhkan sesi'
      using errcode = '42501', detail = 'hazard_unauthenticated';
  end if;

  if v_severity not in ('info', 'moderate', 'high', 'critical') then
    raise exception 'tingkat keparahan tidak dikenal: %', v_severity
      using errcode = '22023', detail = 'hazard_invalid_severity';
  end if;

  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'deskripsi laporan maksimal 1000 karakter'
      using errcode = '22023', detail = 'hazard_invalid_description';
  end if;

  select * into v_hazard
    from public.hazard_reports
   where id = p_hazard_id
   for update;

  if not found then
    raise exception 'laporan tidak ditemukan'
      using errcode = 'P0002', detail = 'hazard_not_found';
  end if;

  if v_hazard.reporter_id <> v_uid then
    raise exception 'hanya pelapor yang dapat mengubah laporannya'
      using errcode = '42501', detail = 'hazard_not_reporter';
  end if;

  if v_hazard.status <> 'active' then
    raise exception 'laporan ini sudah tidak aktif'
      using errcode = '23514', detail = 'hazard_not_active';
  end if;

  if v_hazard.created_at < now() - interval '15 minutes' then
    raise exception 'jendela pengubahan laporan sudah lewat (15 menit sejak dilaporkan)'
      using errcode = '23514', detail = 'hazard_edit_window';
  end if;

  update public.hazard_reports
     set severity = v_severity,
         description = v_description,
         updated_at = now()
   where id = p_hazard_id
   returning * into v_hazard;

  return v_hazard;
end;
$$;

revoke all on function public.update_hazard(uuid, text, text) from public;
revoke all on function public.update_hazard(uuid, text, text) from anon;
grant execute on function public.update_hazard(uuid, text, text) to authenticated;

-- 5c. Lepas laporan. Transisi status `removed` (soft delete), baris tidak
--     dihapus. Pelapor dalam jendela 15 menit; moderasi atas laporan orang lain
--     sengaja tidak diberi RPC karena peran moderator global belum ada
--     (MILESTONE_4_PLAN bagian 8, ADR-066) — jalurnya dashboard admin.
create or replace function public.remove_hazard(p_hazard_id uuid)
returns public.hazard_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hazard public.hazard_reports;
begin
  if v_uid is null then
    raise exception 'menghapus laporan membutuhkan sesi'
      using errcode = '42501', detail = 'hazard_unauthenticated';
  end if;

  select * into v_hazard
    from public.hazard_reports
   where id = p_hazard_id
   for update;

  if not found then
    raise exception 'laporan tidak ditemukan'
      using errcode = 'P0002', detail = 'hazard_not_found';
  end if;

  if v_hazard.reporter_id <> v_uid then
    raise exception 'hanya pelapor yang dapat melepas laporannya'
      using errcode = '42501', detail = 'hazard_not_reporter';
  end if;

  if v_hazard.status <> 'active' then
    raise exception 'laporan ini sudah tidak aktif'
      using errcode = '23514', detail = 'hazard_not_active';
  end if;

  if v_hazard.created_at < now() - interval '15 minutes' then
    raise exception 'jendela penghapusan laporan sudah lewat (15 menit sejak dilaporkan)'
      using errcode = '23514', detail = 'hazard_edit_window';
  end if;

  update public.hazard_reports
     set status = 'removed',
         updated_at = now()
   where id = p_hazard_id
   returning * into v_hazard;

  return v_hazard;
end;
$$;

revoke all on function public.remove_hazard(uuid) from public;
revoke all on function public.remove_hazard(uuid) from anon;
grant execute on function public.remove_hazard(uuid) to authenticated;

-- 5d. Konfirmasi "masih ada". Laporan harus `active` dan belum lewat
--     `expires_at`; satu konfirmasi per pengguna per laporan (duplikat → 23505);
--     batas 10 konfirmasi per jam per pengguna. Mengembalikan jumlah konfirmasi
--     laporan itu setelah operasi.
create or replace function public.confirm_hazard(p_hazard_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hazard public.hazard_reports;
  v_rate int;
  v_inserted int;
  v_total int;
begin
  if v_uid is null then
    raise exception 'mengonfirmasi laporan membutuhkan sesi'
      using errcode = '42501', detail = 'hazard_unauthenticated';
  end if;

  select * into v_hazard
    from public.hazard_reports
   where id = p_hazard_id
   for update;

  if not found then
    raise exception 'laporan tidak ditemukan'
      using errcode = 'P0002', detail = 'hazard_not_found';
  end if;

  if v_hazard.status <> 'active' then
    raise exception 'laporan ini sudah tidak aktif'
      using errcode = '23514', detail = 'hazard_not_active';
  end if;

  if v_hazard.expires_at <= now() then
    raise exception 'laporan ini sudah kedaluwarsa'
      using errcode = '23514', detail = 'hazard_expired';
  end if;

  if exists (
    select 1 from public.hazard_confirmations
     where hazard_id = p_hazard_id and user_id = v_uid
  ) then
    raise exception 'Anda sudah mengonfirmasi laporan ini'
      using errcode = '23505', detail = 'hazard_already_confirmed';
  end if;

  select count(*) into v_rate
    from public.hazard_confirmations
   where user_id = v_uid
     and created_at >= now() - interval '1 hour';

  if v_rate >= 10 then
    raise exception 'Terlalu banyak konfirmasi dalam waktu singkat. Coba lagi nanti.'
      using errcode = 'P0001', detail = 'hazard_confirm_rate_limit';
  end if;

  insert into public.hazard_confirmations (hazard_id, user_id)
  values (p_hazard_id, v_uid)
  on conflict (hazard_id, user_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    raise exception 'Anda sudah mengonfirmasi laporan ini'
      using errcode = '23505', detail = 'hazard_already_confirmed';
  end if;

  select count(*) into v_total
    from public.hazard_confirmations
   where hazard_id = p_hazard_id;

  return v_total;
end;
$$;

revoke all on function public.confirm_hazard(uuid) from public;
revoke all on function public.confirm_hazard(uuid) from anon;
grant execute on function public.confirm_hazard(uuid) to authenticated;

-- 5e. Sapuan kedaluwarsa. Dipanggil malas oleh aplikasi sebelum memuat daftar
--     (MILESTONE_4_PLAN bagian 9); dapat juga dipanggil cron pemilik project.
--     Pembacaan tetap menyaring `status = 'active' and expires_at > now()`,
--     sehingga sapuan yang belum berjalan tidak pernah menampilkan laporan
--     kedaluwarsa sebagai aktif.
create or replace function public.expire_hazard_reports()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'menyapu laporan kedaluwarsa membutuhkan sesi'
      using errcode = '42501', detail = 'hazard_unauthenticated';
  end if;

  update public.hazard_reports
     set status = 'expired',
         updated_at = now()
   where status = 'active'
     and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_hazard_reports() from public;
revoke all on function public.expire_hazard_reports() from anon;
grant execute on function public.expire_hazard_reports() to authenticated;

-- 6. Jalur tulis langsung ditutup (ADR-066): seluruh perubahan melewati RPC di
--    atas, sehingga rate limit, deteksi duplikat, jendela edit, dan expiry
--    server tidak bisa dilewati dengan REST biasa. Baca tetap lewat policy
--    `hazards_select_current_or_reporter` yang tidak diubah.
drop policy if exists "hazards_insert_self" on public.hazard_reports;
revoke insert, update, delete on public.hazard_reports from authenticated, anon;

-- 7. Laporan penyalahgunaan tetap memakai `public.content_reports` yang sudah
--    ada. RPC `report_content` (migration chat) menyediakan jalur tervalidasi
--    untuk `hazard` dan `chat_message`; policy `content_reports_insert_self`
--    yang sudah ada tetap menjamin `reporter_id = auth.uid()`.
