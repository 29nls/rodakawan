-- ============================================================================
-- RodaKawan — Hapus akun dengan anonimisasi (irisan pertama Milestone 5).
--
-- Keputusan produk: **anonimisasi**, bukan hard delete (MILESTONE_5_PLAN §4
-- opsi A). Alasannya ada di rencana itu dan di ADR-076: laporan bahaya adalah
-- data keselamatan bersama, sedangkan `content_reports`/`moderation_actions`
-- adalah jejak audit yang tidak boleh hilang. Karena `hazard_reports.reporter_id`
-- memakai `on delete restrict`, menghapus baris profil akan gagal atau memaksa
-- menghapus riwayat keselamatan milik orang lain.
--
-- Yang dilakukan RPC `delete_my_account()`:
--   1. menghapus data pribadi yang tidak punya nilai bagi pengguna lain —
--      token push, posisi terakhir, relasi follow/blokir, notifikasi pribadi,
--      kendaraan beserta detail privatnya, dan objek Storage di folder pengguna;
--   2. mengeluarkan pengguna dari klub dan perjalanan (`status = 'left'`, bukan
--      DELETE) supaya baris klub/perjalanan yang dipakai orang lain tetap utuh;
--   3. menandai profil `deleted_at`, mengganti `username` dengan turunan id,
--      dan mengosongkan `display_name`, `avatar_url`, `bio`, `city`.
--
-- Konten publik yang ia tulis (laporan bahaya, pesan konvoi, unggahan klub,
-- laporan moderasi) **tetap ada** tetapi tidak lagi menunjuk identitas: baris
-- profilnya sudah anonim, dan policy baca profil menyembunyikan baris itu.
--
-- Batas yang diketahui dan disengaja:
--   * `auth.users` **tidak** dihapus — SQL tidak boleh menyentuh skema auth dari
--     aplikasi, dan penghapusan identitas login adalah tindakan operator/
--     Edge Function. Karena itu sesi yang sedang berjalan tidak dicabut oleh
--     RPC ini; klien memanggil `signOut()` setelahnya (layar hapus akun).
--   * Objek Storage dihapus lewat baris `storage.objects`; berkas fisiknya
--     dibersihkan oleh proses Storage. Menghapus baris sudah cukup untuk
--     mencabut akses karena bucket privat dan policy baca memakai folder uid.
--   * Baris `notifications` yang **ditujukan ke** pengguna dihapus; notifikasi
--     yang ia picu untuk orang lain tetap ada dengan aktor yang sudah anonim.
--
-- Tag galat (`detail`) dipetakan `src/features/account/errors.ts`:
--   account_unauthenticated, account_profile_missing.
-- ============================================================================

-- 1. Penanda anonimisasi pada profil. NULL = akun aktif.
alter table public.profiles
  add column if not exists deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'Waktu akun dianonimkan lewat delete_my_account(). NULL berarti akun aktif. Baris tetap ada karena laporan bahaya dan audit menunjuk ke sana.';

-- 2. Profil yang sudah dianonimkan tidak lagi terbaca siapa pun, termasuk
--    pemiliknya: setelah penghapusan, aplikasi memang tidak boleh lagi
--    menampilkan profil itu. Syarat lain (privat/pengikut) dipertahankan persis.
drop policy if exists "profiles_select_visible" on public.profiles;
create policy "profiles_select_visible" on public.profiles
  for select to authenticated using (
    deleted_at is null
    and (
      id = auth.uid()
      or is_private = false
      or exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid()
          and f.followed_id = profiles.id
          and f.status = 'accepted'
      )
    )
  );

-- 3. Akun yang sudah dianonimkan tidak bisa "dihidupkan kembali" lewat update
--    profil biasa. RPC di bawah tetap boleh menulis karena `security definer`.
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid() and deleted_at is null)
  with check (id = auth.uid() and deleted_at is null);

-- 4. RPC penghapusan. Tanpa parameter: identitas selalu `auth.uid()`, sehingga
--    tidak ada bentuk pemanggilan yang bisa menghapus akun orang lain.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
begin
  if v_uid is null then
    raise exception 'Sesi tidak ditemukan. Masuk kembali lalu ulangi.'
      using errcode = '28000', detail = 'account_unauthenticated';
  end if;

  -- Idempoten: panggilan kedua tidak mengubah apa pun dan tidak gagal.
  if exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.deleted_at is not null
  ) then
    return;
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Profil untuk sesi ini belum tersedia.'
      using errcode = 'P0002', detail = 'account_profile_missing';
  end if;

  -- 30 karakter, sama dengan batas `username`, dan unik karena diturunkan dari id.
  v_username := 'deleted_' || left(replace(v_uid::text, '-', ''), 22);

  -- Data pribadi yang tidak berguna bagi siapa pun setelah akun hilang.
  delete from public.push_tokens where user_id = v_uid;
  delete from public.ride_locations where user_id = v_uid;
  delete from public.notifications where recipient_id = v_uid;

  delete from public.follows
  where follower_id = v_uid or followed_id = v_uid;

  delete from public.user_blocks
  where blocker_id = v_uid or blocked_id = v_uid;

  -- Kendaraan beserta detail privatnya (FK komposit ON DELETE CASCADE).
  delete from public.motorcycles where owner_id = v_uid;

  -- Keanggotaan tidak dihapus: baris klub/perjalanan dipakai orang lain.
  update public.club_members
  set status = 'left', updated_at = now()
  where user_id = v_uid and status <> 'left';

  update public.ride_members
  set status = 'left',
      sharing_location = false,
      last_seen_at = now(),
      updated_at = now()
  where user_id = v_uid and status <> 'left';

  -- Objek Storage milik pengguna: path selalu diawali `<uid>/` (ADR-057/ADR-059).
  delete from storage.objects
  where bucket_id = 'avatars'
    and (storage.foldername(name))[1] = v_uid::text;

  delete from storage.objects
  where bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = v_uid::text;

  update public.profiles
  set username = v_username,
      display_name = 'Akun dihapus',
      avatar_url = null,
      bio = null,
      city = null,
      is_private = false,
      deleted_at = now()
  where id = v_uid and deleted_at is null;
end;
$$;

comment on function public.delete_my_account() is
  'Menganonimkan akun pemanggil (idempoten). Tidak menghapus auth.users maupun konten publik; lihat ADR-076.';

revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
