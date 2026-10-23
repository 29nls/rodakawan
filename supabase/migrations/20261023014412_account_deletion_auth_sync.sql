-- ============================================================================
-- RodaKawan — pagar identitas: hapus Auth user tidak boleh meninggalkan profil
-- aktif.
--
-- Migration `20261023004946_account_deletion_identity.sql` melepas FK
-- `profiles.id -> auth.users.id` supaya Auth Admin API bisa menghapus identitas
-- login tanpa menghapus data keselamatan bersama. Konsekuensinya, penghapusan
-- user di luar Edge Function (mis. tombol Delete user di Dashboard Supabase,
-- pembersihan akun uji, atau job internal Auth) tidak lagi otomatis menghapus
-- profil. Tanpa pagar, baris profil aktif bisa hidup tanpa identitas login.
--
-- Trigger ini menjalankan `purge_account_data()` **sebelum** baris auth dihapus.
-- Efeknya sama dengan langkah `purge` pada Edge Function:
--   * profil dan data pribadi dihapus;
--   * konten keselamatan/audit dialihkan ke tombstone bersama;
--   * kepemilikan klub/perjalanan dialihkan atau perjalanan dibatalkan.
--
-- Ini adalah jaring pengaman database, **bukan** pengganti orkestrasi penuh:
-- trigger tidak dapat memindahkan/menghapus objek Storage lewat Storage API dan
-- tidak mencatat `account_deletion_jobs`. Penghapusan akun dari aplikasi/web
-- tetap harus lewat Edge Function `delete-account` agar media dan status retry
-- ikut tertangani. Bila `purge_account_data()` gagal (mis. FK baru yang belum
-- ditangani), penghapusan auth ikut gagal — kegagalan yang disengaja agar tidak
-- ada profil aktif yang tertinggal.
-- ============================================================================

create or replace function public.purge_profile_before_auth_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Idempoten: bila Edge Function sudah menjalankan purge, profil sudah tidak
  -- ada dan fungsi ini hanya mengembalikan `alreadyPurged`.
  perform public.purge_account_data(old.id);
  return old;
end;
$$;

revoke all on function public.purge_profile_before_auth_delete() from public, anon, authenticated;

drop trigger if exists auth_users_purge_profile on auth.users;
create trigger auth_users_purge_profile
  before delete on auth.users
  for each row execute function public.purge_profile_before_auth_delete();

comment on function public.purge_profile_before_auth_delete() is
  'Jaring pengaman: purge profil sebelum auth user dihapus di luar Edge Function. Tidak menggantikan penanganan Storage/retry (ADR-077).';
