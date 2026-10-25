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

Halaman ini **belum ter-deploy**. Workflow penerbitannya sudah ada di
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml); job build (uji
statis + unggah artefak) sudah lulus pada run pertama, tetapi job deploy gagal
`404` karena GitHub Pages belum diaktifkan. Tidak ada URL publik yang boleh
diklaim sampai pemilik project benar-benar menerbitkannya. Google Play
meminta URL kebijakan privasi dan URL penghapusan akun yang dapat dibuka tanpa
memasang aplikasi; isi keduanya di Play Console setelah deploy diverifikasi.

## 1. Isi konfigurasi

Nilai diambil dari Supabase Dashboard → Project Settings → API, dari project yang
memang melayani halaman itu:

- Project URL → `supabaseUrl`
- Publishable key (atau anon key lama) → `publishableKey`

Untuk menguji halaman hari ini, gunakan project **development** dan akun sintetis.
Untuk Play Console, halaman harus menunjuk backend rilis yang dipakai pengguna —
jangan mencampur keduanya. Edit [`account-deletion/config.js`](account-deletion/config.js).
Jangan pernah menaruh `service_role` key, password database, atau secret lain di
berkas ini: halaman statis dapat dibaca siapa saja. Halaman menolak berjalan
selama nilai masih berawalan `GANTI-`.

Uji statis (konten, tautan, tracker, secret, dan bentuk config) berjalan tanpa
jaringan:

```powershell
node --test scripts/__tests__/web-static.test.mjs
```

`supportUrl` dan `privacyUrl` boleh disesuaikan. Jangan mengarang alamat email
atau domain; saat ini dukungan memakai halaman GitHub Issues repository.

Halaman ini juga harus terdaftar di Edge Function `delete-account` lewat secret
`WEB_ALLOWED_ORIGINS` (origin saja: skema + host + port, tanpa path). Tanpa itu
fungsi menolak semua permintaan browser dengan `403 origin_not_allowed`; aplikasi
Android tetap bekerja karena tidak mengirim header `Origin`. Langkah dan
contohnya ada di [`docs/SETUP_GUIDE.md`](../docs/SETUP_GUIDE.md) §4.3a.

## 2. Deploy (pilih satu)

### Opsi A — Netlify Drop (paling cepat, tanpa repo workflow)

1. Buka <https://app.netlify.com/drop>.
2. Seret folder `web/` ke halaman itu.
3. Salin URL yang diberikan (mis. `https://<nama-acak>.netlify.app`).
4. Buka `.../account-deletion/` dan `.../privacy/`, pastikan keduanya tampil.

Tidak ada redirect yang diperlukan. Jangan gunakan URL ini sebagai bukti sebelum
kedua halaman benar-benar terbuka.

### Opsi B — GitHub Pages (jalur yang disiapkan repo)

Workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) sudah
ada dan hanya menerbitkan folder `web/`. Ia berjalan saat `web/**` berubah di
`main` atau lewat **Actions → Pages (halaman web publik) → Run workflow**.

1. Push perubahan ke `main` (setelah review/merge).
2. Repository → Settings → Pages → Build and deployment → Source:
   **GitHub Actions**. Langkah ini hanya bisa dilakukan pemilik repository;
   sampai itu, job `deploy` akan gagal dengan pesan dari GitHub, bukan sukses
   palsu.
3. Jalankan workflow secara manual untuk penerbitan pertama.
4. Salin `page_url` dari ringkasan job `deploy` (workflow mencetaknya). Jangan
   menebak `https://<owner>.github.io/<repo>/` — nama dan visibilitas repository
   menentukan hasilnya, dan repository privat membutuhkan paket GitHub yang
   mendukung Pages.

Jika memilih **Deploy from a branch** dengan folder `/`, isi `web/` harus
dipindahkan ke root; itu tidak disarankan karena mencampur kode aplikasi dengan
halaman publik.

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

Setelah halaman benar-benar terbuka, baru catat URL-nya di `docs/BETA_READINESS.md`
dan Play Console. Sampai saat itu statusnya tetap **Blocked**.

## 4. Batasan yang disengaja

- Halaman ini bukan build web aplikasi Expo; tidak ada peta, chat, atau fitur
  lain di sini.
- Access token hanya disimpan di memori selama satu percobaan; tidak ada
  `localStorage`.
- Kebijakan privasi menjelaskan data yang **sengaja dipertahankan** (laporan
  bahaya, audit moderasi, pesan yang diredaksi). Jangan mengubahnya menjadi
  klaim "semua data dihapus" tanpa mengubah implementasi dan ADR-077.
