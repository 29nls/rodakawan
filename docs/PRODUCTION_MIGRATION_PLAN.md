# Rencana migrasi ke project produksi

Status: **rencana — belum dieksekusi**. Tanggal 27 Oktober 2026 · Basis: `main`
`c882939`, audit [SECURITY_RELEASE_AUDIT.md](SECURITY_RELEASE_AUDIT.md), dan
[BETA_RUNBOOK.md](BETA_RUNBOOK.md) (yang khusus untuk beta).

Dokumen ini menjawab empat hal: promosi migration, backup/restore, rollback, dan
pengarahan halaman web ke backend rilis. Tidak ada fitur, dependency, izin
Android, atau migration baru yang ditambahkan oleh rencana ini.

## 0. Keputusan yang mengikat rencana

| Hal | Keputusan | Konsekuensi bila salah |
| --- | --- | --- |
| Data beta | **Tidak dipindahkan.** Produksi mulai kosong; hanya tombstone `00000000-0000-4000-8000-000000000001` yang dibuat migration. | Menyalin data beta berarti membawa akun sintetis/media uji ke produksi. |
| Peta | `EXPO_PUBLIC_MAP_STYLE_URL` adalah variabel build ketiga dan juga dibakar. Nilai produksi harus gaya peta yang sah; bila provider belum diputuskan, biarkan kosong dan jangan klaim peta siap. | Build produksi memakai gaya peta dev/uji atau menampilkan peta kosong. |
| Schema | Hanya lewat `supabase/migrations/` di repo, tidak pernah SQL manual. | Riwayat remote dan repo berbeda; `db push` berikutnya berbahaya. |
| Identitas APK | Paket dan keystore **sama** dengan beta (`com.rodakawan.app`). | Mengganti paket setelah unggah Play = aplikasi baru. |
| Backend APK | `EXPO_PUBLIC_*` **dibakar saat build**; tidak bisa diganti runtime. | APK dev tidak bisa diarahkan ke produksi tanpa build ulang. |
| Web | Satu halaman statis menunjuk **satu** project. | Halaman yang masih menunjuk development tidak boleh dipublikasikan. |
| Migration rollback | Tidak ada down migration; perbaikan = migration baru. | "Rollback" dengan menghapus migration merusak riwayat. |
| APK rollback | `versionCode` tidak boleh turun. | APK lama tidak bisa dipasang di atas yang lebih baru. |

## 0.1 Blocker P0 yang harus ditutup sebelum produksi

Ditemukan saat menyusun rencana ini, **belum diperbaiki** karena berada di luar
lingkup dokumen (butuh perubahan kode Edge Function). Ini **tidak terlihat**
pada audit development karena project development masih memiliki key legacy:

- `supabase/functions/delete-account/index.ts:102-104` membaca
  `SUPABASE_ANON_KEY` dan `SUPABASE_SERVICE_ROLE_KEY`. **Project Supabase baru
  tidak lagi menyediakan key legacy itu**; yang ada adalah
  `SUPABASE_PUBLISHABLE_KEYS` dan `SUPABASE_SECRET_KEYS` berbentuk JSON
  (`{"default":"..."}`). Dokumentasi Supabase juga menyatakan `verify_jwt`
  platform tidak memahami key baru.
- Akibatnya, bila project produksi baru tidak menyediakan env legacy (default
  untuk project baru), fungsi membalas **503 `account_deletion_unavailable`**
  dan halaman web tidak bisa menghapus akun. Ini bukan masalah RLS atau
  migration. Periksa **Edge Functions → Secrets** project produksi sebelum
  cutover; jangan berasumsi key legacy ada.
- Perbaikan yang harus dilakukan **sebelum** cutover, sebagai commit terpisah:
  1. baca key baru dengan fallback legacy (parse JSON, ambil `default`), dan
     pastikan klien admin mengirim secret pada header `apikey` — bukan
     `Authorization: Bearer` yang membuat platform mencoba mem-parse-nya
     sebagai JWT (atau pakai `@supabase/server`);
  2. tambahkan `supabase/config.toml` dengan
     `[functions.delete-account]` dan `verify_jwt = false` — fungsi tetap
     memverifikasi token lewat `auth.getUser`, jadi ini tidak membuka akses;
  3. uji ulang `e2e:account-delete` (17) di development dan satu akun uji di
     staging, termasuk request tanpa token (401) dan akun lain (tidak bisa
     dihapus).
- Tanpa langkah ini, jangan membuat klaim “produksi siap” meskipun preflight
  produksi lulus.

## 1. Prasyarat yang harus diputuskan pemilik

Sebelum satu perintah pun dijalankan:

1. **Project produksi** Supabase baru (jangan memakai project development
   `xvmcpfkkveeaevfcvfug`, jangan memakai project beta sebagai produksi).
   Pilih region yang dekat pengguna dan catat ref + database password di
   password manager.
2. **Paket Android final** (ADR-015 masih menyebut `com.rodakawan.app`
   sementara). Putuskan sebelum unggah pertama ke Play Console.
3. **SMTP + Confirm email** untuk produksi. Jangan mengulang `autoconfirm`
   development; preflight akan menandainya GAGAL.
4. **Origin halaman web** yang akan dipakai (`https://<owner>.github.io` untuk
   GitHub Pages project site, atau domain kustom). Ini menjadi
   `WEB_ALLOWED_ORIGINS`.
5. **Rencana dan RPO**:
   - Supabase Pro: backup harian otomatis, retensi 7 hari.
   - PITR (add-on Pro/Team/Enterprise, butuh compute minimal Small): RPO
     sampai ~2 menit; harga 7 hari sekitar **$100/bulan** menurut dokumentasi
     Supabase saat rencana ini ditulis. Untuk pilot 2–5 pengguna ini biasanya
     belum sepadan; untuk peluncuran publik dengan data nyata, evaluasi ulang.
   - Tanpa PITR: RPO realistis **≤24 jam** dari backup harian, ditambah dump
     manual sebelum setiap migration.
6. **Retensi data** (hazard, audit moderasi, chat teredaksi, metadata job hapus
   akun) disahkan produk/legal. Tanpa itu, halaman privasi tidak boleh
   diklaim final.

## 2. Pemisahan lingkungan

| Lingkungan | Project | Dipakai oleh | Boleh diuji dengan `db:test`? |
| --- | --- | --- | --- |
| Development | `xvmcpfkkveeaevfcvfug` | pengembangan harian, akun sintetis | **Ya** (sudah rutin) |
| Staging (disarankan) | project baru, sekali pakai | rehearsal migration + E2E | **Ya**, lalu dihapus |
| Produksi | project baru | pengguna nyata | **Tidak** — hanya preflight read-only dan smoke test terkendali |

Aturan environment:

- `.env.local` dibaca Expo di semua mode; **jangan** menyimpannya dengan nilai
  produksi. Untuk perintah CLI, isi environment di shell sesi itu saja, lalu
  tutup shell. `.env.db` boleh dipakai sementara untuk `DATABASE_URL`
  produksi, tetapi kembalikan ke development setelah selesai.
- URL project dan **publishable key** produksi memang publik (masuk bundel dan
  halaman web). Database password, service role key, dan keystore tidak pernah
  masuk repo, argumen yang tercetak, atau chat.
- Repo ini publik. Jangan pernah menaruh dump database, `.env*`, atau tangkapan
  layar berisi kredensial di issue/PR.

## 3. Rehearsal wajib di staging

Tujuannya membuktikan seluruh migration dan RLS berjalan pada database kosong
**sebelum** produksi, tanpa menjalankan uji DDL di produksi.

```powershell
# Shell sesi ini; password diminta interaktif, jangan ditulis di baris perintah.
npx supabase link --project-ref <ref-staging>
npx supabase migration list --linked      # seluruh Remote harus kosong
npx supabase db push --dry-run            # harus menyebut seluruh migration lokal
npx supabase db push --yes
npx supabase migration list --linked      # jumlah lokal = remote
npx supabase functions deploy delete-account --project-ref <ref-staging>
npx supabase secrets set WEB_ALLOWED_ORIGINS="https://<owner>.github.io" --project-ref <ref-staging>
```

Lalu arahkan environment ke staging dan jalankan uji yang memang bisa
menargetkan project mana pun:

```powershell
$env:EXPO_PUBLIC_SUPABASE_URL = 'https://<ref-staging>.supabase.co'
$env:EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = '<publishable-key-staging>'
$env:DATABASE_URL = '<connection-string-staging>'

npm run db:test                 # 11/11, seluruh transaksi ROLLBACK
npm run db:types:check
npm run beta:preflight          # 8/8 bila pengaturan Auth staging = produksi
```

Batas runner yang harus dihormati (dibaca dari kode, bukan asumsi):

- `e2e:account-delete` dan `e2e:shared-ride` **mengunci ref development**
  (`scripts/account-deletion-e2e.mjs:53,164`,
  `scripts/shared-ride-e2e.mjs:237`). Keduanya tidak bisa diarahkan ke staging;
  bukti E2E tetap berasal dari development pada commit yang sama. Jangan
  memaksa dengan menyunting guard.
- `storage:test` tidak mengunci ref, tetapi dokumentasinya menyebut project
  development dan memakai ID tetap. Jalankan di development. Untuk staging,
  buktikan policy Storage secara manual dengan dua akun uji (unggah/unduh/hapus
  lintas akun), lalu bersihkan.
- `db:test` berjalan dalam transaksi dan `ROLLBACK`, jadi aman pada staging
  kosong; **jangan** menjalankannya pada produksi meski rollback.

Kriteria lulus rehearsal:

- `migration list` tanpa selisih; `db:types:check` lulus;
- `db:test` **11/11** di staging;
- `beta:preflight` **8/8** di staging (termasuk autoconfirm nonaktif). Bila SMTP
  staging belum ada, catat kegagalan itu sebagai temuan konfigurasi, bukan
  kegagalan migration;
- bukti E2E development pada commit yang sama: `storage:test` **27**,
  `e2e:account-delete` **17**, `e2e:shared-ride` **24**;
- tidak ada akun/objek uji tersisa di staging maupun development.

Hapus project staging setelah rehearsal (atau biarkan kosong) supaya tidak
menjadi backend kedua yang lupa dipantau. Catat hasilnya di laporan rilis.

## 4. Backup sebelum menyentuh produksi

### 4.1 Backup yang disediakan platform

- Backup harian otomatis hanya untuk Pro/Team/Enterprise (7/14/30 hari).
- Backup **tidak** memuat objek Storage; yang tersimpan hanya metadata.
- Restore backup harian/PITR bersifat **in-place** dan project tidak dapat
  diakses selama proses. Untuk investigasi, duplikasi project lebih dulu.
- Free plan: tidak ada backup otomatis; wajib dump manual off-site.

### 4.2 Dump logis mandiri (sebelum setiap `db push` produksi)

Prasyarat: Supabase CLI + `psql`/`pg_dump` (dan Docker Desktop bila CLI
memintanya). Folder `backups/` sudah diabaikan Git.

```powershell
# Setelah `supabase link --project-ref <ref-prod>`
npx supabase db dump --linked -f backups/prod-roles.sql --role-only
npx supabase db dump --linked -f backups/prod-schema.sql
npx supabase db dump --linked -f backups/prod-data.sql --use-copy --data-only
npx supabase db dump --linked -f backups/prod-history-schema.sql --schema supabase_migrations
npx supabase db dump --linked -f backups/prod-history-data.sql --use-copy --data-only --schema supabase_migrations
```

Periksa hasilnya **tanpa mencetak isi**: ukuran berkas wajar, dan
`prod-schema.sql` memuat `CREATE TABLE public.profiles` serta policy RLS.
Simpan dua salinan terenkripsi (password manager + media offline), retensi
minimal 30 hari, akses terbatas. Jangan meng-commit `backups/`.

### 4.3 Drill restore (wajib, bukan opsional)

1. Buat project **scratch** baru (jangan produksi).
2. Ikuti panduan resmi Supabase *Backup and Restore using the CLI*: restore
   `roles.sql` → `schema.sql` → `data.sql` dengan
   `SET session_replication_role = replica` di antara schema dan data, lalu
   restore riwayat `supabase_migrations`. Beberapa baris `OWNER TO
   supabase_admin`/grant role mungkin perlu dikomentari sesuai catatan resmi.
3. Pada project scratch hasil restore, jalankan `npm run db:test` (11/11) dan
   `npm run db:types:check`. Suite SQL berjalan dalam transaksi `ROLLBACK`,
   tetapi jangan pernah menunjukkannya ke produksi; project scratch harus
   disposable dan tidak melayani pengguna.
4. Bandingkan jumlah baris tabel utama dan jumlah objek Storage dengan sumber.
   Restore database tidak memulihkan berkas; selisih objek adalah temuan yang
   harus dicatat, bukan diabaikan.
5. Hapus project scratch setelah drill; catat tanggal, durasi, dan temuan.

Alternatif yang lebih aman untuk produksi: **Restore to a New Project**
(Duplicate Project) dari backup. Yang ikut: schema, seluruh data, role, data
Auth (termasuk hash kata sandi), dan encryption root key. Yang **tidak** ikut:
objek/bucket Storage, Edge Functions, pengaturan Auth/API key, Realtime, dan
extension. Setelah clone, deploy ulang `delete-account`, set secret, dan salin
objek Storage secara terpisah — jangan menganggap clone = produksi lengkap.

### 4.4 Objek Storage

Database backup **tidak** memulihkan berkas di bucket. Untuk produksi:

- minimal, unduh objek penting secara berkala lewat Dashboard/Storage API;
- atau jalankan skrip satu-kali di mesin owner dengan **service role key dari
  environment** (bukan file yang di-commit) untuk menyalin
  `avatars`, `vehicle-photos`, `club-logos` ke penyimpanan terenkripsi;
- uji restore ke bucket scratch dan bandingkan jumlah objek;
- jangan menaruh service role key di `web/`, `EXPO_PUBLIC_*`, atau log.

Batas yang harus disadari: menghapus objek setelah backup tidak bisa
dikembalikan oleh restore database; hanya salinan objek yang bisa.

## 5. Promosi migration ke produksi

### 5.1 Sebelum jendela

- [ ] Commit yang akan dirilis lulus **CI** dan **Database RLS** di `main`.
- [ ] `git status` bersih; tidak ada migration yang belum di-commit.
- [ ] `npm ci` + gerbang lokal lulus (lihat `AGENTS.md`).
- [ ] **Blocker §0.1 sudah ditutup** (fungsi membaca key baru + `verify_jwt = false`).
- [ ] Rehearsal staging §3 lulus pada commit yang sama.
- [ ] Backup §4.2 (untuk produksi yang sudah berisi data) selesai dan
      diverifikasi.
- [ ] Tidak ada deploy lain yang berjalan bersamaan (concurrency workflow
      rilis sudah global, tetapi migration manual tidak).

### 5.2 Jendela penerapan (produksi kosong, pertama kali)

```powershell
npx supabase link --project-ref <ref-prod>
npx supabase migration list --linked      # semua Remote kosong; jika tidak, STOP
npx supabase db push --dry-run            # daftar harus = seluruh migration lokal
npx supabase db push --yes
npx supabase migration list --linked      # lokal = remote
```

Lalu verifikasi **read-only** terhadap produksi:

```powershell
$env:DATABASE_URL = '<connection-string-prod>'
$env:EXPO_PUBLIC_SUPABASE_URL = 'https://<ref-prod>.supabase.co'
$env:EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = '<publishable-key-prod>'

npm run db:types:check      # tipe repo = schema produksi (tidak menulis)
npm run beta:preflight      # harus 8/8
```

`db:types:check` mencetak target `user@host` tanpa password; jangan salin
keluarannya ke laporan publik. **Jangan** menjalankan `db:test`,
`storage:test`, atau E2E pembuat akun terhadap produksi.

### 5.3 Setelah push

- [ ] `migration list` **25 = 25** (atau jumlah aktual saat itu).
- [ ] Tabel tombstone ada tepat satu; `deleted_at` terisi.
- [ ] Ketiga bucket ada dan **privat** (preflight).
- [ ] `delete-account` di-deploy, memakai key baru (bukan env legacy yang
      kosong), dan menolak request tanpa JWT/apikey (401).
- [ ] Satu akun uji produksi berhasil dihapus penuh lewat halaman web; bukan
      hanya 401 yang diperiksa.
- [ ] Redirect URL `rodakawan://auth/callback` terdaftar; Site URL benar.
- [ ] SMTP teruji: konfirmasi pendaftaran dan reset password benar-benar
      sampai (bukan hanya "dashboard hijau").
- [ ] Rate limit Auth dan CAPTCHA (bila tersedia) diputuskan.
- [ ] Tidak ada akun uji tersisa (preflight).

### 5.4 Promosi berikutnya (produksi sudah berisi data)

Urutannya sama, dengan tambahan:

1. Review migration baru: aditif, tidak menghapus kolom yang masih dibaca
   versi APK sebelumnya (pola expand/contract).
2. Backup §4.2 **dan** konfirmasi backup harian/PITR tersedia.
3. Rehearsal pada **clone** produksi (Duplicate Project) atau staging yang
   datanya sintetis; jalankan `db:test` di sana, bukan di produksi.
4. `db push --dry-run` → `--yes`; selesaikan dalam satu jendela.
5. Rilis APK yang kompatibel dengan schema baru; jangan biarkan APK lama
   menulis ke schema yang sudah berubah tanpa masa transisi.

## 6. Rollback

### 6.1 Prinsip

- **Tidak ada down migration.** Migration yang sudah diterapkan tidak disunting
  atau dihapus; perbaikan selalu migration baru.
- Rollback schema yang aman = **forward-fix** yang aditif.
- Restore backup adalah tindakan **destruktif dan in-place** (project tidak
  dapat diakses selama restore); untuk investigasi, restore ke project baru.
- APK tidak bisa di-downgrade; rollback aplikasi = rilis perbaikan dengan
  `versionCode` lebih tinggi.
- Setiap insiden dicatat di `docs/INCIDENT_RESPONSE.md` (waktu, commit,
  migration, dampak, tindakan).

### 6.2 Pohon keputusan

| Keadaan | Tindakan |
| --- | --- |
| `db push` gagal sebelum migration pertama | Tidak ada perubahan. Perbaiki penyebab, ulangi. |
| Gagal di tengah, produksi **belum** punya pengguna | Perbaiki migration secara forward, atau hapus & buat ulang project kosong lalu push lagi. |
| Gagal di tengah, produksi **sudah** punya pengguna | Jangan hapus project. Perbaiki dengan migration baru; bila schema tidak konsisten, restore backup ke **project baru**, verifikasi, lalu arahkan environment ke sana. |
| Data rusak/hilang karena bug aplikasi | Hentikan penulisan (nonaktifkan fungsi/rilis), tentukan waktu aman, restore PITR/backup ke project baru, bandingkan, baru arahkan. |
| Edge Function salah | Deploy ulang versi commit sebelumnya; secret tidak berubah. Verifikasi 401 tanpa JWT. |
| Pengaturan Auth/SMTP salah | Kembalikan di Dashboard; tidak butuh build. |
| Halaman web salah menunjuk backend | Revert commit `config.js`, push (workflow `web/**`), atau unpublish Pages sebagai upaya terakhir. |
| APK baru bermasalah | Terbitkan APK perbaikan dengan `versionCode` lebih tinggi. APK lama **tidak** bisa dipasang di atasnya. |

### 6.3 Target pemulihan

Target ini harus diuji, bukan diasumsikan:

- **RPO**: ≤24 jam dengan backup harian; ≤2 menit bila PITR aktif.
- **RTO**: ≤4 jam untuk restore project kecil (Ukur saat drill; downtime
  restore in-place lebih lama daripada membuat project baru + arahkan ulang).
- **Storage RPO** terpisah dan lebih buruk kecuali ada salinan objek; tulis
  batas ini di kebijakan privasi/internal.

### 6.4 Yang tidak boleh dilakukan saat rollback

- Menghapus baris `supabase_migrations` agar `db push` mengulang migration.
- Menjalankan `db reset` pada project remote.
- Menyalin SQL dari development ke produksi.
- Menurunkan `versionCode` atau memakai ulang tag rilis.
- Menghapus project produksi yang sudah berisi data pengguna.

## 7. Halaman web ke backend rilis

Lakukan **setelah** preflight produksi 8/8 dan sebelum APK produksi disebar.

1. Ubah `web/account-deletion/config.js`:
   - `supabaseUrl` → `https://<ref-prod>.supabase.co`
   - `publishableKey` → publishable key produksi (bukan service role)
   - `supportUrl`/`privacyUrl` tetap, atau sesuaikan setelah domain final.
2. Jalankan uji statis (juga berjalan di CI):

   ```powershell
   node --test scripts/__tests__/web-static.test.mjs   # 11/11
   if (Select-String -Path web/account-deletion/config.js -Pattern 'xvmcpfkkveeaevfcvfug' -Quiet) {
     throw 'config.js masih menunjuk project development'
   }
   ```

   Perhatikan batas uji itu: `config.js` **dikecualikan** dari pemindaian ref
   development (`scripts/__tests__/web-static.test.mjs`), justru karena berkas
   ini memang harus memuat URL project. Karena itu langkah `grep` di atas wajib:
   tanpa itu, lupa mengganti URL tetap lolos 11/11. publishable key produksi
   boleh ada karena memang publik; service role tidak pernah boleh.
3. Set origin halaman di Edge Function produksi, lalu deploy ulang bila perlu:

   ```powershell
   npx supabase secrets set WEB_ALLOWED_ORIGINS="https://<owner>.github.io" --project-ref <ref-prod>
   npx supabase functions deploy delete-account --project-ref <ref-prod>
   ```

   Isi **origin** saja (skema + host + port), tanpa path. Bila domain Pages
   berubah, perbarui nilai ini.
4. Uji CORS tanpa token (preflight):

   ```powershell
   curl.exe -i -X OPTIONS "https://<ref-prod>.supabase.co/functions/v1/delete-account" `
     -H "Origin: https://<owner>.github.io" `
     -H "Access-Control-Request-Method: POST"
   # harapan: 204 + Access-Control-Allow-Origin: https://<owner>.github.io

   curl.exe -i -X OPTIONS "https://<ref-prod>.supabase.co/functions/v1/delete-account" `
     -H "Origin: https://evil.example" `
     -H "Access-Control-Request-Method: POST"
   # harapan: 403 origin_not_allowed
   ```

   Bila gateway membalas **401 sebelum fungsi berjalan** (kemungkinan karena
   `verify_jwt` default true dan preflight tidak membawa token), browser akan
   memblokir panggilan. Jangan menerbitkan halaman dan jangan melemahkan
   verifikasi; catat sebagai **Blocked**, lalu putuskan `verify_jwt = false`
   khusus fungsi ini (fungsi tetap memverifikasi `auth.getUser`) atau pola
   gateway yang didukung. `supabase/config.toml` belum ada di repo (C-01), jadi
   pengaturan platform harus diperiksa di Dashboard dan dicatat di laporan.
5. Aktifkan **Settings → Pages → Source: GitHub Actions**. Push perubahan
   `config.js` ke `main` (trigger `web/**`) atau jalankan
   `gh workflow run pages.yml`. Catat `page_url` dari ringkasan run.
6. Verifikasi di browser: halaman privasi dan hapus akun terbuka, tidak ada
   error konsol, dan alur hapus akun diuji dengan **akun produksi sekali
   pakai** yang sudah dikonfirmasi emailnya:
   - salah kata sandi → pesan galat jelas;
   - kata sandi benar → status selesai;
   - Auth user, profil, media pribadi hilang; konten bersama menjadi tombstone;
   - login ulang gagal; job `completed`; tidak ada objek/baris tersisa.
7. Baru setelah itu catat URL publik di `README.md`,
   `docs/BETA_READINESS.md`, `docs/ROADMAP.md`, dan `web/README.md` — dengan
   tanggal dan bukti, bukan sebelum halaman benar-benar terbuka.

Catatan: selama `config.js` menunjuk produksi, pengujian halaman di mesin
pengembang ikut menyentuh produksi. Untuk uji lokal, ubah sementara ke
development **tanpa commit**, atau gunakan salinan halaman.

## 8. APK produksi

### 8.1 Masalah yang harus diselesaikan lebih dulu

Kedua workflow build membaca **repository variables** (`vars.EXPO_PUBLIC_*`),
yang saat ini dipakai build preview/development. Bila variabel itu diganti ke
produksi, build preview ikut menunjuk produksi. Pilihan:

- **Disarankan:** tambahkan `environment: production` pada job `build-apk`
  `android-release.yml`, lalu isi **Environment variables** `production`
  dengan **ketiga** nilai: `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, dan `EXPO_PUBLIC_MAP_STYLE_URL`.
  Biarkan repository variables untuk build preview/development. Environment
  juga bisa diberi protection rule (reviewer wajib) sebelum job berjalan.
- **Alternatif tanpa mengubah workflow:** ganti repository variables tepat
  saat cutover, build, lalu kembalikan. Risikonya build lain yang berjalan
  bersamaan ikut memakai produksi — hindari.

`EXPO_PUBLIC_MAP_STYLE_URL` sering memuat kunci penyedia peta. Walaupun
nilainya masuk bundel dan bukan rahasia server, nilai itu tetap tidak boleh
ditaruh di repo; simpan di environment build seperti dua variabel lain.

Jangan memindahkan `EXPO_PUBLIC_*` ke `secrets`; nilainya tetap masuk bundel,
jadi bukan rahasia. Yang wajib rahasia tetap `ANDROID_KEYSTORE_*` dan service
role (hanya server).

### 8.2 Rilis

1. Naikkan `expo.version` di `app.json` (harus sama dengan input workflow) dan
   commit setelah CI hijau.
2. Jalankan workflow rilis produksi manual (bukan `release-on-push` yang
   otomatis untuk preview):

   ```powershell
   gh workflow run android-release.yml -f version=<versi>
   ```

3. Tunggu `verify` → `build-apk` → `smoke-test` → `release`. Jangan menandai
   sukses sebelum asset terunggah.
4. Verifikasi:
   - nama paket `com.rodakawan.app`, `versionCode` lebih besar dari rilis
     terakhir;
   - SHA-256 APK di badan rilis = berkas yang diunduh;
   - sidik jari sertifikat penandatangan sama dengan rilis sebelumnya;
   - layar Sistem aplikasi menampilkan ref produksi (URL/key publik).
5. Uji di **dua HP** + akun ketiga: daftar/konfirmasi email, klub, perjalanan,
   lokasi, chat, bahaya, hapus akun. Isi checklist 8f; jangan menulis
   "Tested on physical device" tanpa artefak.

### 8.3 Distribusi

- APK beta dan produksi memakai paket sama, jadi tidak bisa berdampingan;
  memasang APK produksi menimpa beta (data aplikasi di perangkat dipertahankan,
  sesi lama akan ditolak karena project berbeda — minta peserta login ulang).
- Setelah produksi berjalan, jangan arahkan kembali variabel build ke beta
  tanpa build baru.

## 9. Urutan cutover

| Waktu | Langkah | Bukti yang disimpan |
| --- | --- | --- |
| T-7 | Tutup §0.1; putuskan §1; buat project staging; rehearsal §3 | fungsi key baru teruji; `db:test` staging 11/11; E2E dev 27/17/24; preflight 8/8 |
| T-3 | Buat project produksi; siapkan SMTP, redirect URL, backup plan | tangkapan dashboard tanpa secret |
| T-1 | Dump baseline; uji restore ke scratch; siapkan Environment `production` | log drill, hash dump |
| T-0 | `db push` produksi → `db:types:check` → preflight → function + secret → Auth → web config → Pages | `migration list`, preflight 8/8, `page_url` |
| T-0 | Rilis APK produksi → smoke emulator → uji 2 HP | SHA-256, cert, checklist 8f |
| T+1 | Pantau Auth/function/DB; verifikasi backup harian; umumkan ke tester | log tanpa PII, tanggal |

Jangan mengumumkan URL web atau membagikan APK sebelum langkah verifikasi di
baris yang sama selesai.

## 10. Verifikasi pasca-cutover

- [ ] `beta:preflight` 8/8 terhadap produksi.
- [ ] Halaman web: privasi + hapus akun terbuka; CORS menolak origin asing;
      hapus akun sekali-pakai berhasil penuh.
- [ ] APK: login, konfirmasi email, reset password, klub, perjalanan, lokasi,
      chat, bahaya, hapus akun — di dua perangkat.
- [ ] Tidak ada akun/objek uji tersisa; `contoh.test` = 0.
- [ ] Backup harian terlihat di dashboard; dump manual tersimpan; drill
      berikutnya dijadwalkan.
- [ ] Kembalikan `.env.local`/`.env.db` mesin pengembang ke development;
      hapus salinan connection string produksi dari shell.
- [ ] Perbarui dokumen status dengan URL/tanggal **setelah** bukti; jangan
      menyunting entri ADR/CHANGELOG lama.

## 11. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Migration tidak bisa dibalik | Schema rusak | Rehearsal staging/clone, backup + drill, forward-fix |
| Edge Function memakai env key legacy | Hapus akun gagal 503 di project baru | Tutup §0.1 sebelum cutover; uji hapus akun nyata di staging |
| Backup DB tidak memuat Storage | Foto/logo hilang permanen | Salinan objek terpisah + uji restore bucket |
| Repository variables dipakai bersama | Build dev menunjuk produksi | Environment `production` khusus job rilis |
| `EXPO_PUBLIC_*` dibakar | Tidak bisa ganti backend tanpa build | Rilis baru; jangan tukar variabel saat runtime |
| APK tidak bisa downgrade | Rollback aplikasi tidak instan | Rilis perbaikan cepat; jangan pernah menurunkan versionCode |
| `autoconfirm`/SMTP salah | Akun tidak terverifikasi, email tidak sampai | Preflight + uji kirim email nyata sebelum sebar |
| Halaman web menunjuk dev | Pengguna menghapus akun di backend uji | Uji statis + review config sebelum Pages |
| Origin Pages berubah | Hapus akun dari web ditolak 403 | Perbarui `WEB_ALLOWED_ORIGINS`, uji CORS |
| Paket Android diganti setelah Play | Aplikasi baru, pengguna lama tertinggal | Putuskan sebelum unggah pertama |
| Repo publik | Kredensial bocor bila ceroboh | Tidak ada secret di repo; dump diabaikan; rotasi bila ragu |

## 12. Yang belum bisa dibuktikan tanpa pemilik

- Pembuatan project, aktivasi Pages, dan kredensial SMTP.
- Restore backup nyata (butuh project scratch dan data produksi).
- Uji perangkat fisik, Play Console, dan verifikasi sertifikat APK.
- Keputusan retensi, paket final, dan biaya PITR.

Sampai semua itu ada, status yang benar adalah **rencana**, bukan
"produksi siap".
