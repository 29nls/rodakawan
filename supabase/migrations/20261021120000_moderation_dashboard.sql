-- ============================================================================
-- RodaKawan — Dashboard moderasi (lanjutan Milestone 4).
--
-- Wewenang moderasi **tidak** membuat peran global baru (ADR-067, melanjutkan
-- ADR-066). Yang berwenang adalah pihak yang sudah punya otoritas atas konteks
-- kontennya:
--   - host perjalanan (`is_ride_host`), untuk chat dan laporan bahaya yang
--     tertaut ke perjalanan yang dipimpinnya;
--   - owner/admin klub (`is_club_admin`) untuk perjalanan milik klub itu.
-- Konten tanpa konteks perjalanan (laporan bahaya `ride_id = null`) **tidak**
-- dapat dimoderasi dari aplikasi; jalurnya tetap dashboard tepercaya.
--
-- Yang ditambahkan (aditif):
--   1. tabel audit `public.moderation_actions` — setiap tindakan hapus/tinjau
--      dicatat dalam transaksi yang sama dengan perubahan kontennya, jadi
--      tidak ada penghapusan tanpa jejak;
--   2. helper otorisasi `can_moderate_ride/hazard/chat_message/content_report`
--      (`security definer`, `search_path = ''`);
--   3. policy baca untuk moderator pada `content_reports`; tabel audit sengaja
--      **tanpa** policy baca/tulis (RLS menolak semua) sehingga satu-satunya
--      jalan bacanya RPC `list_moderation_actions`;
--   4. RPC `moderate_hazard`, `moderate_chat_message`, `review_content_report`, dan
--      `list_moderation_actions`.
--
-- Yang **tidak** berubah: policy baca konten (`hazards_select_current_or_reporter`,
-- `chat_select_ride_member`) dan seluruh RPC tulis Milestone 4. Moderasi hanya
-- memindahkan status/`deleted_at`, bukan menghapus baris, sehingga riwayat untuk
-- peninjauan tetap ada.
--
-- Tag galat (`detail`) dipetakan `src/features/moderation/errors.ts`:
--   moderation_unauthenticated, moderation_invalid_action,
--   moderation_invalid_reason, moderation_invalid_note,
--   moderation_target_not_found, moderation_target_final,
--   moderation_report_closed, moderation_not_allowed.
-- ============================================================================

-- 1. Jejak audit tindakan moderasi.
create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_type text not null check (target_type in ('hazard', 'chat_message', 'content_report')),
  target_id uuid not null,
  action text not null check (action in ('remove', 'dismiss', 'review')),
  reason text not null check (
    reason in ('spam', 'harassment', 'false_information', 'unsafe_content', 'privacy', 'other')
  ),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists moderation_actions_created_idx
  on public.moderation_actions(created_at desc);
create index if not exists moderation_actions_target_idx
  on public.moderation_actions(target_type, target_id, created_at desc);

alter table public.moderation_actions enable row level security;

-- 2. Helper otorisasi. Semuanya membaca kepemilikan konteks, bukan identitas
--    pelaku: moderator tidak perlu menjadi peserta perjalanan.
create or replace function public.can_moderate_ride(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_ride_host(p_ride_id)
    or exists (
      select 1
        from public.rides r
       where r.id = p_ride_id
         and r.club_id is not null
         and public.is_club_admin(r.club_id)
    );
$$;

create or replace function public.can_moderate_hazard(p_hazard_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.hazard_reports h
     where h.id = p_hazard_id
       and h.ride_id is not null
       and public.can_moderate_ride(h.ride_id)
  );
$$;

create or replace function public.can_moderate_chat_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.chat_messages m
     where m.id = p_message_id
       and public.can_moderate_ride(m.ride_id)
  );
$$;

create or replace function public.can_moderate_content_report(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.content_reports cr
     where cr.id = p_report_id
       and (
         (cr.target_type = 'hazard' and public.can_moderate_hazard(cr.target_id))
         or (cr.target_type = 'chat_message' and public.can_moderate_chat_message(cr.target_id))
       )
  );
$$;

revoke all on function public.can_moderate_ride(uuid) from public;
revoke all on function public.can_moderate_ride(uuid) from anon;
revoke all on function public.can_moderate_ride(uuid) from authenticated;
revoke all on function public.can_moderate_hazard(uuid) from public;
revoke all on function public.can_moderate_hazard(uuid) from anon;
grant execute on function public.can_moderate_hazard(uuid) to authenticated;
revoke all on function public.can_moderate_chat_message(uuid) from public;
revoke all on function public.can_moderate_chat_message(uuid) from anon;
grant execute on function public.can_moderate_chat_message(uuid) to authenticated;
revoke all on function public.can_moderate_content_report(uuid) from public;
revoke all on function public.can_moderate_content_report(uuid) from anon;
grant execute on function public.can_moderate_content_report(uuid) to authenticated;

-- 3. Jejak audit **tidak punya jalur baca langsung**: RLS aktif tanpa policy
--    (menolak semua) dan seluruh DML dicabut. Satu-satunya jalan baca adalah RPC
--    `list_moderation_actions` di bawah, yang menyaring baris dengan fungsi
--    otorisasi yang sama seperti aksi tulisnya. Dengan begitu tidak ada policy
--    baca yang bisa diperlebar tanpa sengaja lewat REST.
revoke all on table public.moderation_actions from authenticated, anon;

create or replace function public.list_moderation_actions(
  p_limit int default 50,
  p_target_type text default null,
  p_target_id uuid default null
)
returns setof public.moderation_actions
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
    from public.moderation_actions a
   where (
           a.actor_id = auth.uid()
           or (a.target_type = 'hazard' and public.can_moderate_hazard(a.target_id))
           or (a.target_type = 'chat_message' and public.can_moderate_chat_message(a.target_id))
           or (a.target_type = 'content_report' and public.can_moderate_content_report(a.target_id))
         )
     and (p_target_type is null or a.target_type = btrim(p_target_type))
     and (p_target_id is null or a.target_id = p_target_id)
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.list_moderation_actions(int, text, uuid) from public;
revoke all on function public.list_moderation_actions(int, text, uuid) from anon;
grant execute on function public.list_moderation_actions(int, text, uuid) to authenticated;

-- 4. Moderator boleh membaca laporan penyalahgunaan atas konten yang ia awasi.
--    Policy `content_reports_select_reporter` yang lama tetap ada, jadi pelapor
--    masih melihat status laporannya sendiri.
drop policy if exists "content_reports_select_moderator" on public.content_reports;
create policy "content_reports_select_moderator" on public.content_reports
  for select to authenticated using (public.can_moderate_content_report(id));

-- 4b. Isi konten yang dilaporkan, untuk moderator yang **tidak** bisa membacanya
--     lewat policy biasa. Kasus nyatanya: admin klub bukan peserta perjalanan,
--     sehingga `chat_select_ride_member` tidak menampilkan pesan yang ia awasi;
--     dan hazard yang sudah kedaluwarsa tidak lagi lolos
--     `hazards_select_current_or_reporter`. Fungsi ini mengembalikan **hanya**
--     konten yang dilaporkan (bukan seluruh riwayat chat), setelah otorisasi yang
--     sama dengan aksi moderasinya. `null` berarti tidak berwenang atau sudah hilang.
create or replace function public.get_moderation_subject(
  p_target_type text,
  p_target_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type text := btrim(coalesce(p_target_type, ''));
  v_subject jsonb;
begin
  if auth.uid() is null or p_target_id is null then
    return null;
  end if;

  if v_type = 'hazard' then
    if not public.can_moderate_hazard(p_target_id) then
      return null;
    end if;

    select jsonb_build_object(
             'kind', 'hazard',
             'id', h.id,
             'author_id', h.reporter_id,
             'ride_id', h.ride_id,
             'body', coalesce(h.description, ''),
             'category', h.category,
             'severity', h.severity,
             'status', h.status,
             'created_at', h.created_at,
             'removed', h.status <> 'active'
           )
      into v_subject
      from public.hazard_reports h
     where h.id = p_target_id;

    return v_subject;
  end if;

  if v_type = 'chat_message' then
    if not public.can_moderate_chat_message(p_target_id) then
      return null;
    end if;

    select jsonb_build_object(
             'kind', 'chat_message',
             'id', m.id,
             'author_id', m.sender_id,
             'ride_id', m.ride_id,
             'body', m.content,
             'category', null,
             'severity', null,
             'status', m.message_type,
             'created_at', m.created_at,
             'removed', m.deleted_at is not null
           )
      into v_subject
      from public.chat_messages m
     where m.id = p_target_id;

    return v_subject;
  end if;

  return null;
end;
$$;

revoke all on function public.get_moderation_subject(text, uuid) from public;
revoke all on function public.get_moderation_subject(text, uuid) from anon;
grant execute on function public.get_moderation_subject(text, uuid) to authenticated;

-- 5. RPC moderasi. `security definer`, `search_path = ''`, grant hanya
--    `authenticated`; perubahan konten dan baris audit berada di transaksi yang
--    sama sehingga tidak mungkin terpisah.

-- 5a. Lepas laporan bahaya. `remove` = konten tidak lagi tampil sebagai bahaya;
--     `dismiss` = laporan dinilai bukan bahaya nyata. Keduanya soft status, bukan
--     DELETE, dan hanya untuk laporan yang belum final.
create or replace function public.moderate_hazard(
  p_hazard_id uuid,
  p_action text,
  p_reason text,
  p_note text default null
)
returns public.hazard_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_action text := btrim(coalesce(p_action, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_hazard public.hazard_reports;
begin
  if v_uid is null then
    raise exception 'moderasi membutuhkan sesi'
      using errcode = '42501', detail = 'moderation_unauthenticated';
  end if;

  if v_action not in ('remove', 'dismiss') then
    raise exception 'tindakan moderasi tidak dikenal: %', v_action
      using errcode = '22023', detail = 'moderation_invalid_action';
  end if;

  if v_reason not in ('spam', 'harassment', 'false_information', 'unsafe_content', 'privacy', 'other') then
    raise exception 'alasan moderasi tidak dikenal: %', v_reason
      using errcode = '22023', detail = 'moderation_invalid_reason';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'catatan moderasi maksimal 1000 karakter'
      using errcode = '22023', detail = 'moderation_invalid_note';
  end if;

  -- Wewenang diperiksa **sebelum** baris dibaca, supaya penolakan untuk konten
  -- yang tidak ada dan konten milik orang lain tidak bisa dibedakan (bukan
  -- oracle keberadaan).
  if not public.can_moderate_hazard(p_hazard_id) then
    raise exception 'Anda tidak berwenang memoderasi laporan ini'
      using errcode = '42501', detail = 'moderation_not_allowed';
  end if;

  select * into v_hazard
    from public.hazard_reports
   where id = p_hazard_id
   for update;

  if not found then
    raise exception 'laporan bahaya tidak ditemukan'
      using errcode = 'P0002', detail = 'moderation_target_not_found';
  end if;

  if v_hazard.status in ('removed', 'dismissed', 'resolved') then
    raise exception 'laporan ini sudah final'
      using errcode = '23514', detail = 'moderation_target_final';
  end if;

  update public.hazard_reports
     set status = case when v_action = 'remove' then 'removed' else 'dismissed' end,
         updated_at = now()
   where id = p_hazard_id
   returning * into v_hazard;

  insert into public.moderation_actions (actor_id, target_type, target_id, action, reason, note)
  values (v_uid, 'hazard', p_hazard_id, v_action, v_reason, v_note);

  return v_hazard;
end;
$$;

revoke all on function public.moderate_hazard(uuid, text, text, text) from public;
revoke all on function public.moderate_hazard(uuid, text, text, text) from anon;
grant execute on function public.moderate_hazard(uuid, text, text, text) to authenticated;

-- 5b. Hapus pesan chat (soft delete) oleh moderator. Idempoten: pesan yang sudah
--     terhapus dikembalikan apa adanya tanpa baris audit kedua.
create or replace function public.moderate_chat_message(
  p_message_id uuid,
  p_reason text,
  p_note text default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_message public.chat_messages;
begin
  if v_uid is null then
    raise exception 'moderasi membutuhkan sesi'
      using errcode = '42501', detail = 'moderation_unauthenticated';
  end if;

  if v_reason not in ('spam', 'harassment', 'false_information', 'unsafe_content', 'privacy', 'other') then
    raise exception 'alasan moderasi tidak dikenal: %', v_reason
      using errcode = '22023', detail = 'moderation_invalid_reason';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'catatan moderasi maksimal 1000 karakter'
      using errcode = '22023', detail = 'moderation_invalid_note';
  end if;

  if not public.can_moderate_chat_message(p_message_id) then
    raise exception 'Anda tidak berwenang memoderasi pesan ini'
      using errcode = '42501', detail = 'moderation_not_allowed';
  end if;

  select * into v_message
    from public.chat_messages
   where id = p_message_id
   for update;

  if not found then
    raise exception 'pesan tidak ditemukan'
      using errcode = 'P0002', detail = 'moderation_target_not_found';
  end if;

  if v_message.deleted_at is not null then
    return v_message;
  end if;

  update public.chat_messages
     set deleted_at = now()
   where id = p_message_id
   returning * into v_message;

  insert into public.moderation_actions (actor_id, target_type, target_id, action, reason, note)
  values (v_uid, 'chat_message', p_message_id, 'remove', v_reason, v_note);

  return v_message;
end;
$$;

revoke all on function public.moderate_chat_message(uuid, text, text) from public;
revoke all on function public.moderate_chat_message(uuid, text, text) from anon;
grant execute on function public.moderate_chat_message(uuid, text, text) to authenticated;

-- 5c. Tinjau laporan penyalahgunaan. Status laporan **tidak** otomatis
--     menghapus konten: penghapusan adalah aksi terpisah yang punya audit
--     sendiri. Ini menjaga janji ADR-066 bahwa laporan berulang tidak
--     menghapus konten secara otomatis.
create or replace function public.review_content_report(
  p_report_id uuid,
  p_status text,
  p_note text default null
)
returns public.content_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text := btrim(coalesce(p_status, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_report public.content_reports;
  v_action text;
begin
  if v_uid is null then
    raise exception 'moderasi membutuhkan sesi'
      using errcode = '42501', detail = 'moderation_unauthenticated';
  end if;

  if v_status not in ('reviewed', 'removed', 'dismissed') then
    raise exception 'status tinjauan tidak dikenal: %', v_status
      using errcode = '22023', detail = 'moderation_invalid_action';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'catatan moderasi maksimal 1000 karakter'
      using errcode = '22023', detail = 'moderation_invalid_note';
  end if;

  if not public.can_moderate_content_report(p_report_id) then
    raise exception 'Anda tidak berwenang meninjau laporan ini'
      using errcode = '42501', detail = 'moderation_not_allowed';
  end if;

  select * into v_report
    from public.content_reports
   where id = p_report_id
   for update;

  if not found then
    raise exception 'laporan penyalahgunaan tidak ditemukan'
      using errcode = 'P0002', detail = 'moderation_target_not_found';
  end if;

  if v_report.status <> 'open' then
    raise exception 'laporan ini sudah ditinjau sebelumnya'
      using errcode = '23514', detail = 'moderation_report_closed';
  end if;

  update public.content_reports
     set status = v_status,
         reviewed_at = now()
   where id = p_report_id
   returning * into v_report;

  v_action := case
    when v_status = 'removed' then 'remove'
    when v_status = 'dismissed' then 'dismiss'
    else 'review'
  end;

  insert into public.moderation_actions (actor_id, target_type, target_id, action, reason, note)
  values (v_uid, 'content_report', p_report_id, v_action, v_report.reason, v_note);

  return v_report;
end;
$$;

revoke all on function public.review_content_report(uuid, text, text) from public;
revoke all on function public.review_content_report(uuid, text, text) from anon;
grant execute on function public.review_content_report(uuid, text, text) to authenticated;
