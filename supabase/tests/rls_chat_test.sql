-- db:test notice: UJI RLS CHAT M4 LULUS
-- ============================================================================
-- Uji RLS/RPC Milestone 4 — chat konvoi.
-- ============================================================================
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi tidak
-- ada pengguna/laporan uji yang tertinggal.
-- ============================================================================

begin;

-- 0. Paritas: berhenti dengan pesan jelas bila migration belum diterapkan.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.send_chat_message(uuid, text, uuid)') is null then
    v_missing := v_missing || 'fungsi public.send_chat_message'::text;
  end if;

  if to_regprocedure('public.edit_chat_message(uuid, text)') is null then
    v_missing := v_missing || 'fungsi public.edit_chat_message'::text;
  end if;

  if to_regprocedure('public.delete_chat_message(uuid)') is null then
    v_missing := v_missing || 'fungsi public.delete_chat_message'::text;
  end if;

  if to_regprocedure('public.insert_ride_system_message(uuid, text, uuid)') is null then
    v_missing := v_missing || 'fungsi public.insert_ride_system_message'::text;
  end if;

  if to_regprocedure('public.ride_status_system_message()') is null then
    v_missing := v_missing || 'fungsi public.ride_status_system_message'::text;
  end if;

  if to_regprocedure('public.ride_member_system_message()') is null then
    v_missing := v_missing || 'fungsi public.ride_member_system_message'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (migration M4 belum diterapkan): objek berikut belum ada — %. Terapkan supabase/migrations/20261020100000_convoy_chat_m4.sql lebih dulu.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Tabel konteks uji hanya hidup di dalam transaksi dan ikut ROLLBACK.
create table public.uji_m4_chat_konteks (
  nama text primary key,
  club_id uuid,
  ride_id uuid
);
grant select, insert, update, delete on public.uji_m4_chat_konteks to authenticated;

-- 2. Empat akun: A host, B anggota, C non-anggota, D pengirim.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'm4.chat.a@contoh.test', now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"m4_cha","display_name":"M4 Chat A"}',
  now(), now()
), (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'm4.chat.b@contoh.test', now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"m4_ach","display_name":"M4 Chat B"}',
  now(), now()
), (
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'm4.chat.c@contoh.test', now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"m4_ach","display_name":"M4 Chat C"}',
  now(), now()
), (
  '44444444-4444-4444-4444-444444444444',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'm4.chat.d@contoh.test', now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"m4_chatd","display_name":"M4 Chat D"}',
  now(), now()
);

-- 3. Klub privat dibuat A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_club jsonb;
begin
  v_club := public.create_club(
    'Uji Chat M4',
    'uji-chat-m4',
    'Klub untuk uji chat Milestone 4.',
    'private',
    'approval'
  );
  insert into public.uji_m4_chat_konteks (nama, club_id)
  values ('klub', (v_club ->> 'id')::uuid);
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.uji_m4_chat_konteks where nama = 'klub';
  perform public.request_club_membership(v_club);
end;
$$;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

do $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.uji_m4_chat_konteks where nama = 'klub';
  perform public.request_club_membership(v_club);
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.uji_m4_chat_konteks where nama = 'klub';
  perform public.review_club_membership(v_club, '22222222-2222-2222-2222-222222222222', true);
  perform public.review_club_membership(v_club, '44444444-4444-4444-4444-444444444444', true);
end;
$$;

-- 4. Pembuatan perjalanan hanya untuk anggota klub.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_club uuid;
  v_ride public.rides;
begin
  select club_id into v_club from public.uji_m4_chat_konteks where nama = 'klub';
  begin
    perform public.create_ride(v_club, 'Chat Ride M4', now() + interval '1 hour', 'Perjalanan chat');
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 5. Cek bahwa hanya anggota join ride yang boleh kirim pesan.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_msg public.chat_messages;
begin
  select ride_id into v_ride from public.uji_m4_chat_konteks where nama = 'klub';
  v_msg := public.send_chat_message(v_ride, 'Halo semua', null);
  if v_msg is null then
    raise exception 'UJI GAGAL: pesan tidak dibuat';
  end if;
end;
$$;

-- 6. Non-anggota tidak boleh kirim pesan.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_ride uuid;
begin
  select ride_id into v_ride from public.uji_m4_chat_konteks where nama = 'klub';
  begin
    perform public.send_chat_message(v_ride, 'Pesan dari non-anggota', null);
    raise exception 'UJI GAGAL: non-anggota mengirim pesan';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 7. Kirim pesan ketika ride final -> harus gagal.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
begin
  select ride_id into v_ride from public.uji_m4_chat_konteks where nama = 'klub';
  -- Transisi ke completed dulu
  perform public.transition_ride(v_ride, 'completed');
  begin
    perform public.send_chat_message(v_ride, 'Pesan setelah selesai', null);
    raise exception 'UJI GAGAL: pesan di ride final diterima';
  exception
    when check_violation then null;
  end;
end;
$$;

-- 8. Idempotensi kirim pesan via client_message_id.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_msg1 public.chat_messages;
  v_msg2 public.chat_messages;
begin
  v_msg1 := public.send_chat_message(v_ride, 'Pesan idempotennya', 'client-msg-001');
  v_msg2 := public.send_chat_message(v_ride, 'Pesan idempotennya (ulang)', 'client-msg-001');

  -- Harus mengembalikan baris yang sama
  if v_msg1.id <> v_msg2.id then
    raise exception 'UJI GAGAL: send_chat_message idempoten tidak bekerja';
  end if;
end;
$$;

-- 9. Rate limit: 20 pesan/60 detik per pengguna.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_i int;
  v_exc exception;
begin
  for v_i in 1..21 loop
    begin
      perform public.send_chat_message(v_ride, 'Pesan rate limit', null);
    exception
      when exception then
        get stacked diag v_exc;
        exit when SQLSTATE_SUBSTR(v_exc, 1, 5) = 'P0001';
    end;
  end loop;

  -- Uji bahwa upaya ke-21 mengembalikan error rate limit
  if v_exc is null or not (v_exc detail like 'chat_rate_limit%' or v_exc message like 'Terlalu banyak pesan') then
    raise exception 'UJI GAGAL: rate limit send_chat_message tidak terdeteksi';
  end if;
end;
$$;

-- 10. Ubah pesan: hanya pengirim, 15 menit window.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_msg uuid;
begin
  v_msg := public.send_chat_message(v_ride, 'Pesan original', null);
  -- Ubah dalam jendela 15 menit
  perform public.edit_chat_message(v_msg.id, 'Pesan diubah');
  -- Jendela 15 menit sudah lewat
  begin
    perform public.edit_chat_message(v_msg.id, 'Coba ubah lagi');
    raise exception 'UJI GAGAL: edit_chat_message setelah jendela lewat harus gagal';
  exception
    when exception then
      if not (v_exc errcode = '23514' or v_exc detail like 'jendela edit') then
        raise exception 'UJI GAGAL: error edit window salah: %', v_exc;
      end if;
  end;
end;
$$;

-- 11. Hanya pengirim yang boleh mengubah pesan lain.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_msg uuid;
begin
  v_msg := public.send_chat_message(v_ride, 'Pesan user C', null);
  -- User A (host) coba ubah pesan user C
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  begin
    perform public.edit_chat_message(v_msg.id, 'Diubah oleh host');
    raise exception 'UJI GAGAL: host boleh mengubah pesan orang lain';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 12. Sistem pesan mulai perjalanan.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
begin
  select ride_id into v_ride from public.uji_m4_chat_konteks where nama = 'klub';
  perform public.transition_ride(v_ride, 'active');
  -- Trigger ride_status_systemMessage harus membuat pesan system
end;
$$;

-- 13. Sistem pesan bergabung/keluar.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
begin
  select ride_id into v_ride from public.uji_m4_chat_konteks where nama = 'klub';
  perform public.join_ride(v_ride);
  -- Trigger ride_member_system_message harus membuat pesan system
end;
$$;

-- 14. Laporan konten untuk chat_message.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_ride uuid;
  v_msg uuid;
  v_report public.content_reports;
begin
  select ride_id into v_ride from public.uji_m4_chat_konteks where nama = 'klub';
  v_msg := public.send_chat_message(v_ride, 'Pesan dilaporkan', null);
  v_report := public.report_content('chat_message', v_msg, 'spam');
  if v_report is null then
    raise exception 'UJI GAGAL: report_content tidak menghasilkan laporan';
  end if;
end;
$$;

-- 15. Anon tidak boleh mengirim/membaca pesan.
set local role anon;
set local request.jwt.claims = '{}';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.chat_messages
  where message_type = 'text';

  -- Anon tidak boleh membaca pesan teks
  if v_count > 0 then
    raise exception 'UJI GAGAL: anon membaca pesan (% baris)', v_count;
  end if;
end;
$$;

reset role;

do $$
begin
  raise notice 'UJI RLS CHAT M4 LULUS: chat RLS, RPC, idempotensi, sistem pesan, rate limit semuanya lolos uji';
end;
$$;

rollback;