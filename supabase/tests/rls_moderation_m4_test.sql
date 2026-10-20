-- db:test notice: UJI MODERASI M4 LULUS
--
-- ============================================================================
-- Uji RLS/RPC dashboard moderasi (lanjutan Milestone 4).
--
-- Seluruh asersi berjalan dalam satu transaksi dan diakhiri ROLLBACK, jadi tidak
-- ada pengguna/klub/perjalanan/laporan uji yang tertinggal.
--
-- Yang dibuktikan:
--   1. antrean laporan hanya terbaca pihak berwenang: host perjalanan, admin
--      klub pemilik perjalanan, dan pelapor sendiri — bukan anggota biasa lain;
--   2. aksi moderasi ditolak untuk konten di luar wewenang, termasuk laporan
--      bahaya yang tidak tertaut perjalanan;
--   3. hapus hazard = status `removed`, hapus chat = `deleted_at`, keduanya
--      tanpa menghapus baris;
--   4. setiap aksi tercatat di `moderation_actions` dengan pelaku, alasan, dan
--      catatan, dan hanya bisa dibaca lewat RPC `list_moderation_actions`;
--   5. tabel audit tidak punya jalur tulis/baca langsung untuk klien;
--   6. status final tidak bisa diubah lagi (hazard final, laporan sudah ditinjau);
--   7. hapus chat idempoten: moderasi kedua tidak menambah baris audit;
--   8. `anon` tidak boleh EXECUTE RPC moderasi maupun audit.
-- ============================================================================

begin;

-- 0. Paritas: berhenti dengan pesan jelas bila migration belum diterapkan.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.moderation_actions') is null then
    v_missing := v_missing || 'tabel public.moderation_actions'::text;
  end if;

  if to_regprocedure('public.moderate_hazard(uuid,text,text,text)') is null then
    v_missing := v_missing || 'fungsi public.moderate_hazard'::text;
  end if;

  if to_regprocedure('public.moderate_chat_message(uuid,text,text)') is null then
    v_missing := v_missing || 'fungsi public.moderate_chat_message'::text;
  end if;

  if to_regprocedure('public.review_content_report(uuid,text,text)') is null then
    v_missing := v_missing || 'fungsi public.review_content_report'::text;
  end if;

  if to_regprocedure('public.list_moderation_actions(integer,text,uuid)') is null then
    v_missing := v_missing || 'fungsi public.list_moderation_actions'::text;
  end if;

  if to_regprocedure('public.get_moderation_subject(text,uuid)') is null then
    v_missing := v_missing || 'fungsi public.get_moderation_subject'::text;
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UJI GAGAL (migration moderasi belum diterapkan): objek berikut belum ada — %. Terapkan supabase/migrations/20261021120000_moderation_dashboard.sql lebih dulu.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- 1. Konteks uji. Tabel ini hanya hidup di dalam transaksi dan ikut ROLLBACK.
create table public.uji_m4mod_konteks (
  nama text primary key,
  id uuid
);
grant select, insert, update, delete on public.uji_m4mod_konteks to authenticated;

-- 2. Lima akun:
--    A = owner klub sekaligus host perjalanan R1 (moderator karena dua alasan),
--    B = rider R1 yang melaporkan konten,
--    C = anggota klub biasa (host perjalanan lain, bukan peserta R1),
--    E = bukan anggota klub,
--    F = admin klub yang **tidak** ikut perjalanan R1 (jalur admin klub).
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'a0000000-0000-4000-8000-00000000000a',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm4mod.a@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m4mod_host_a","display_name":"M4Mod Host A"}',
    now(), now()
  ),
  (
    'b0000000-0000-4000-8000-00000000000b',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm4mod.b@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m4mod_rider_b","display_name":"M4Mod Rider B"}',
    now(), now()
  ),
  (
    'c0000000-0000-4000-8000-00000000000c',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm4mod.c@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m4mod_member_c","display_name":"M4Mod Member C"}',
    now(), now()
  ),
  (
    'e0000000-0000-4000-8000-00000000000e',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm4mod.e@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m4mod_outsider_e","display_name":"M4Mod Outsider E"}',
    now(), now()
  ),
  (
    'f0000000-0000-4000-8000-00000000000f',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'm4mod.f@contoh.test', now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"m4mod_admin_f","display_name":"M4Mod Admin F"}',
    now(), now()
  );

-- 3. A membuat klub privat; B, C, dan F meminta bergabung; A menyetujui
--    semuanya dan mengangkat F menjadi admin klub.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}';

do $$
declare
  v_club jsonb;
begin
  v_club := public.create_club(
    'Uji Moderasi M4',
    'uji-moderasi-m4',
    'Klub untuk uji dashboard moderasi.',
    'private',
    'approval'
  );
  insert into public.uji_m4mod_konteks (nama, id)
  values ('klub', (v_club ->> 'id')::uuid);
end;
$$;

set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';
do $$
declare
  v_club uuid;
begin
  select id into v_club from public.uji_m4mod_konteks where nama = 'klub';
  perform public.request_club_membership(v_club);
end;
$$;

set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-00000000000c","role":"authenticated"}';
do $$
declare
  v_club uuid;
begin
  select id into v_club from public.uji_m4mod_konteks where nama = 'klub';
  perform public.request_club_membership(v_club);
end;
$$;

set local request.jwt.claims = '{"sub":"f0000000-0000-4000-8000-00000000000f","role":"authenticated"}';
do $$
declare
  v_club uuid;
begin
  select id into v_club from public.uji_m4mod_konteks where nama = 'klub';
  perform public.request_club_membership(v_club);
end;
$$;

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}';
do $$
declare
  v_club uuid;
begin
  select id into v_club from public.uji_m4mod_konteks where nama = 'klub';
  perform public.review_club_membership(v_club, 'b0000000-0000-4000-8000-00000000000b', true);
  perform public.review_club_membership(v_club, 'c0000000-0000-4000-8000-00000000000c', true);
  perform public.review_club_membership(v_club, 'f0000000-0000-4000-8000-00000000000f', true);
  perform public.set_club_member_role(v_club, 'f0000000-0000-4000-8000-00000000000f', 'admin');
end;
$$;

-- 4. A membuat R1 dan B bergabung. F sengaja tidak bergabung ke R1.
do $$
declare
  v_club uuid;
  v_ride public.rides;
begin
  select id into v_club from public.uji_m4mod_konteks where nama = 'klub';
  v_ride := public.create_ride(
    v_club,
    'Ride Moderasi M4',
    now() + interval '1 hour',
    'Perjalanan uji moderasi.',
    'Titik kumpul uji',
    'Tujuan uji'
  );
  insert into public.uji_m4mod_konteks (nama, id) values ('ride', v_ride.id);
end;
$$;

set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_status text;
begin
  select id into v_ride from public.uji_m4mod_konteks where nama = 'ride';
  v_status := public.join_ride(v_ride);

  if v_status <> 'joined' then
    raise exception 'UJI GAGAL: rider B tidak bergabung ke R1 (status %)', v_status;
  end if;
end;
$$;

-- 5. B mengirim satu pesan chat dan dua laporan bahaya (satu tertaut R1, satu
--    tanpa perjalanan), lalu melaporkan hazard R1 dan pesan chat itu.
do $$
declare
  v_ride uuid;
  v_hazard public.hazard_reports;
  v_message public.chat_messages;
  v_report public.content_reports;
begin
  select id into v_ride from public.uji_m4mod_konteks where nama = 'ride';

  v_message := public.send_chat_message(v_ride, 'Pesan uji moderasi dari B.');
  insert into public.uji_m4mod_konteks (nama, id) values ('pesan', v_message.id);

  v_hazard := public.create_hazard('pothole', 'moderate', -6.2, 106.8, 'Lubang uji moderasi', v_ride);
  insert into public.uji_m4mod_konteks (nama, id) values ('hazard_ride', v_hazard.id);

  v_report := public.report_content('hazard', v_hazard.id, 'unsafe_content', 'Bahaya untuk pengendara.');
  insert into public.uji_m4mod_konteks (nama, id) values ('laporan_hazard', v_report.id);

  v_report := public.report_content('chat_message', v_message.id, 'harassment', 'Kata-kata kasar.');
  insert into public.uji_m4mod_konteks (nama, id) values ('laporan_chat', v_report.id);

  v_hazard := public.create_hazard('flood', 'high', -6.3, 106.9, 'Banjir uji moderasi');
  insert into public.uji_m4mod_konteks (nama, id) values ('hazard_lepas', v_hazard.id);

  v_report := public.report_content('hazard', v_hazard.id, 'false_information', 'Tidak terjadi.');
  insert into public.uji_m4mod_konteks (nama, id) values ('laporan_lepas', v_report.id);
end;
$$;

-- 6. Antrean laporan dibatasi wewenang.
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';
do $$
declare
  v_rows int;
begin
  select count(*) into v_rows from public.content_reports;
  if v_rows <> 3 then
    raise exception 'UJI GAGAL: pelapor B melihat % laporan, seharusnya 3 laporan miliknya', v_rows;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}';
do $$
declare
  v_rows int;
begin
  -- Hanya dua laporan yang tertaut R1; laporan bahaya tanpa perjalanan tidak
  -- dapat dimoderasi dari aplikasi.
  select count(*) into v_rows from public.content_reports;
  if v_rows <> 2 then
    raise exception 'UJI GAGAL: host A melihat % laporan, seharusnya 2 (laporan R1 saja)', v_rows;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"f0000000-0000-4000-8000-00000000000f","role":"authenticated"}';
do $$
declare
  v_rows int;
begin
  select count(*) into v_rows from public.content_reports;
  if v_rows <> 2 then
    raise exception 'UJI GAGAL: admin klub F melihat % laporan, seharusnya 2', v_rows;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-00000000000c","role":"authenticated"}';
do $$
declare
  v_rows int;
  v_report uuid;
  v_hazard uuid;
begin
  select count(*) into v_rows from public.content_reports;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: anggota klub biasa C membaca % laporan moderasi', v_rows;
  end if;

  select id into v_report from public.uji_m4mod_konteks where nama = 'laporan_chat';
  select id into v_hazard from public.uji_m4mod_konteks where nama = 'hazard_ride';

  begin
    perform public.moderate_chat_message(
      (select id from public.uji_m4mod_konteks where nama = 'pesan'),
      'harassment',
      null
    );
    raise exception 'UJI GAGAL: anggota biasa C boleh menghapus pesan chat';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.moderate_hazard(v_hazard, 'remove', 'spam', null);
    raise exception 'UJI GAGAL: anggota biasa C boleh melepas laporan bahaya';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.review_content_report(v_report, 'dismissed', null);
    raise exception 'UJI GAGAL: anggota biasa C boleh meninjau laporan';
  exception
    when insufficient_privilege then null;
  end;

  select count(*) into v_rows from public.list_moderation_actions(50, null, null);
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: anggota biasa C membaca % baris audit moderasi', v_rows;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"e0000000-0000-4000-8000-00000000000e","role":"authenticated"}';
do $$
declare
  v_rows int;
begin
  select count(*) into v_rows from public.content_reports;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: non-anggota E membaca % laporan moderasi', v_rows;
  end if;

  -- Laporan bahaya tanpa perjalanan tidak dapat dimoderasi host mana pun.
  select count(*) into v_rows from public.hazard_reports;
  if v_rows < 1 then
    raise exception 'UJI GAGAL: laporan bahaya aktif tidak terbaca oleh pengguna terautentikasi';
  end if;
end;
$$;

-- 7. Laporan bahaya tanpa perjalanan ditolak walau pelakunya owner klub.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}';
do $$
declare
  v_hazard uuid;
begin
  select id into v_hazard from public.uji_m4mod_konteks where nama = 'hazard_lepas';

  begin
    perform public.moderate_hazard(v_hazard, 'remove', 'false_information', null);
    raise exception 'UJI GAGAL: hazard tanpa perjalanan dapat dimoderasi dari aplikasi';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 8. Host melepas hazard R1; status berubah, baris tidak hilang, audit tercatat.
do $$
declare
  v_hazard uuid;
  v_row public.hazard_reports;
  v_audit public.moderation_actions;
begin
  select id into v_hazard from public.uji_m4mod_konteks where nama = 'hazard_ride';

  begin
    perform public.moderate_hazard(v_hazard, 'delete', 'spam', null);
    raise exception 'UJI GAGAL: tindakan moderasi tak dikenal diterima';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.moderate_hazard(v_hazard, 'remove', 'bukan-alasan', null);
    raise exception 'UJI GAGAL: alasan moderasi tak dikenal diterima';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.moderate_hazard(v_hazard, 'remove', 'spam', repeat('x', 1001));
    raise exception 'UJI GAGAL: catatan moderasi lebih dari 1000 karakter diterima';
  exception
    when invalid_parameter_value then null;
  end;

  v_row := public.moderate_hazard(v_hazard, 'remove', 'unsafe_content', 'Menutup jalur evakuasi.');

  if v_row.status <> 'removed' then
    raise exception 'UJI GAGAL: status hazard setelah dihapus adalah %', v_row.status;
  end if;

  if v_row.description is null or v_row.description <> 'Lubang uji moderasi' then
    raise exception 'UJI GAGAL: baris hazard ikut terhapus/berubah saat moderasi';
  end if;

  -- Audit dibaca lewat RPC (tabelnya tidak punya jalur baca langsung).
  select * into v_audit from public.list_moderation_actions(200, 'hazard', v_hazard) limit 1;
  if not found then
    raise exception 'UJI GAGAL: aksi hapus hazard tidak tercatat di audit';
  end if;

  if v_audit.actor_id <> auth.uid()
     or v_audit.target_type <> 'hazard'
     or v_audit.action <> 'remove'
     or v_audit.reason <> 'unsafe_content'
     or v_audit.note <> 'Menutup jalur evakuasi.' then
    raise exception 'UJI GAGAL: isi audit hazard tidak sesuai (%, %, %, %, %)',
      v_audit.actor_id, v_audit.target_type, v_audit.action, v_audit.reason, v_audit.note;
  end if;

  -- Status final tidak dapat dimoderasi ulang.
  begin
    perform public.moderate_hazard(v_hazard, 'dismiss', 'spam', null);
    raise exception 'UJI GAGAL: hazard final masih bisa dimoderasi ulang';
  exception
    when check_violation then null;
  end;
end;
$$;

-- 9. Hapus pesan chat: soft delete, idempoten, dan tercatat sekali.
do $$
declare
  v_message uuid;
  v_row public.chat_messages;
  v_rows int;
begin
  select id into v_message from public.uji_m4mod_konteks where nama = 'pesan';

  v_row := public.moderate_chat_message(v_message, 'harassment', 'Pesan kasar berulang.');
  if v_row.deleted_at is null then
    raise exception 'UJI GAGAL: pesan chat tidak ditandai terhapus';
  end if;

  if v_row.content <> 'Pesan uji moderasi dari B.' then
    raise exception 'UJI GAGAL: isi pesan hilang fisik, seharusnya hanya soft delete';
  end if;

  perform public.moderate_chat_message(v_message, 'harassment', null);

  select count(*) into v_rows
  from public.list_moderation_actions(200, 'chat_message', v_message);
  if v_rows <> 1 then
    raise exception 'UJI GAGAL: moderasi ulang pesan terhapus menambah audit (% baris)', v_rows;
  end if;
end;
$$;

-- 10. Tinjau laporan penyalahgunaan: status + reviewed_at + audit.
do $$
declare
  v_report uuid;
  v_row public.content_reports;
  v_rows int;
begin
  select id into v_report from public.uji_m4mod_konteks where nama = 'laporan_chat';

  v_row := public.review_content_report(v_report, 'removed', 'Konten dihapus.');
  if v_row.status <> 'removed' or v_row.reviewed_at is null then
    raise exception 'UJI GAGAL: laporan tidak berstatus removed/tertinjau (%, %)',
      v_row.status, v_row.reviewed_at;
  end if;

  begin
    perform public.review_content_report(v_report, 'reviewed', null);
    raise exception 'UJI GAGAL: laporan yang sudah ditinjau bisa ditinjau ulang';
  exception
    when check_violation then null;
  end;

  if not exists (
    select 1 from public.list_moderation_actions(200, 'content_report', v_report)
    where action = 'remove'
  ) then
    raise exception 'UJI GAGAL: tinjauan laporan tidak tercatat di audit';
  end if;

  select count(*) into v_rows from public.list_moderation_actions(200, null, null);
  if v_rows <> 3 then
    raise exception 'UJI GAGAL: audit terlihat host berisi % baris, seharusnya 3', v_rows;
  end if;
end;
$$;

-- 11. Admin klub (bukan peserta R1) dapat melepas hazard R1 — jalur kedua.
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';
do $$
declare
  v_ride uuid;
  v_hazard public.hazard_reports;
begin
  select id into v_ride from public.uji_m4mod_konteks where nama = 'ride';
  v_hazard := public.create_hazard('crash', 'high', -6.1, 106.7, 'Kecelakaan uji admin klub', v_ride);
  insert into public.uji_m4mod_konteks (nama, id) values ('hazard_admin', v_hazard.id);
end;
$$;

set local request.jwt.claims = '{"sub":"f0000000-0000-4000-8000-00000000000f","role":"authenticated"}';
do $$
declare
  v_hazard uuid;
  v_row public.hazard_reports;
  v_rows int;
begin
  select id into v_hazard from public.uji_m4mod_konteks where nama = 'hazard_admin';

  -- F bukan peserta R1, jadi buktikan dulu ia memang tidak membaca chat R1
  -- lewat policy anggota; wewenangnya berasal dari peran admin klub.
  select count(*) into v_rows from public.chat_messages;
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: admin klub non-peserta membaca % pesan chat R1', v_rows;
  end if;

  -- ...tetapi isi pesan yang dilaporkan tetap dapat ia baca lewat RPC moderasi,
  -- supaya laporan atas pesan itu bisa ditinjau tanpa membuka seluruh riwayat chat.
  if public.get_moderation_subject(
       'chat_message',
       (select id from public.uji_m4mod_konteks where nama = 'pesan')
     ) ->> 'body' is distinct from 'Pesan uji moderasi dari B.' then
    raise exception 'UJI GAGAL: admin klub tidak membaca isi pesan yang dilaporkan lewat RPC';
  end if;

  v_row := public.moderate_hazard(v_hazard, 'dismiss', 'false_information', 'Bukan kecelakaan.');
  if v_row.status <> 'dismissed' then
    raise exception 'UJI GAGAL: admin klub tidak dapat melepas hazard (status %)', v_row.status;
  end if;

  select count(*) into v_rows from public.list_moderation_actions(200, null, null);
  if v_rows <> 4 then
    raise exception 'UJI GAGAL: admin klub melihat % baris audit, seharusnya 4', v_rows;
  end if;
end;
$$;

-- 12. Pelapor tetap melihat laporannya sendiri setelah ditinjau.
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';
do $$
declare
  v_report uuid;
  v_status text;
  v_rows int;
begin
  select id into v_report from public.uji_m4mod_konteks where nama = 'laporan_chat';
  select status into v_status from public.content_reports where id = v_report;

  if v_status <> 'removed' then
    raise exception 'UJI GAGAL: pelapor tidak membaca status laporannya sendiri (%)', v_status;
  end if;

  select count(*) into v_rows from public.list_moderation_actions(50, null, null);
  if v_rows <> 0 then
    raise exception 'UJI GAGAL: pelapor non-moderator membaca % baris audit', v_rows;
  end if;
end;
$$;

-- 13. Tidak ada jalur tulis/baca langsung ke tabel audit.
do $$
declare
  v_rows int;
begin
  begin
    select count(*) into v_rows from public.moderation_actions;
    raise exception 'UJI GAGAL: klien membaca tabel audit langsung';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.moderation_actions (actor_id, target_type, target_id, action, reason)
    values (auth.uid(), 'hazard', gen_random_uuid(), 'remove', 'spam');
    raise exception 'UJI GAGAL: klien menulis tabel audit langsung';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 14. Tanpa sesi dan sebagai anon tidak ada akses.
set local role anon;
set local request.jwt.claims = '{}';

do $$
begin
  if has_function_privilege('anon', 'public.moderate_hazard(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon boleh EXECUTE moderate_hazard';
  end if;
  if has_function_privilege('anon', 'public.moderate_chat_message(uuid,text,text)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon boleh EXECUTE moderate_chat_message';
  end if;
  if has_function_privilege('anon', 'public.review_content_report(uuid,text,text)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon boleh EXECUTE review_content_report';
  end if;
  if has_function_privilege('anon', 'public.list_moderation_actions(integer,text,uuid)', 'EXECUTE') then
    raise exception 'UJI GAGAL: anon boleh EXECUTE list_moderation_actions';
  end if;
end;
$$;

reset role;

do $$
begin
  raise notice 'UJI MODERASI M4 LULUS: antrean, aksi hapus, dan audit sesuai wewenang host/admin klub';
end;
$$;

rollback;
