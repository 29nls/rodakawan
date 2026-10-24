-- ============================================================================
-- RodaKawan — hardening katalog RLS (checklist keamanan Milestone 5).
--
-- Dua temuan dari `supabase/tests/rls_catalog_test.sql` yang tidak bisa
-- diperbaiki tanpa perubahan skema:
--
--   1. Dua belas fungsi `security definer` lama masih memakai
--      `set search_path = public`, bukan `''` seperti aturan AGENTS.md. Semua
--      referensi tabel di dalamnya sudah memakai skema eksplisit
--      (`public.…`) dan identitas memakai `auth.uid()`, sedangkan fungsi
--      bawaan (`btrim`, `now`, `md5`, …) selalu tersedia lewat `pg_catalog`.
--      Karena itu penguncian search_path di bawah tidak mengubah perilaku,
--      hanya menutup jalur pembajakan nama objek.
--
--   2. Empat fungsi trigger masih bisa dieksekusi langsung oleh pengguna
--      karena grant bawaan `PUBLIC`:
--        - `bootstrap_profile()` (trigger pada `auth.users`),
--        - `clear_ride_location_on_opt_out()`,
--        - `clear_ride_locations_on_finish()`,
--        - `set_follow_status()`.
--      Fungsi trigger dijalankan oleh mesin database, bukan oleh peran
--      pengguna, sehingga `EXECUTE` untuk `public`/`anon`/`authenticated`
--      tidak diperlukan. Grant dicabut tanpa memberi grant pengganti.
--
-- Migration ini **tidak** mengubah RLS, policy, data, atau signature fungsi.
-- Setelah diterapkan, hapus nama-nama terkait dari daftar pengecualian
-- sementara di `supabase/tests/rls_catalog_test.sql`; uji itu sengaja gagal
-- bila daftar pengecualiannya sudah tidak lagi diperlukan.
-- ============================================================================

-- 1. Kunci search_path fungsi security definer lama.
alter function public.can_publish_ride_location(uuid) set search_path = '';
alter function public.create_club(text, text, text, text, text) set search_path = '';
alter function public.is_club_admin(uuid) set search_path = '';
alter function public.is_club_member(uuid) set search_path = '';
alter function public.is_ride_active_member(uuid) set search_path = '';
alter function public.is_ride_host(uuid) set search_path = '';
alter function public.is_ride_member(uuid) set search_path = '';
alter function public.leave_club(uuid) set search_path = '';
alter function public.remove_club_member(uuid, uuid) set search_path = '';
alter function public.request_club_membership(uuid) set search_path = '';
alter function public.review_club_membership(uuid, uuid, boolean) set search_path = '';
alter function public.set_club_member_role(uuid, uuid, text) set search_path = '';

-- 2. Cabut EXECUTE fungsi trigger dari peran pengguna.
revoke all on function public.bootstrap_profile() from public, anon, authenticated;
revoke all on function public.clear_ride_location_on_opt_out() from public, anon, authenticated;
revoke all on function public.clear_ride_locations_on_finish() from public, anon, authenticated;
revoke all on function public.set_follow_status() from public, anon, authenticated;

comment on function public.bootstrap_profile() is
  'Trigger pembuatan profil pada auth.users; tidak dapat dieksekusi peran pengguna (checklist keamanan M5).';
comment on function public.set_follow_status() is
  'Trigger penentu status follow; tidak dapat dieksekusi peran pengguna (checklist keamanan M5).';
