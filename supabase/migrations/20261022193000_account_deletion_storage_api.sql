-- ============================================================================
-- RodaKawan — Perbaikan `delete_my_account()`: Storage dihapus lewat Storage API.
--
-- Penemuan saat menjalankan uji `rls_account_delete_test.sql` terhadap project
-- development: Supabase memasang penjaga pada `storage.objects` yang menolak
-- DELETE langsung dari SQL dengan pesan
--
--     Direct deletion from storage tables is not allowed. Use the Storage API instead.
--
-- Migration `20261022190000_account_deletion_m5.sql` sudah terlanjur diterapkan,
-- jadi isinya **tidak** disunting (aturan: migration yang sudah diterapkan tidak
-- boleh diubah). Migration ini mengganti badan fungsinya secara aditif dengan
-- `create or replace`; tanda tangan fungsi tetap sama, jadi grant-nya ikut
-- dipertahankan dan dipulihkan di bagian bawah.
--
-- Pembagian tanggung jawab setelah perbaikan:
--   * klien menghapus avatar dan foto kendaraan lewat Storage API **sebelum**
--     memanggil RPC (best effort; kegagalan Storage tidak menghalangi hak
--     pengguna untuk menghapus akunnya);
--   * RPC menghapus semua **rujukan** ke objek itu (`profiles.avatar_url`,
--     kendaraan beserta `photo_path`), mengganti username menjadi anonim, dan
--     menandai `deleted_at`;
--   * sisa berkas yang gagal dihapus tidak bisa dibaca siapa pun: bucket privat,
--     policy baca memakai folder uid, dan setelah `signOut()` tidak ada lagi
--     sesi yang mencocokkan folder itu. Pembersihan berkas yatim adalah tugas
--     operator (Storage API dengan service role) — dicatat di ADR-076.
-- ============================================================================

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

  v_username := 'deleted_' || left(replace(v_uid::text, '-', ''), 22);

  delete from public.push_tokens where user_id = v_uid;
  delete from public.ride_locations where user_id = v_uid;
  delete from public.notifications where recipient_id = v_uid;

  delete from public.follows
  where follower_id = v_uid or followed_id = v_uid;

  delete from public.user_blocks
  where blocker_id = v_uid or blocked_id = v_uid;

  delete from public.motorcycles where owner_id = v_uid;

  update public.club_members
  set status = 'left', updated_at = now()
  where user_id = v_uid and status <> 'left';

  update public.ride_members
  set status = 'left',
      sharing_location = false,
      last_seen_at = now(),
      updated_at = now()
  where user_id = v_uid and status <> 'left';

  -- Objek Storage sengaja tidak disentuh di sini; lihat kepala berkas.
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
  'Menganonimkan akun pemanggil (idempoten). Tidak menghapus auth.users, konten publik, maupun objek Storage; keduanya ditangani klien/operator. Lihat ADR-076.';

revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
