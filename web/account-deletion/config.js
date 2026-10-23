/*
 * Konfigurasi publik halaman penghapusan akun.
 *
 * Nilai di bawah aman untuk publik: URL project dan **publishable/anon key**
 * memang dikirim ke browser oleh aplikasi mana pun. JANGAN menaruh service_role
 * key, password database, atau secret lain di berkas ini — halaman ini statis
 * dan seluruh isinya dapat dibaca siapa saja.
 *
 * Isi sebelum deploy (lihat web/README.md). Halaman akan menolak berjalan dan
 * menampilkan pesan "belum dikonfigurasi" selama masih ada awalan GANTI-.
 */
window.RODAKAWAN_WEB = {
  supabaseUrl: 'https://GANTI-PROJECT-REF.supabase.co',
  publishableKey: 'GANTI-PUBLISHABLE-KEY',
  supportUrl: 'https://github.com/29nls/rodakawan/issues',
  privacyUrl: '../privacy/',
};
