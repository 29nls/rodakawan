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

Seluruh migration di `supabase/migrations/` (28 berkas saat penulisan ini — jumlah pastinya
`ls supabase/migrations/*.sql | Measure-Object`) diterapkan ke database **kosong** beta:

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

Jalur termudah adalah variabel repository (Settings → Secrets and variables → Actions →
**Variables**):

| Variable | Nilai untuk beta |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://<ref-beta>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key project beta |
| `EXPO_PUBLIC_MAP_STYLE_URL` | kosongkan (peta belum dipilih, ADR-064) |

Lalu jalankan workflow rilis dari commit yang diinginkan (bagian 6.7 SETUP_GUIDE):

```powershell
gh workflow run release-on-push.yml --ref main   # atau -f commit=<sha>
```

Karena APK beta memakai id paket yang sama, peserta **tidak bisa** memasang APK beta dan APK
rilis berdampingan — itu disengaja. Setelah beta selesai, kembalikan ketiga variabel ke nilai
project development/produksi yang benar sebelum rilis berikutnya.

Alternatif build lokal (tanpa GitHub) ada di SETUP_GUIDE bagian 6.1 — rangkaiannya sama:
`expo prebuild` → `configure-android-release.mjs` → `assembleRelease` → `verify-apk.mjs`.

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

1. Ambil APK dari halaman **GitHub Releases** (atau Artifacts run workflow) — bukan dari
   perkiraan lokal.
2. Cocokkan **SHA-256** berkasnya dengan bagian **🔒 Verifikasi berkas** di badan rilis itu
   (SETUP_GUIDE bagian 6.10). Yang dibagikan adalah berkas yang sudah cocok.
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
  diterapkan. Perbaikan = migration **baru** yang diterapkan ke beta, lalu `beta:preflight` dan
  `npm run e2e:shared-ride` (dengan env beta) dijalankan ulang.
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
- [ ] Variabel GitHub diarahkan ke beta; APK dibangun; SHA-256 cocok dengan halaman rilis.
- [ ] Backup keystore diverifikasi `keytool -list`.
- [ ] APK + `BETA_GUIDE_PESERTA.md` dibagikan ke peserta terpilih; kanal masukan siap.
- [ ] Setelah beta: variabel build dikembalikan; project beta ditutup/dibiarkan sesuai kebutuhan
      (jangan dijadikan produksi tanpa audit ulang).
