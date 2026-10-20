-- db:test notice: UJI FILTER BLOKIR CHAT LULUS
--
-- ============================================================================
-- Uji policy `chat_select_ride_member` untuk pemblokiran (ADR-068).
--
-- Kenapa berkas terpisah: perilaku ini menggantikan penyaringan di klien, jadi
-- yang harus dibuktikan adalah **server tidak pernah mengirim** pesan teks dari
-- pengguna yang diblokir — bukan sekadar menyembunyikannya di UI.
--
-- Yang dibuktikan:
--   1. hanya pemblokir sendiri yang dapat menulis/membaca hubungan blokirnya;
--   2. pemblokir tidak lagi membaca pesan teks dari pengguna yang ia blokir;
--   3. pesan sistem dari pengguna yang sama tetap terbaca (informasi perjalanan);
--   4. peserta lain yang tidak memblokir tetap membaca pesan itu;
--   5. pengirim tetap membaca pesannya sendiri;
--   6. membuka blokir memunculkan kembali riwayat tanpa perubahan data;
--   7. `anon` tidak boleh EXECUTE helper blokir;
--   8. policy tetap memuat penjaga keanggotaan (syarat ADR-060).
--
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK.
-- ============================================================================

begin;

-- 0. Paritas: pastikan migration filter blokir sudah diterapkan.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.is_blocked_by_me(uuid)') is null then
    v_missing := v_missing || 'fungsi public.is_blocked_by_me'::text;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_messages'
      and policyname = 'chat_select_ride_member'
  ) then
    v_missing := v_missing || 'policy chat_select_ride_member'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (migration filter blokir belum diterapkan): objek berikut belum ada — %. Terapkan supabase/migrations/20261021130000_blocked_chat_server_filter.sql lebih dulu.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Konteks uji; ikut ROLLBACK.
create table public.uji_blokir_konteks (
  nama text primary key,
  id uuid
);
grant select, insert, update, delete on public.uji_blokir_konteks to authenticated;

-- 2. Tiga akun: A host, B peserta yang akan diblokir, C peserta lain.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'a1111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'blokir.a@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"blokir_host_a","display_name":"Blokir Host A"}',
    now(), now()
  ),
  (
    'b1111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'blokir.b@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"blokir_rider_b","display_name":"Blokir Rider B"}',
    now(), now()
  ),
  (
    'c1111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'blokir.c@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"blokir_rider_c","display_name":"Blokir Rider C"}',
    now(), now()
  );

-- 3. Klub privat + ride; B dan C bergabung.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  v_club jsonb;
begin
  v_club := public.create_club(
    'Uji Filter Blokir',
    'uji-filter-blokir',
    'Klub untuk uji penyaringan blokir di server.',
    'private',
    'approval'
  );
  insert into public.uji_blokir_konteks (nama, id) values ('klub', (v_club ->> 'id')::uuid);
end;
$$;

set local request.jwt.claims = '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
begin
  perform public.request_club_membership((select id from public.uji_blokir_konteks where nama = 'klub'));
end;
$$;

set local request.jwt.claims = '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
begin
  perform public.request_club_membership((select id from public.uji_blokir_konteks where nama = 'klub'));
end;
$$;

set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_club uuid;
  v_ride public.rides;
begin
  select id into v_club from public.uji_blokir_konteks where nama = 'klub';
  perform public.review_club_membership(v_club, 'b1111111-1111-4111-8111-111111111111', true);
  perform public.review_club_membership(v_club, 'c1111111-1111-4111-8111-111111111111', true);

  v_ride := public.create_ride(
    v_club,
    'Ride Uji Filter Blokir',
    now() + interval '1 hour',
    'Perjalanan untuk uji filter blokir.',
    'Titik kumpul uji',
    'Tujuan uji'
  );
  insert into public.uji_blokir_konteks (nama, id) values ('ride', v_ride.id);
end;
$$;

set local request.jwt.claims = '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_msg public.chat_messages;
begin
  select id into v_ride from public.uji_blokir_konteks where nama = 'ride';
  perform public.join_ride(v_ride);
  v_msg := public.send_chat_message(v_ride, 'Pesan B yang harus tersembunyi', null);
  insert into public.uji_blokir_konteks (nama, id) values ('pesan_b', v_msg.id);
end;
$$;

set local request.jwt.claims = '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_ride uuid;
begin
  select id into v_ride from public.uji_blokir_konteks where nama = 'ride';
  perform public.join_ride(v_ride);
end;
$$;

-- 4. Hanya pemblokir yang melihat hubungan blokirnya.
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
begin
  if public.is_blocked_by_me('b1111111-1111-4111-8111-111111111111') then
    raise exception 'UJI GAGAL: blokir terbaca sebelum dibuat';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (
    'a1111111-1111-4111-8111-111111111111',
    'b1111111-1111-4111-8111-111111111111'
  );

  if not public.is_blocked_by_me('b1111111-1111-4111-8111-111111111111') then
    raise exception 'UJI GAGAL: pemblokir tidak membaca blokirnya sendiri';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
begin
  if public.is_blocked_by_me('b1111111-1111-4111-8111-111111111111') then
    raise exception 'UJI GAGAL: blokir orang lain terbaca oleh pengguna yang diblokir';
  end if;
  if public.is_blocked_by_me('a1111111-1111-4111-8111-111111111111') then
    raise exception 'UJI GAGAL: arah blokir terbaca dari sisi yang salah';
  end if;

  if exists (select 1 from public.user_blocks) then
    raise exception 'UJI GAGAL: pengguna yang diblokir membaca baris user_blocks';
  end if;
end;
$$;

-- 5. Pesan teks B hilang untuk A; pesan sistem dan pesan pengguna lain tetap ada.
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_text int;
  v_system int;
begin
  select count(*) into v_text
    from public.chat_messages
   where sender_id = 'b1111111-1111-4111-8111-111111111111'
     and message_type = 'text';

  if v_text <> 0 then
    raise exception 'UJI GAGAL: pemblokir masih membaca % pesan teks dari pengguna yang diblokir', v_text;
  end if;

  select count(*) into v_system
    from public.chat_messages
   where sender_id = 'b1111111-1111-4111-8111-111111111111'
     and message_type = 'system';

  if v_system < 1 then
    raise exception 'UJI GAGAL: pesan sistem dari pengguna yang diblokir ikut hilang';
  end if;

  -- Isi pesan yang diblokir tidak boleh muncul lewat jalur apa pun.
  if exists (
    select 1 from public.chat_messages
     where content = 'Pesan B yang harus tersembunyi'
  ) then
    raise exception 'UJI GAGAL: isi pesan pengguna yang diblokir masih terkirim ke pemblokir';
  end if;
end;
$$;

-- 6. Peserta lain dan pengirim sendiri tetap melihat pesan itu.
set local request.jwt.claims = '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_text int;
begin
  select count(*) into v_text
    from public.chat_messages
   where content = 'Pesan B yang harus tersembunyi';

  if v_text <> 1 then
    raise exception 'UJI GAGAL: peserta lain kehilangan pesan B (% baris)', v_text;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_text int;
begin
  select count(*) into v_text
    from public.chat_messages
   where content = 'Pesan B yang harus tersembunyi';

  if v_text <> 1 then
    raise exception 'UJI GAGAL: pengirim tidak lagi membaca pesannya sendiri (% baris)', v_text;
  end if;
end;
$$;

-- 7. Membuka blokir memunculkan kembali riwayat tanpa mengubah data.
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_text int;
begin
  delete from public.user_blocks
   where blocker_id = 'a1111111-1111-4111-8111-111111111111'
     and blocked_id = 'b1111111-1111-4111-8111-111111111111';

  select count(*) into v_text
    from public.chat_messages
   where content = 'Pesan B yang harus tersembunyi';

  if v_text <> 1 then
    raise exception 'UJI GAGAL: pesan tidak muncul kembali setelah blokir dibuka (% baris)', v_text;
  end if;
end;
$$;

-- 8. Policy tetap berpenjaga keanggotaan dan memuat penjaga blokir.
do $$
declare
  v_qual text;
begin
  select coalesce(qual, '') into v_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'chat_messages'
     and policyname = 'chat_select_ride_member';

  if v_qual not like '%is_ride_member%' then
    raise exception 'UJI GAGAL: policy chat kehilangan penjaga keanggotaan (ADR-060)';
  end if;

  if v_qual not like '%is_blocked_by_me%' then
    raise exception 'UJI GAGAL: policy chat tidak memuat penjaga blokir';
  end if;
end;
$$;

-- 9. Anon tidak bisa memanggil helper blokir.
set local role anon;
set local request.jwt.claims = '{}';

do $$
begin
  if has_function_privilege('anon', 'public.is_blocked_by_me(uuid)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon boleh EXECUTE is_blocked_by_me';
  end if;
end;
$$;

reset role;

do $$
begin
  raise notice 'UJI FILTER BLOKIR CHAT LULUS: pesan teks dari pengguna yang diblokir tidak pernah dikirim ke pemblokir';
end;
$$;

rollback;
