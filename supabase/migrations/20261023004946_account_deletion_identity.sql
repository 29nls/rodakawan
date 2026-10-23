-- ============================================================================
-- RodaKawan — Hapus akun P0: identitas login benar-benar dihapus.
--
-- Migration `20261022190000_account_deletion_m5.sql` hanya **menganonimkan**
-- profil; `auth.users` tetap ada sehingga orang yang "menghapus akun" masih bisa
-- masuk kembali, dan objek Storage miliknya tetap menghalangi Auth Admin API.
-- Migration ini menutup celah itu tanpa menghapus data keselamatan bersama.
--
-- Keputusan arsitektur (ADR-077):
--   1. `profiles.id` **tidak lagi** mereferensikan `auth.users(id)`. Dengan
--      begitu Auth Admin API dapat menghapus identitas login tanpa ikut
--      menghapus baris profil. Trigger `enforce_profile_identity` menjaga arah
--      sebaliknya: profil aktif hanya boleh dibuat untuk auth user yang benar-
--      benar ada, dan tidak boleh dibuat ulang untuk akun yang sudah dihapus.
--   2. Profil milik akun yang dihapus **dihapus seluruhnya** (bukan tombstone
--      per pengguna). Semua konten yang wajib dipertahankan dialihkan ke satu
--      profil tombstone bersama (`00000000-0000-4000-8000-000000000001`,
--      username `deleted_account`) yang tidak punya auth user. Tombstone
--      bersama membuat konten dari akun berbeda tidak bisa saling dikaitkan.
--   3. Penghapusan diorkestrasi server-side (Supabase Edge Function
--      `delete-account`) karena hanya service role yang boleh memanggil Auth
--      Admin API dan Storage API lintas bucket. Fungsi SQL di sini hanya
--      menangani bagian database dalam satu transaksi.
--
-- Retensi yang disengaja (perlu pengesahan produk/legal, lihat ADR-077):
--   * `hazard_reports` dipertahankan (keselamatan peserta lain), pelapor →
--     tombstone, `client_report_id` dikosongkan.
--   * `moderation_actions` dan `content_reports` dipertahankan sebagai jejak
--     audit/moderasi, pelaku/pelapor → tombstone.
--   * `chat_messages` dipertahankan sebagai riwayat konvoi, tetapi isinya
--     diredaksi menjadi `[Pesan dihapus]` dan pengirimnya → tombstone.
--   * `club_posts`/`post_comments` dipertahankan strukturnya agar balasan orang
--     lain tidak hilang, isinya diredaksi dan penulisnya → tombstone.
--   * `clubs` dan `rides` tidak dihapus. Kepemilikan dialihkan ke admin/anggota
--     aktif lain; bila tidak ada penerus, `created_by` → tombstone dan
--     perjalanan yang masih planned/active dibatalkan.
--   * `club_role_audit` memakai ON DELETE SET NULL; aktor/subjek menjadi NULL.
--
-- Yang dihapus: kendaraan + detail privat, token push, lokasi terakhir,
-- notifikasi pribadi, follow, blokir, reaksi, konfirmasi bahaya, dan baris
-- `profiles` itu sendiri. Keanggotaan klub/perjalanan ikut terhapus lewat
-- cascade **setelah** kepemilikan dialihkan.
--
-- Objek Storage **tidak** disentuh di SQL (Supabase memblokir DELETE langsung
-- pada `storage.objects`); Edge Function menghapusnya lewat Storage API sebelum
-- memanggil Auth Admin API. `account_media_manifest()` memberi daftar objek
-- yang harus ditangani, termasuk logo klub yang dimiliki pengguna.
-- ============================================================================

-- 1. Pisahkan identitas profil dari identitas login.
alter table public.profiles
  drop constraint if exists profiles_id_fkey;

comment on column public.profiles.id is
  'Identitas profil. Untuk akun aktif nilainya sama dengan auth.users.id, tetapi FK sengaja dilepas agar identitas login bisa dihapus tanpa menghapus data keselamatan bersama. Lihat ADR-077.';

-- 2. Status pekerjaan penghapusan. Baris tetap ada setelah profil/auth hilang
--    supaya retry idempoten dan status bisa diperiksa operator.
create table if not exists public.account_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  status text not null default 'running' check (status in ('running', 'failed', 'completed')),
  last_step text not null default 'start' check (
    last_step in ('start', 'media', 'purge', 'auth', 'done')
  ),
  attempts int not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists account_deletion_jobs_status_idx
  on public.account_deletion_jobs(status, updated_at desc);

alter table public.account_deletion_jobs enable row level security;

-- Tidak ada policy: hanya service role (yang melewati RLS) yang boleh membaca
-- atau menulis. `anon`/`authenticated` juga tidak mendapat grant tabel.
revoke all on table public.account_deletion_jobs from anon, authenticated;

comment on table public.account_deletion_jobs is
  'Status orkestrasi hapus akun. Tanpa FK ke profiles agar tetap ada setelah profil dan auth user dihapus. Hanya service role.';

-- 3. Tombstone bersama. Tidak punya auth user; trigger di bawah mengizinkannya
--    secara eksplisit. `deleted_at` membuat policy profil menyembunyikannya.
insert into public.profiles (id, username, display_name, is_private, deleted_at)
values (
  '00000000-0000-4000-8000-000000000001',
  'deleted_account',
  'Akun dihapus',
  false,
  now()
)
on conflict (id) do nothing;

-- 4. Integritas identitas profil.
--
--    * INSERT biasa: harus ada auth.users dengan id yang sama, kecuali tombstone.
--    * INSERT setelah akun dihapus: ditolak walau auth user sempat dibuat lagi
--      dengan UUID yang sama (tidak terjadi pada Supabase, tetapi dijaga).
--    * UPDATE: id tidak boleh berubah, `deleted_at` tidak boleh kembali NULL.
create or replace function public.enforce_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tombstone constant uuid := '00000000-0000-4000-8000-000000000001';
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id then
      raise exception 'Identitas profil tidak boleh diubah.'
        using errcode = '55000', detail = 'profile_identity_immutable';
    end if;

    if old.deleted_at is not null and new.deleted_at is null then
      raise exception 'Profil yang sudah dihapus tidak boleh diaktifkan kembali.'
        using errcode = '55000', detail = 'profile_already_deleted';
    end if;
  end if;

  if new.id = c_tombstone then
    if new.deleted_at is null then
      raise exception 'Tombstone akun harus tetap nonaktif.'
        using errcode = '55000', detail = 'profile_tombstone_active';
    end if;
    return new;
  end if;

  if exists (
    select 1
    from public.account_deletion_jobs j
    where j.user_id = new.id
  ) then
    raise exception 'Akun ini sedang atau sudah dihapus dan tidak bisa dibuat ulang.'
      using errcode = '55000', detail = 'profile_account_deleted';
  end if;

  if tg_op = 'INSERT' and not exists (
    select 1 from auth.users u where u.id = new.id
  ) then
    raise exception 'Profil hanya boleh dibuat untuk identitas login yang sah.'
      using errcode = '23503', detail = 'profile_identity_missing';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profile_identity() from public, anon, authenticated;

drop trigger if exists profiles_enforce_identity on public.profiles;
create trigger profiles_enforce_identity
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_identity();

-- 5. Mulai/klaim pekerjaan penghapusan (service role saja).
--    `last_step` adalah langkah terakhir yang **selesai**, sehingga retry
--    melanjutkan dari langkah berikutnya. Maksimal 5 percobaan per 15 menit.
create or replace function public.begin_account_deletion(p_user uuid)
returns table (job_id uuid, status text, last_step text, attempts int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tombstone constant uuid := '00000000-0000-4000-8000-000000000001';
  v_job public.account_deletion_jobs%rowtype;
begin
  if p_user is null then
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
        updated_at = now()
    where j.id = v_job.id
    returning * into v_job;
  else
    insert into public.account_deletion_jobs (user_id, status, attempts)
    values (p_user, 'running', 1)
    returning * into v_job;
  end if;

  return query select v_job.id, v_job.status, v_job.last_step, v_job.attempts;
end;
$$;

-- 6. Tutup pekerjaan (service role saja).
create or replace function public.finish_account_deletion(
  p_job uuid,
  p_status text,
  p_step text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
      updated_at = now(),
      completed_at = case when p_status = 'completed' then now() else j.completed_at end
  where j.id = p_job;

  if not found then
    raise exception 'Pekerjaan penghapusan tidak ditemukan.'
      using errcode = 'P0002', detail = 'account_deletion_job_missing';
  end if;
end;
$$;

-- 7. Daftar objek Storage yang harus ditangani. Sumbernya `storage.objects`
--    (owner + folder uid), **bukan** kolom avatar/photo yang mungkin sudah
--    kosong. Logo klub yang dipakai klub aktif ditandai `inUse` agar Edge
--    Function menyalinnya lebih dulu, bukan menghapus aset bersama.
create or replace function public.account_media_manifest(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profileExists', exists (
      select 1 from public.profiles p where p.id = p_user
    ),
    'avatars', coalesce(
      (
        select jsonb_agg(o.name order by o.name)
        from storage.objects o
        where o.bucket_id = 'avatars'
          and (
            (storage.foldername(o.name))[1] = p_user::text
            or o.owner_id = p_user::text
            or o.owner = p_user
          )
      ),
      '[]'::jsonb
    ),
    'vehiclePhotos', coalesce(
      (
        select jsonb_agg(o.name order by o.name)
        from storage.objects o
        where o.bucket_id = 'vehicle-photos'
          and (
            (storage.foldername(o.name))[1] = p_user::text
            or o.owner_id = p_user::text
            or o.owner = p_user
          )
      ),
      '[]'::jsonb
    ),
    'clubLogos', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'path', o.name,
            'clubId', (storage.foldername(o.name))[1],
            'inUse', exists (
              select 1 from public.clubs c where c.logo_path = o.name
            )
          )
          order by o.name
        )
        from storage.objects o
        where o.bucket_id = 'club-logos'
          and (o.owner_id = p_user::text or o.owner = p_user)
      ),
      '[]'::jsonb
    )
  );
$$;

-- 8. Pembersihan database dalam satu transaksi. Identitas target datang dari
--    service role (Edge Function sudah memverifikasi JWT), bukan dari klien.
create or replace function public.purge_account_data(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tombstone constant uuid := '00000000-0000-4000-8000-000000000001';
  v_profile public.profiles%rowtype;
  v_successor uuid;
  v_club record;
  v_ride record;
  v_deleted int;
begin
  if p_user is null or p_user = c_tombstone then
    raise exception 'Identitas penghapusan tidak valid.'
      using errcode = '22023', detail = 'account_deletion_invalid_user';
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = p_user
  for update;

  if not found then
    return jsonb_build_object(
      'profileDeleted', false,
      'alreadyPurged', true
    );
  end if;

  -- 8a. Alihkan kepemilikan klub ke admin/anggota aktif lain.
  for v_club in
    select c.id
    from public.clubs c
    where c.created_by = p_user
       or exists (
         select 1 from public.club_members cm
         where cm.club_id = c.id
           and cm.user_id = p_user
           and cm.role = 'owner'
           and cm.status = 'active'
       )
    for update
  loop
    select cm.user_id into v_successor
    from public.club_members cm
    where cm.club_id = v_club.id
      and cm.user_id <> p_user
      and cm.status = 'active'
    order by (cm.role = 'admin') desc, cm.joined_at nulls last, cm.created_at
    limit 1;

    if v_successor is null then
      update public.clubs
      set created_by = c_tombstone, updated_at = now()
      where id = v_club.id;
    else
      update public.club_members
      set role = 'owner', updated_at = now()
      where club_id = v_club.id and user_id = v_successor;

      update public.clubs
      set created_by = v_successor, updated_at = now()
      where id = v_club.id;
    end if;
  end loop;

  -- 8b. Alihkan atau batalkan perjalanan yang dipimpin pengguna. Tanpa ini,
  --     `rides.created_by` (ON DELETE RESTRICT) akan menggagalkan penghapusan.
  for v_ride in
    select r.id, r.status
    from public.rides r
    where r.created_by = p_user
       or exists (
         select 1 from public.ride_members rm
         where rm.ride_id = r.id
           and rm.user_id = p_user
           and rm.role = 'host'
           and rm.status = 'joined'
       )
    for update
  loop
    select rm.user_id into v_successor
    from public.ride_members rm
    where rm.ride_id = v_ride.id
      and rm.user_id <> p_user
      and rm.status = 'joined'
    order by (rm.role = 'sweeper') desc, rm.joined_at nulls last, rm.created_at
    limit 1;

    if v_successor is null then
      update public.rides
      set created_by = c_tombstone,
          status = case when status in ('planned', 'active') then 'cancelled' else status end,
          ended_at = case
            when status in ('planned', 'active') then coalesce(ended_at, now())
            else ended_at
          end,
          updated_at = now()
      where id = v_ride.id;
    else
      update public.ride_members
      set role = 'host', updated_at = now()
      where ride_id = v_ride.id and user_id = v_successor;

      update public.rides
      set created_by = v_successor, updated_at = now()
      where id = v_ride.id;
    end if;
  end loop;

  -- 8c. Data pribadi yang tidak punya nilai bagi siapa pun setelah akun hilang.
  delete from public.push_tokens where user_id = p_user;
  delete from public.ride_locations where user_id = p_user;
  delete from public.notifications where recipient_id = p_user;
  delete from public.follows where follower_id = p_user or followed_id = p_user;
  delete from public.user_blocks where blocker_id = p_user or blocked_id = p_user;
  delete from public.post_reactions where user_id = p_user;
  delete from public.hazard_confirmations where user_id = p_user;
  delete from public.motorcycles where owner_id = p_user;

  -- 8d. Konten bersama: pertahankan baris, lepaskan identitas, redaksi isi
  --     pribadi. Isi hazard reports sengaja dipertahankan karena itu data
  --     keselamatan yang dibaca peserta lain.
  update public.hazard_reports
  set reporter_id = c_tombstone,
      client_report_id = null,
      updated_at = now()
  where reporter_id = p_user;

  update public.chat_messages
  set sender_id = c_tombstone,
      content = '[Pesan dihapus]',
      edited_at = null,
      deleted_at = coalesce(deleted_at, now())
  where sender_id = p_user;

  update public.club_posts
  set author_id = c_tombstone,
      content = '[Konten dihapus]',
      media_path = null,
      updated_at = now()
  where author_id = p_user;

  update public.post_comments
  set author_id = c_tombstone,
      content = '[Komentar dihapus]',
      updated_at = now()
  where author_id = p_user;

  update public.content_reports
  set reporter_id = c_tombstone
  where reporter_id = p_user;

  update public.moderation_actions
  set actor_id = c_tombstone
  where actor_id = p_user;

  -- 8e. Hapus profil. Seluruh FK ON DELETE RESTRICT harus sudah dialihkan;
  --     bila ada yang terlewat, DELETE gagal dan transaksi rollback — pagar
  --     yang disengaja, bukan kegagalan yang ditelan.
  delete from public.profiles where id = p_user;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'profileDeleted', v_deleted = 1,
    'alreadyPurged', false
  );
end;
$$;

-- 9. Hentikan RPC lama. Build aplikasi sebelum ADR-077 hanya menganonimkan dan
--    mencoba menghapus storage.objects langsung (ditolak Supabase), sehingga
--    hasilnya setengah jadi. Lebih baik gagal jelas lalu meminta pembaruan.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Penghapusan akun sekarang diproses oleh server. Perbarui aplikasi lalu ulangi.'
    using errcode = '0A000', detail = 'account_deletion_requires_server';
end;
$$;

comment on function public.delete_my_account() is
  'Tidak lagi menghapus apa pun. Dipertahankan agar build lama mendapat pesan yang jelas; gunakan Edge Function delete-account. Lihat ADR-077.';

-- 10. Hak eksekusi. Semua fungsi baru hanya untuk service_role; RPC lama tetap
--     authenticated supaya build lama tidak menerima PGRST202 yang membingungkan.
revoke all on function public.begin_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.finish_account_deletion(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.account_media_manifest(uuid) from public, anon, authenticated;
revoke all on function public.purge_account_data(uuid) from public, anon, authenticated;
grant execute on function public.begin_account_deletion(uuid) to service_role;
grant execute on function public.finish_account_deletion(uuid, text, text, text) to service_role;
grant execute on function public.account_media_manifest(uuid) to service_role;
grant execute on function public.purge_account_data(uuid) to service_role;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
