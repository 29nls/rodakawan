# Runbook Beta Tertutup — Panduan Pemilik

Dokumen ini melengkapi [`SETUP_GUIDE.md`](SETUP_GUIDE.md). SETUP_GUIDE menjelaskan pengembangan
harian terhadap project **development**; runbook ini menjelaskan langkah **sekali** menyiapkan
project **beta** terpisah, menyebarkan APK ke peserta, dan apa yang dilakukan bila ada masalah.

Aturan emas: **project development, beta, dan (kelak) produksi adalah project Supabase
berbeda.** Alat uji (`db:test`, `storage:test`, `e2e:*`) menolak selain development — jangan
memaksa mereka ke beta. Alat yang memang untuk beta adalah `beta:preflight` (hanya-baca).

Daftar isi:

1. [Buat project Supabase beta](#1-buat-project-supabase-beta)
2. [Terapkan migration ke beta](#2-terapkan-migration-ke-beta)
3. [Deploy Edge Function `delete-account`](#3-deploy-edge-function-delete-account)
4. [Atur Redirect URLs dan email](#4-atur-redirect-urls-dan-email)
5. [Jalankan preflight](#5-jalankan-preflight)
6. [Siapkan build APK beta](#6-siapkan-build-apk-beta)
7. [Backup keystore](#7-backup-keystore)
8. [Sebar APK ke peserta](#8-sebar-apk-ke-peserta)
9. [Rollback](#9-rollback)
10. [Checklist ringkas](#10-checklist-ringkas)

> Rencana untuk **project produksi** (bukan beta) ada di
> [`PRODUCTION_MIGRATION_PLAN.md`](PRODUCTION_MIGRATION_PLAN.md): promosi migration, backup/restore,
> rollback, dan pengarahan halaman web ke backend rilis.

## 1. Buat project Supabase beta

1. Masuk https://supabase.com/dashboard → **New project** (jangan menyentuh project development
   `xvmcpfkkveeaevfcvfug` maupun project produksi bila sudah ada).
2. Catat **region** (mis. Singapore) dan simpan database password di password manager — password itu
   tidak dipakai aplikasi mobile, hanya oleh Anda lewat connection string.
3. Ambil **Project URL** dan **publishable key** dari **Project Settings → API**. Jangan pernah
   menyalin service_role key ke mana pun selain server/Edge Function.

Siapkan dua berkas lokal (diabaikan Git, jangan pernah di-commit):

```dotenv
# .env.local — diisi URL + publishable key project BETA
EXPO_PUBLIC_SUPABASE_URL=https://<ref-beta>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key-beta>
```

```dotenv
# .env.db — session pooler project BETA, satu baris
DATABASE_URL=postgresql://postgres.<ref-beta>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

> Saat menyiapkan beta, `.env.local` dan `.env.db` di mesin Anda menunjuk beta — kembalikan ke
> development setelah selesai supaya alat uji harian tidak salah sasaran. Host langsung
> `db.<ref>.supabase.co` hanya punya record AAAA; selalu pakai host pooler seperti di atas.

## 2. Terapkan migration ke beta

Seluruh migration di `supabase/migrations/` diterapkan berurutan ke database **kosong** beta.
Hitung daftar aktual sebelum menerapkan, karena berkas migration baru ditambahkan secara aditif:

```powershell
(Get-ChildItem supabase/migrations/*.sql).Count
```

Pada 29 Oktober 2026 jumlah berkas lokal adalah **31** — termasuk migration revoke grant `anon`
`20261028031237_revoke_anon_rls_helper_execute.sql` — dan project development yang terhubung
tercatat sudah menerapkan seluruhnya. Jangan memakai angka lama (**30**, sebelum migration revoke)
sebagai target, dan jangan mulai beta dari salinan folder migration lama.

```powershell
npx supabase link --project-ref <ref-beta>   # menanyakan password sekali
npx supabase migration list                  # seharusnya seluruh baris Remote kosong
npx supabase db push --dry-run
npx supabase db push --yes
```

Catatan penting:

- Migration awal memakai `create table if not exists` dan akan **melewati diam-diam** tabel yang
  sudah ada dengan bentuk berbeda, lalu gagal di tengah. Database beta harus benar-benar bersih —
  jangan dipakai project lama yang pernah diutak-atik.
- Jangan menyunting migration yang sudah diterapkan; perbaikan lewat migration baru.
- Jangan pernah menuliskan connection string sebagai argumen perintah — npm mencetak ulang argumen
  lengkap di log (`npm notice run …`).

## 3. Deploy Edge Function `delete-account`

`delete-account` adalah satu-satunya jalur hapus akun penuh; Supabase menyuntikkan URL dan
kredensialnya ke fungsi otomatis, jadi tidak ada secret yang perlu disalin dari development.

Fungsi ini membaca **kedua format** key yang disediakan platform: format baru
(`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`, JSON `{"default":"..."}`) lebih dahulu,
lalu jatuh ke nama legacy (`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`). Jadi project
baru maupun lama bisa dipakai tanpa mengubah kode. `supabase/config.toml` menyetel
`verify_jwt = false` untuk fungsi ini **tanpa** melemahkan autentikasi: fungsi tetap
memverifikasi access token pengguna sendiri lewat `auth.getUser` dan tetap membalas 401 tanpa
token atau dengan token yang tidak sah. Setelah deploy, jalankan `npm run beta:preflight` dan
pastikan kedua probe `delete-account` tetap 401.

```powershell
npx supabase functions deploy delete-account --project-ref <ref-beta>
```

Bila halaman web hapus akun (`web/account-deletion/`) akan dipakai dari browser, isi daftar origin
yang diizinkan (fail-closed selama kosong):

```powershell
npx supabase secrets set WEB_ALLOWED_ORIGINS="https://<owner>.github.io" --project-ref <ref-beta>
```

Isi hanya **origin** (skema + host + port), bukan URL berisi path. Aplikasi Android tidak mengirim
header `Origin` sehingga tetap bekerja tanpa entri apa pun.

## 4. Atur Redirect URLs dan email

**Authentication → URL Configuration → Redirect Routes**:

- `rodakawan://auth/callback` — untuk APK dan development build (scheme di `app.json`).
- `exp://**` — hanya bila menguji lewat Expo Go.

**Authentication → Providers → Email** — putuskan konfirmasi email, dan ketahuilah konsekuensinya:

- **Confirm email menyala** (disarankan untuk beta): peserta harus mengklik tautan di email dulu.
  Dengan SMTP bawaan Supabase, kuota email sangat kecil dan sering tertunda berjam-jam — **pasang
  SMTP kustom** supaya email konfirmasi/reset benar-benar sampai. Caranya: **Authentication →
  Email → SMTP settings**, isi kredensial penyedia email (SendGrid, Mailgun, Mailjet, dsb.).
- **Confirm email mati (autoconfirm)**: sesi langsung tersedia tanpa verifikasi. Praktis untuk
  uji cepat, tetapi berarti siapa pun bisa mendaftar dengan email palsu. Bila memilih ini,
  **catat keputusannya** — jangan sampai tidak disadari.

`npm run beta:preflight` memeriksa autoconfirm di endpoint publik `/auth/v1/settings` dan
**menandainya GAGAL** bila aktif. Kegagalan itu adalah pengingat untuk mengambil keputusan sadar,
bukan perintah mematikan buta — lihat bagian 5.

## 5. Jalankan preflight

Dengan `.env.local` dan `.env.db` menunjuk project beta (bagian 1):

```powershell
npm run beta:preflight
```

Skrip ini **hanya-baca** dan memeriksa delapan hal: jumlah + daftar versi migration remote = lokal,
RLS aktif di semua tabel public, ketiga bucket media privat, Edge Function `delete-account`
menolak request tanpa JWT dan dengan apikey saja, autoconfirm tidak aktif, serta tidak ada akun
uji tersisa. Keluaran 0 berarti project beta layak dipakai.

Periksa baris pertama keluarannya: `Project : <ref>` harus menyebut **ref beta**, bukan
`xvmcpfkkveeaevfcvfug`. Terhadap project development (25 Oktober 2026) hasilnya 7 lulus, 1 gagal —
`mailer_autoconfirm` aktif di development; di beta, pastikan hasilnya 8/8 atau keputusan
autoconfirm-nya tercatat.

## 6. Siapkan build APK beta

APK beta memakai **keystore dan id paket yang sama** dengan rilis (`com.rodakawan.app`), supaya
bisa diperbarui mengikuti rilis berikutnya tanpa uninstall. Yang berbeda hanya nilai
`EXPO_PUBLIC_*` yang dibakar ke bundel.

Sebelum workflow beta dipakai, pemilik membuat GitHub Environment bernama `beta` (Settings →
Environments) dan mengisinya tanpa mengubah variables/secrets repository atau environment lain:

| Jenis | Nama di Environment `beta` | Nilai |
|---|---|---|
| Variable | `BETA_SUPABASE_PROJECT_REF` | ref project beta, bukan `xvmcpfkkveeaevfcvfug` |
| Variable | `BETA_SUPABASE_URL` | `https://<ref-beta>.supabase.co` |
| Variable | `BETA_SUPABASE_PUBLISHABLE_KEY` | publishable key project beta |
| Variable | `BETA_MAP_STYLE_URL` | style URL MapTiler setelah akun dibuat (ADR-082); kosongkan selama akun belum ada — tanpa nilai, build menampilkan "peta belum dikonfigurasi", bukan kegagalan |
| Secret | `BETA_SUPABASE_DATABASE_URL` | session-pooler connection string project beta |

Pastikan `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, dan
`ANDROID_KEY_PASSWORD` tersedia sebagai secrets repository yang sudah dipakai rilis. Nilai
`EXPO_PUBLIC_*` bersifat publik dan masuk APK; database URL tetap secret. Jalur build memverifikasi
ref API dan host/user DB cocok, menolak ref development, menjalankan `beta:preflight`, membangun,
memverifikasi SHA-256/tanda tangan, dan menjalankan smoke test emulator. Build beta hanya menjadi
**Actions artifact** 30 hari; workflow tidak membuat tag atau GitHub Release.

Setelah workflow ini tersedia pada branch default, jalankan dengan commit yang sudah lulus CI:

```powershell
gh workflow run release-on-push.yml --ref main -f environment=beta -f commit=<sha-yang-sudah-lulus-ci>
```

Unduh APK hanya bila workflow selesai sukses dan smoke test emulator lulus. Karena APK beta memakai
id paket dan keystore yang sama, peserta **tidak bisa** memasang APK beta dan APK lain berdampingan;
bangun ulang untuk mengganti backend. Jangan mengubah variables repository bersama.

## 7. Backup keystore

Keystore adalah identitas aplikasi. **Kehilangan keystore berarti instalasi yang sudah beredar
tidak akan pernah bisa diperbarui lagi.**

- Simpan berkas `rilis.jks` dan keempat nilainya (`ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) di **dua** tempat
  terpisah yang enkripsinya kuat (password manager + drive terenkripsi/offline).
- Jangan menyimpan `*.jks` di repo, di log, atau di chat (sudah diabaikan `.gitignore`; jangan
  di-commit).
- Uji backup secara berkala — backup yang belum pernah dipulihkan bukan backup:

```powershell
keytool -list -v -keystore rilis.jks -alias rilis   # harus berhasil dengan sandi yang dicatat
```

- Bila keystore pernah diekspor dari EAS (SETUP_GUIDE bagian 5.1), sidik jarinya tercatat di
  bagian **🔒 Verifikasi berkas** setiap halaman rilis — bandingkan untuk memastikan kunci yang
  dipakai build beta sama dengan yang beredar.

## 8. Sebar APK ke peserta

1. Untuk beta, unduh APK dari **Actions artifact** pada run beta yang sukses; jangan mencari
   GitHub Release karena workflow beta tidak menerbitkannya. Jangan memakai artifact sebelum
   job smoke test emulator lulus.
2. Cocokkan **SHA-256** berkas dengan log verifikasi APK pada run/summary Actions dan catat nilai
   tersebut pada lembar eksekusi pilot. Tolak unduhan jika nilainya berbeda.
3. Bagikan tautan unduhan **plus** [`BETA_GUIDE_PESERTA.md`](BETA_GUIDE_PESERTA.md) — peserta
   membutuhkan panduan izin lokasi/baterai dan cara lapor masalah.
4. Batasi jumlah peserta awal (5–15 orang) dan kanal masukan (grup obrolan kecil), supaya umpan
   balik tertangkap sebelum meluas.

## 9. Rollback

**APK bermasalah:** Android **menolak** memasang APK dengan `versionCode` lebih rendah di atas versi
terpasang (`INSTALL_FAILED_VERSION_DOWNGRADE`), jadi APK lama bukan rollback yang bisa dipakai
peserta. Yang benar: terbitkan APK perbaikan dengan `versionCode` lebih tinggi secepat mungkin.
Simpan APK lama hanya untuk instalasi bersih di perangkat yang belum memperbarui, atau untuk
pembanding. Rencana produksi lengkap ada di [`PRODUCTION_MIGRATION_PLAN.md`](PRODUCTION_MIGRATION_PLAN.md).

**Backend bermasalah:**

- Migration bersifat **aditif**; jangan pernah menghapus atau menyunting migration yang sudah
  diterapkan. Perbaikan = migration **baru** diterapkan ke beta, lalu jalankan `beta:preflight`
  (hanya-baca) dan ulangi kasus pilot manual yang terdampak. `db:test`, `storage:test`, serta
  runner `e2e:*` ditujukan ke development dan tidak boleh diarahkan ke beta.
- Project beta rusak parah/tercampur: buat project beta **baru** yang bersih (bagian 1–2) dan
  arahkan variabel build ke ref baru. Kehilangan data beta bisa diterima — beta adalah lingkungan
  uji, bukan data pengguna produksi.
- Jangan pernah memindahkan perubahan database beta ke development atau produksi dengan
  menyalin SQL manual; semuanya lewat migration di repo.

**Email/auth bermasalah:** kembalikan ke pengaturan sebelumnya lewat dashboard (Confirm email,
SMTP) — perubahan itu live, tidak butuh build baru.

## 10. Checklist ringkas

- [ ] Project Supabase beta dibuat; URL + publishable key + connection string disimpan di password
      manager; `.env.local`/`.env.db` diarahkan ke beta.
- [ ] `npx supabase db push --yes` diterapkan ke database bersih; `migration list` tanpa selisih.
- [ ] `delete-account` di-deploy; `WEB_ALLOWED_ORIGINS` diisi bila halaman web dipakai.
- [ ] Redirect URLs memuat `rodakawan://auth/callback`.
- [ ] Keputusan Confirm email diambil sadar; SMTP kustom dipasang bila konfirmasi menyala.
- [ ] `npm run beta:preflight` keluar 0 (atau keputusan autoconfirm tercatat).
- [ ] GitHub Environment `beta` memakai `BETA_*` variables/secrets khusus; variables repo development tidak diubah.
- [ ] Workflow beta selesai sukses termasuk smoke test emulator; APK Actions artifact diverifikasi SHA-256 dan sertifikatnya.
- [ ] Backup keystore diverifikasi `keytool -list`.
- [ ] APK + `BETA_GUIDE_PESERTA.md` dibagikan ke peserta terpilih; kanal masukan siap.
- [ ] Setelah beta: variabel build dikembalikan; project beta ditutup/dibiarkan sesuai kebutuhan
      (jangan dijadikan produksi tanpa audit ulang).
