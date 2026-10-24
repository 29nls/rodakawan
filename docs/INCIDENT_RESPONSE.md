# Prosedur tanggap insiden — RodaKawan

Dokumen ini untuk insiden keamanan/privasi yang menyentuh aplikasi Android, project
Supabase development, atau alur rilis. Tujuannya: menghentikan kerusakan, memutar
kredensial, memberi tahu pengguna secara jujur, dan mencatat bukti. **Jangan**
menghapus log atau menutup laporan sebelum bukti disalin.

Kontak: halaman **GitHub Issues** repo `29nls/rodakawan`
(`https://github.com/29nls/rodakawan/issues`). Belum ada alamat email atau nomor
darurat khusus; jangan mencantumkan kontak yang tidak benar-benar dipantau.

## 1. Deteksi dan triase

Sumber sinyal yang tersedia sekarang:

- **Supabase Dashboard → Logs** (API, Postgres, Auth, Edge Functions, Storage) dan
  **Advisors** (`npx supabase db advisors --linked` bila CLI tersedia).
- **GitHub Actions**: kegagalan `ci.yml`/`database-rls.yml`, job rilis APK, dan
  peringatan Dependabot/secret scanning.
- **GitHub Issues** dan laporan langsung pengguna.
- Perilaku aplikasi: galat 401/403 berulang, data pengguna lain terlihat, atau pesan
  galat yang memuat detail internal.

Langkah pertama (maksimal 30 menit):

1. Tentukan tingkat: **P0** data pribadi/kredensial terbuka atau penghapusan massal;
   **P1** akses lintas pengguna terbatas; **P2** kebocoran log/konfigurasi tanpa bukti
   penyalahgunaan.
2. Hentikan penyebab yang paling langsung (bagian 3–5). Jangan menunggu analisis
   lengkap bila kredensial sudah terekspos.
3. Simpan bukti: tangkapan layar log, ID request, commit/tag, waktu (UTC), dan
   perkiraan jumlah akun terdampak. Jangan menyalin token, password, atau isi pesan
   pribadi ke issue publik — gunakan GitHub Security Advisory (private) untuk detail.
4. Catat satu «insiden» di issue privat/Advisory dengan kronologi; perbarui setiap
   ada keputusan.

## 2. Rotasi kredensial Supabase

Urutannya: cabut yang bocor → ganti → perbarui pemakai → verifikasi.

1. **Secret/service role key** (Dashboard → Project Settings → API keys): buat kunci
   baru, ganti pemakaian di Edge Function/dashboard, lalu revoke kunci lama. Kunci ini
   tidak pernah boleh ada di repo, APK, atau chat.
2. **Password database**: Dashboard → Database → Settings → Reset database password.
   Perbarui `.env.db` lokal dan secret CI `DB_TEST_DATABASE_URL`
   (`gh secret set DB_TEST_DATABASE_URL`), lalu jalankan `npm run db:test` untuk
   memastikan koneksi baru bekerja. Jangan mencetak nilainya.
3. **JWT secret/signing key** (Dashboard → Auth): putar **hanya** bila token
   penandatangan dicurigai bocor. Semua sesi berakhir; pengguna harus masuk ulang dan
   kunci klien yang diturunkan dari secret itu perlu diperbarui. Catat dampaknya di
   pengumuman.
4. **Access token Supabase CLI/GitHub** yang bocor: revoke di halaman token masing-
   masing, buat token scoped baru, dan perbarui secret environment — bukan file repo.
5. **Storage**: bila objek privat bocor, putar signed URL (otomatis kedaluwarsa) dan
   periksa policy bucket (`avatars`, `vehicle-photos`, `club-logos`). Jangan menghapus
   baris `storage.objects` langsung; gunakan Storage API.
6. Verifikasi: `npm run db:test`, `npm run db:types:check`, `npm run storage:test`,
   lalu login dan satu operasi baca/tulis dengan akun uji.

## 3. Menonaktifkan Edge Function

Untuk menghentikan endpoint yang disalahgunakan (mis. `delete-account`):

```bash
npx supabase functions delete delete-account --project-ref xvmcpfkkveeaevfcvfug
```

`functions delete` menghapus deployment, bukan kode di repo. Setelah akar masalah
diperbaiki dan diuji, deploy ulang:

```bash
npx supabase functions deploy delete-account --project-ref xvmcpfkkveeaevfcvfug
```

Bila hanya satu perilaku yang berbahaya, utamakan perbaikan kode + deploy ulang
daripada membiarkan endpoint mati lama. Catat waktu nonaktif dan aktif kembali.

## 4. Mencabut rilis/APK

1. Hapus GitHub Release dan tag yang memuat build bermasalah:
   `gh release delete <tag> --cleanup-tag --yes`.
2. Hapus asset APK dari release tersebut; APK yang sudah terpasang **tidak** bisa
   ditarik dari perangkat. Siapkan build perbaikan dengan versi lebih tinggi dan
   catat di `CHANGELOG.md` lewat workflow rilis (jangan menyunting entri lama).
3. Bila masalah ada di Play Console, hentikan peluncuran bertahap dan unggah build
   perbaikan. Jangan mengklaim rilis dicabut sebelum release/asset benar-benar hilang.
4. Jika commit berbahaya sudah di `main`, revert lewat PR (bukan force-push) dan
   pastikan CI + Database RLS hijau pada commit revert.

## 5. Memberi tahu pengguna

Belum ada kanal broadcast (push/email) di aplikasi. Sampai kanal itu ada:

- Terbitkan pengumuman di **GitHub Releases** dan issue yang disematkan; sebutkan
  data apa yang terdampak, apa yang sudah dilakukan, dan tindakan yang perlu diambil
  pengguna (mis. ganti kata sandi, keluar dari sesi lain).
- Perbarui halaman privasi di `web/privacy/` **setelah** pemilik men-deploy-nya; URL
  publik belum ada, jadi jangan mencantumkan tautan yang belum hidup.
- Untuk insiden yang wajib dilaporkan, gunakan GitHub Security Advisory agar detail
  tidak menjadi publik sebelum perbaikan selesai.

Jangan mengarang jumlah korban, penyebab, atau jaminan «tidak ada data yang diambil».
Tulis hanya yang bisa dibuktikan dari log/bukti yang disimpan.

## 6. Penutupan

1. Pastikan kredensial baru bekerja dan kredensial lama gagal (uji eksplisit).
2. Jalankan gate: `npm run typecheck`, `npm run lint`, `npm test -- --ci`,
   `npm run db:test`, `npm run db:types:check`.
3. Tulis catatan pasca-insiden singkat: garis waktu, akar masalah, apa yang mencegah
   deteksi lebih cepat, dan tindakan pencegahan dengan pemilik + tenggat.
4. Tambahkan uji regresi untuk celah yang ditemukan (SQL RLS, uji unit, atau
   pemeriksaan statis) sebelum menutup insiden.
