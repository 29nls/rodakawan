# Halaman web publik: privasi dan hapus akun

Tiga halaman statis tanpa build step:

```
web/
  index.html                 tautan ke kedua halaman
  styles.css
  privacy/index.html         kebijakan privasi publik
  account-deletion/index.html
  account-deletion/app.js    Auth REST + Edge Function delete-account
  account-deletion/config.js URL project + publishable key (diisi saat deploy)
```

Halaman ini **belum ter-deploy**. Tidak ada URL publik yang boleh diklaim sampai
pemilik project benar-benar menerbitkannya. Google Play meminta URL kebijakan
privasi dan URL penghapusan akun yang dapat dibuka tanpa memasang aplikasi; isi
keduanya di Play Console setelah deploy.

## 1. Isi konfigurasi

Ambil nilai dari Supabase Dashboard → project **development** → Project Settings →
API:

- Project URL → `supabaseUrl`
- Publishable key (atau anon key lama) → `publishableKey`

Edit [`account-deletion/config.js`](account-deletion/config.js). Jangan pernah
menaruh `service_role` key, password database, atau secret lain di berkas ini:
halaman statis dapat dibaca siapa saja. Halaman menolak berjalan selama nilai
masih berawalan `GANTI-`.

`supportUrl` dan `privacyUrl` boleh disesuaikan. Jangan mengarang alamat email
atau domain; saat ini dukungan memakai halaman GitHub Issues repository.

## 2. Deploy (pilih satu)

### Opsi A — Netlify Drop (paling cepat, tanpa repo workflow)

1. Buka <https://app.netlify.com/drop>.
2. Seret folder `web/` ke halaman itu.
3. Salin URL yang diberikan (mis. `https://<nama-acak>.netlify.app`).
4. Buka `.../account-deletion/` dan `.../privacy/`, pastikan keduanya tampil.

Tidak ada redirect yang diperlukan. Jangan gunakan URL ini sebagai bukti sebelum
kedua halaman benar-benar terbuka.

### Opsi B — GitHub Pages (butuh akses Settings repository)

1. Push folder `web/` ke branch `main` (setelah review/merge).
2. Repository → Settings → Pages → Build and deployment → Source:
   **GitHub Actions**.
3. Tambahkan workflow yang mengunggah `web/` sebagai artifact Pages, atau
   gunakan source **Deploy from a branch** dengan folder `/` setelah memindahkan
   isi `web/` ke root — opsi terakhir tidak disarankan karena mencampur kode
   aplikasi dengan halaman publik.

Contoh langkah workflow (tanpa menambahkan berkas ke repo sekarang):

```yaml
- uses: actions/configure-pages@v5
- uses: actions/upload-pages-artifact@v3
  with:
    path: web
- uses: actions/deploy-pages@v4
```

### Opsi C — hosting statis lain

Cloudflare Pages, Vercel, atau S3 + CDN juga cukup: unggah isi `web/` sebagai
root situs. Tidak ada server/Node yang dijalankan.

## 3. Verifikasi setelah deploy (wajib, jangan dilewati)

Gunakan akun uji di project **development**, bukan akun nyata.

1. Buka halaman hapus akun; konfirmasi tidak ada error konsol dan tidak ada
   permintaan ke domain selain Supabase.
2. Coba login dengan email tidak terdaftar dan dengan kata sandi salah → pesan
   harus sama persis (tidak membocorkan apakah email terdaftar).
3. Login dengan akun uji, ketik `HAPUS AKUN`, kirim.
4. Pastikan respons sukses hanya muncul setelah server selesai; lalu periksa di
   database:
   - `auth.users` untuk id tersebut sudah tidak ada;
   - `public.profiles` sudah tidak ada;
   - `public.hazard_reports` yang dibuat akun itu tetap ada dengan
     `reporter_id = 00000000-0000-4000-8000-000000000001`;
   - `public.account_deletion_jobs` berstatus `completed`;
   - objek `avatars`/`vehicle-photos` milik akun hilang, logo klub yang masih
     dipakai tetap ada dan `clubs.logo_path` menunjuk path baru.
5. Ulangi percobaan dari halaman yang sama setelah akun terhapus → login harus
   gagal secara generik; tidak boleh ada penghapusan kedua.
6. Uji kegagalan jaringan di tengah proses: halaman tidak boleh menampilkan
   sukses; setelah jaringan pulih, ulangi dan pastikan job melanjutkan (bukan
   menggandakan penghapusan).

Catat hasil per butir. Bila Edge Function belum di-deploy, halaman akan
menampilkan galat "belum selesai"; itu **bukan** bukti penghapusan berhasil.

## 4. Batasan yang disengaja

- Halaman ini bukan build web aplikasi Expo; tidak ada peta, chat, atau fitur
  lain di sini.
- Access token hanya disimpan di memori selama satu percobaan; tidak ada
  `localStorage`.
- Kebijakan privasi menjelaskan data yang **sengaja dipertahankan** (laporan
  bahaya, audit moderasi, pesan yang diredaksi). Jangan mengubahnya menjadi
  klaim "semua data dihapus" tanpa mengubah implementasi dan ADR-077.
