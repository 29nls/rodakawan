-- ============================================================================
-- RodaKawan — reliabilitas orkestrasi hapus akun (ADR-078).
--
-- Migration `20261023004946_account_deletion_identity.sql` menyimpan status di
-- `account_deletion_jobs`, tetapi hanya menulis `last_step` pada keberhasilan
-- akhir atau saat error tertangkap. Tiga celah reliabilitas ditutup di sini,
-- **tanpa** mengubah urutan media → purge → auth dan tanpa melonggarkan RLS:
--
--   1. **Checkpoint tahan-gagal.** Tanpa tulisan `last_step` antar tahap, proses
--      yang mati di tengah meninggalkan job pada langkah awal sehingga tahap yang
--      sudah selesai (mis. transfer logo) diulang. `checkpoint_account_deletion`
--      mencatat kemajuan secara durable SEBELUM tahap berikutnya dimulai.
--
--   2. **Lease / klaim eksklusif.** `begin_account_deletion` lama hanya
--      menyerialisasi transaksinya sendiri (`select ... for update`), sehingga
--      dua isolasi Edge Function untuk pengguna yang sama bisa menjalankan
--      purge/Auth secara bersamaan. Klaim kini membawa `lease_token` +
--      `lease_expires_at`; hanya pemegang lease yang boleh mengecekpoint atau
--      menutup job, dan permintaan selama lease aktif ditolak
--      `account_deletion_in_progress` (bukan rate-limit).
--
--   3. **Pemulihan setelah crash pasca-Auth.** Bila Auth user sudah terhapus
--      tetapi job belum ditandai `completed` (crash di antara deleteAuthUser dan
--      finish), access token pengguna sudah mati sehingga retry lewat klien
--      tidak mungkin. `begin_account_deletion_claim` menyelesaikan sendiri job
--      yang identitas Auth-nya sudah hilang dan yang sudah mencapai langkah
--      `auth`; `reconcile_account_deletion_jobs` melakukan hal yang sama dari
--      konteks tepercaya (operator) untuk kasus serupa yang tertinggal.
--
-- Fungsi lama `begin_account_deletion(uuid)` dan `finish_account_deletion(...)`
-- dibiarkan tetap ada agar Edge Function yang masih ter-deploy tidak rusak
-- selama jendela sebelum function baru di-deploy; keduanya hanya untuk
-- `service_role`. Setelah function `delete-account` memakai varian lease,
-- migration berikutnya boleh menjatuhkan yang lama.
--
-- Retensi: lihat ADR-078 dan docs/SECURITY_PRIVACY.md — metadata job (UUID +
-- status, tanpa konten) belum dibersihkan otomatis; keputusan retensi produk/
-- legal masih terbuka.
-- ============================================================================

-- 1. Kolom lease pada tabel status pekerjaan.
alter table public.account_deletion_jobs
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

comment on column public.account_deletion_jobs.lease_token is
  'Token klaim eksklusif pemroses; hanya pemegangnya yang boleh mengecekpoint/menutup job (ADR-078).';
comment on column public.account_deletion_jobs.lease_expires_at is
  'Kedaluwarsa lease; setelah ini job boleh diklaim ulang oleh retry (ADR-078).';

-- 2. Klaim eksklusif + pemulihan. Menggantikan peran `begin_account_deletion`
--    untuk jalur baru; nama berbeda agar tidak ada jendela di mana function
--    yang sudah ter-deploy memanggil signature yang hilang.
create or replace function public.begin_account_deletion_claim(
  p_user uuid,
  p_lease uuid,
  p_ttl interval default interval '10 minutes'
)
returns table (job_id uuid, status text, last_step text, attempts int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tombstone constant uuid := '00000000-0000-4000-8000-000000000001';
  v_job public.account_deletion_jobs%rowtype;
  v_auth_exists boolean;
begin
  if p_user is null or p_lease is null then
    raise exception 'Identitas penghapusan tidak valid.'
      using errcode = '22023', detail = 'account_deletion_invalid_user';
  end if;

  if p_user = c_tombstone then
    raise exception 'Tombstone tidak bisa dihapus.'
      using errcode = '22023', detail = 'account_deletion_invalid_user';
  end if;

  select * into v_job
  from public.account_deletion_jobs j
  where j.user_id = p_user
  for update;

  if found and v_job.status = 'completed' then
    return query select v_job.id, v_job.status, v_job.last_step, v_job.attempts;
    return;
  end if;

  -- 2a. Pemulihan: identitas Auth sudah hilang dan pekerjaan sudah mencapai
  --     langkah auth. Semua langkah material sudah selesai; yang tersisa hanya
  --     penutupan buku. Tandai completed agar job tidak macet selamanya —
  --     penggunanya sudah tidak bisa login untuk meretry.
  if found then
    select exists(select 1 from auth.users u where u.id = p_user) into v_auth_exists;

    if not v_auth_exists and v_job.last_step in ('auth', 'done') then
      update public.account_deletion_jobs j
      set status = 'completed',
          last_step = 'done',
          last_error = null,
          lease_token = null,
          lease_expires_at = null,
          updated_at = now(),
          completed_at = coalesce(j.completed_at, now())
      where j.id = v_job.id
      returning * into v_job;

      return query select v_job.id, v_job.status, v_job.last_step, v_job.attempts;
      return;
    end if;

    -- 2b. Lease aktif (belum kedaluwarsa) berarti pemroses lain sedang
    --     menangani tahap yang sama. Tolak tanpa menghitung percobaan dan
    --     tanpa menyentuh kolom apa pun.
    if v_job.status = 'running'
       and v_job.lease_expires_at is not null
       and v_job.lease_expires_at > now()
       and v_job.lease_token is distinct from p_lease then
      raise exception 'Penghapusan akun ini sedang diproses. Tunggu sebentar lalu coba lagi.'
        using errcode = '55006', detail = 'account_deletion_in_progress';
    end if;
  end if;

  -- 2c. Rate limit tetap berlaku dan tidak digantikan lease.
  if found
     and v_job.attempts >= 5
     and v_job.updated_at > now() - interval '15 minutes' then
    raise exception 'Terlalu banyak percobaan penghapusan. Coba lagi beberapa menit lagi.'
      using errcode = '54000', detail = 'account_deletion_rate_limited';
  end if;

  if found then
    update public.account_deletion_jobs j
    set status = 'running',
        attempts = j.attempts + 1,
        last_error = null,
        lease_token = p_lease,
        lease_expires_at = now() + coalesce(p_ttl, interval '10 minutes'),
        updated_at = now()
    where j.id = v_job.id
    returning * into v_job;
  else
    insert into public.account_deletion_jobs
      (user_id, status, attempts, lease_token, lease_expires_at)
    values (
      p_user, 'running', 1, p_lease,
      now() + coalesce(p_ttl, interval '10 minutes')
    )
    returning * into v_job;
  end if;

  return query select v_job.id, v_job.status, v_job.last_step, v_job.attempts;
end;
$$;

-- 3. Checkpoint tahan-gagal: catat langkah yang SELESAI sebelum tahap
--    berikutnya dimulai. Hanya pemegang lease yang sah.
create or replace function public.checkpoint_account_deletion(
  p_job uuid,
  p_lease uuid,
  p_step text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if p_step not in ('media', 'purge', 'auth') then
    raise exception 'Langkah pekerjaan tidak valid.'
      using errcode = '22023', detail = 'account_deletion_invalid_step';
  end if;

  update public.account_deletion_jobs j
  set last_step = p_step,
      updated_at = now(),
      lease_expires_at = greatest(
        coalesce(j.lease_expires_at, now()),
        now() + interval '10 minutes'
      )
  where j.id = p_job
    and j.lease_token = p_lease
    and j.status = 'running';

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'Lease penghapusan tidak valid atau sudah kedaluwarsa.'
      using errcode = '55006', detail = 'account_deletion_lease_lost';
  end if;
end;
$$;

-- 4. Penutupan job berversi lease. Pemegang lease saja; job yang sudah
--    completed tidak bisa ditutup ulang (idempoten terhadap worker basi).
create or replace function public.finish_account_deletion_claim(
  p_job uuid,
  p_lease uuid,
  p_status text,
  p_step text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if p_status not in ('failed', 'completed') then
    raise exception 'Status pekerjaan tidak valid.'
      using errcode = '22023', detail = 'account_deletion_invalid_status';
  end if;

  if p_step not in ('start', 'media', 'purge', 'auth', 'done') then
    raise exception 'Langkah pekerjaan tidak valid.'
      using errcode = '22023', detail = 'account_deletion_invalid_step';
  end if;

  update public.account_deletion_jobs j
  set status = p_status,
      last_step = p_step,
      last_error = left(p_error, 500),
      lease_token = null,
      lease_expires_at = null,
      updated_at = now(),
      completed_at = case when p_status = 'completed' then now() else j.completed_at end
  where j.id = p_job
    and j.lease_token = p_lease
    and j.status <> 'completed';

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- Sudah completed oleh proses lain (mis. pemulihan) = sah, bukan kegagalan.
    if exists (
      select 1 from public.account_deletion_jobs j
      where j.id = p_job and j.status = 'completed'
    ) then
      return;
    end if;

    raise exception 'Lease penghapusan tidak valid atau pekerjaan tidak ditemukan.'
      using errcode = '55006', detail = 'account_deletion_lease_lost';
  end if;
end;
$$;

-- 5. Pemulihan operator: sapuan job yang lease-nya kedaluwarsa dan identitas
--    Auth-nya sudah hilang. Tidak menerima target dari klien — memindai state
--    server. Job yang identitas Auth-nya hilang tetapi belum mencapai auth
--    berarti dihapus di luar orkestrasi (mis. tombol Dashboard) sehingga
--    Storage mungkin masih menyisakan objek; ditandai `failed` agar operator
--    dapat menindak, bukan diklaim sebagai sukses.
create or replace function public.reconcile_account_deletion_jobs(
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completed int := 0;
  var_flagged int := 0;
  v_job record;
begin
  for v_job in
    select j.*
    from public.account_deletion_jobs j
    where j.status = 'running'
      and (j.lease_expires_at is null or j.lease_expires_at <= now())
    order by j.updated_at
    limit greatest(coalesce(p_limit, 50), 0)
    for update
  loop
    if exists (select 1 from auth.users u where u.id = v_job.user_id) then
      -- Identitas masih ada: biarkan retry pengguna melanjutkan (lease sudah
      -- kedaluwarsa sehingga klaim ulang diizinkan).
      continue;
    end if;

    if v_job.last_step in ('auth', 'done') then
      update public.account_deletion_jobs j
      set status = 'completed',
          last_step = 'done',
          last_error = null,
          lease_token = null,
          lease_expires_at = null,
          updated_at = now(),
          completed_at = coalesce(j.completed_at, now())
      where j.id = v_job.id;
      v_completed := v_completed + 1;
    else
      update public.account_deletion_jobs j
      set status = 'failed',
          last_error = 'account_deletion_identity_removed',
          lease_token = null,
          lease_expires_at = null,
          updated_at = now()
      where j.id = v_job.id;
      var_flagged := var_flagged + 1;
    end if;
  end loop;

  return jsonb_build_object('completed', v_completed, 'flagged', var_flagged);
end;
$$;

-- 6. Hak eksekusi: hanya service_role, sama seperti fungsi orkestrasi lain.
revoke all on function public.begin_account_deletion_claim(uuid, uuid, interval) from public, anon, authenticated;
revoke all on function public.checkpoint_account_deletion(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_account_deletion_claim(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.reconcile_account_deletion_jobs(int) from public, anon, authenticated;

grant execute on function public.begin_account_deletion_claim(uuid, uuid, interval) to service_role;
grant execute on function public.checkpoint_account_deletion(uuid, uuid, text) to service_role;
grant execute on function public.finish_account_deletion_claim(uuid, uuid, text, text, text) to service_role;
grant execute on function public.reconcile_account_deletion_jobs(int) to service_role;
