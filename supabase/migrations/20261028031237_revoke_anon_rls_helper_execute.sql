-- Cabut akses tanpa sesi (`anon`) ke enam helper RLS SECURITY DEFINER.
--
-- Latar (AUD-11, dikonfirmasi ulang 28 Oktober 2026):
--   * Migration awal (20261013022938) memang mencabut grant `PUBLIC` dan
--     memberi grant `authenticated`, tetapi default privileges Supabase juga
--     menambahkan grant `anon` untuk setiap fungsi baru di skema `public`;
--     karena itu keenam helper tetap dapat dieksekusi tanpa sesi.
--   * Penelusuran seluruh `create policy` di riwayat migration (76 policy,
--     termasuk policy Storage `club_logos_*`) menunjukkan semuanya hanya
--     menargetkan `to authenticated`. Tidak ada policy maupun RPC invoker-
--     rights yang memanggil helper ini sebagai `anon`, sehingga grant itu
--     tidak diperlukan oleh perilaku aplikasi mana pun.
--   * Memanggil helper tanpa sesi selalu menghasilkan `false` (membandingkan
--     dengan `auth.uid()`), jadi grant ini tidak membuka baris apa pun; ia
--     tetap permukaan serangan tanpa sesi yang tidak perlu pada fungsi
--     SECURITY DEFINER.
--   * Fungsi SECURITY DEFINER lain sudah dicabut dari `anon` oleh migration
--     20261024003227; keenam helper ini adalah pengecualian terakhir yang
--     tercatat di rls_catalog_test.sql dan rls_catalog_hardening_test.sql.
--
-- Sifat perubahan: aditif dan hanya mencabut izin. Grant `authenticated`
-- tidak disentuh (tetap dibutuhkan policy RLS yang mengevaluasinya), dan
-- pemanggilan dari dalam fungsi SECURITY DEFINER lain tetap sah karena
-- dihitung terhadap owner fungsi (postgres), bukan peran sesi pemanggil.
--
-- Kedua berkas uji katalog diperbarui pada commit yang sama: daftar
-- pengecualian beralasan dikosongkan (pemeriksaan anti-usang), dan
-- ditambahkan asersi dua sisi — `anon` ditolak, `authenticated` tetap
-- diizinkan — sehingga revoke ini tidak dapat menghapus akses login secara
-- tidak sengaja.

revoke all on function public.can_publish_ride_location(uuid) from public, anon;
revoke all on function public.is_club_admin(uuid) from public, anon;
revoke all on function public.is_club_member(uuid) from public, anon;
revoke all on function public.is_ride_active_member(uuid) from public, anon;
revoke all on function public.is_ride_host(uuid) from public, anon;
revoke all on function public.is_ride_member(uuid) from public, anon;
