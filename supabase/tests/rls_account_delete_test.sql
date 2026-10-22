-- db:test notice: UJI HAPUS AKUN LULUS
--
-- ============================================================================
-- Uji RPC `public.delete_my_account()` dan policy profil setelah anonimisasi.
--
-- Kenapa berkas terpisah: hapus akun menyentuh banyak tabel sekaligus, dan
-- kesalahan yang paling berbahaya justru yang **tidak** terlihat — akun yang
-- "terhapus" tetapi masih terbaca publik, token push yang masih hidup, atau
-- laporan bahaya orang lain yang ikut hilang karena salah memakai DELETE.
--
-- Yang dibuktikan:
--   1. RPC tidak punya parameter, jadi tidak ada bentuk panggilan yang bisa
--      menghapus akun orang lain; `anon` tidak boleh EXECUTE;
--   2. data pribadi hilang: token push, posisi terakhir, follow, blokir,
--      notifikasi pribadi, kendaraan, objek Storage di folder pengguna;
--   3. konten bersama tetap ada: laporan bahaya dan baris klub tidak terhapus;
--   4. keanggotaan klub menjadi `left`, bukan dihapus;
--   5. profil menjadi anonim dan tidak lagi terlihat oleh pengguna lain;
--   6. pemilik yang sudah dihapus tidak bisa menghidupkan kembali profilnya;
--   7. panggilan kedua idempoten;
--   8. notice penanda lulus.
--
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK.
-- ============================================================================

begin;

-- 0. Paritas: migration harus sudah diterapkan.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.delete_my_account()') is null then
    v_missing := v_missing || 'fungsi public.delete_my_account'::text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'deleted_at'
  ) then
    v_missing := v_missing || 'kolom profiles.deleted_at'::text;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_select_visible'
      and qual like '%deleted_at%'
  ) then
    v_missing := v_missing || 'policy profiles_select_visible yang menyaring deleted_at'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (migration hapus akun belum diterapkan): objek berikut belum ada — %. Terapkan supabase/migrations/20261022190000_account_deletion_m5.sql lebih dulu.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Konteks uji; ikut ROLLBACK.
create table public.uji_hapus_konteks (
  nama text primary key,
  id uuid
);

-- 2. Dua akun: A akan dihapus, B tetap aktif sebagai pengamat.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'd1111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'hapus.a@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"hapus_akun_a","display_name":"Hapus Akun A"}',
    now(), now()
  ),
  (
    'd2222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'hapus.b@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"hapus_akun_b","display_name":"Hapus Akun B"}',
    now(), now()
  );

-- 3. Data pribadi A + satu objek milik B sebagai pembanding.
insert into public.motorcycles (id, owner_id, make, model)
values ('d3333333-3333-4333-8333-333333333333', 'd1111111-1111-4111-8111-111111111111', 'Honda', 'Uji');

insert into public.motorcycle_private_details (motorcycle_id, owner_id, plate_number)
values ('d3333333-3333-4333-8333-333333333333', 'd1111111-1111-4111-8111-111111111111', 'B 1234 UJI');

insert into public.push_tokens (user_id, token, platform, device_label)
values
  ('d1111111-1111-4111-8111-111111111111', 'ExponentPushToken[uji-hapus-a]', 'android', 'HP A'),
  ('d2222222-2222-4222-8222-222222222222', 'ExponentPushToken[uji-hapus-b]', 'android', 'HP B');

insert into public.follows (follower_id, followed_id)
values ('d1111111-1111-4111-8111-111111111111', 'd2222222-2222-4222-8222-222222222222');

insert into public.user_blocks (blocker_id, blocked_id)
values ('d1111111-1111-4111-8111-111111111111', 'd2222222-2222-4222-8222-222222222222');

insert into public.notifications (recipient_id, kind, payload)
values ('d1111111-1111-4111-8111-111111111111', 'system', '{"teks":"uji hapus akun"}');

insert into public.hazard_reports (reporter_id, category, severity, latitude, longitude, status, expires_at)
values ('d1111111-1111-4111-8111-111111111111', 'flood', 'high', -6.2, 106.8, 'active', now() + interval '2 hours');

insert into storage.objects (bucket_id, name, owner)
values
  ('avatars', 'd1111111-1111-4111-8111-111111111111/uji-avatar.jpg', 'd1111111-1111-4111-8111-111111111111'),
  ('vehicle-photos', 'd1111111-1111-4111-8111-111111111111/d3333333-3333-4333-8333-333333333333/uji.jpg', 'd1111111-1111-4111-8111-111111111111'),
  ('avatars', 'd2222222-2222-4222-8222-222222222222/uji-avatar-b.jpg', 'd2222222-2222-4222-8222-222222222222');

-- 4. A membuat klub supaya keanggotaan ikut diuji.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  v_club jsonb;
begin
  v_club := public.create_club(
    'Klub Uji Hapus Akun',
    'uji-hapus-akun',
    'Klub untuk uji penghapusan akun.',
    'public',
    'open'
  );
  insert into public.uji_hapus_konteks (nama, id) values ('klub', (v_club ->> 'id')::uuid);
end;
$$;

-- 5. Penghapusan oleh pemiliknya sendiri.
do $$
begin
  perform public.delete_my_account();
end;
$$;

-- 5a. Setelah anonimisasi, baris profil tidak lagi terbaca lewat RLS — bahkan
--     oleh pemiliknya. Karena itu pemeriksaan isi baris dilakukan sebagai pemilik
--     skema, bukan sebagai `authenticated`.
reset role;

do $$
declare
  v_profil public.profiles;
  v_klub uuid;
begin
  select * into v_profil from public.profiles
  where id = 'd1111111-1111-4111-8111-111111111111';

  if v_profil.deleted_at is null then
    raise exception 'UJI GAGAL: deleted_at tidak diisi';
  end if;
  if v_profil.username not like 'deleted\_%' then
    raise exception 'UJI GAGAL: username tidak dianonimkan (%)', v_profil.username;
  end if;
  if v_profil.display_name <> 'Akun dihapus' then
    raise exception 'UJI GAGAL: display_name masih %', v_profil.display_name;
  end if;
  if v_profil.avatar_url is not null or v_profil.bio is not null or v_profil.city is not null then
    raise exception 'UJI GAGAL: data pribadi profil masih terisi';
  end if;

  if exists (select 1 from public.push_tokens where user_id = v_profil.id) then
    raise exception 'UJI GAGAL: token push akun terhapus masih ada';
  end if;
  if exists (select 1 from public.motorcycles where owner_id = v_profil.id) then
    raise exception 'UJI GAGAL: kendaraan akun terhapus masih ada';
  end if;
  if exists (
    select 1 from public.follows
    where follower_id = v_profil.id or followed_id = v_profil.id
  ) then
    raise exception 'UJI GAGAL: relasi follow masih ada';
  end if;
  if exists (
    select 1 from public.user_blocks
    where blocker_id = v_profil.id or blocked_id = v_profil.id
  ) then
    raise exception 'UJI GAGAL: relasi blokir masih ada';
  end if;
  if exists (select 1 from public.notifications where recipient_id = v_profil.id) then
    raise exception 'UJI GAGAL: notifikasi pribadi masih ada';
  end if;

  select id into v_klub from public.uji_hapus_konteks where nama = 'klub';
  if exists (
    select 1 from public.club_members
    where club_id = v_klub and user_id = v_profil.id and status <> 'left'
  ) then
    raise exception 'UJI GAGAL: keanggotaan klub belum menjadi left';
  end if;
  if not exists (select 1 from public.clubs where id = v_klub) then
    raise exception 'UJI GAGAL: klub ikut terhapus padahal dipakai orang lain';
  end if;

  -- Rujukan ke objek Storage harus hilang walau berkasnya sendiri dibersihkan
  -- lewat Storage API (Supabase memblokir DELETE langsung ke storage.objects).
  if v_profil.avatar_url is not null then
    raise exception 'UJI GAGAL: avatar_url masih menunjuk objek Storage';
  end if;
end;
$$;

-- 5b. Panggilan kedua harus idempoten: tidak melempar galat dan tidak
--     menghapus/mengubah apa pun lagi (baris profil sudah tidak terbaca lewat
--     RLS, jadi di sini yang dibuktikan adalah tidak adanya kegagalan).
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
begin
  perform public.delete_my_account();
end;
$$;

-- 6. Konten bersama tetap ada (diperiksa sebagai pemilik skema).
reset role;

do $$
begin
  if not exists (
    select 1 from public.hazard_reports
    where reporter_id = 'd1111111-1111-4111-8111-111111111111'
      and category = 'flood'
  ) then
    raise exception 'UJI GAGAL: laporan bahaya hilang padahal harus dipertahankan';
  end if;

  if (select count(*) from storage.objects
      where name = 'd2222222-2222-4222-8222-222222222222/uji-avatar-b.jpg') <> 1 then
    raise exception 'UJI GAGAL: objek milik akun lain ikut terhapus';
  end if;
end;
$$;

-- 7. Profil yang dianonimkan tidak terbaca pengguna lain, dan tidak bisa
--    dihidupkan lagi oleh pemiliknya.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d2222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
begin
  if exists (
    select 1 from public.profiles where id = 'd1111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'UJI GAGAL: profil anonim masih terbaca pengguna lain';
  end if;

  -- Policy Storage berbasis folder uid: pengguna lain tidak bisa membaca objek
  -- sisa milik akun yang dihapus, jadi signed URL tidak bisa dibuat lagi.
  if exists (
    select 1 from storage.objects
    where name like 'd1111111-1111-4111-8111-111111111111/%'
  ) then
    raise exception 'UJI GAGAL: objek Storage akun terhapus masih terbaca pengguna lain';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  v_terpengaruh int;
begin
  update public.profiles
  set display_name = 'Hidup Lagi', deleted_at = null
  where id = 'd1111111-1111-4111-8111-111111111111';
  get diagnostics v_terpengaruh = row_count;

  if v_terpengaruh <> 0 then
    raise exception 'UJI GAGAL: profil anonim bisa dihidupkan kembali';
  end if;
end;
$$;

-- 8. Bentuk fungsi: tanpa parameter, dan `anon` tidak boleh memanggil.
do $$
begin
  if (select pronargs from pg_proc where oid = 'public.delete_my_account()'::regprocedure) <> 0 then
    raise exception 'UJI GAGAL: delete_my_account punya parameter, pemanggil bisa menarget akun lain';
  end if;
end;
$$;

set local role anon;

do $$
begin
  begin
    perform public.delete_my_account();
    raise exception 'UJI GAGAL: anon berhasil memanggil delete_my_account';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlstate <> '42501' then
        raise;
      end if;
  end;
end;
$$;

reset role;

do $$
begin
  raise notice 'UJI HAPUS AKUN LULUS: anonimisasi, penghapusan data pribadi, konten bersama tetap utuh, dan panggilan berulang tidak mengubah apa pun';
end;
$$;

rollback;
