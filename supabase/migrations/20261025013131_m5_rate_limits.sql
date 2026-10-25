-- ============================================================================
-- RodaKawan — rate limit database untuk interaksi sosial (AUD-14).
--
-- Kenapa di database, bukan di UI
-- ---------------------------------------------------------------------------
-- Batas yang hanya diperiksa aplikasi bisa dilewati dengan REST/RPC langsung.
-- `public.follows` dan `public.content_reports` masih punya policy INSERT untuk
-- `authenticated` (policy lama, sengaja tidak dihapus supaya alur yang ada tetap
-- berjalan), sehingga pemeriksaan di dalam `report_content` saja tidak menutup
-- jalur REST. Trigger BEFORE INSERT menjaga kedua jalur sekaligus.
--
-- `public.club_members` tidak punya policy INSERT: satu-satunya jalur tulis
-- adalah `request_club_membership` (dan `create_club` untuk baris owner).
-- Batasnya ditaruh di dalam RPC itu, bukan trigger, karena pengajuan ulang
-- setelah ditolak meng-UPDATE baris yang sama — bukan INSERT baru.
--
-- Batas awal (bisa diubah lewat migration baru; jangan sunting migration ini
-- setelah diterapkan):
--   follow            10 baris baru / 10 menit / pengikut
--   laporan moderasi  10 laporan    / 10 menit / pelapor
--   gabung klub        5 permintaan / 10 menit / pengguna
--
-- Angka ini cukup longgar untuk pemakaian wajar (menambah teman setelah
-- bergabung, melaporkan beberapa pesan dalam satu insiden) dan cukup ketat
-- untuk menahan skrip massal. Penolakan memakai SQLSTATE P0001 + detail
-- `<scope>_rate_limit` seperti rate limit M4, supaya klien memetakan kode —
-- bukan mencocokkan teks pesan.
--
-- Identitas selalu `auth.uid()`, tidak pernah kolom dari payload. Pemanggilan
-- tanpa sesi (service_role) tidak dibatasi karena bukan jalur pengguna.
-- Migration ini aditif: tidak mengubah policy, data, atau tanda tangan fungsi.
-- ============================================================================

-- 1. Follow: jalur REST langsung tetap terbuka (policy `follows_insert_self`).
create or replace function public.enforce_follow_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
begin
  -- Tidak ada sesi pengguna: bukan jalur yang perlu dibatasi di sini.
  if auth.uid() is null then
    return new;
  end if;

  select count(*)
    into v_recent
    from public.follows f
   where f.follower_id = auth.uid()
     and f.created_at > now() - interval '10 minutes';

  if v_recent >= 10 then
    raise exception 'Terlalu banyak permintaan mengikuti dalam waktu singkat. Coba lagi beberapa menit lagi.'
      using errcode = 'P0001', detail = 'follow_rate_limit';
  end if;

  return new;
end;
$$;

comment on function public.enforce_follow_rate_limit() is
  'BEFORE INSERT public.follows: maksimal 10 follow baru per 10 menit per pengikut (AUD-14).';

revoke all on function public.enforce_follow_rate_limit() from public, anon, authenticated;

drop trigger if exists follows_rate_limit on public.follows;
create trigger follows_rate_limit
  before insert on public.follows
  for each row
  execute function public.enforce_follow_rate_limit();

-- 2. Laporan moderasi: `content_reports_insert_self` masih mengizinkan INSERT
--    REST, jadi trigger ini yang menutup kedua jalur (RPC dan REST).
create or replace function public.enforce_content_report_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
begin
  if auth.uid() is null then
    return new;
  end if;

  select count(*)
    into v_recent
    from public.content_reports r
   where r.reporter_id = auth.uid()
     and r.created_at > now() - interval '10 minutes';

  if v_recent >= 10 then
    raise exception 'Terlalu banyak laporan dalam waktu singkat. Coba lagi beberapa menit lagi.'
      using errcode = 'P0001', detail = 'report_rate_limit';
  end if;

  return new;
end;
$$;

comment on function public.enforce_content_report_rate_limit() is
  'BEFORE INSERT public.content_reports: maksimal 10 laporan per 10 menit per pelapor (AUD-14).';

revoke all on function public.enforce_content_report_rate_limit() from public, anon, authenticated;

drop trigger if exists content_reports_rate_limit on public.content_reports;
create trigger content_reports_rate_limit
  before insert on public.content_reports
  for each row
  execute function public.enforce_content_report_rate_limit();

-- 3. Permintaan gabung klub. Badan fungsi sama dengan
--    20261016093000_club_membership_rpc.sql; satu-satunya perubahan adalah
--    pemeriksaan kuota sebelum baris ditulis. `search_path` sudah dikunci ''
--    oleh 20261024003227_m5_catalog_hardening.sql dan dipertahankan di sini.
create or replace function public.request_club_membership(p_club_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_club public.clubs;
  v_member public.club_members;
  v_status text;
  v_old_status text;
  v_member_exists boolean;
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'Harus masuk untuk bergabung ke klub.' using errcode = '42501';
  end if;

  select * into v_club from public.clubs c where c.id = p_club_id;

  if not found then
    raise exception 'Klub tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_club.join_policy = 'invite_only' then
    raise exception 'Klub ini hanya menerima anggota lewat undangan.' using errcode = '42501';
  end if;

  select * into v_member
  from public.club_members cm
  where cm.club_id = p_club_id and cm.user_id = v_uid;

  -- Simpan hasil SELECT di atas: SELECT ... INTO untuk hitungan kuota di bawah
  -- selalu menemukan satu baris dan akan menimpa FOUND bila dipakai langsung.
  v_member_exists := found;

  if v_member_exists then
    v_old_status := v_member.status;

    -- Sudah anggota aktif: permintaan ulang tidak mengubah apa pun.
    if v_member.status = 'active' then
      return 'active';
    end if;

    -- Owner/admin yang sedang nonaktif tidak boleh diturunkan diam-diam menjadi
    -- member biasa lewat jalur permintaan ini.
    if v_member.role <> 'member' then
      raise exception 'Peran owner/admin tidak bisa didaftarkan ulang lewat jalur ini.'
        using errcode = '42501';
    end if;
  end if;

  -- Klub privat selalu butuh persetujuan; klub publik mengikuti join_policy.
  v_status := case
    when v_club.visibility = 'public' and v_club.join_policy = 'open' then 'active'
    else 'pending'
  end;

  -- AUD-14: batas 5 permintaan per 10 menit. Hanya baris berperan `member`
  -- yang dihitung, sehingga pembuatan klub (baris owner) tidak menghabiskan
  -- kuota bergabung. Baris `active` lama tidak dihitung saat disetujui admin;
  -- yang dihitung adalah baris baru dan permintaan yang masih `pending`.
  select count(*)
    into v_recent
    from public.club_members cm
   where cm.user_id = v_uid
     and cm.role = 'member'
     and (
       cm.created_at > now() - interval '10 minutes'
       or (cm.status = 'pending' and cm.updated_at > now() - interval '10 minutes')
     );

  if v_recent >= 5 then
    raise exception 'Terlalu banyak permintaan bergabung dalam waktu singkat. Coba lagi beberapa menit lagi.'
      using errcode = 'P0001', detail = 'club_join_rate_limit';
  end if;

  if v_member_exists then
    update public.club_members
      set status = v_status,
          role = 'member',
          joined_at = case when v_status = 'active' then coalesce(joined_at, now()) else null end,
          updated_at = now()
      where club_id = p_club_id and user_id = v_uid;
  else
    insert into public.club_members (club_id, user_id, role, status, joined_at)
    values (
      p_club_id,
      v_uid,
      'member',
      v_status,
      case when v_status = 'active' then now() else null end
    );
  end if;

  insert into public.club_role_audit (
    club_id, actor_id, subject_id, action, old_status, new_status, new_role
  )
  values (
    p_club_id,
    v_uid,
    v_uid,
    case when v_status = 'active' then 'join' else 'request' end,
    v_old_status,
    v_status,
    'member'
  );

  return v_status;
end;
$$;

comment on function public.request_club_membership(uuid) is
  'SECURITY DEFINER: pengguna (auth.uid()) mengajukan/bergabung ke klub; maksimal 5 permintaan per 10 menit (AUD-14).';
