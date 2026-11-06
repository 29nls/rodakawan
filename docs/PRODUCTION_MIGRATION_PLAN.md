# Rencana migrasi ke project produksi

Status: **rencana — belum dieksekusi**. Tanggal 27 Oktober 2026 · Basis: `main`
`c882939`, audit [SECURITY_RELEASE_AUDIT.md](SECURITY_RELEASE_AUDIT.md), dan
[BETA_RUNBOOK.md](BETA_RUNBOOK.md) (yang khusus untuk beta).

Dokumen ini menjawab empat hal: promosi migration, backup/restore, rollback, dan
pengarahan halaman web ke backend rilis. Tidak ada fitur, dependency, izin
Android, atau migration baru yang ditambahkan oleh rencana ini.

> **Pembaruan ADR-083 (6 November 2026):** aplikasi tidak lagi punya akun email. Di mana pun
> rencana ini menyebut "daftar/konfirmasi email", "login", "reset password", atau SMTP untuk APK,
> gantinya adalah **Anonymous sign-ins = ON** dan **provider Email = OFF** di project rilis. Setiap
> instalasi membuat identitas sendiri; tidak ada pemulihan identitas dan tidak ada email yang perlu
> dikonfirmasi. Langkah yang menyebut halaman web hapus akun tetap berlaku sebagai **Blocked**:
> halaman itu masih memakai alur email + kata sandi yang perlu ditinjau ulang.

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

## 0.1 Kompatibilitas key Edge Function — sudah ditutup

Temuan awal menyatakan fungsi hapus akun hanya membaca env legacy
(`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`) dan bahwa project baru tidak
lagi menyediakannya, sehingga fungsi akan membalas 503. **Sebagian dari premis
ini ternyata keliru** dan dikoreksi setelah diperiksa terhadap dokumentasi
Supabase resmi (27 Oktober 2026):

- Dokumentasi resmi **masih mencantumkan** `SUPABASE_ANON_KEY` dan
  `SUPABASE_SERVICE_ROLE_KEY` sebagai variabel yang disuntikkan ke runtime Edge
  Functions, dan panduan API key menyatakan keduanya "masih ada di runtime".
  Variabel baru (`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`) ditambahkan
  **di samping** nama lama, bukan menggantikannya.
- Yang benar adalah **timeline**: key legacy didepresiasi dan dijadwalkan
  berakhir **akhir 2026**. Karena itu ketergantungan pada nama legacy tetap
  risiko, bukan kegagalan sesaat.
- Dokumentasi **tidak konsisten** soal `verify_jwt`: satu panduan menyatakan
  pemeriksaan platform hanya memahami key lama, panduan yang lebih baru menyatakan
  ia menerima key publishable/secret demi kompatibilitas migrasi. Panduan yang
  konsisten di semua versi: **jangan mengandalkan `verify_jwt` sendiri untuk
  mengautentikasi pemanggil yang hanya membawa API key.**

Yang dikerjakan (commit pada fase ini):

1. `supabase/functions/delete-account/index.ts` membaca key baru lebih dahulu
   (`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`, parse JSON, ambil
   `default`) lalu **jatuh ke nama legacy**. Klien admin memakai `createClient(url,
   key)`, yang mengirim kredensial lewat header `apikey` — bukan sebagai Bearer
   JWT, karena key format baru memang bukan JWT.
2. `supabase/config.toml` menambahkan `[functions.delete-account]` dengan
   `verify_jwt = false`. **Ini tidak menghapus autentikasi**: fungsi tetap
   memverifikasi access token pengguna lewat `auth.getUser(token)` dan tetap
   membalas 401 tanpa token maupun dengan token yang tidak sah — dibuktikan uji
   negatif pada `npm run e2e:account-delete`.
3. Uji ulang `e2e:account-delete` di development: **21 langkah lulus**, termasuk
   permintaan tanpa token (401), token tidak valid (401), dan token yang hanya
   menghapus akunnya sendiri.

Verifikasi yang masih membutuhkan project baru sungguhan: jalankan
`beta:preflight` terhadap project beta/produksi dan pastikan probe
`delete-account` tetap 401 tanpa JWT dan dengan apikey saja. Jangan mengklaim
"produksi siap" hanya karena preflight lulus — periksa juga **Edge Functions →
Secrets** project target dan jangan berasumsi format key tertentu ada.

## 1. Prasyarat yang harus diputuskan pemilik

Sebelum satu perintah pun dijalankan:

1. **Project produksi** Supabase baru (jangan memakai project development
   `xvmcpfkkveeaevfcvfug`, jangan memakai project beta sebagai produksi).
   Pilih region yang dekat pengguna dan catat ref + database password di
   password manager.
2. **Paket Android final** (ADR-015 masih menyebut `com.rodakawan.app`
   sementara). Putuskan sebelum unggah pertama ke Play Console.
3. **Anonymous sign-ins = ON dan provider Email = OFF** di project produksi
   (ADR-083). Tidak ada SMTP, konfirmasi email, atau reset kata sandi yang perlu
   disiapkan untuk APK. `beta:preflight` tetap memeriksa `autoconfirm` di
   `/auth/v1/settings`; dengan provider Email mati, kegagalan pemeriksaan itu
   diharapkan dan dicatat sebagai temuan konfigurasi, bukan kegagalan migration.
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

npm run db:test                 # 12/12, seluruh transaksi ROLLBACK
npm run db:test:concurrency     # dua koneksi: kuota throttle tidak bisa dilewati
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
- `db:test` **12/12** di staging; `db:test:concurrency` lulus;
- `beta:preflight` **7/8 atau 8/8** di staging. Sejak ADR-083 provider Email
  dimatikan, sehingga pemeriksaan `autoconfirm` bisa gagal secara wajar; catat
  hasilnya sebagai temuan konfigurasi, bukan kegagalan migration. Tujuh
  pemeriksaan lain tetap wajib lulus;
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
3. Pada project scratch hasil restore, jalankan `npm run db:test` (12/12) dan
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
- [x] **Blocker §0.1 sudah ditutup** (27 Oktober 2026): fungsi membaca key baru
      dengan fallback legacy, `verify_jwt = false` dengan autentikasi tetap di
      handler, dan `e2e:account-delete` 21 langkah lulus di development.
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

- [ ] `migration list` **28 = 28** (atau jumlah aktual saat itu).
- [ ] Tabel tombstone ada tepat satu; `deleted_at` terisi.
- [ ] Ketiga bucket ada dan **privat** (preflight).
- [ ] `delete-account` di-deploy, memakai key baru (bukan env legacy yang
      kosong), dan menolak request tanpa JWT/apikey (401).
- [ ] Satu akun uji produksi berhasil dihapus penuh lewat halaman web; bukan
      hanya 401 yang diperiksa. (**Blocked** sampai halaman web pindah dari
      alur email + kata sandi ke identitas anonim, ADR-083.)
- [ ] **Anonymous sign-ins = ON** dan provider **Email = OFF**; provider lain
      yang tidak dipakai juga OFF.
- [ ] Satu instalasi baru di perangkat bersih mendapat sesi `authenticated`
      tanpa layar masuk; pengguna `anon` tetap ditolak RLS.
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
| Pengaturan Auth salah (Anonymous OFF / Email ON) | Aplikasi berhenti di "Butuh internet untuk memulai" | Kembalikan di Dashboard; tidak butuh build. |
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

1. Tidak ada konfigurasi backend di halaman. Sejak halaman hapus data menjadi
   instruksi tanpa JavaScript (6 November 2026), `web/` tidak memuat URL project,
   publishable key, atau token apa pun; terbitkan folder itu apa adanya.
2. Jalankan uji statis (juga berjalan di CI):

   ```powershell
   node --test scripts/__tests__/web-static.test.mjs   # 10/10
   ```

   Uji ini memindai **seluruh** `web/` tanpa pengecualian terhadap ref project
   development, kunci Supabase, JWT, dan connection string; halaman yang kembali
   memuat config akan langsung gagal.
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
   gateway yang didukung. `supabase/config.toml` kini ada di repo dan menyetel
   `verify_jwt = false` untuk fungsi ini (C-01 ditutup); periksa di Dashboard bahwa
   pengaturan platform mengikuti konfigurasi itu dan catat di laporan.
5. Aktifkan **Settings → Pages → Source: GitHub Actions**. Push perubahan
   `config.js` ke `main` (trigger `web/**`) atau jalankan
   `gh workflow run pages.yml`. Catat `page_url` dari ringkasan run.
6. Verifikasi di browser: halaman privasi dan hapus akun terbuka dan tidak ada
   error konsol. **Alur hapus akun tidak lagi lewat halaman web**: sejak 6 November 2026 halaman
   itu hanya memuat instruksi (tanpa JavaScript, formulir, atau config), karena identitas anonim
   hanya ada di perangkat. Verifikasi penghapusan dilakukan dari aplikasi terhadap project
   development, bukan dari browser.
   memakai email + kata sandi, sedangkan APK baru tidak punya akun email
   (ADR-083). Jangan menerbitkan halaman itu sebagai alur final sebelum ia
   diubah ke identitas perangkat; catat sebagai **Blocked** dengan pemilik
   sebagai penanggung jawab. Setelah diubah, uji dengan akun produksi sekali
   pakai:
   - Auth user, profil, media pribadi hilang; konten bersama menjadi tombstone;
   - job `completed`; tidak ada objek/baris tersisa.
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
5. Uji di **dua HP** (identitas anonim baru per instalasi): onboarding, klub,
   perjalanan, lokasi, chat, bahaya, hapus data. Isi checklist 8f; jangan
   menulis "Tested on physical device" tanpa artefak.

### 8.3 Distribusi

- APK beta dan produksi memakai paket sama, jadi tidak bisa berdampingan;
  memasang APK produksi menimpa beta (data aplikasi di perangkat dipertahankan,
  sesi lama akan ditolak karena project berbeda). Identitas anonim terikat pada
  project, jadi setiap peserta mendapat identitas baru dan harus diundang ulang
  ke klub; jelaskan ini sebelum cutover.
- Setelah produksi berjalan, jangan arahkan kembali variabel build ke beta
  tanpa build baru.

## 9. Urutan cutover

| Waktu | Langkah | Bukti yang disimpan |
| --- | --- | --- |
| T-7 | Tutup §0.1; putuskan §1; buat project staging; rehearsal §3 | fungsi key baru teruji; `db:test` staging 12/12 + konkurensi; E2E dev 27/17/24; preflight 7/8 atau 8/8 |
| T-3 | Buat project produksi; aktifkan Anonymous sign-ins, matikan Email; siapkan backup plan | tangkapan dashboard tanpa secret |
| T-1 | Dump baseline; uji restore ke scratch; siapkan Environment `production` | log drill, hash dump |
| T-0 | `db push` produksi → `db:types:check` → preflight → function + secret → Auth → web config → Pages | `migration list`, hasil preflight, `page_url` |
| T-0 | Rilis APK produksi → smoke emulator → uji 2 HP | SHA-256, cert, checklist 8f |
| T+1 | Pantau Auth/function/DB; verifikasi backup harian; umumkan ke tester | log tanpa PII, tanggal |

Jangan mengumumkan URL web atau membagikan APK sebelum langkah verifikasi di
baris yang sama selesai.

## 10. Verifikasi pasca-cutover

- [ ] `beta:preflight` dijalankan terhadap produksi; tujuh pemeriksaan wajib
      lulus dan hasil pemeriksaan `autoconfirm` dicatat apa adanya.
- [ ] Halaman web: privasi terbuka; CORS menolak origin asing. Alur hapus akun
      web tetap **Blocked** sampai alur email diganti (ADR-083).
- [ ] APK: identitas anonim baru, onboarding, klub, perjalanan, lokasi, chat,
      bahaya, hapus data — di dua perangkat.
- [ ] Pengguna `anon` (tanpa sesi) ditolak saat membaca tabel apa pun.
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
| `autoconfirm` aktif / provider Email menyala | Pemeriksaan preflight gagal dan permukaan auth yang tak terpakai terbuka | Catat sebagai temuan konfigurasi; matikan provider Email; preflight tidak diubah |
| Halaman web menunjuk dev | Pengguna menghapus akun di backend uji | Uji statis + review config sebelum Pages |
| Origin Pages berubah | Hapus akun dari web ditolak 403 | Perbarui `WEB_ALLOWED_ORIGINS`, uji CORS |
| Paket Android diganti setelah Play | Aplikasi baru, pengguna lama tertinggal | Putuskan sebelum unggah pertama |
| Repo publik | Kredensial bocor bila ceroboh | Tidak ada secret di repo; dump diabaikan; rotasi bila ragu |

## 12. Yang belum bisa dibuktikan tanpa pemilik

- Pembuatan project, aktivasi Pages, dan pengaturan Auth di dashboard.
- Restore backup nyata (butuh project scratch dan data produksi).
- Uji perangkat fisik, Play Console, dan verifikasi sertifikat APK.
- Keputusan retensi, paket final, dan biaya PITR.
- Halaman web hapus akun yang cocok dengan identitas anonim (masih alur email).

Sampai semua itu ada, status yang benar adalah **rencana**, bukan
"produksi siap".
