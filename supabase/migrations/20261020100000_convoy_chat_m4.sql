-- ============================================================================
-- RodaKawan — Milestone 4 (bagian C+D+E): chat konvoi, pesan sistem, moderasi.
--
-- Skema dasar `public.chat_messages` sudah ada sejak
-- `20261013022938_initial_schema.sql` (ride, pengirim, `message_type` text/system,
-- konten 1–2000 karakter, `edited_at`/`deleted_at`). Migration ini **tidak**
-- membuat model pesan kedua dan tidak mengubah CHECK yang ada.
--
-- Yang ditambahkan (aditif + pengetatan jalur tulis):
--   1. kolom idempotency `client_message_id` + unique index
--      `(ride_id, sender_id, client_message_id)` — retry setelah jaringan putus
--      tidak menggandakan pesan;
--   2. index keyset `(ride_id, created_at desc, id desc)` untuk paginasi riwayat;
--   3. RPC `send_chat_message`, `edit_chat_message`, `delete_chat_message`, dan
--      `report_content` (laporan penyalahgunaan untuk pesan chat **dan** hazard,
--      memakai `public.content_reports` yang sudah ada);
--   4. trigger pesan sistem untuk mulai/selesai/batal perjalanan serta
--      bergabung/keluar/dikeluarkan peserta — transaksional dengan perubahan
--      statusnya, jadi mutasi yang gagal tidak meninggalkan pesan palsu;
--   5. pencabutan INSERT/UPDATE/DELETE langsung pada `chat_messages` dan
--      pemusnahan policy `chat_insert_self_member`, `chat_update_own_text`,
--      `chat_delete_own` (ADR-066) — rate limit 20 pesan/60 detik, penolakan
--      pesan untuk ride final, jendela edit 15 menit, dan larangan klien menyisip
--      pesan sistem semuanya hidup di database, bukan disembunyikan di UI;
--   6. keanggotaan `public.chat_messages` (dan `public.ride_locations`) ke
--      publication `supabase_realtime`: saat ini publication itu **kosong**, jadi
--      Postgres Changes yang didokumentasikan ADR-065 tidak mengirim apa pun.
--      Anggota publication ini dimiliki `postgres`, sehingga perubahan bisa
--      dibuat dari koneksi migration; setiap baris tetap melewati policy SELECT
--      (`chat_select_ride_member`, `ride_locations_active_member`) sebelum
--      terkirim.
--
-- Otorisasi baca tidak dilonggarkan dan tidak diganti: `chat_select_ride_member`
-- memakai `is_ride_member` (`ride_members.status = 'joined'`), sehingga `anon`,
-- non-anggota klub, peserta yang `left`, dan peserta yang `removed` tidak
-- menerima baris apa pun. Host yang masih `joined` tetap terlihat. Perubahan
-- policy ini tidak ada; yang berubah hanya jalur tulis.
--
-- Daftar pengecualian pagar ADR-060 ikut diperbarui (empat → dua) karena
-- `chat_delete_own` sudah tidak ada.
--
-- Pesan galat memakai `detail = '<tag>'` sebagai kontrak mesin untuk
-- `src/features/chat/errors.ts`; teks pesan dalam Bahasa Indonesia.
-- ============================================================================

-- 1. Idempotency key per (ride, pengirim). Unique index parsial supaya baris
--    lama tanpa client id tetap sah.
alter table public.chat_messages
  add column if not exists client_message_id uuid;

create unique index if not exists chat_messages_ride_sender_client_uidx
  on public.chat_messages(ride_id, sender_id, client_message_id)
  where client_message_id is not null;

-- 2. Index keyset untuk paginasi riwayat (created_at, id) per ride.
create index if not exists chat_messages_ride_keyset_idx
  on public.chat_messages(ride_id, created_at desc, id desc);

-- 3. Helper pesan sistem. SECURITY DEFINER: dipanggil trigger (bukan klien),
--    sehingga policy INSERT klien tidak perlu dilonggarkan. `sender_id` diisi
--    pelaku aksi bila ada, dengan fallback pembuat perjalanan; konten dibatasi
--    200 karakter dan tidak pernah memuat koordinat (MILESTONE_4_PLAN bagian 3.3).
create or replace function public.insert_ride_system_message(
  p_ride_id uuid,
  p_content text,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content text := btrim(coalesce(p_content, ''));
  v_sender uuid;
  v_id uuid;
begin
  if char_length(v_content) < 1 or char_length(v_content) > 200 then
    raise exception 'pesan sistem harus 1-200 karakter'
      using errcode = '22023', detail = 'chat_system_message_invalid';
  end if;

  select created_by into v_sender
    from public.rides
   where id = p_ride_id;

  if v_sender is null then
    return null;
  end if;

  if p_actor is not null
     and exists (select 1 from public.profiles where id = p_actor) then
    v_sender := p_actor;
  end if;

  insert into public.chat_messages (ride_id, sender_id, message_type, content)
  values (p_ride_id, v_sender, 'system', v_content)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.insert_ride_system_message(uuid, text, uuid) from public;
revoke all on function public.insert_ride_system_message(uuid, text, uuid) from anon;
revoke all on function public.insert_ride_system_message(uuid, text, uuid) from authenticated;

-- 3a. Mulai/selesai/batal perjalanan.
create or replace function public.ride_status_system_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'active' then
      perform public.insert_ride_system_message(new.id, 'Perjalanan dimulai', auth.uid());
    elsif new.status = 'completed' then
      perform public.insert_ride_system_message(new.id, 'Perjalanan selesai', auth.uid());
    elsif new.status = 'cancelled' then
      perform public.insert_ride_system_message(new.id, 'Perjalanan dibatalkan', auth.uid());
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists rides_system_message on public.rides;
create trigger rides_system_message
after update of status on public.rides
for each row execute function public.ride_status_system_message();

revoke all on function public.ride_status_system_message() from public;
revoke all on function public.ride_status_system_message() from anon;
revoke all on function public.ride_status_system_message() from authenticated;

-- 3b. Peserta bergabung/keluar/dikeluarkan. Undangan (`invited`) sengaja tidak
--     menghasilkan pesan; hanya transisi ke status `joined`/`left`/`removed`.
create or replace function public.ride_member_system_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride uuid := coalesce(new.ride_id, old.ride_id);
  v_target uuid := coalesce(new.user_id, old.user_id);
  v_actor uuid := auth.uid();
  v_name text;
begin
  if v_actor is null
     or not exists (select 1 from public.profiles where id = v_actor) then
    select created_by into v_actor from public.rides where id = v_ride;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), p.username)
    into v_name
    from public.profiles p
   where p.id = v_target;

  v_name := coalesce(nullif(v_name, ''), 'Seseorang');

  if tg_op = 'INSERT' and new.status = 'joined' then
    perform public.insert_ride_system_message(v_ride, v_name || ' bergabung', v_actor);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'joined' and old.status = 'invited' then
      perform public.insert_ride_system_message(v_ride, v_name || ' bergabung', v_actor);
    elsif new.status = 'left' and old.status = 'joined' then
      perform public.insert_ride_system_message(v_ride, v_name || ' keluar', v_actor);
    elsif new.status = 'removed' and old.status in ('joined', 'invited') then
      perform public.insert_ride_system_message(v_ride, v_name || ' dikeluarkan', v_actor);
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists ride_members_system_message on public.ride_members;
create trigger ride_members_system_message
after insert or update of status on public.ride_members
for each row execute function public.ride_member_system_message();

revoke all on function public.ride_member_system_message() from public;
revoke all on function public.ride_member_system_message() from anon;
revoke all on function public.ride_member_system_message() from authenticated;

-- 4. RPC tulis chat. Semua `security definer` + `search_path = ''`, grant hanya
--    `authenticated`, pengirim selalu `auth.uid()`.

-- 4a. Kirim pesan. Idempoten lewat `client_message_id`; anggota `joined` saja;
--     ride `completed`/`cancelled` tidak menerima pesan baru; maksimal 20 pesan
--     teks per 60 detik per pengguna (dihitung database, bukan UI).
create or replace function public.send_chat_message(
  p_ride_id uuid,
  p_content text,
  p_client_message_id uuid default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_content text := btrim(coalesce(p_content, ''));
  v_existing public.chat_messages;
  v_message public.chat_messages;
  v_ride public.rides;
  v_recent int;
begin
  if v_uid is null then
    raise exception 'mengirim pesan membutuhkan sesi'
      using errcode = '42501', detail = 'chat_unauthenticated';
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 2000 then
    raise exception 'pesan harus 1-2000 karakter'
      using errcode = '22023', detail = 'chat_invalid_content';
  end if;

  -- Retry dengan UUID yang sama mengembalikan baris yang sudah ada, bukan
  -- baris kedua dan bukan galat.
  if p_client_message_id is not null then
    select * into v_existing
      from public.chat_messages
     where ride_id = p_ride_id
       and sender_id = v_uid
       and client_message_id = p_client_message_id;

    if found then
      return v_existing;
    end if;
  end if;

  select * into v_ride
    from public.rides
   where id = p_ride_id
   for update;

  if not found then
    raise exception 'perjalanan tidak ditemukan'
      using errcode = 'P0002', detail = 'chat_ride_not_found';
  end if;

  if not public.is_ride_member(p_ride_id) then
    raise exception 'hanya peserta aktif perjalanan ini yang dapat mengirim pesan'
      using errcode = '42501', detail = 'chat_not_member';
  end if;

  if v_ride.status in ('completed', 'cancelled') then
    raise exception 'perjalanan ini sudah selesai, pesan baru tidak dapat dikirim'
      using errcode = '23514', detail = 'chat_ride_final';
  end if;

  select count(*) into v_recent
    from public.chat_messages
   where sender_id = v_uid
     and message_type = 'text'
     and created_at >= now() - interval '60 seconds';

  if v_recent >= 20 then
    raise exception 'Terlalu banyak pesan dalam waktu singkat. Coba lagi sebentar lagi.'
      using errcode = 'P0001', detail = 'chat_rate_limit';
  end if;

  begin
    insert into public.chat_messages (
      ride_id,
      sender_id,
      message_type,
      content,
      client_message_id
    )
    values (p_ride_id, v_uid, 'text', v_content, p_client_message_id)
    returning * into v_message;
  exception when unique_violation then
    if p_client_message_id is not null then
      select * into v_existing
        from public.chat_messages
       where ride_id = p_ride_id
         and sender_id = v_uid
         and client_message_id = p_client_message_id;

      if found then
        return v_existing;
      end if;
    end if;

    raise;
  end;

  return v_message;
end;
$$;

revoke all on function public.send_chat_message(uuid, text, uuid) from public;
revoke all on function public.send_chat_message(uuid, text, uuid) from anon;
grant execute on function public.send_chat_message(uuid, text, uuid) to authenticated;

-- 4b. Ubah pesan. Hanya pengirim, hanya `message_type = 'text'`, tidak boleh
--     yang sudah dihapus, maksimal 15 menit sejak `created_at`.
create or replace function public.edit_chat_message(
  p_message_id uuid,
  p_content text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_content text := btrim(coalesce(p_content, ''));
  v_message public.chat_messages;
begin
  if v_uid is null then
    raise exception 'mengubah pesan membutuhkan sesi'
      using errcode = '42501', detail = 'chat_unauthenticated';
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 2000 then
    raise exception 'pesan harus 1-2000 karakter'
      using errcode = '22023', detail = 'chat_invalid_content';
  end if;

  select * into v_message
    from public.chat_messages
   where id = p_message_id
   for update;

  if not found then
    raise exception 'pesan tidak ditemukan'
      using errcode = 'P0002', detail = 'chat_message_not_found';
  end if;

  if v_message.sender_id <> v_uid then
    raise exception 'hanya pengirim yang dapat mengubah pesannya'
      using errcode = '42501', detail = 'chat_not_sender';
  end if;

  if v_message.message_type <> 'text' then
    raise exception 'pesan sistem tidak dapat diubah'
      using errcode = '42501', detail = 'chat_system_message';
  end if;

  if v_message.deleted_at is not null then
    raise exception 'pesan yang sudah dihapus tidak dapat diubah'
      using errcode = '23514', detail = 'chat_message_deleted';
  end if;

  if v_message.created_at < now() - interval '15 minutes' then
    raise exception 'jendela pengubahan pesan sudah lewat (15 menit sejak dikirim)'
      using errcode = '23514', detail = 'chat_edit_window';
  end if;

  update public.chat_messages
     set content = v_content,
         edited_at = now()
   where id = p_message_id
   returning * into v_message;

  return v_message;
end;
$$;

revoke all on function public.edit_chat_message(uuid, text) from public;
revoke all on function public.edit_chat_message(uuid, text) from anon;
grant execute on function public.edit_chat_message(uuid, text) to authenticated;

-- 4c. Hapus pesan: soft delete (`deleted_at`), baris tetap ada untuk moderasi
--     dan isi tidak pernah dikirim ulang ke UI (lihat `redactChatMessage` di
--     `src/features/chat/api.ts`). Idempoten: menghapus pesan yang sudah
--     terhapus mengembalikan baris yang sama tanpa galat.
create or replace function public.delete_chat_message(p_message_id uuid)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_message public.chat_messages;
begin
  if v_uid is null then
    raise exception 'menghapus pesan membutuhkan sesi'
      using errcode = '42501', detail = 'chat_unauthenticated';
  end if;

  select * into v_message
    from public.chat_messages
   where id = p_message_id
   for update;

  if not found then
    raise exception 'pesan tidak ditemukan'
      using errcode = 'P0002', detail = 'chat_message_not_found';
  end if;

  if v_message.sender_id <> v_uid then
    raise exception 'hanya pengirim yang dapat menghapus pesannya'
      using errcode = '42501', detail = 'chat_not_sender';
  end if;

  if v_message.message_type <> 'text' then
    raise exception 'pesan sistem tidak dapat dihapus'
      using errcode = '42501', detail = 'chat_system_message';
  end if;

  if v_message.deleted_at is not null then
    return v_message;
  end if;

  update public.chat_messages
     set deleted_at = now()
   where id = p_message_id
   returning * into v_message;

  return v_message;
end;
$$;

revoke all on function public.delete_chat_message(uuid) from public;
revoke all on function public.delete_chat_message(uuid) from anon;
grant execute on function public.delete_chat_message(uuid) to authenticated;

-- 4d. Laporan penyalahgunaan untuk hazard maupun pesan chat, memakai
--     `public.content_reports` yang sudah ada. Pelapor selalu diambil dari
--     `auth.uid()` — tidak ada parameter identitas yang bisa dipalsukan; policy
--     `content_reports_insert_self` tetap menjadi lapisan kedua. Target wajib
--     ada; pesan chat juga harus terlihat oleh pelapor (anggota ride), supaya
--     fungsi ini bukan oracle keberadaan pesan ride lain.
create or replace function public.report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default null
)
returns public.content_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_type text := btrim(coalesce(p_target_type, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_report public.content_reports;
begin
  if v_uid is null then
    raise exception 'melaporkan konten membutuhkan sesi'
      using errcode = '42501', detail = 'report_unauthenticated';
  end if;

  if v_type not in ('hazard', 'chat_message') then
    raise exception 'jenis konten yang dapat dilaporkan hanya hazard dan pesan chat'
      using errcode = '22023', detail = 'report_invalid_target_type';
  end if;

  if v_reason not in ('spam', 'harassment', 'false_information', 'unsafe_content', 'privacy', 'other') then
    raise exception 'alasan laporan tidak dikenal: %', v_reason
      using errcode = '22023', detail = 'report_invalid_reason';
  end if;

  if v_details is not null and char_length(v_details) > 2000 then
    raise exception 'rincian laporan maksimal 2000 karakter'
      using errcode = '22023', detail = 'report_invalid_details';
  end if;

  if v_type = 'hazard' then
    if not exists (select 1 from public.hazard_reports where id = p_target_id) then
      raise exception 'laporan bahaya yang dilaporkan tidak ditemukan'
        using errcode = 'P0002', detail = 'report_target_not_found';
    end if;
  else
    if not exists (
      select 1
        from public.chat_messages m
       where m.id = p_target_id
         and (m.sender_id = v_uid or public.is_ride_member(m.ride_id))
    ) then
      raise exception 'pesan yang dilaporkan tidak ditemukan'
        using errcode = 'P0002', detail = 'report_target_not_found';
    end if;
  end if;

  insert into public.content_reports (
    reporter_id,
    target_type,
    target_id,
    reason,
    details
  )
  values (v_uid, v_type, p_target_id, v_reason, v_details)
  returning * into v_report;

  return v_report;
end;
$$;

revoke all on function public.report_content(text, uuid, text, text) from public;
revoke all on function public.report_content(text, uuid, text, text) from anon;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;

-- 5. Jalur tulis langsung ditutup (ADR-066). Baca tetap lewat
--    `chat_select_ride_member` yang tidak diubah: baris realtime pun melewati
--    policy SELECT yang sama sebelum terkirim.
drop policy if exists "chat_insert_self_member" on public.chat_messages;
drop policy if exists "chat_update_own_text" on public.chat_messages;
drop policy if exists "chat_delete_own" on public.chat_messages;
revoke insert, update, delete on public.chat_messages from authenticated, anon;

-- 6. Publication Realtime. `supabase_realtime` ada tetapi berisi nol tabel,
--    sehingga Postgres Changes pada `ride_locations` (ADR-065) maupun chat tidak
--    pernah mengirim apa pun. Anggota publication ini dimiliki `postgres`, jadi
--    penambahan bisa dilakukan dari koneksi migration. Pengaturan ini tidak
--    memperluas akses: setiap baris tetap difilter policy SELECT milik tabel.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'ride_locations'
  ) then
    alter publication supabase_realtime add table public.ride_locations;
  end if;
end;
$$;
