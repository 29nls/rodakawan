-- RodaKawan Milestone 1.6 (lanjutan): hak eksekusi fungsi persetujuan follow.
--
-- Kenapa migration kecil tersendiri
-- ---------------------------------------------------------------------------
-- Supabase memberi `EXECUTE` kepada `anon`, `authenticated`, dan `service_role` untuk setiap
-- fungsi baru di schema `public` lewat default privileges. Karena itu
-- `revoke all on function ... from public` pada 20261013140000_follow_consent_private_profiles.sql
-- menghapus grant PUBLIC tetapi **tidak** menghapus grant eksplisit ke `anon` — hasil
-- pemeriksaan ACL setelah migration itu diterapkan:
--
--   accept_follow_request : postgres, anon, authenticated, service_role
--   set_follow_status     : postgres, anon, authenticated, service_role
--
-- Dampaknya kecil tetapi tetap tidak perlu: `accept_follow_request` mengembalikan `false`
-- ketika `auth.uid()` kosong (jadi anon tidak bisa mengubah data), dan `set_follow_status`
-- adalah fungsi trigger yang tidak bisa dipanggil langsung. Meski begitu, permukaan eksekusi
-- untuk peran tanpa sesi sebaiknya nol.
--
-- Migration 20261013140000 TIDAK diubah karena sudah tercatat di database remote; perbaikan
-- hak akses dikirim sebagai migration baru. Konvensi ini dipegang supaya riwayat remote dan
-- lokal tidak pernah menyimpang.
--
-- Catatan cakupan: fungsi helper Milestone 1 (`is_club_member`, `is_ride_host`,
-- `can_publish_ride_location`, dst.) masih membawa grant `anon` yang sama. Fungsi-fungsi itu
-- mengembalikan `false` tanpa sesi (`user_id = auth.uid()` bernilai NULL), jadi tidak ada data
-- yang terbuka, dan pembatasan grant menyeluruh tetap direncanakan sebagai pekerjaan tersendiri
-- (ADR-030) — jangan diperluas diam-diam di migration ini.

revoke all on function public.accept_follow_request(uuid) from anon;
revoke all on function public.set_follow_status() from anon;
