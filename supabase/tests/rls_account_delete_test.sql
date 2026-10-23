-- db:test notice: UJI HAPUS AKUN LULUS
--
-- ============================================================================
-- Uji penghapusan akun P0 (ADR-077).
--
-- Yang dibuktikan di sini adalah **batas database**:
--   1. `purge_account_data()` menghapus profil dan seluruh data pribadi;
--   2. konten keselamatan/audit dipertahankan tetapi dialihkan ke tombstone;
--   3. kepemilikan klub dan perjalanan dialihkan sebelum profil dihapus;
--   4. objek Storage tidak disentuh dari SQL (harus lewat Storage API);
--   5. setelah profil hilang, JWT lama tidak bisa membaca/menulis data akun;
--   6. `auth.users` bisa dihapus setelah purge tanpa melanggar FK, dan data
--      keselamatan tetap utuh;
--   7. akun yang sudah dihapus tidak bisa membuat profil baru;
--   8. RPC lama gagal dengan pesan yang jelas, dan fungsi service-role tidak
--      bisa dipanggil `anon`/`authenticated`.
--
-- Auth Admin API dan Storage API **tidak** bisa diuji dari transaksi SQL.
-- Langkah server-side itu diuji terpisah lewat Edge Function (lihat
-- docs/QA_TEST_PLAN.md). Berkas ini tidak mengklaim Auth user terhapus oleh SQL.
--
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK.
-- ============================================================================

begin;

-- 0. Paritas migration.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.purge_account_data(uuid)') is null then
    v_missing := v_missing || 'fungsi public.purge_account_data'::text;
  end if;
  if to_regprocedure('public.account_media_manifest(uuid)') is null then
    v_missing := v_missing || 'fungsi public.account_media_manifest'::text;
  end if;
  if to_regprocedure('public.begin_account_deletion(uuid)') is null then
    v_missing := v_missing || 'fungsi public.begin_account_deletion'::text;
  end if;
  if to_regclass('public.account_deletion_jobs') is null then
    v_missing := v_missing || 'tabel public.account_deletion_jobs'::text;
  end if;
  if not exists (
    select 1 from public.profiles
    where id = '00000000-0000-4000-8000-000000000001'
  ) then
    v_missing := v_missing || 'profil tombstone'::text;
  end if;
  if exists (
    select 1 from pg_constraint
    where conname = 'profiles_id_fkey' and conrelid = 'public.profiles'::regclass
  ) then
    v_missing := v_missing || 'pelepasan FK profiles.id -> auth.users'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (migration ADR-077 belum diterapkan): %',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Dua akun. Trigger bootstrap membuat profilnya.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'e1111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'p0.hapus.a@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"p0_hapus_a","display_name":"P0 Hapus A"}',
    now(), now()
  ),
  (
    'e2222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'p0.hapus.b@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"p0_hapus_b","display_name":"P0 Hapus B"}',
    now(), now()
  );

-- 2. Data pribadi A + pembanding milik B.
insert into public.motorcycles (id, owner_id, make, model)
values (
  'e9999999-9999-4999-8999-999999999999',
  'e1111111-1111-4111-8111-111111111111',
  'Honda', 'Uji P0'
);

insert into public.motorcycle_private_details (motorcycle_id, owner_id, plate_number)
values (
  'e9999999-9999-4999-8999-999999999999',
  'e1111111-1111-4111-8111-111111111111',
  'B 1234 P0'
);

insert into public.push_tokens (user_id, token, platform, device_label)
values
  ('e1111111-1111-4111-8111-111111111111', 'ExponentPushToken[p0-a]', 'android', 'HP A'),
  ('e2222222-2222-4222-8222-222222222222', 'ExponentPushToken[p0-b]', 'android', 'HP B');

insert into public.follows (follower_id, followed_id)
values ('e1111111-1111-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222');

insert into public.user_blocks (blocker_id, blocked_id)
values ('e1111111-1111-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222');

insert into public.notifications (recipient_id, actor_id, kind, payload)
values
  ('e1111111-1111-4111-8111-111111111111', null, 'system', '{"teks":"pribadi A"}'),
  ('e2222222-2222-4222-8222-222222222222', 'e1111111-1111-4111-8111-111111111111', 'system', '{"teks":"dari A"}');

-- 3. Klub: A owner, B admin aktif. Logo klub dimiliki A (dipakai + yatim).
insert into public.clubs (id, name, slug, created_by, visibility)
values (
  'e3333333-3333-4333-8333-333333333333',
  'Klub Uji P0', 'klub-uji-p0',
  'e1111111-1111-4111-8111-111111111111', 'public'
);

insert into public.club_members (club_id, user_id, role, status, joined_at)
values
  (
    'e3333333-3333-4333-8333-333333333333',
    'e1111111-1111-4111-8111-111111111111',
    'owner', 'active', now() - interval '2 days'
  ),
  (
    'e3333333-3333-4333-8333-333333333333',
    'e2222222-2222-4222-8222-222222222222',
    'admin', 'active', now() - interval '1 day'
  );

update public.clubs
set logo_path = 'e3333333-3333-4333-8333-333333333333/logo.png'
where id = 'e3333333-3333-4333-8333-333333333333';

-- 4. Perjalanan aktif yang dipimpin A; B peserta.
insert into public.rides (id, club_id, created_by, title, status, visibility, started_at)
values (
  'e4444444-4444-4444-8444-444444444444',
  'e3333333-3333-4333-8333-333333333333',
  'e1111111-1111-4111-8111-111111111111',
  'Konvoi Uji P0', 'active', 'club', now()
);

insert into public.ride_members (ride_id, user_id, role, status, joined_at, sharing_location)
values
  (
    'e4444444-4444-4444-8444-444444444444',
    'e1111111-1111-4111-8111-111111111111',
    'host', 'joined', now() - interval '2 hours', true
  ),
  (
    'e4444444-4444-4444-8444-444444444444',
    'e2222222-2222-4222-8222-222222222222',
    'rider', 'joined', now() - interval '1 hour', true
  );

insert into public.ride_locations (ride_id, user_id, latitude, longitude, recorded_at)
values
  ('e4444444-4444-4444-8444-444444444444', 'e1111111-1111-4111-8111-111111111111', -6.2, 106.8, now()),
  ('e4444444-4444-4444-8444-444444444444', 'e2222222-2222-4222-8222-222222222222', -6.21, 106.81, now());

-- 5. Konten bersama.
insert into public.hazard_reports (
  id, reporter_id, ride_id, category, description, severity, latitude, longitude,
  status, expires_at, client_report_id
) values
  (
    'e5555555-5555-4555-8555-555555555555',
    'e1111111-1111-4111-8111-111111111111',
    'e4444444-4444-4444-8444-444444444444',
    'flood', 'Jalan tergenang', 'high', -6.2, 106.8,
    'active', now() + interval '2 hours', 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  (
    'e6666666-6666-4666-8666-666666666666',
    'e2222222-2222-4222-8222-222222222222',
    'e4444444-4444-4444-8444-444444444444',
    'pothole', 'Lubang', 'moderate', -6.21, 106.81,
    'active', now() + interval '2 hours', null
  );

insert into public.hazard_confirmations (hazard_id, user_id)
values
  ('e6666666-6666-4666-8666-666666666666', 'e1111111-1111-4111-8111-111111111111'),
  ('e5555555-5555-4555-8555-555555555555', 'e2222222-2222-4222-8222-222222222222');

insert into public.chat_messages (ride_id, sender_id, message_type, content, client_message_id)
values
  (
    'e4444444-4444-4444-8444-444444444444',
    'e1111111-1111-4111-8111-111111111111', 'text', 'Rahasia pribadi A',
    'eabababa-baba-4bab-8bab-abababababab'
  ),
  (
    'e4444444-4444-4444-8444-444444444444',
    'e2222222-2222-4222-8222-222222222222', 'text', 'Pesan B',
    null
  );

insert into public.club_posts (id, club_id, author_id, content)
values (
  'e7777777-7777-4777-8777-777777777777',
  'e3333333-3333-4333-8333-333333333333',
  'e1111111-1111-4111-8111-111111111111',
  'Postingan pribadi A'
);

insert into public.post_comments (post_id, author_id, content)
values
  ('e7777777-7777-4777-8777-777777777777', 'e1111111-1111-4111-8111-111111111111', 'Komentar A'),
  ('e7777777-7777-4777-8777-777777777777', 'e2222222-2222-4222-8222-222222222222', 'Komentar B');

insert into public.content_reports (reporter_id, target_type, target_id, reason, details)
values (
  'e1111111-1111-4111-8111-111111111111',
  'user', 'e2222222-2222-4222-8222-222222222222', 'other', 'Laporan A'
);

insert into public.moderation_actions (id, actor_id, target_type, target_id, action, reason)
values (
  'e8888888-8888-4888-8888-888888888888',
  'e1111111-1111-4111-8111-111111111111',
  'content_report', 'e8888888-8888-4888-8888-888888888888', 'review', 'other'
);

-- 6. Objek Storage: milik A (avatar, foto motor, dua logo klub) dan milik B.
insert into storage.objects (bucket_id, name, owner, owner_id)
values
  (
    'avatars', 'e1111111-1111-4111-8111-111111111111/avatar.jpg',
    'e1111111-1111-4111-8111-111111111111', 'e1111111-1111-4111-8111-111111111111'
  ),
  (
    'vehicle-photos',
    'e1111111-1111-4111-8111-111111111111/e9999999-9999-4999-8999-999999999999/foto.jpg',
    'e1111111-1111-4111-8111-111111111111', 'e1111111-1111-4111-8111-111111111111'
  ),
  (
    'club-logos', 'e3333333-3333-4333-8333-333333333333/logo.png',
    'e1111111-1111-4111-8111-111111111111', 'e1111111-1111-4111-8111-111111111111'
  ),
  (
    'club-logos', 'e3333333-3333-4333-8333-333333333333/lama.png',
    'e1111111-1111-4111-8111-111111111111', 'e1111111-1111-4111-8111-111111111111'
  ),
  (
    'avatars', 'e2222222-2222-4222-8222-222222222222/avatar.jpg',
    'e2222222-2222-4222-8222-222222222222', 'e2222222-2222-4222-8222-222222222222'
  );

-- 7. Manifest harus memuat SEMUA objek A, termasuk logo yatim, dan menandai
--    logo yang masih dipakai klub. Kegagalan baca tidak boleh tampak kosong.
do $$
declare
  v_manifest jsonb := public.account_media_manifest('e1111111-1111-4111-8111-111111111111');
  v_logos jsonb;
begin
  if jsonb_array_length(v_manifest -> 'avatars') <> 1 then
    raise exception 'UJI GAGAL: manifest avatar salah: %', v_manifest -> 'avatars';
  end if;
  if jsonb_array_length(v_manifest -> 'vehiclePhotos') <> 1 then
    raise exception 'UJI GAGAL: manifest foto kendaraan salah: %', v_manifest -> 'vehiclePhotos';
  end if;

  v_logos := v_manifest -> 'clubLogos';
  if jsonb_array_length(v_logos) <> 2 then
    raise exception 'UJI GAGAL: manifest logo klub harus 2, dapat %', v_logos;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_logos) e
    where e ->> 'path' = 'e3333333-3333-4333-8333-333333333333/logo.png'
      and (e ->> 'inUse')::boolean = true
  ) then
    raise exception 'UJI GAGAL: logo yang dipakai klub tidak ditandai inUse';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_logos) e
    where e ->> 'path' = 'e3333333-3333-4333-8333-333333333333/lama.png'
      and (e ->> 'inUse')::boolean = false
  ) then
    raise exception 'UJI GAGAL: logo yatim tidak ditandai tidak dipakai';
  end if;

  if v_manifest -> 'profileExists' <> 'true'::jsonb then
    raise exception 'UJI GAGAL: manifest tidak melaporkan profil yang ada';
  end if;
end;
$$;

-- 8. Jalankan purge sebagai pemilik database (peran service role di produksi).
do $$
declare
  v_hasil jsonb := public.purge_account_data('e1111111-1111-4111-8111-111111111111');
begin
  if (v_hasil ->> 'profileDeleted')::boolean is not true then
    raise exception 'UJI GAGAL: profil tidak terhapus: %', v_hasil;
  end if;

  if exists (
    select 1 from public.profiles
    where id = 'e1111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'UJI GAGAL: baris profil masih ada';
  end if;

  -- Identitas Auth sengaja belum dihapus di sini; langkah itu milik Edge
  -- Function setelah Storage bersih. Yang dibuktikan: tidak ada FK yang
  -- menghalangi penghapusan Auth setelah purge.
  if not exists (
    select 1 from auth.users where id = 'e1111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'UJI GAGAL: auth user terhapus oleh lapisan database';
  end if;
end;
$$;

-- 9. Data pribadi hilang, konten bersama tetap dan anonim.
do $$
declare
  c_a constant uuid := 'e1111111-1111-4111-8111-111111111111';
  c_tombstone constant uuid := '00000000-0000-4000-8000-000000000001';
begin
  if exists (select 1 from public.push_tokens where user_id = c_a) then
    raise exception 'UJI GAGAL: token push tersisa';
  end if;
  if exists (select 1 from public.ride_locations where user_id = c_a) then
    raise exception 'UJI GAGAL: lokasi terakhir tersisa';
  end if;
  if exists (select 1 from public.follows where follower_id = c_a or followed_id = c_a) then
    raise exception 'UJI GAGAL: relasi follow tersisa';
  end if;
  if exists (select 1 from public.user_blocks where blocker_id = c_a or blocked_id = c_a) then
    raise exception 'UJI GAGAL: relasi blokir tersisa';
  end if;
  if exists (select 1 from public.notifications where recipient_id = c_a) then
    raise exception 'UJI GAGAL: notifikasi pribadi tersisa';
  end if;
  if exists (select 1 from public.motorcycles where owner_id = c_a) then
    raise exception 'UJI GAGAL: kendaraan tersisa';
  end if;
  if exists (select 1 from public.hazard_confirmations where user_id = c_a) then
    raise exception 'UJI GAGAL: konfirmasi bahaya milik akun tersisa';
  end if;
  if exists (select 1 from public.club_members where user_id = c_a) then
    raise exception 'UJI GAGAL: keanggotaan klub tersisa';
  end if;
  if exists (select 1 from public.ride_members where user_id = c_a) then
    raise exception 'UJI GAGAL: keanggotaan perjalanan tersisa';
  end if;

  -- Laporan bahaya A tetap ada, kini milik tombstone.
  if not exists (
    select 1 from public.hazard_reports
    where id = 'e5555555-5555-4555-8555-555555555555'
      and reporter_id = c_tombstone
      and description = 'Jalan tergenang'
      and client_report_id is null
  ) then
    raise exception 'UJI GAGAL: laporan bahaya tidak dipertahankan/dialihkan dengan benar';
  end if;

  -- Laporan B tidak tersentuh.
  if not exists (
    select 1 from public.hazard_reports
    where id = 'e6666666-6666-4666-8666-666666666666'
      and reporter_id = 'e2222222-2222-4222-8222-222222222222'
  ) then
    raise exception 'UJI GAGAL: laporan bahaya B ikut berubah';
  end if;

  -- Chat A diredaksi, chat B utuh.
  if not exists (
    select 1 from public.chat_messages
    where ride_id = 'e4444444-4444-4444-8444-444444444444'
      and sender_id = c_tombstone
      and content = '[Pesan dihapus]'
      and deleted_at is not null
  ) then
    raise exception 'UJI GAGAL: pesan A tidak diredaksi';
  end if;
  if not exists (
    select 1 from public.chat_messages
    where ride_id = 'e4444444-4444-4444-8444-444444444444'
      and sender_id = 'e2222222-2222-4222-8222-222222222222'
      and content = 'Pesan B'
  ) then
    raise exception 'UJI GAGAL: pesan B ikut berubah';
  end if;

  -- Post/komentar: struktur tetap, isi A diredaksi.
  if not exists (
    select 1 from public.club_posts
    where id = 'e7777777-7777-4777-8777-777777777777'
      and author_id = c_tombstone
      and content = '[Konten dihapus]'
  ) then
    raise exception 'UJI GAGAL: postingan A tidak diredaksi';
  end if;
  if (select count(*) from public.post_comments
      where post_id = 'e7777777-7777-4777-8777-777777777777'
        and content = 'Komentar B') <> 1 then
    raise exception 'UJI GAGAL: komentar B hilang';
  end if;

  -- Audit dan laporan moderasi dialihkan, bukan dihapus.
  if not exists (
    select 1 from public.content_reports
    where reporter_id = c_tombstone and details = 'Laporan A'
  ) then
    raise exception 'UJI GAGAL: content report A hilang';
  end if;
  if not exists (
    select 1 from public.moderation_actions
    where id = 'e8888888-8888-4888-8888-888888888888' and actor_id = c_tombstone
  ) then
    raise exception 'UJI GAGAL: audit moderasi A hilang';
  end if;

  -- Klub tetap ada dan kepemilikannya pindah ke B.
  if not exists (
    select 1 from public.clubs
    where id = 'e3333333-3333-4333-8333-333333333333'
      and created_by = 'e2222222-2222-4222-8222-222222222222'
  ) then
    raise exception 'UJI GAGAL: kepemilikan klub tidak dialihkan';
  end if;
  if not exists (
    select 1 from public.club_members
    where club_id = 'e3333333-3333-4333-8333-333333333333'
      and user_id = 'e2222222-2222-4222-8222-222222222222'
      and role = 'owner' and status = 'active'
  ) then
    raise exception 'UJI GAGAL: B tidak menjadi owner klub';
  end if;

  -- Perjalanan tetap ada dan host pindah ke B, bukan dibatalkan.
  if not exists (
    select 1 from public.rides
    where id = 'e4444444-4444-4444-8444-444444444444'
      and created_by = 'e2222222-2222-4222-8222-222222222222'
      and status = 'active'
  ) then
    raise exception 'UJI GAGAL: kepemilikan perjalanan tidak dialihkan';
  end if;
  if not exists (
    select 1 from public.ride_members
    where ride_id = 'e4444444-4444-4444-8444-444444444444'
      and user_id = 'e2222222-2222-4222-8222-222222222222'
      and role = 'host' and status = 'joined'
  ) then
    raise exception 'UJI GAGAL: B tidak menjadi host';
  end if;

  -- Lokasi B tetap.
  if not exists (
    select 1 from public.ride_locations
    where ride_id = 'e4444444-4444-4444-8444-444444444444'
      and user_id = 'e2222222-2222-4222-8222-222222222222'
  ) then
    raise exception 'UJI GAGAL: lokasi B ikut terhapus';
  end if;

  -- Notifikasi B tetap, aktor A menjadi NULL (ON DELETE SET NULL).
  if not exists (
    select 1 from public.notifications
    where recipient_id = 'e2222222-2222-4222-8222-222222222222' and actor_id is null
  ) then
    raise exception 'UJI GAGAL: notifikasi B hilang atau aktor tidak dinullkan';
  end if;

  -- Objek Storage TIDAK boleh dihapus lewat SQL.
  if (select count(*) from storage.objects
      where owner = c_a) <> 4 then
    raise exception 'UJI GAGAL: SQL menghapus/mengubah objek Storage (harus lewat Storage API)';
  end if;
  if not exists (
    select 1 from storage.objects
    where name = 'e2222222-2222-4222-8222-222222222222/avatar.jpg'
  ) then
    raise exception 'UJI GAGAL: objek B ikut terhapus';
  end if;
end;
$$;

-- 10. Purge kedua idempoten dan menolak tombstone.
do $$
declare
  v_hasil jsonb := public.purge_account_data('e1111111-1111-4111-8111-111111111111');
begin
  if (v_hasil ->> 'alreadyPurged')::boolean is not true then
    raise exception 'UJI GAGAL: purge kedua tidak idempoten: %', v_hasil;
  end if;

  begin
    perform public.purge_account_data('00000000-0000-4000-8000-000000000001');
    raise exception 'UJI GAGAL: tombstone bisa dipurge';
  exception
    when sqlstate '22023' then null;
  end;
end;
$$;

-- 11. JWT lama tidak bisa membaca atau menulis data akun yang sudah hilang.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  if exists (
    select 1 from public.profiles
    where id = 'e1111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'UJI GAGAL: JWT lama masih membaca profil';
  end if;

  update public.profiles
  set display_name = 'Hidup Lagi'
  where id = 'e1111111-1111-4111-8111-111111111111';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: JWT lama mengubah % baris profil', v_rows;
  end if;

  begin
    insert into public.push_tokens (user_id, token, platform)
    values (
      'e1111111-1111-4111-8111-111111111111',
      'ExponentPushToken[hidup-lagi]', 'android'
    );
    raise exception 'UJI GAGAL: JWT lama mendaftarkan token push baru';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.motorcycles (owner_id, make, model)
    values ('e1111111-1111-4111-8111-111111111111', 'Yamaha', 'Hidup Lagi');
    raise exception 'UJI GAGAL: JWT lama membuat kendaraan baru';
  exception
    when foreign_key_violation then null;
  end;
end;
$$;

-- 12. Profil tidak bisa dibuat ulang setelah akun dihapus, walau sebagai
--     pemilik database (trigger, bukan hanya RLS).
reset role;

insert into public.account_deletion_jobs (user_id, status, last_step, attempts, completed_at)
values (
  'e1111111-1111-4111-8111-111111111111',
  'completed', 'done', 1, now()
);

do $$
declare
  v_job public.account_deletion_jobs%rowtype;
begin
  select * into v_job
  from public.account_deletion_jobs
  where user_id = 'e1111111-1111-4111-8111-111111111111';

  if v_job.status <> 'completed' then
    raise exception 'UJI GAGAL: status job tidak tersimpan';
  end if;

  begin
    insert into public.profiles (id, username, display_name)
    values ('e1111111-1111-4111-8111-111111111111', 'hidup_lagi', 'Hidup Lagi');
    raise exception 'UJI GAGAL: profil akun terhapus bisa dibuat ulang';
  exception
    when sqlstate '55000' then null;
  end;
end;
$$;

-- 13. Setelah purge, Auth user bisa dihapus tanpa merusak data keselamatan.
delete from auth.users where id = 'e1111111-1111-4111-8111-111111111111';

do $$
begin
  if exists (select 1 from auth.users where id = 'e1111111-1111-4111-8111-111111111111') then
    raise exception 'UJI GAGAL: auth user masih ada setelah dihapus';
  end if;

  if not exists (
    select 1 from public.hazard_reports
    where id = 'e5555555-5555-4555-8555-555555555555'
      and reporter_id = '00000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'UJI GAGAL: laporan bahaya hilang setelah auth user dihapus';
  end if;

  if not exists (
    select 1 from public.account_deletion_jobs
    where user_id = 'e1111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'UJI GAGAL: metadata job ikut terhapus';
  end if;
end;
$$;

-- 14. Tombstone tidak terbaca sebagai profil aktif.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
begin
  if exists (
    select 1 from public.profiles
    where id = '00000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'UJI GAGAL: tombstone terbaca sebagai profil';
  end if;
end;
$$;

reset role;

-- 15. RPC lama gagal jelas, bukan melakukan penghapusan setengah jadi.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  v_detail text;
begin
  begin
    perform public.delete_my_account();
    raise exception 'UJI GAGAL: delete_my_account lama masih menerima panggilan';
  exception
    when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      if v_detail <> 'account_deletion_requires_server' then
        raise exception 'UJI GAGAL: RPC lama gagal dengan detail %, bukan account_deletion_requires_server', v_detail;
      end if;
  end;
end;
$$;

reset role;

-- 16. Hak eksekusi: fungsi orkestrasi hanya untuk service_role.
do $$
begin
  if has_function_privilege('authenticated', 'public.purge_account_data(uuid)', 'execute') then
    raise exception 'UJI GAGAL: authenticated bisa memanggil purge_account_data';
  end if;
  if has_function_privilege('anon', 'public.purge_account_data(uuid)', 'execute') then
    raise exception 'UJI GAGAL: anon bisa memanggil purge_account_data';
  end if;
  if has_function_privilege('authenticated', 'public.account_media_manifest(uuid)', 'execute') then
    raise exception 'UJI GAGAL: authenticated bisa membaca manifest semua pengguna';
  end if;
  if not has_function_privilege('service_role', 'public.purge_account_data(uuid)', 'execute') then
    raise exception 'UJI GAGAL: service_role tidak bisa memanggil purge_account_data';
  end if;
end;
$$;

-- 17. `begin_account_deletion` idempoten untuk job selesai dan mencatat retry.
do $$
declare
  v_job record;
  v_second record;
begin
  delete from public.account_deletion_jobs where user_id = 'e2222222-2222-4222-8222-222222222222';

  select * into v_job from public.begin_account_deletion('e2222222-2222-4222-8222-222222222222');
  if v_job.status <> 'running' or v_job.attempts <> 1 then
    raise exception 'UJI GAGAL: job awal tidak dibuat dengan benar: %', row_to_json(v_job);
  end if;

  perform public.finish_account_deletion(v_job.job_id, 'completed', 'done', null);

  select * into v_second from public.begin_account_deletion('e2222222-2222-4222-8222-222222222222');
  if v_second.status <> 'completed' or v_second.attempts <> 1 then
    raise exception 'UJI GAGAL: job selesai tidak idempoten: %', row_to_json(v_second);
  end if;
end;
$$;

reset role;

-- 18. Jaring pengaman: menghapus auth user di luar Edge Function tidak boleh
--     meninggalkan profil aktif. Trigger menjalankan purge yang sama sebelum
--     baris auth hilang.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'eccc3333-3333-4333-8333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'p0.hapus.c@contoh.test', now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"p0_hapus_c","display_name":"P0 Hapus C"}',
  now(), now()
);

insert into public.hazard_reports (
  id, reporter_id, category, description, severity, latitude, longitude,
  status, expires_at
) values (
  'e9999999-9999-4999-8999-999999999998',
  'eccc3333-3333-4333-8333-333333333333',
  'road_block', 'Jalan tertutup', 'high', -6.3, 106.9,
  'active', now() + interval '2 hours'
);

do $$
begin
  if not exists (
    select 1 from public.profiles where id = 'eccc3333-3333-4333-8333-333333333333'
  ) then
    raise exception 'UJI GAGAL: profil C tidak dibuat oleh bootstrap';
  end if;
end;
$$;

delete from auth.users where id = 'eccc3333-3333-4333-8333-333333333333';

do $$
begin
  if exists (
    select 1 from auth.users where id = 'eccc3333-3333-4333-8333-333333333333'
  ) then
    raise exception 'UJI GAGAL: auth user C masih ada';
  end if;

  if exists (
    select 1 from public.profiles where id = 'eccc3333-3333-4333-8333-333333333333'
  ) then
    raise exception 'UJI GAGAL: profil aktif tertinggal setelah auth user C dihapus';
  end if;

  if not exists (
    select 1 from public.hazard_reports
    where id = 'e9999999-9999-4999-8999-999999999998'
      and reporter_id = '00000000-0000-4000-8000-000000000001'
      and description = 'Jalan tertutup'
  ) then
    raise exception 'UJI GAGAL: laporan bahaya C tidak dipertahankan lewat trigger';
  end if;
end;
$$;

do $$
begin
  raise notice 'UJI HAPUS AKUN LULUS: profil hilang, data pribadi terhapus, konten bersama anonim, kepemilikan dialihkan, JWT lama ditolak, Auth user bisa dihapus tanpa merusak data, dan penghapusan auth di luar fungsi tidak meninggalkan profil aktif';
end;
$$;

rollback;
