# Halaman web publik: privasi dan cara menghapus data

Halaman statis tanpa build step dan tanpa JavaScript:

```
web/
  index.html                 tautan ke kedua halaman
  styles.css
  privacy/index.html         kebijakan privasi publik
  account-deletion/index.html langkah menghapus data dari aplikasi
```

Halaman ini **belum ter-deploy**. Workflow penerbitannya sudah ada di
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml); job build (uji
statis + unggah artefak) sudah lulus pada run pertama, tetapi job deploy gagal
`404` karena GitHub Pages belum diaktifkan. Tidak ada URL publik yang boleh
diklaim sampai pemilik project benar-benar menerbitkannya. Google Play meminta
URL kebijakan privasi dan URL penghapusan data yang dapat dibuka tanpa memasang
aplikasi; isi keduanya di Play Console setelah deploy diverifikasi.

## 1. Kenapa tidak ada formulir login

Sejak ADR-083, RodaKawan tidak punya akun: identitas dibuat otomatis per
perangkat lewat `signInAnonymously()` dan tidak ada email atau kata sandi.
Halaman yang meminta login tidak bisa dipakai pengguna mana pun — dan menjanjikan
jalur yang tidak ada. Karena itu halaman ini hanya menjelaskan **langkah
penghapusan di dalam aplikasi** (Profil → Hapus data saya), konsekuensinya, dan
kanal dukungan bila aplikasi tidak bisa dibuka.

Konsekuensi yang diterima: penghapusan tidak bisa dilakukan dari browser. Itu
batas model identitas anonim, bukan kekurangan halaman. Jangan menambahkan
formulir email/password kembali tanpa mengubah ADR-083 dan menyiapkan provider
email.

Halaman ini tidak memuat URL project, kunci Supabase, atau token apa pun, jadi
tidak ada konfigurasi yang perlu diisi sebelum deploy. Uji statis memastikan hal
itu tetap benar.

Uji statis (konten, tautan, tracker, dan tidak adanya secret) berjalan tanpa
jaringan:

```powershell
node --test scripts/__tests__/web-static.test.mjs
```

`supportUrl` saat ini halaman GitHub Issues repository. Jangan mengarang alamat
email atau domain.

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

1. Buka ketiga halaman; konfirmasi tidak ada error konsol dan tidak ada
   permintaan jaringan selain dokumen/CSS dari origin sendiri.
2. Halaman hapus data harus menyebut **Profil → Hapus data saya** dan tidak boleh
   punya kolom email, kata sandi, atau formulir apa pun.
3. Tautan dukungan dan tautan kebijakan privasi harus terbuka.
4. Jalankan penghapusan sungguhan **dari aplikasi** dengan akun uji di project
   development, lalu periksa di database:
   - `auth.users` untuk id tersebut sudah tidak ada;
   - `public.profiles` sudah tidak ada;
   - `public.hazard_reports` yang dibuat akun itu tetap ada dengan
     `reporter_id = 00000000-0000-4000-8000-000000000001`;
   - `public.account_deletion_jobs` berstatus `completed`;
   - objek `avatars`/`vehicle-photos` milik akun hilang, logo klub yang masih
     dipakai tetap ada dan `clubs.logo_path` menunjuk path baru.
5. Catat hasil per butir. Halaman web ini **tidak** menjalankan penghapusan, jadi
   jangan memakai "halaman terbuka" sebagai bukti data terhapus.

Setelah halaman benar-benar terbuka, baru catat URL-nya di `docs/BETA_READINESS.md`
dan Play Console. Sampai saat itu statusnya tetap **Blocked**.

## 4. Batasan yang disengaja

- Halaman ini bukan build web aplikasi Expo; tidak ada peta, chat, atau fitur
  lain di sini.
- Tidak ada JavaScript, tidak ada `localStorage`, tidak ada permintaan ke
  Supabase dari halaman.
- Kebijakan privasi menjelaskan data yang **sengaja dipertahankan** (laporan
  bahaya, audit moderasi, pesan yang diredaksi). Jangan mengubahnya menjadi
  klaim "semua data dihapus" tanpa mengubah implementasi dan ADR-077.
