-- db:test notice: UJI RLS CHAT M4 LULUS
-- ============================================================================
-- Uji RLS/RPC Milestone 4 — chat konvoi.
-- ============================================================================
-- Desain yang diuji (lihat supabase/migrations/20261020100000_convoy_chat_m4.sql
-- dan 20261021130000_blocked_chat_server_filter.sql, MILESTONE_4_PLAN bagian 3):
-- seluruh tulis chat melewati RPC `security definer`; jalur tulis langsung
-- dicabut; baca lewat `chat_select_ride_member` (hanya peserta `joined`, dan
-- pesan teks dari pengguna yang memblokir saya tidak pernah terkirim).
--
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi tidak
-- ada pengguna/perjalanan/pesan uji yang tertinggal.
--
-- Pola penangkapan galat: blok inner menangkap SQLSTATE yang diharapkan lalu
-- menyimpannya; bila RPC justru SUKSES, `raise exception 'UJI GAGAL ...'`
-- (SQLSTATE P0001) ditembak dan TIDAK tertangkap handler (khusus SQLSTATE itu),
-- sehingga kegagalan uji selalu terlihat jelas.
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

  if to_regprocedure('public.report_content(text, uuid, text, text)') is null then
    v_missing := v_missing || 'fungsi public.report_content'::text;
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
  id uuid
);
grant select, insert, update, delete on public.uji_m4_chat_konteks to authenticated;

-- 2. Lima akun: A host, B peserta uji utama, C orang luar, D peserta uji
--    lintas-pengguna, E khusus uji rate limit.
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m4ch.a@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"m4ch_a","display_name":"M4Ch A"}',now(),now()),
  ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m4ch.b@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"m4ch_b","display_name":"M4Ch B"}',now(),now()),
  ('33333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m4ch.c@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"m4ch_c","display_name":"M4Ch C"}',now(),now()),
  ('44444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m4ch.d@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"m4ch_d","display_name":"M4Ch D"}',now(),now()),
  ('55555555-5555-4555-8555-555555555555','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m4ch.e@contoh.test',now(),'{"provider":"email","providers":["email"]}','{"username":"m4ch_e","display_name":"M4Ch E"}',now(),now());

-- 3. Klub privat + perjalanan: A membuat keduanya (A host `joined`); B, D, E
--    meminta klub, disetujui A, lalu join ride. C tetap orang luar.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_club jsonb;
  v_ride public.rides;
begin
  v_club := public.create_club('Uji Chat M4','uji-chat-m4','Klub untuk uji chat Milestone 4.','private','approval');
  insert into public.uji_m4_chat_konteks (nama, id) values ('klub', (v_club ->> 'id')::uuid);

  v_ride := public.create_ride((v_club ->> 'id')::uuid, 'Ride Chat M4', now() + interval '1 hour', 'Perjalanan uji chat.', 'Titik kumpul', 'Tujuan');
  insert into public.uji_m4_chat_konteks (nama, id) values ('ride', v_ride.id);
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
begin
  perform public.request_club_membership((select id from public.uji_m4_chat_konteks where nama = 'klub'));
end;
$$;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
begin
  perform public.request_club_membership((select id from public.uji_m4_chat_konteks where nama = 'klub'));
end;
$$;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
begin
  perform public.request_club_membership((select id from public.uji_m4_chat_konteks where nama = 'klub'));
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_club uuid;
begin
  select id into v_club from public.uji_m4_chat_konteks where nama = 'klub';
  perform public.review_club_membership(v_club, '22222222-2222-4222-8222-222222222222', true);
  perform public.review_club_membership(v_club, '44444444-4444-4444-8444-444444444444', true);
  perform public.review_club_membership(v_club, '55555555-5555-4555-8555-555555555555', true);
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ begin
  perform public.join_ride((select id from public.uji_m4_chat_konteks where nama = 'ride'));
end; $$;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$ begin
  perform public.join_ride((select id from public.uji_m4_chat_konteks where nama = 'ride'));
end; $$;

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$ begin
  perform public.join_ride((select id from public.uji_m4_chat_konteks where nama = 'ride'));
end; $$;

-- 4. Non-anggota tidak boleh mengirim pesan (C).
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';
  begin
    perform public.send_chat_message(v_ride, 'Pesan dari orang luar', null);
    raise exception 'UJI GAGAL: non-anggota mengirim pesan';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '42501' or v_detail is distinct from 'chat_not_member' then
    raise exception 'UJI GAGAL: penolakan non-anggota salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 5. Anggota aktif membaca dan menulis; non-anggota menerima nol baris.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_msg public.chat_messages;
  v_n int;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';

  v_msg := public.send_chat_message(v_ride, 'Halo semua, pesan B.', null);
  if v_msg.id is null then
    raise exception 'UJI GAGAL: pesan anggota tidak dibuat';
  end if;
  insert into public.uji_m4_chat_konteks (nama, id) values ('pesan_b', v_msg.id);

  select count(*) into v_n from public.chat_messages where ride_id = v_ride and message_type = 'text';
  if v_n < 1 then
    raise exception 'UJI GAGAL: anggota aktif tidak membaca pesan teks (% baris)', v_n;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.chat_messages;
  if v_n <> 0 then
    raise exception 'UJI GAGAL: non-anggota membaca % pesan chat', v_n;
  end if;
end;
$$;

-- 6. Idempotensi: client_message_id sama + pengirim sama → baris yang sama.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_m1 public.chat_messages;
  v_m2 public.chat_messages;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';

  v_m1 := public.send_chat_message(v_ride, 'Pesan idempoten', '11111111-2222-4333-8444-555555555555');
  v_m2 := public.send_chat_message(v_ride, 'Pesan idempoten (ulang)', '11111111-2222-4333-8444-555555555555');

  if v_m1.id is distinct from v_m2.id then
    raise exception 'UJI GAGAL: idempotensi client_message_id membuat baris kedua';
  end if;
end;
$$;

-- 7. Ubah pesan: hanya pengirim (D kirim, B coba ubah → ditolak).
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_msg public.chat_messages;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';
  v_msg := public.send_chat_message(v_ride, 'Pesan D untuk uji lintas-edit.', null);
  insert into public.uji_m4_chat_konteks (nama, id) values ('pesan_d', v_msg.id);
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_id from public.uji_m4_chat_konteks where nama = 'pesan_d';
  begin
    perform public.edit_chat_message(v_id, 'Diubah oleh bukan pengirim');
    raise exception 'UJI GAGAL: pengguna lain mengubah pesan orang';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '42501' or v_detail is distinct from 'chat_not_sender' then
    raise exception 'UJI GAGAL: edit lintas-pengirim salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 8. Ubah pesan sendiri dalam jendela 15 menit → edited_at terisi.
do $$
declare
  v_id uuid;
  v_u public.chat_messages;
begin
  select id into v_id from public.uji_m4_chat_konteks where nama = 'pesan_b';
  v_u := public.edit_chat_message(v_id, 'Pesan B yang sudah diubah.');

  if v_u.edited_at is null then
    raise exception 'UJI GAGAL: edit_chat_message tidak mengisi edited_at';
  end if;
  if v_u.content <> 'Pesan B yang sudah diubah.' then
    raise exception 'UJI GAGAL: isi pesan tidak berubah setelah edit';
  end if;
end;
$$;

-- 9. Ubah pesan sistem ditolak (B mengedit pesan sistem yang ia kirim saat join).
do $$
declare
  v_id uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_id
    from public.chat_messages
   where message_type = 'system'
     and sender_id = '22222222-2222-4222-8222-222222222222'
   limit 1;

  if v_id is null then
    raise exception 'UJI GAGAL: tidak ada pesan sistem milik B untuk diuji';
  end if;

  begin
    perform public.edit_chat_message(v_id, 'Sistem diubah');
    raise exception 'UJI GAGAL: pesan sistem dapat diubah';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '42501' or v_detail is distinct from 'chat_system_message' then
    raise exception 'UJI GAGAL: penolakan edit sistem salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 10. Hapus: soft delete milik sendiri, idempoten; lintas-pengirim ditolak.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_msg public.chat_messages;
  v_r public.chat_messages;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';
  v_msg := public.send_chat_message(v_ride, 'Pesan yang akan dihapus.', null);

  v_r := public.delete_chat_message(v_msg.id);
  if v_r.deleted_at is null then
    raise exception 'UJI GAGAL: delete_chat_message tidak mengisi deleted_at';
  end if;

  -- Idempoten: hapus ulang tidak error dan tidak mengubah baris.
  v_r := public.delete_chat_message(v_msg.id);
  if v_r.deleted_at is null then
    raise exception 'UJI GAGAL: hapus ulang kehilangan deleted_at';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_id from public.uji_m4_chat_konteks where nama = 'pesan_d';
  begin
    perform public.delete_chat_message(v_id);
    raise exception 'UJI GAGAL: pengguna lain menghapus pesan orang';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '42501' or v_detail is distinct from 'chat_not_sender' then
    raise exception 'UJI GAGAL: hapus lintas-pengirim salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 11. Jendela edit 15 menit: setelah lewat, pengirim sendiri ditolak 23514.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_msg public.chat_messages;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';
  v_msg := public.send_chat_message(v_ride, 'Pesan D untuk uji jendela edit.', null);
  insert into public.uji_m4_chat_konteks (nama, id) values ('pesan_d_win', v_msg.id);
end;
$$;

reset role;
do $$
declare v_id uuid;
begin
  select id into v_id from public.uji_m4_chat_konteks where nama = 'pesan_d_win';
  update public.chat_messages set created_at = now() - interval '16 minutes' where id = v_id;
end;
$$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_id from public.uji_m4_chat_konteks where nama = 'pesan_d_win';
  begin
    perform public.edit_chat_message(v_id, 'Terlambat mengubah');
    raise exception 'UJI GAGAL: edit setelah jendela 15 menit diterima';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '23514' or v_detail is distinct from 'chat_edit_window' then
    raise exception 'UJI GAGAL: jendela edit chat salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 12. Laporan penyalahgunaan: pelapor selalu auth.uid() (dirinya sendiri).
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_rep public.content_reports;
begin
  select id into v_id from public.uji_m4_chat_konteks where nama = 'pesan_d';
  v_rep := public.report_content('chat_message', v_id, 'harassment', 'Pesan kasar.');

  if v_rep.id is null then
    raise exception 'UJI GAGAL: report_content tidak menghasilkan laporan';
  end if;
  if v_rep.reporter_id <> auth.uid() then
    raise exception 'UJI GAGAL: pelapor laporan bukan auth.uid() (%)', v_rep.reporter_id;
  end if;
end;
$$;

-- 13. Pesan sistem untuk transisi status perjalanan (planned → active).
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_n int;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';
  perform public.transition_ride(v_ride, 'active');

  select count(*) into v_n
    from public.chat_messages
   where ride_id = v_ride
     and message_type = 'system'
     and content = 'Perjalanan dimulai';

  if v_n <> 1 then
    raise exception 'UJI GAGAL: pesan sistem "Perjalanan dimulai" tidak dibuat trigger (% baris)', v_n;
  end if;
end;
$$;

-- 14. Rate limit 20 pesan / 60 detik / pengguna (E). Percobaan ke-21 ditolak.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_i int;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';

  for v_i in 1..21 loop
    begin
      perform public.send_chat_message(v_ride, 'Pesan rate limit ' || v_i, null);
    exception when others then
      get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
      exit when v_state = 'P0001';
    end;
  end loop;

  if v_state is distinct from 'P0001' or v_detail is distinct from 'chat_rate_limit' then
    raise exception 'UJI GAGAL: rate limit send_chat_message tidak terdeteksi (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 15. Peserta yang keluar (left) tidak lagi membaca pesan; host tetap bisa.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ begin
  perform public.leave_ride((select id from public.uji_m4_chat_konteks where nama = 'ride'));
end; $$;

do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.chat_messages where message_type = 'text';
  if v_n <> 0 then
    raise exception 'UJI GAGAL: peserta yang keluar masih membaca % pesan teks', v_n;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.chat_messages where message_type = 'text';
  if v_n < 1 then
    raise exception 'UJI GAGAL: host tidak lagi membaca pesan setelah peserta keluar (% baris)', v_n;
  end if;

  -- Pesan sistem "keluar" ikut tercatat untuk transisi joined → left.
  if not exists (
    select 1 from public.chat_messages
     where message_type = 'system'
       and content like '%keluar'
  ) then
    raise exception 'UJI GAGAL: pesan sistem keluar tidak dibuat trigger';
  end if;
end;
$$;

-- 15b. Peserta yang dikeluarkan host (removed) juga kehilangan akses chat,
--      bukan hanya peserta yang keluar sendiri (left) seperti langkah 15.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ begin
  perform public.remove_ride_member(
    (select id from public.uji_m4_chat_konteks where nama = 'ride'),
    '55555555-5555-4555-8555-555555555555'
  );
end; $$;

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_n int;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';

  select count(*) into v_n
  from public.chat_messages
  where ride_id = v_ride and message_type = 'text';
  if v_n <> 0 then
    raise exception 'UJI GAGAL: peserta yang dikeluarkan masih membaca % pesan teks', v_n;
  end if;

  begin
    perform public.send_chat_message(v_ride, 'Pesan setelah dikeluarkan', null);
    raise exception 'UJI GAGAL: peserta yang dikeluarkan masih mengirim pesan';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '42501' or v_detail is distinct from 'chat_not_member' then
    raise exception 'UJI GAGAL: penolakan peserta yang dikeluarkan salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 16. Ride final (completed) tidak menerima pesan baru.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  v_ride uuid;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';
  perform public.transition_ride(v_ride, 'completed');
end;
$$;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_state text := null;
  v_detail text := null;
begin
  select id into v_ride from public.uji_m4_chat_konteks where nama = 'ride';
  begin
    perform public.send_chat_message(v_ride, 'Pesan setelah selesai', null);
    raise exception 'UJI GAGAL: pesan diterima pada ride yang sudah selesai';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  end;

  if v_state is distinct from '23514' or v_detail is distinct from 'chat_ride_final' then
    raise exception 'UJI GAGAL: penolakan ride final salah (state=%, detail=%)', v_state, v_detail;
  end if;
end;
$$;

-- 17. Anon: tidak membaca dan tidak mengirim.
set local role anon;
set local request.jwt.claims = '{}';
do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.chat_messages where message_type = 'text';
  if v_n > 0 then
    raise exception 'UJI GAGAL: anon membaca % pesan chat', v_n;
  end if;

  if has_function_privilege('anon', 'public.send_chat_message(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon boleh EXECUTE send_chat_message';
  end if;
end;
$$;

reset role;

do $$
begin
  raise notice 'UJI RLS CHAT M4 LULUS: chat RLS, RPC, idempotensi, jendela edit, rate limit, pesan sistem, dan ride final semuanya lolos uji';
end;
$$;

rollback;
