# Setup Guide — Mulai Mengembangkan Tanpa Android Studio

Panduan ini untuk Windows + VS Code + HP Android fisik. Periksa kembali versi dan requirement pada dokumentasi resmi sebelum instalasi karena SDK dapat berubah.

## 1. Prasyarat

- Node.js 22.13 atau lebih baru (`engines.node` di `package.json`; CI memakai 24.x).
- VS Code.
- Git.
- HP Android dengan internet.
- Akun Expo untuk cloud builds.
- Akun/project Supabase untuk backend.

Android Studio tidak dibutuhkan untuk membuat build melalui EAS cloud. Expo Go tetap berguna untuk UI/prototipe awal, tetapi background location dan native modules perlu development build.

## 2. Ambil repository dan pasang dependency

Repository ini **sudah** berisi aplikasi Expo-nya, jadi jangan membuat project baru dengan
`create-expo-app` dan jangan menyalin dokumen `docs/` kembali ke repo — semua dokumen, migration, dan
konfigurasi sudah ada di sini.

Di PowerShell:

```powershell
git clone https://github.com/29nls/rodakawan.git
cd rodakawan
npm ci
npx expo start
```

`npm ci` memasang dependency persis mengikuti `package-lock.json`. Setelah Metro berjalan, instal Expo
Go di ponsel lalu pindai QR code yang ditampilkan terminal; untuk fitur native gunakan development
build (bagian 5). Jika router/CLI pada versi terpasang menampilkan alur QR yang berbeda, ikuti
instruksi CLI tersebut.

## 3. Quality tools yang sudah tersedia

Tidak perlu memasang tool tambahan: ESLint (`eslint-config-expo` + `eslint-plugin-prettier`),
TypeScript strict, Jest (`jest-expo` + `@testing-library/react-native`), dan `expo-doctor` sudah
dikonfigurasi di repo ini.

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run deps:check       # TypeScript editor = CI + versi dependency terhadap Expo SDK
npm run check:editor-ts  # hanya pemeriksaan TypeScript editor (lokal, tanpa jaringan)
npm test                 # komponen & hooks aplikasi (Jest); menjalankan deps:check lebih dulu
npm run test:scripts     # script rilis: pengelompokan catatan rilis & rentang commit
npm run doctor
npm run export:android   # verifikasi bundel Android tanpa perangkat
```

Script rilis di `scripts/` diuji dengan runner bawaan Node (`node:test`, lewat
`npm run test:scripts`), bukan Jest: berkasnya `.mjs` dan test-nya sengaja menjalankan git sungguhan di
directori sementara untuk membuktikan parsing keluaran `git log` dan pemilihan tag masih benar. Jest
tetap dipakai untuk kode aplikasi di `src/`. Keduanya berjalan di CI.

Perintah itu dijalankan dengan konfigurasi yang dikunci: `--test-concurrency=1` (berkas uji satu per
satu, jadi hasilnya tidak bergantung jumlah CPU mesin) dan `--test-timeout=180000` (setiap test punya
batas waktu, jadi yang menggantung menggagalkan run, bukan menggantungkan pipeline). Kedua flag itu
berada di `package.json` dan **wajib ditulis sebelum glob berkas uji** — Node mengabaikan opsi yang
diletakkan setelah argumen berkas tanpa memberi pesan apa pun, sehingga menambahkan flag lewat
`npm run test:scripts -- --test-timeout=1` tidak mengubah apa pun. CI memakai perintah yang sama
persis, sehingga kegagalan di runner GitHub bisa direproduksi di laptop (ADR-072).

Tetap pakai satu package manager (npm) dan commit lockfile. Sebelum memasang dependency native baru,
baca dokumentasi kompatibilitasnya dengan Expo SDK aktif, lalu jalankan `npm run deps:check` lebih
dulu — ia menjalankan dua pemeriksaan: `check:editor-ts` (lokal, tanpa jaringan: `.vscode/settings.json`
harus menunjuk `node_modules/typescript/lib`, versinya memenuhi `devDependencies.typescript`, dan sama
dengan lockfile) lalu CLI Expo yang terpasang (`expo install --check`, ±3 detik termasuk startup npm)
yang gagal dengan daftar paket yang perlu disesuaikan; `npm run doctor` tetap dipakai sebagai pemeriksaan
menyeluruh sebelum rilis.

## 4. Hubungkan Supabase (langkah konkret Milestone 1)

Bagian ini adalah urutan yang sudah disesuaikan dengan kode di repo. Project development RodaKawan **sudah dibuat dan seluruh migration sudah diterapkan** (13 Oktober 2026, ADR-035), jadi langkah di bawah adalah panduan lengkap untuk project baru — staging, produksi, atau mesin developer lain.

### 4.1 Buat project development

1. Masuk ke https://supabase.com/dashboard lalu buat project baru khusus pengembangan (jangan pakai project produksi).
2. Simpan database password di password manager; password itu tidak dipakai aplikasi mobile.
3. Catat region project agar latensi dari Indonesia wajar (mis. Singapore).

### 4.2 Ambil URL dan publishable key

1. Buka **Project Settings → API**.
2. Salin **Project URL** dan **publishable key** (project baru) atau **anon public** key (project lama).
3. Jangan pernah menyalin **service_role** key ke aplikasi; key itu hanya untuk backend/Edge Functions.

### 4.3 Jalankan migration

Repository ini sekarang memuat **dua puluh** migration. Dua yang pertama adalah **sejarah penyiapan
awal** dan urutannya penting:

1. `supabase/migrations/20261013022938_initial_schema.sql` — skema fondasi (migration awal).
2. `supabase/migrations/20261013023038_auth_profile_bootstrap.sql` — bootstrap profil, constraint
   username, dan trigger `updated_at`. Migration ini idempotent (`create or replace`,
   `drop trigger if exists`) sehingga aman dijalankan ulang dan tidak menghapus data.

Delapan belas migration berikutnya bersifat aditif (privasi follow, detail privat kendaraan,
keanggotaan klub, kendaraan utama, akses perjalanan, tiga bucket Storage, pagar policy, alur
perjalanan M3 di `20261019120000_ride_workflow.sql`, lalu Milestone 4:
`20261020090000_hazard_reports_m4.sql`, `20261020100000_convoy_chat_m4.sql`,
`20261021120000_moderation_dashboard.sql`, dan
`20261021130000_blocked_chat_server_filter.sql`), serta tiga migration Milestone 5:
`20261022190000_account_deletion_m5.sql` (kolom `profiles.deleted_at`),
`20261022193000_account_deletion_storage_api.sql` (berhenti menghapus `storage.objects` dari SQL — ADR-076),
dan `20261023004946_account_deletion_identity.sql` (melepas FK `profiles.id → auth.users`, trigger
integritas profil, tombstone, `purge_account_data()`, `account_media_manifest()`, job retry, dan
penonaktifan RPC lama — ADR-077).

> **Status Milestone 4 (21 Oktober 2026): keempat migration terakhir SUDAH diterapkan ke project
> development** (terverifikasi `npx supabase migration list --linked`; saat itu 17 local = remote). Pada project
> baru atau project lain yang belum dimigrasikan, aplikasi sudah memanggil RPC-nya sehingga tab
> Peringatan, chat, dan dashboard moderasi menampilkan galat `PGRST202`/`42883` ("Backend belum
> memuat fungsi yang dibutuhkan"), bukan data kosong yang menyesatkan. Terapkan keempat berkas itu
> dengan urutan di bawah (bila belum), lalu jalankan uji M4:
>
> ```powershell
> npx supabase migration list          # pastikan 20261020090000, 20261020100000, 20261021120000, 20261021130000 masih kosong di remote
> npx supabase db push --dry-run
> npx supabase db push --yes
> npm run db:types                     # regenerasi tipe setelah RPC baru ada
> npm run db:test -- --file supabase/tests/rls_hazards_test.sql
> npm run db:test -- --file supabase/tests/rls_chat_test.sql
> npm run db:test -- --file supabase/tests/rls_moderation_m4_test.sql
> npm run db:test -- --file supabase/tests/rls_blocked_chat_test.sql
> ```
>
> Keempat berkas uji itu **sudah** ada di `DEFAULT_TEST_FILES` (`scripts/db-test.mjs`) dan notice
> penandanya diperiksa `.github/workflows/database-rls.yml`, jadi `npm run db:test` menjalankan
> kedelapan berkas sekaligus. Statusnya: **lulus terhadap backend development** lewat Database RLS
> run #19 (commit `1aa1480`, 22 Oktober 2026 — 7 berkas, 7 lulus). Perintah `--file` di atas tinggal
> cara menjalankan satu berkas saat sedang mengembangkan uji; tidak ada yang perlu dipindahkan lagi.
>
> **Status Milestone 5 (23 Oktober 2026): ketiga migration hapus akun SUDAH diterapkan ke project
> development** (20 local = remote; `npm run db:types:check` lulus). Pada project yang belum
> dimigrasikan, `/account-delete` menampilkan galat backend, bukan klaim sukses. Terapkan dan uji:
>
> ```powershell
> npx supabase db push --dry-run
> npx supabase db push --yes
> npm run db:types
> npm run db:test -- --file supabase/tests/rls_account_delete_test.sql
> npx supabase functions deploy delete-account --project-ref <project-ref-development>
> ```
>
> Berkas uji itu sudah ada di `DEFAULT_TEST_FILES` dan notice `UJI HAPUS AKUN LULUS` diperiksa
> workflow, jadi `npm run db:test` menjalankan **delapan** berkas sekaligus. RPC lama
> `delete_my_account()` kini **selalu gagal** dengan `account_deletion_requires_server`; build sebelum
> ADR-077 harus diperbarui, bukan dianggap masih bisa menghapus akun. Satu catatan yang mahal
> dipelajari: `delete from storage.objects` **ditolak** Supabase ("Direct deletion from storage tables
> is not allowed") — objek Storage hanya bisa dihapus lewat Storage API (Edge Function/service role).
>
> Setelah migration ini, `auth.users` **boleh** dihapus tanpa cascade ke profil (FK sudah dilepas),
> tetapi jangan menghapusnya manual untuk pengguna nyata: gunakan Edge Function agar Storage, data
> pribadi, dan retensi ditangani dalam urutan yang benar. Trigger `enforce_profile_identity` menolak
> pembuatan profil untuk auth user yang tidak ada dan untuk akun yang sudah dihapus.
>
> Jangan menyunting migration yang sudah diterapkan ke remote; tambahkan migration baru. Jumlah
> pastinya bisa diperiksa dengan `ls supabase/migrations` atau `npx supabase migration list` — jangan
> menganggap angka di dokumentasi lama masih berlaku.

**Penting:** migration awal memakai `create table if not exists`. Bila tabel `profiles` sudah ada di
database dengan bentuk yang berbeda, tabel itu **dilewati diam-diam** lalu migration gagal di policy
yang menyebut `is_private` — dan database berakhir setengah jadi. Pastikan database benar-benar bersih
(tidak ada `public.profiles`) sebelum menjalankan migration awal.

### 4.3a Deploy Edge Function hapus akun

`delete-account` adalah satu-satunya jalur hapus akun penuh; klien tidak memegang service role.
Supabase menyuntikkan `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` ke fungsi
secara otomatis, jadi tidak ada secret yang perlu ditulis ke repo atau `.env`.

```powershell
npx supabase functions deploy delete-account --project-ref <project-ref-development>
```

Verifikasi setelah deploy (jangan pakai akun nyata): buat dua akun uji, unggah avatar/foto/logo klub,
panggil fungsi dengan access token akun A, lalu periksa: `auth.users` A hilang, profil A hilang,
media pribadi hilang, logo klub masih ada di path baru, laporan bahaya tetap ada sebagai tombstone,
dan JWT lama tidak bisa membaca/menulis. Skrip E2E yang dipakai pada 23 Oktober 2026 bersifat
sementara (tidak di-commit) karena membuat/menghapus akun di project development; langkah manualnya
ada di `web/README.md` bagian verifikasi.

Halaman web publik ada di `web/` (statis, tanpa build). Ikuti `web/README.md` untuk mengisi URL +
publishable key, memilih hosting, dan mencatat URL di Play Console. **URL publik belum ada** sampai
halaman benar-benar diterbitkan; jangan menuliskan URL contoh sebagai bukti.

**Cara 1 — Supabase CLI (disarankan, otomatis dan dapat diulang).** Simpan connection string project
di berkas `.env.db` di root repo (berkas ini diabaikan Git dan **tidak** dibaca Expo, jadi password
tidak masuk ke bundel aplikasi):

```dotenv
# .env.db — hanya satu baris, jangan di-commit
# Salin dari Project Settings → Database → Connection string → **Session pooler**:
# host langsung db.<ref>.supabase.co hanya punya record AAAA (tanpa IPv4) sehingga sering gagal
# ENOTFOUND, jadi pakai host pooler dan tulis user sebagai postgres.<ref>.
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

`sslmode=require` adalah nilai standar yang juga dipahami `psql` dan `npx supabase`. Runner
`npm run db:test` menerapkannya dengan semantik libpq; alasannya dijelaskan di bagian 4.6.

Lalu hubungkan CLI ke project itu dan terapkan migration:

```powershell
npx supabase link --project-ref <ref>   # menanyakan password database sekali, bukan lewat argumen
npx supabase migration list            # bandingkan riwayat lokal vs remote
npx supabase db push --dry-run          # lihat apa yang akan dijalankan
npx supabase db push --yes              # terapkan seluruh migration yang belum ada di remote
```

**Jangan** menuliskan connection string sebagai argumen perintah (mis. `--db-url "$env:DATABASE_URL"`,
termasuk pada `npm run <script> -- ...`): npm/npx mencetak ulang argumen lengkap lewat baris
`npm notice run ...`, sehingga password database muncul di layar dan di log CI. Jika password pernah
tercetak, segera reset di Dashboard → **Project Settings → Database → Reset database password**, lalu
perbarui `.env.db`. Bila Anda memang harus memakai `--db-url` (tanpa `link`), redam dulu outputnya,
mis. `... 2>&1 | sed -E 's#://[^@/]*@#://***@#g'`.

Catatan: `npx supabase link` menulis project ref ke `supabase/.temp/` (diabaikan Git) dan CLI langsung
membaca `supabase/migrations`. `npx supabase` mengunduh CLI ke cache npm; CLI **tidak** ditambahkan ke
`package.json`. Setelah pindah project, **link wajib diperbarui**: tanpa itu, `npx supabase db push`
tanpa argumen masih menargetkan project lama. Kalau memilih jalur `--db-url` daripada `link`, muat nilai
`.env.db` lebih dulu (di PowerShell):
`$env:DATABASE_URL=(Get-Content .env.db | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=',''`.

**Cara 2 — SQL Editor (tanpa CLI).** Tempel isi kedua berkas di atas secara berurutan dan periksa
pesan error tiap langkah. Cara ini tidak mencatat riwayat migration di database, sehingga nanti tidak
bisa dipakai `db push` untuk perubahan berikutnya tanpa `supabase migration repair`.

Verifikasi setelah selesai: **Table Editor → profiles** harus ada, kolom `is_private` harus terlihat,
dan **Database → Triggers** pada skema `auth` menampilkan `on_auth_user_created`.

### 4.4 Atur URL konfirmasi email

Tanpa langkah ini, email konfirmasi/reset akan membuka halaman web dan aplikasi tidak pernah menerima kodenya.

1. **Authentication → URL Configuration**.
2. **Redirect URLs** — tambahkan:
   - `rodakawan://auth/callback` (development build & APK; `scheme` di `app.json`).
   - `exp://**` atau URL `exp://<host>:<port>/--/auth/callback` yang ditampilkan Metro bila menguji lewat Expo Go.
3. **Site URL** boleh tetap nilai default; aplikasi native tidak memakainya.
4. **Authentication → Providers → Email**: putuskan apakah **Confirm email** menyala.
   - Menyala: setelah daftar, aplikasi menampilkan instruksi "cek email" dan pengguna harus mengklik tautan.
   - Mati: sesi langsung tersedia dan aplikasi membawa pengguna masuk tanpa menunggu konfirmasi.
   Kedua pengaturan didukung kode; yang penting konfigurasinya diketahui saat pengujian manual.

### 4.5 Isi environment lokal

1. Salin `.env.example` menjadi `.env.local` di root repo (`.env` juga dibaca Expo dan diabaikan Git;
pilih salah satu, jangan keduanya dengan nilai berbeda).
2. Isi nilainya:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_CLIENT_KEY
EXPO_PUBLIC_MAP_STYLE_URL=https://YOUR_TILE_PROVIDER/STYLE.json
```

3. `.env.local` sudah masuk `.gitignore`. Setiap variabel berprefix `EXPO_PUBLIC_` ikut masuk ke bundle aplikasi, jadi isinya tidak boleh berupa secret.
4. Restart Metro setelah mengubah `.env.local` (nilai di-inline saat build).

### 4.6 Jalankan uji RLS profil

Uji ini membuktikan user A tidak dapat membaca atau mengubah profil privat user B, bahwa `anon` tidak
melihat apa pun, bahwa `DELETE` profil sendiri ditolak, dan bahwa bootstrap trigger serta constraint
username bekerja. Sejak Milestone 1.6 berkas yang sama juga membuktikan bahwa permintaan follow tidak
memberi akses ke profil privat (permintaan berstatus `pending` sampai pemilik menyetujui lewat
`accept_follow_request`) dan bahwa detail privat kendaraan hanya dapat dibuat/diubah untuk kendaraan
milik sendiri. Semua asersi berjalan dalam satu transaksi yang berakhir `ROLLBACK`, sehingga tidak ada
pengguna/profil uji yang tertinggal.

Berkas uji dimulai dengan pemeriksaan **paritas skema**: bila migration Milestone 1.6 belum diterapkan
pada database yang diuji, uji gagal dengan pesan yang menyebut objek yang hilang (kolom
`follows.status`, fungsi `accept_follow_request`, trigger `follows_set_status`, foreign key komposit)
alih-alih error `column does not exist` di tengah berkas.

**Cara 1 — runner `npm run db:test` (disarankan).** Ambil connection string dari **Project Settings →
Database → Connection string → Session pooler** (host `aws-0-<region>.pooler.supabase.com`, user
`postgres.<ref>`) dan tambahkan `?sslmode=require`. Jangan memakai host langsung: `db.<ref>.supabase.co`
hanya punya record AAAA (tanpa IPv4), sehingga koneksi gagal `ENOTFOUND` pada jaringan biasa.

```powershell
$env:DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
npm run db:test
Remove-Item Env:\DATABASE_URL   # jangan biarkan nilai ini tertinggal di sesi shell
```

`sslmode=require` diperlakukan mengikuti semantik libpq: koneksi terenkripsi, tetapi rantai
sertifikat tidak diverifikasi. Itu diperlukan karena pooler Supabase memakai CA internal, sedangkan
`node-postgres` (sejak `pg-connection-string` 2.14) memetakan `require` ke `verify-full` sehingga
koneksi gagal `SELF_SIGNED_CERT_IN_CHAIN`. Runner memakai semantik libpq untuk `require` dan mencetak
catatannya satu baris di output. Bila ingin verifikasi penuh, pakai `sslmode=verify-full` bersama
`sslrootcert` berisi CA project Supabase.

Di Bash/Git Bash:

```bash
DATABASE_URL="postgresql://..." npm run db:test
```

Runner menjalankan seluruh berkas uji di `DEFAULT_TEST_FILES` secara berurutan, dan hanya melaporkan
lulus bila notice penanda dari **masing-masing** benar-benar diterima dari server. Contoh dua berkas
pertama:

| Berkas | Isi | Notice |
| --- | --- | --- |
| `supabase/tests/rls_profiles_test.sql` | Izin/penolakan per tabel, RPC, dan Storage | `UJI RLS PROFIL LULUS` |
| `supabase/tests/rls_policy_guard_test.sql` | Pagar katalog: policy wadah yang memberi akses lewat kolom kepemilikan tanpa penjaga keanggotaan (ADR-060) | `UJI POLICY OWNER-GUARD LULUS` |

**Satu putaran uji menunjukkan semua masalah (ADR-070).** Kegagalan satu berkas uji **tidak**
menghentikan berkas lain: seluruh berkas tetap dijalankan, lalu ringkasan berisi jumlah berkas
lulus/gagal/tidak dijalankan beserta daftar setiap kegagalannya dicetak sekaligus sebelum runner keluar
dengan kode non-nol. Jadi tidak perlu satu putaran per berkas untuk melihat semua yang rusak.

| Keluaran | Arti |
| --- | --- |
| `Ringkasan: 7 berkas uji — 5 lulus, 1 gagal, 1 tidak dijalankan` | Angka seluruh berkas uji pada putaran itu |
| `Berkas uji yang gagal (1):` + daftar per berkas | Berkas yang **memang** gagal; perbaikannya ada di isi berkas itu |
| `Berkas uji yang tidak dijalankan (1):` + daftar per berkas | Berkas yang **tidak pernah** diuji karena koneksi database terputus di tengah jalan — bukan berarti berkasnya rusak; jalankan ulang setelah koneksi pulih |

Koneksi yang terputus membuat sambungan tidak berguna lagi, jadi sisa berkas ditandai "tidak
dijalankan", bukan "gagal" — dibedakan karena yang pertama berarti ada masalah pada isi berkasnya.
Pemeriksaan statis (berkas hilang, literal UUID, berkas tanpa direktif notice) juga melapor **seluruh**
masalah sekaligus, bukan berhenti di masalah pertama, dan tidak membuka satu pun koneksi.

Password tidak pernah dicetak; hanya `user@host:port/database` yang ditampilkan. Untuk menjalankan
satu berkas saja saat mengembangkan (mis. yang sedang Anda ubah):

```powershell
npm run db:test -- --file supabase/tests/rls_policy_guard_test.sql
```

Opsi `--file` boleh diulang untuk menjalankan beberapa berkas sekaligus (berguna saat ingin melihat
kegagalan beberapa berkas dalam satu putaran):

```powershell
npm run db:test -- --file supabase/tests/rls_profiles_test.sql --file supabase/tests/rls_chat_test.sql
```

**Menambah berkas uji baru:** letakkan di `supabase/tests/`, tulis asersinya dalam satu transaksi dan
akhiri dengan `ROLLBACK`, lalu cantumkan direktif notice di baris awal:

```sql
-- db:test notice: UJI NAMA PEMERIKSAAN LULUS
```

Tambahkan berkas itu ke `DEFAULT_TEST_FILES` di [`scripts/db-test.mjs`](../scripts/db-test.mjs);
berkas tanpa direktif notice ditolak runner sebelum satu perintah pun dijalankan ke database, dan
workflow `database-rls.yml` memeriksa kedua notice yang ada saat ini.

`npm run db:test -- --help` menampilkan daftar berkas dan opsinya.

**Literal UUID harus benar-benar UUID.** Parameter bertipe `uuid` hanya menerima nilai UUID; string
teks seperti `'a-client-001'` ditolak PostgreSQL dengan SQLSTATE 22P02 (`invalid input syntax for
type uuid`) tepat saat pemanggilan, jadi satu literal salah menghentikan seluruh berkas uji.
Pemeriksaan statis `npm run db:test:lint` (**tanpa** database) membaca tanda tangan fungsi dari
`supabase/migrations/*.sql` dan menandai literal yang diberikan ke parameter `uuid`; perintah yang
sama berjalan sebagai pra-syarat `npm run db:test` sebelum satu koneksi pun dibuka, dan sebagai
langkah CI di job `quality` yang tidak memakai secret sama sekali (ADR-069). Jadi kelas galat ini
tertangkap di pull request, bukan setelah runner masuk ke database development. Gunakan literal UUID
kanonis (8-4-4-4-12 heksadesimal); untuk uji idempotensi pakai UUID **tetap** yang sama di semua
pemanggilan, bukan UUID acak.

**Uji jalur HTTP Storage — `npm run storage:test`.** Runner ini melengkapi `db:test` dengan alur yang
benar-benar dipakai aplikasi, dan memakai `DATABASE_URL` yang sama plus URL/publishable key publik
dari `.env.local`:

```powershell
npm run storage:test   # memuat .env.local dan .env.db otomatis
```

Tanpa `service_role`: dua akun uji sementara dibuat lewat SQL (kata sandi acak per run), sign-in lewat
GoTrue password grant, lalu runner membuktikan unggah foto kendaraan, signed URL yang isinya identik
(SHA-256), penolakan lintas pengguna/`anon`, dan hapus oleh pemilik. Data uji selalu dibersihkan
(objek lewat Storage API, akun beserta baris turunannya) dan runner hanya mencetak
`UJI INTEGRASI STORAGE LULUS` bila tidak ada sisa; sisa run yang terputus disapu otomatis di run
berikutnya. `npm run storage:test -- --help` menampilkan ringkasannya.

**Cara 2 — SQL Editor.** Tempel seluruh isi berkas uji yang ingin diperiksa (mis.
[`supabase/tests/rls_profiles_test.sql`](../supabase/tests/rls_profiles_test.sql) atau
[`supabase/tests/rls_policy_guard_test.sql`](../supabase/tests/rls_policy_guard_test.sql)) ke SQL
Editor → **Run**. Hasil lulus ditandai notice pada direktif berkas itu (`UJI RLS PROFIL LULUS` /
`UJI POLICY OWNER-GUARD LULUS`); bila ada masalah, pesan menyebutkan asersi mana yang gagal — untuk
pagar policy, pesannya mendaftar `tabel.policy` beserta ekspresi yang melanggar.

Catatan penting:

- Jalankan hanya pada project **development**. Jangan memakai kredensial produksi.
- Perintah `set local role ...` hanya berlaku di dalam transaksi; pastikan seluruh berkas dijalankan
  sebagai satu blok, bukan baris per baris.
- **Jangan** menyimpan `DATABASE_URL` di `.env.local`: berkas itu berisi variabel `EXPO_PUBLIC_*` yang
  ikut masuk ke bundle aplikasi. Untuk CI, simpan sebagai secret repository (`DB_TEST_DATABASE_URL`).
- Status saat ini: **LULUS** pada project development khusus RodaKawan (ADR-035): notice
  `UJI RLS PROFIL LULUS` diterima dan **171 perintah** selesai tanpa error (13 Oktober 2026 dengan
  88 perintah; diperluas oleh garasi/klub Milestone 2, audit policy, Storage foto/logo, dan foto
  profil; dijalankan ulang 19 Oktober 2026 dengan **tiga belas** migration diterapkan dan tiga berkas
  uji: 171 + 17 + 67 = **255 perintah**, seluruh notice penanda diterima). Sebelumnya uji ini **belum pernah
  lulus**: pada project lama yang dipakai bersama aplikasi lain, `bootstrap_profile()` gagal
  `42703 column "display_name" of relation "profiles" does not exist` karena `public.profiles` di sana
  bukan tabel buatan migration (ADR-033). Pesan itu berguna sebagai gejala khas schema drift: lihat
  juga langkah verifikasi di bagian 4.3 dan `docs/QA_TEST_PLAN.md` bagian 9.

### 4.7 Generate tipe database

`src/lib/supabase/database.generated.ts` adalah hasil `supabase gen types` dan satu-satunya sumber
bentuk tabel, kolom, dan signature RPC. Jangan mengubah berkas itu dengan tangan;
`src/lib/supabase/database.types.ts` hanya menambahkan union nilai yang dijaga `CHECK` constraint dan
bentuk balik RPC yang dikurasi.

Union yang dikurasi itu **tidak** bisa-cek basi oleh `npm run db:types:check`: perintah itu hanya
membandingkan berkas *generated* dengan skema, bukan union yang ditulis tangan. Jadi setiap
migration yang mengubah `CHECK` constraint pada kolom bersistem — misalnya `hazard_reports.category`,
`hazard_reports.severity`, `hazard_reports.status`, `chat_messages.message_type`,
`content_reports.target_type`/`reason`/`status`, atau `moderation_actions.target_type`/`action`/`reason`
— wajib menyunting union di `database.types.ts` **dalam perubahan yang sama**, lalu jalankan
`npm run typecheck` (ADR-073).

Setelah migration diterapkan ke project development (4.3), jalankan:

```bash
npm run db:types          # tulis ulang database.generated.ts dari skema
npm run typecheck         # pastikan layar dan service API masih cocok
npm run db:types:check    # sama dengan langkah CI; gagal bila tipe tertinggal
```

Perintah ini memakai `DATABASE_URL` dari `.env.db` yang sama dengan `npm run db:test` (4.6), jadi
connection string tidak perlu diketik. Target dioper ke CLI lewat `--db-url` (ADR-061), sehingga
perintah ini **tidak** membutuhkan `supabase login`, link project, maupun `SUPABASE_ACCESS_TOKEN` —
di CI cukup secret `DB_TEST_DATABASE_URL` yang sama dengan uji RLS. (Sebelumnya CLI jatuh ke jalur
`--linked` yang memakai access token tersimpan di mesin pengembang: lancar di komputer lokal,
gagal di CI dengan `Must specify one of --local, --linked, --project-id, or --db-url`.) CLI Supabase
adalah versi yang dipin dan hanya membaca katalog skema — tidak ada data yang diubah. Bila
`db:types:check` gagal, jalankan `npm run db:types`, tinjau diff-nya, lalu commit hasilnya; berkas
generated tidak boleh disunting manual.

### 4.8 Uji manual alur autentikasi

1. `npx expo start` lalu buka aplikasi di perangkat.
2. Daftar akun baru → ikuti alur konfirmasi sesuai pengaturan 4.4 → masuk.
3. Tab **Profil** → ubah nama tampilan/username/kota/bio → simpan → muat ulang aplikasi untuk memastikan perubahan tersimpan.
4. Daftarkan username yang sudah dipakai; aplikasi harus menampilkan pesan yang jelas, bukan crash.
5. Logout → pastikan layar privat tidak bisa dibuka kembali.
6. **Lupa password** → selesaikan tautan reset dari email.

### 4.9 Uji Milestone 3 (perjalanan dan lokasi)

Migration `20261019120000_ride_workflow.sql` sudah diterapkan ke project development. Setelah menarik
perubahan ini pada mesin lain:

```bash
npm ci
npm_config_loglevel=error npx supabase db push --yes   # atau db push --db-url "$DATABASE_URL"
npm run db:types                                       # tipe RPC perjalanan ikut diperbarui
npm run db:test   # 7 berkas: profil, policy guard, perjalanan, bahaya M4, chat M4, moderasi M4, filter blokir
```

`npm run db:test` harus mencetak tujuh notice penanda: `UJI RLS PROFIL LULUS`,
`UJI POLICY OWNER-GUARD LULUS`, `UJI RLS PERJALANAN M3 LULUS`, `UJI RLS LAKUAN M4 LULUS`,
`UJI RLS CHAT M4 LULUS`, `UJI MODERASI M4 LULUS`, dan `UJI FILTER BLOKIR CHAT LULUS`. Berkas perjalanan berjalan dalam
satu transaksi dan berakhir `ROLLBACK`, jadi tidak meninggalkan pengguna/klub/ride uji.

**Dependency native.** `expo-location` dan `expo-task-manager` sudah ada di `package.json`
(versi SDK 57). Keduanya modul native: Expo Go tidak cukup untuk menguji background location, dan
APK/dev client harus dibangun ulang. `app.json` memuat plugin `expo-location` dengan
`isAndroidBackgroundLocationEnabled` dan `isAndroidForegroundServiceEnabled`, serta izin
`POST_NOTIFICATIONS` untuk notifikasi foreground service. Jangan menghapus plugin itu; tanpa plugin,
manifest Android tidak memuat izin background/foreground service yang dibutuhkan.

**Realtime.** Posisi memakai Postgres Changes pada `public.ride_locations`, bukan Broadcast. Tidak ada
konfigurasi kanal privat yang perlu dinyalakan; RLS tabel adalah gerbangnya. Fitur Realtime harus
aktif di project (default Supabase) dan publikasi tabel `ride_locations` sudah tersedia lewat
Realtime publication default. Bila project memakai publication kustom, pastikan tabel itu ikut
dipublikasikan; tanpa itu perubahan baris tidak terkirim, tetapi layar tetap dapat dimuat ulang manual.

**Peta.** Jangan mengisi `EXPO_PUBLIC_MAP_STYLE_URL` dengan URL contoh dan jangan memasang renderer
peta sebelum ADR-064 disetujui. Riset 20 Oktober 2026 mengusulkan MapLibre + MapTiler Flex dan
mencatatnya sebagai **Proposed** di [`MAP_PROVIDER_DECISION.md`](MAP_PROVIDER_DECISION.md) bagian 5;
persetujuan pemilik produk belum ada. Build saat ini menampilkan daftar posisi + umur pembaruan,
dengan keadaan “peta belum tersedia” yang disengaja.

**Uji perangkat yang belum dijalankan.** Dua akun di dua HP: buat ride, undang, terima, mulai, nyalakan
berbagi, matikan, keluar, selesaikan. Ulangi dengan izin background ditolak, GPS mati, mode pesawat,
aplikasi di background, force-stop, dan reboot. Catat konsumsi baterai/data 30 menit apa adanya — lihat
RIDE-01…LOC-10 di [`QA_TEST_PLAN.md`](QA_TEST_PLAN.md).

### 4.10 Hal yang belum ada di Milestone 1

- **Foto kendaraan, logo klub, dan foto profil sudah ada** lewat bucket privat `vehicle-photos`,
  `club-logos`, dan `avatars` (migration `20261017120000_private_photo_storage.sql`, perbaikan
  `20261017121000_club_logo_policy_qualified_name.sql`, lalu
  `20261018120000_profile_avatar_storage.sql`). Foto profil diatur dari tab **Profil** (unggah, ganti,
  hapus) dan hanya bisa dibaca akun pemiliknya.
- Fitur foto memakai modul native (`expo-image-picker`, `expo-file-system`, dan `expo-image-manipulator`
  untuk memperkecil foto); setelah menarik perubahan ini, bangun ulang development client/APK.
  Expo Go memuat ketiga modul, tetapi build mandiri yang lama tidak.
- Foto diperkecil otomatis sebelum diunggah (sisi terpanjang 1600 px untuk kendaraan, 512 px untuk
  logo klub; JPEG/WEBP dikompres ulang 0.7) supaya kuota Storage dan waktu unggah hemat. Foto yang
  sudah kecil dan tidak perlu diperkecil diunggah apa adanya, dan bila langkah kompresi gagal,
  berkas asli tetap diunggah — pesan batas ukuran baru muncul bila berkas itu tetap melebihi batas
  bucket (5 MB kendaraan, 2 MB logo).
- **Objek foto yatim dibersihkan oleh aplikasi, jadi tidak perlu aksi manual.** Setiap kali layar
  Garasi memuat daftar kendaraan, aplikasi menyapu folder `vehicle-photos/<user_id>/` dengan sesi
  pemilik: objek yang tidak lagi dirujuk `photo_path` **dan** berumur lebih dari 1 jam dihapus dalam
  satu panggilan. Hal yang sama terjadi setelah sebuah kendaraan dihapus. Karena itu daftar kendaraan
  yang dipakai sapuan harus lengkap — jangan memanggil `sweepOrphanVehiclePhotos` dari layar detail
  kendaraan dengan satu path saja, karena foto kendaraan lain akan dianggap yatim. Untuk melihat
  hasilnya: buka Garasi, lalu periksa **Storage → vehicle-photos** di dashboard; folder kendaraan yang
  sudah dihapus hilang sendiri, bukan lewat SQL manual (Supabase menolak `delete from storage.objects`
  langsung, dan `service_role` tidak boleh disimpan di repo ini).
- Verifikasi cepat di dashboard: **Storage → Buckets** harus menampilkan tiga bucket dengan status
  *Private*; **Storage → Policies** harus berisi policy `vehicle_photos_*`, `club_logos_*`, dan
  `avatars_*`. Jangan mengubahnya menjadi publik — foto kendaraan dan foto profil hanya untuk
  pemilik, dan logo klub memakai signed URL.
- Edge Function, private Realtime channel, push notification, dan peta.
- Riwayat migration di project: CLI sudah dipakai untuk menerapkan seluruh migration (bagian 4.3).
  CI database otomatis belum ada — job `database-rls` di CI hanya menjalankan uji RLS, bukan migration.
- Uji RLS **sudah** punya runner (`npm run db:test`, lihat 4.6) yang membaca `.env.db` otomatis.

## 5. Tanda tangan rilis dan konfigurasi publik (sekali saja)

Bagian ini adalah konfigurasi **sekali** milik pemilik repository. Setelah selesai, rilis APK berjalan
otomatis (bagian 6) tanpa perlu mengubah apa pun lagi.

Sejak ADR-051, APK dibangun di runner GitHub Actions sendiri (`npx expo prebuild` + Gradle), bukan di
EAS Cloud. Konsekuensinya: **kunci penandatangan rilis dan konfigurasi publik aplikasi sekarang milik
repository ini**, dan keduanya disimpan sebagai secret/variable GitHub — bukan lagi di akun Expo.

### 5.1 Keystore rilis

Keystore adalah identitas aplikasi. Semua APK dengan id paket `com.rodakawan.app` harus ditandatangani
kunci yang **sama**, kalau tidak Android menolak memasangnya sebagai pembaruan; kehilangan kuncinya
berarti tidak ada lagi cara memperbarui instalasi yang sudah ada.

Bila project ini pernah membangun APK lewat EAS, keystore itu bisa diunduh dan dipakai ulang — itu cara
terbaik, karena instalasi yang sudah beredar tetap bisa diperbarui dan build EAS untuk development
masih bisa dipasang berdampingan:

```powershell
npx eas-cli@latest credentials -p android        # pilih profil, lalu "Download credentials"
# berkasnya muncul sebagai credentials.json + keystore .jks di direktori kerja
```

Bila belum ada keystore sama sekali, buat satu baru — sekali, lalu simpan di tempat yang aman (bukan
di repo):

```powershell
keytool -genkeypair -v -keystore rilis.jks -storetype PKCS12 `
  -keyalg RSA -keysize 2048 -validity 10000 -alias rilis `
  -dname "CN=RodaKawan, O=RodaKawan, C=ID"
```

Lalu simpan keempat nilainya sebagai **secret** repository (Settings → Secrets and variables → Actions
→ Secrets). `ANDROID_KEYSTORE_BASE64` adalah isi berkasnya dalam base64, bukan jalur berkasnya:

| Secret | Isinya |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 rilis.jks` (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("rilis.jks"))`) |
| `ANDROID_KEYSTORE_PASSWORD` | sandi keystore (`storePassword` di `credentials.json` bila hasil unduhan EAS) |
| `ANDROID_KEY_ALIAS` | alias kuncinya (`keyAlias`) |
| `ANDROID_KEY_PASSWORD` | sandi kunci (`keyPassword`) |

- Jangan menaruh `*.jks`, `*.keystore`, `*.p12`, atau `credentials.json` di repo (sudah diabaikan
  `.gitignore`), dan jangan menempelkan isinya di issue, log, atau chat.
- Keempat secret itu **repo-level**, bukan per-environment: APK preview dan APK produksi memakai id
  paket yang sama, jadi keduanya wajib memakai kunci yang sama.
- Workflow menulis keystore ke `RUNNER_TEMP` (di luar workspace) hanya tepat sebelum dipakai, dan
  menghapusnya lagi di akhir job. Langkah `npm ci` dan `expo prebuild` berjalan **sebelum** itu,
  sehingga kode pihak ketiga tidak pernah berada di runner yang sudah memegang kunci rilis.
- Bila `ANDROID_KEYSTORE_BASE64` belum diatur, workflow berhenti dengan pesan yang menyebutnya; begitu
  pula alias atau sandi yang salah — ditangkap `keytool` dalam hitungan detik, sebelum build native
  dimulai.
- Unggah ke Google Play **tidak** ada di pipeline ini (butuh service account Play Store — pekerjaan
  terpisah).

### 5.2 Konfigurasi publik aplikasi (`EXPO_PUBLIC_*`)

Dulu ketiga nilai ini diambil dari environment milik EAS yang dipilih profil di `eas.json`. Build lokal
memakai *variables* repository, dengan nama yang sama persis seperti di [`.env.example`](../.env.example)
(Settings → Secrets and variables → Actions → **Variables**):

| Variable | Contoh isi |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable/anon key project Supabase |
| `EXPO_PUBLIC_MAP_STYLE_URL` | `https://<tile provider>/style.json` |

- Ketiganya sengaja **bukan** secret: nilainya ikut masuk ke bundel aplikasi dan terpasang di
  perangkat siapa pun yang memegang APK-nya. Menyimpannya sebagai variable membuatnya bisa diperiksa
  tanpa membuka nilai rahasia — dan `scripts/write-app-env.mjs` tetap tidak pernah mencetaknya ke log.
- Hanya ketiga nama itu yang ditulis; rahasia CI lain (mis. `DB_TEST_DATABASE_URL`) tidak ikut masuk ke
  `.env.local`.
- Bila ada yang belum diisi, workflow rilis **berhenti lebih dulu** dengan pesan yang menyebut nama
  variabelnya. Tanpa pemeriksaan itu, APK-nya tetap terbangun dan bahkan tetap lolos uji nyala, tetapi
  tampil dengan banner “konfigurasi belum tersedia” dan tidak menyentuh backend (AUTH-13) — APK tanpa
  backend yang baru ketahuan setelah dipasang orang.
- Bila nanti preview dan produksi perlu menunjuk backend berbeda, pindahkan ketiganya ke
  **environment** GitHub (`preview`/`production`) dan tambahkan `environment:` pada job `build-apk` —
  sekarang keduanya memakai satu set nilai karena masih satu project Supabase (bagian 4).

### 5.3 Saat memakai native dependency baru

Untuk native location/background service, MapLibre, atau LiveKit, tambahkan dependency yang sesuai lalu
buat development build (`--profile development`, butuh `npx expo install expo-dev-client`):

```powershell
npx expo start --dev-client   # jalankan JS bundler untuk development build
```

Build native perlu diulang setelah native dependency atau konfigurasi native berubah; perubahan
TypeScript/JS biasa biasanya cukup dengan restart bundler/refresh.

## 6. APK: build manual, rilis otomatis, dan versi

Profil build EAS masih ada di [`eas.json`](../eas.json) untuk build **manual** (mis. development
client), tetapi pipeline rilis tidak memakainya lagi: kedua workflow membangun APK dengan Gradle di
runner sendiri (ADR-051). `cli.appVersionSource` di sana bernilai `local`, yaitu versi dibaca dari
`app.json` — sama dengan satu-satunya sumber versi yang dipakai CI.

### 6.1 Build APK manual

Build lokal memakai rantai yang sama dengan CI, sehingga hasilnya bisa diperiksa dengan cara yang sama:

```powershell
npm ci
npx expo prebuild --platform android --no-install
# tanda tangan + nomor versi (butuh keystore dan keempat nilainya di lingkungan)
$env:ANDROID_KEYSTORE_PATH="$PWD\rilis.jks"
$env:ANDROID_KEYSTORE_PASSWORD="<sandi keystore>"
$env:ANDROID_KEY_ALIAS="rilis"
$env:ANDROID_KEY_PASSWORD="<sandi kunci>"
node scripts/configure-android-release.mjs --project android --version-code auto
cd android; ./gradlew :app:assembleRelease
# APK: android\app\build\outputs\apk\release\app-release.apk
```

Syaratnya sama seperti di runner: JDK 17, Android SDK (platform 36, build-tools 36.0.0), dan NDK yang
dipin React Native (27.1.12297006) — Gradle mengunduh NDK-nya sendiri bila lisensi SDK sudah diterima.
Perintah `node scripts/verify-apk.mjs <berkas.apk>` memeriksa tanda tangan berkas hasil build itu,
sama seperti yang dilakukan workflow.

Development client tetap nyaman dibangun lewat EAS bila tidak ingin memasang toolchain Android di
laptop:

```powershell
npx eas-cli@latest build --platform android --profile development    # development build (expo-dev-client)
```

Perlu diketahui: build EAS itu ditandatangani kunci yang disimpan EAS. Bila kunci rilis di bagian 5.1
diekspor dari EAS (cara yang dianjurkan), keduanya sama sehingga APK dev dan APK rilis bisa dipasang
berdampingan; bila keystore rilis dibuat baru, memasang APK EAS di perangkat yang sudah memakai APK
rilis akan ditolak Android kecuali yang lama di-uninstall lebih dulu.

### 6.2 Kenapa tidak ada lagi `EXPO_TOKEN`

Workflow rilis tidak lagi memanggil EAS, jadi tidak ada token Expo yang disimpan di repository. Yang
menggantikannya adalah keempat secret keystore di bagian 5.1 — dan bila salah satunya belum diatur,
workflow gagal pada langkah yang menyebut namanya secara eksplisit, bukan dengan kegagalan samar dari
layanan pihak ketiga. Konsekuensi yang perlu diketahui: tidak ada lagi kuota build EAS yang bisa habis
(Free plan membatasi jumlah build per bulan), tetapi build kini memakai menit runner GitHub — gratis
untuk repository publik, dan untuk repository privat memakai kuota Actions akun (ADR-051).

### 6.3 Rilis produksi (tag dibuat setelah build sukses)

Satu rilis = satu jalannya workflow, dan tag versi **baru dibuat bila build berhasil**. Tag tidak
pernah didorong lebih dulu, jadi build yang gagal tidak meninggalkan tag tanpa release (ADR-042).

```powershell
# 1. Naikkan "expo.version" di app.json (mis. 0.1.0 → 0.2.0), lalu commit dan push.
# 2. Jalankan workflow rilis dari commit itu, dengan versi yang sama.
gh workflow run android-release.yml --ref main -f version=0.2.0
#    Atau lewat UI: Actions → Android APK Release → Run workflow → isi input "version".
```

[`.github/workflows/android-release.yml`](../.github/workflows/android-release.yml)
menjalankan lima job:

1. **`verify`** — memvalidasi input `version` (harus sama dengan `expo.version` di `app.json`, dan tag
   `v<versi>` belum ada di remote), **menyusun catatan rilis** dengan format yang sama seperti rilis
   preview (bagian "Perubahan yang Merusak" paling atas, batas bawahnya rilis produksi terakhir),
   lalu seluruh pemeriksaan kualitas (`typecheck`, `lint`, `format:check`, `test`, `doctor`,
   `export:android`) sebelum belasan menit build native dipakai.
2. **`build-apk`** — membangun APK di runner: `npx expo prebuild --platform android`, lalu
   `scripts/configure-android-release.mjs` menyiapkan tanda tangan rilis dan nomor versi, lalu
   `./gradlew :app:assembleRelease`. Berkasnya diverifikasi `scripts/verify-apk.mjs` sebelum diunggah
   sebagai Actions artifact bernama `RodaKawan-v0.2.0.apk` (SHA-256, sidik jari sertifikat
   penandatangan, dan nomor versi build dicatat di ringkasan run).
3. **`smoke-test`** — memasang APK itu di emulator Android, meluncurkan aktivitas utamanya, dan
   menunggu sampai prosesnya hidup serta layarnya di depan (`scripts/smoke-test-apk.mjs`, bagian 6.9).
   Job ini berjalan **sebelum** `release`: tanda tangan yang sah membuktikan berkasnya utuh, bukan
   bahwa aplikasinya bisa dibuka.
4. **`release`** — mengunduh artifact (APK dan berkas catatan rilis), memverifikasi SHA-256 APK sama
   dengan hasil build (berkas yang identik berarti tanda tangan yang sudah diverifikasi tetap
   berlaku), menambahkan bagian **🔒 Verifikasi berkas** ke catatan rilisnya (bagian 6.10), lalu
   **membuat** tag `v0.2.0` beserta GitHub Release berisi `RodaKawan-v0.2.0.apk` dalam satu perintah
   (`gh release create --target --notes-file`) — isi rilisnya karena itu memakai catatan yang sama
   dengan rilis preview, bukan `--generate-notes` milik GitHub.
5. **`changelog`** — mencatat rilis itu di [`CHANGELOG.md`](../CHANGELOG.md) dan mendorongnya ke
   `main` (bagian 6.8). Job ini berjalan setelah `release`, hanya menyentuh berkas changelog, dan tidak
   memegang kunci penandatangan apa pun.

APK diunduh dari halaman **Releases** repository, atau dari Artifacts run tersebut.

Verifikasi APK (ADR-043) memeriksa tiga hal: struktur ZIP (EOCD berakhir tepat di akhir berkas dan
CRC-32 tiap entri cocok), tanda tangan APK **v2/v3** pada APK Signing Block (digest konten
1 MiB-chunk dibandingkan dengan yang ditandatangani, lalu tanda tangan atas `signedData` diverifikasi
memakai sertifikat yang tertanam), dan rantai tanda tangan **v1** (`MANIFEST.MF` → `.SF` → PKCS#7).
Dengan itu berkas yang terpotong, APK tanpa tanda tangan, APK yang isinya diubah setelah
ditandatangani, serta APK dengan entri tambahan semuanya tertolak di sini.

Bila build gagal, berkas APK tidak dihasilkan, atau berkas hasil build tidak lolos verifikasi,
workflow **gagal** dan **tidak ada tag maupun release** yang dibuat. Setelah penyebabnya diperbaiki,
jalankan ulang versi yang sama — tag belum dibuat, jadi tidak ada yang bertabrakan. Versi yang tag-nya
sudah ada ditolak di `verify` sebelum build dimulai (fail-closed: rilis lama tidak pernah ditimpa);
untuk rilis berikutnya naikkan `expo.version` di `app.json`.

### 6.4 Build produksi tanpa rilis

Karena `workflow_dispatch` sekarang selalu berujung rilis (build sukses → tag + GitHub Release), build
produksi **tanpa** rilis dilakukan lokal seperti bagian 6.1 — dengan `--version-code auto` yang sama,
sehingga nomor versinya konsisten dengan rilis berikutnya.

### 6.5 APK vs AAB dan cara menaikkan versi

| | APK (rilis) | AAB (`production`, manual) |
|---|---|---|
| Berkas | `.apk`, ditandatangani kunci rilis | `.aab`, ditandatangani EAS |
| Distribusi | GitHub Release / Actions artifact | Google Play (`store`), lewat `eas build` manual |
| Cara dapat | Actions → workflow rilis | halaman build EAS → Play Console |

Aturan versi (ADR-036, diperbarui ADR-051):

- **`version` di `app.json`** (mis. `0.2.0`) dinaikkan **manual** setiap siklus rilis. Ini nama versi yang
  terlihat pengguna, dan workflow rilis memakainya untuk menamai tag (`v<versi>`) sehingga label rilis
  selalu sama dengan versi di dalam APK (ADR-042).
- **Nomor versi build (`versionCode`)** dihitung CI dari riwayat repository — jumlah seluruh commit
  (`git rev-list --count --all`) — sehingga selalu naik dan tidak perlu diurus manusia. `app.json`
  `android.versionCode` berfungsi sebagai **lantai**: bila hitungan git lebih kecil darinya, nilai di
  `app.json` yang dipakai (dan dicatat di log sebagai `::notice::`). Naikkan angka itu bila repository
  pernah di-rewrite sehingga hitungannya turun di bawah APK yang sudah beredar.
- **Yang salah**: nomor versi tidak lagi dikelola EAS. Jalur manual `eas build` memakai nilai dari
  `app.json` (`appVersionSource: local`), dan APK manual seperti itu tidak boleh dirilis ke halaman
  Releases — pakai workflow rilis.
- Jangan menurunkan `version` dan jangan memakai ulang tag: setiap rilis butuh tag baru dengan angka
  yang lebih tinggi.

### 6.6 Memeriksa APK yang sudah dibangun

Pemeriksaan yang sama dengan yang dijalankan workflow bisa dipakai lokal untuk APK apa pun — hasil
build sendiri maupun berkas yang baru diunduh, sebelum dipasang ke perangkat:

```powershell
node scripts/verify-apk.mjs RodaKawan-v0.2.0.apk
```

Keluar dengan kode `0` dan mencetak ukuran berkas, jumlah entri, skema tanda tangan yang lolos
(`v1`, `v2`, `v3`), serta sidik jari SHA-256 sertifikat penandatangan. Bila APK tidak tertandatangani
atau isinya berubah setelah ditandatangani, script keluar dengan kode `1` dan menyebutkan alasannya
(mis. `CRC-32 entri classes.dex tidak cocok` atau `Isi APK tidak cocok dengan digest yang
ditandatangani (v2, RSA-PKCS#1/SHA-256)`). Sidik jari sertifikat yang **sama** antar rilis adalah
bukti bahwa APK tidak pernah ditandatangani ulang oleh keystore lain; keystore itu sendiri dikelola
EAS, jadi memperbaruinya akan mengubah sidik jarinya. Bila APK-nya diunduh dari halaman Releases,
bandingkan dulu SHA-256-nya dengan bagian **🔒 Verifikasi berkas** di catatan rilis itu (bagian 6.10)
— script ini memeriksa isi berkasnya, sedangkan perbandingan itu membuktikan berkasnya memang yang
dirilis.

### 6.7 Rilis preview: otomatis dan atas permintaan

[`.github/workflows/release-on-push.yml`](../.github/workflows/release-on-push.yml) membangun APK
profil `preview` dan menerbitkannya sebagai GitHub Release **prerelease** bertag `v<versi>-build<N>`
(`N` = `github.run_number`). Ada dua cara menjalankannya:

| Cara | Pemicu | Kapan dipakai |
|---|---|---|
| Otomatis | `ci.yml` sukses pada push ke `main` | alur normal |
| Manual | Actions → **Release APK (push to main or manual)** → Run workflow, input `commit` | merilis commit tertentu tanpa menunggu push ke `main`, mis. perbaikan di branch yang belum di-merge |

```powershell
# Rilis commit dari ref yang dipilih saat menjalankan workflow:
gh workflow run release-on-push.yml --ref hotfix/0.2.1

# Atau sebutkan commit/ref-nya secara eksplisit (SHA, nama branch, atau tag):
gh workflow run release-on-push.yml -f commit=0b989a0
```

Aturan yang berlaku di kedua jalur:

- **Hanya commit yang sudah lulus CI** yang dirilis. Pada jalur manual, job `plan` mencari run workflow
  `CI` yang sukses untuk SHA itu lewat API Actions (izin `actions: read`, memakai `GITHUB_TOKEN`); bila
  tidak ada, rilis dibatalkan sebelum build dimulai. Dorong commit tersebut ke `main` atau buka pull
  request sampai CI-nya hijau, lalu jalankan lagi.
- **Commit pilihan boleh ada di branch yang belum di-merge.** Input diselesaikan menjadi satu SHA di job
  `plan` dan SHA itu yang dipakai seluruh job, jadi tidak ada risiko tiap job memakai commit berbeda
  (mis. ketika branch bergerak di antara job).
- **Dispatch manual yang tidak membawa perubahan aplikasi gagal** dengan pesan jelas: seluruh perubahan
  sejak tag rilis terakhir hanya dokumentasi/test/CI, jadi tidak ada yang perlu dirilis. Ini berbeda
  dengan jalur push, yang memang melewati build tanpa gagal.
- **Pilih commit yang masih satu riwayat dengan tag rilis terakhir** (mis. branch yang dicabang dari
  `main` setelah rilis terakhir). Batas bawah catatan rilis dicari dari tag rilis terakhir yang bisa
  dicapai commit itu; bila tidak ada yang tercapai, script menganggapnya "belum ada rilis sebelumnya",
  sehingga catatan rilisnya memuat seluruh riwayat commit tersebut. Untuk cherry-pick yang sudah lama
  terpisah, siapkan branch yang memuat `main` terbaru lebih dulu.
- **Catatan rilis menyorot perubahan yang merusak.** Badan rilis dibuat `scripts/release-notes.mjs`
  dari subjek commit sejak tag rilis terakhir. Commit yang headernya bertanda `!` (`feat!:`,
  `fix(api)!:`) atau memuat baris `BREAKING CHANGE:`/`BREAKING-CHANGE:` dikumpulkan di bagian paling
  atas, dicetak tebal bersama tipe dan lingkupnya, dan tidak diulang di kelompok Fitur/Perbaikan —
  jadi satu daftar itu saja yang perlu dibaca sebelum memperbarui. Sisa commit masuk Fitur (`feat`),
  Perbaikan (`fix`), atau Perubahan lain. **Kedua jalur rilis memakai format ini**: rilis produksi
  menjalankan script yang sama di job `verify` dengan `--tag-exclude 'v*-build*'`, sehingga batas
  bawahnya rilis produksi terakhir, bukan build preview terakhir — tanpa itu catatan rilis versi Play
  Store hanya memuat satu-dua commit karena setiap push ke `main` membuat tag build preview. Berkas
  catatan diserahkan ke job `release` sebagai Actions artifact (`rodakawan-release-notes`) karena job
  itu sengaja tidak menjalankan kode repository (ADR-043).
- **Commit pembukuan rilis dilewati.** Commit yang mencatat rilis sebelumnya ke `CHANGELOG.md`
  bertanda `[skip ci]` (bagian 6.8) dan tidak masuk catatan rilis, sama seperti penanda itu mencegah CI
  berjalan. Tanpa aturan ini, bagian Perubahan lain pada setiap rilis memuat baris "catat rilis … di
  CHANGELOG.md" — termasuk di dalam `CHANGELOG.md` itu sendiri, yang berarti riwayatnya bercerita
  tentang dirinya sendiri.
- **Rilis preview lama dipangkas otomatis** setelah rilis barunya terbit (bagian 6.11): job `prune`
  menyimpan sepuluh build preview terbaru beserta tag-nya dan menghapus sisanya, sehingga halaman
  Releases tetap bisa dibaca. Rilis produksi dan tag di luar pola `v<versi>-build<N>` tidak pernah
  disentuh, dan riwayat setiap preview tetap ada di `CHANGELOG.md` (bagian 6.8).
- **Unduhannya bisa diperiksa penguji** (bagian 6.10): badan rilis ditutup bagian **🔒 Verifikasi berkas**
  berisi SHA-256 dan sidik jari sertifikat APK yang barusan dirilis, ditambahkan job `release` tepat
  sebelum rilis terbit. Berlaku di kedua jalur karena keduanya melewati penambahan yang sama.
- **APK dijalankan di emulator sebelum rilis dibuat** (bagian 6.9). Rilis preview inilah yang dipasang
  manusia dari halaman Releases, jadi pratinjau yang crash saat dibuka tidak boleh sempat terbit;
  ongkosnya satu boot emulator per rilis, dan push dokumentasi tidak terkena karena job itu ikut
  dilewati bersama `build-apk`.
- **Pencatatan itu tidak bisa memicu rilis berantai** walau workflow-nya sampai berjalan:
  `scripts/should-release.mjs` melewati build APK bila seluruh perubahan sejak tag terakhir hanya
  dokumentasi/markdown, uji (Jest dan SQL `supabase/tests/**`), migration `supabase/migrations/**`,
  draf SQL, tooling repo di `scripts/` — kecuali tiga skrip yang menjadi input build
  (`write-app-env.mjs`, `configure-android-release.mjs`, `generate-assets.mjs`) — atau berkas CI, dan
  `CHANGELOG.md` termasuk di dalamnya. Berkas yang tidak dikenali selalu dihitung perlu build
  (ADR-074).
- Build EAS hanya dipanggil sekali per rilis: `concurrency: release-on-push` membuat dispatch manual
  yang datang saat rilis lain berjalan ikut mengantre, bukan berjalan bersamaan.
- Rilis preview tidak pernah mengunggah apa pun ke Google Play; rilis produksi tetap lewat
  `android-release.yml` (bagian 6.3), yang juga dijalankan manual.
- Setiap rilis juga dicatat permanen di `CHANGELOG.md` (bagian 6.8).

### 6.8 Riwayat rilis: CHANGELOG.md

[`CHANGELOG.md`](../CHANGELOG.md) adalah riwayat permanen setiap rilis. Isinya ditulis otomatis oleh
job `changelog` di kedua workflow rilis, bukan oleh manusia:

- Rilis **produksi** masuk sebagai bagian penuh, judulnya bertautan ke halaman rilisnya di GitHub:
  mis. `## [v0.2.0](https://github.com/29nls/rodakawan/releases/tag/v0.2.0) — 2026-10-14`. Dengan
  begitu riwayat di berkas ini bisa dinavigasi langsung ke halaman rilis (APK, SHA-256, catatan
  lengkap). Repository untuk tautannya diambil dari `--repo`, lalu `GITHUB_REPOSITORY`, lalu remote
  `origin` (ADR-052).
- Rilis **preview** (`v<versi>-build<N>`) diringkas di dalam blok `<details>` yang bisa dibuka, karena
  build preview dibuat pada setiap push ke `main` — bila ditulis sama panjang, versi produksi akan
  tenggelam di antara puluhan build. Entri inilah yang membuat pemangkasan rilis lama tidak
  kehilangan apa pun (bagian 6.11). Judul preview-nya juga bertautan, ke halaman rilis build itu.

Aturan yang dipegang job itu:

- Entri baru ditaruh **paling atas**, tepat di bawah judul berkas; urutannya terbaru → terlama.
- Isi tiap bagian sama dengan badan GitHub Release-nya (`scripts/release-notes.mjs`), hanya judul di
  dalamnya yang diturunkan satu tingkat (`## Fitur` → `### Fitur`) supaya judul versi menjadi
  satu-satunya tingkat dua di berkas ini. Satu-satunya perbedaan yang disengaja: badan rilis ditutup
  bagian **🔒 Verifikasi berkas** (bagian 6.10) yang tidak ikut masuk ke sini — hash artefak berguna di
  halaman tempat berkasnya diunduh, bukan di riwayat repository.
- Job-nya **idempoten** dan mencoba ulang sampai tiga kali: setiap percobaan dimulai dari `origin/main`
  terbaru (`git reset --hard`) lalu menulis ulang bagiannya sendiri, jadi percobaan ulang tidak pernah
  menghasilkan bagian ganda. Bila bagian untuk tag itu sudah ada, tidak ada commit baru sama sekali.
- Job itu **checkout `main`**, bukan commit yang dirilis: dispatch manual boleh merilis commit dari
  branch yang belum di-merge (bagian 6.7), dan mendorong commit itu ke `main` akan ikut
  mempublikasikan seluruh branch tersebut. Yang didorong hanya perubahan `CHANGELOG.md`.
- Grup `concurrency: changelog` dipakai bersama kedua workflow, sehingga dua pencatatan tidak pernah
  mendorong ke `main` bersamaan. Job `release` tetap satu-satunya yang membuat tag dan GitHub Release.
- Commit-nya memakai penanda `[skip ci]`. Push dengan `GITHUB_TOKEN` memang tidak memicu workflow baru,
  jadi tidak ada rilis berantai; penandanya menjaga sifat itu bila kelak tokennya diganti, sekaligus
  membuat commit pencatatan ini **tidak ikut muncul** di catatan rilis berikutnya (lihat bagian 6.7)
  — kalau ikut, setiap rilis akan bercerita tentang pencatatan rilis di depannya.
- Berkasnya ditulis mesin dan karena itu dikecualikan dari `prettier --check` (lihat `.prettierignore`).
  Menyunting teksnya boleh, asalkan judul bagiannya tidak diubah — bentuknya
  `## [<tag>](<halaman-rilis>) — <tanggal>` (judul polos dari script versi lama pun tetap
  dikenali). Judul itulah penanda yang dipakai job untuk mengenali rilis yang sudah tercatat.

Bila branch protection melarang push langsung ke `main` (atau mewajibkan pull request), job itu gagal
dengan pesan `::error::` dan rilisnya perlu dicatat manual:

```powershell
node scripts/release-notes.mjs > catatan.md
node scripts/update-changelog.mjs --tag v0.2.0 --notes catatan.md                   # rilis produksi
node scripts/update-changelog.mjs --tag v0.2.0-build4 --notes catatan.md --preview  # build preview
```

Catatan rilis yang gagal diunduh dari Actions artifact `rodakawan-release-notes` bisa disimpan sebagai
`catatan.md` untuk perintah di atas.

Perintah di atas menghasilkan judul bertautan selama dijalankan dari clone yang punya remote
`origin` (atau dengan tambahan `--repo 29nls/rodakawan`). Tanpa keduanya rilis tetap tercatat,
hanya judulnya yang polos — dan script mencatat `::warning::` supaya itu tidak hilang diam-diam.

### 6.9 Uji nyala APK di emulator

Sebelum tag maupun GitHub Release dibuat, APK hasil build **benar-benar dijalankan** di emulator
Android oleh job `smoke-test` di kedua workflow rilis. `scripts/verify-apk.mjs` sudah membuktikan
berkasnya utuh dan ditandatangani; yang belum dibuktikan adalah bahwa aplikasinya bisa dibuka — APK
yang lolos verifikasi tetap bisa mati seketika karena kode native yang salah atau bundel JS yang tidak
bisa dimuat.

Yang diperiksa `scripts/smoke-test-apk.mjs`, berurutan:

1. Emulator sudah selesai boot (`sys.boot_completed` = `1`).
2. `adb install -r` melaporkan `Success`.
3. `am start -W` melaporkan `Status: ok` untuk aktivitas peluncur paket itu.
4. Dalam batas waktu (90 detik di workflow), proses paketnya hidup **dan** aktivitasnya menjadi
   aktivitas terdepan (`dumpsys activity activities`, dengan `dumpsys window` sebagai cadangan).
5. Logcat sejak peluncuran tidak memuat `FATAL EXCEPTION`, crash native (`Fatal signal`), atau
   `ANR in` milik paket itu.

`am start -W` sengaja tidak dipercaya sendirian: ia melaporkan hasil permintaan peluncuran, dan tetap
berbunyi `Status: ok` untuk aplikasi yang langsung mati setelah aktivitasnya diterima. Karena itu
langkah 4 dan 5 ada. Pemeriksaan logcat hanya menuduh paket aplikasi ini — crash `system_server` atau
layanan Google bukan kegagalan rilis ini.

Menjalankannya sendiri di mesin yang punya emulator menyala:

```powershell
node scripts/smoke-test-apk.mjs --apk app-preview.apk --evidence bukti-smoke
```

Keluar dengan kode `0` dan mencetak `paket`, `aktivitas`, `pid`, `peluncuran_ms`, serta `frame`
(jumlah frame yang digambar, hanya dilaporkan). Kegagalan memberi kode `1` dengan kutipan log yang
relevan. `--package` mengambil id paket dari `expo.android.package` di `app.json` bila tidak disebut,
dan `--timeout <detik>` mengubah batas tunggunya (default 60).

Bukti ujinya — `layar.png` (tangkapan layar emulator), `logcat.txt`, dan `ringkasan.txt` — diunggah
selalu, termasuk saat ujinya gagal, sebagai Actions artifact `rodakawan-smoke-test` (produksi) atau
`rodakawan-smoke-test-preview` (pratinjau). Tangkapan layar dan logcat itulah satu-satunya cara tahu
apa yang terjadi di dalam emulator setelah run-nya selesai.

Catatan operasional:

- **Job ini memakai `ubuntu-24.04`, bukan `ubuntu-latest`.** Jalur emulator bergantung pada isi image
  (akses `/dev/kvm`, versi Android SDK, versi emulator), sedangkan label `ubuntu-latest` berpindah
  versi Ubuntu dari waktu ke waktu. Job lain tetap memakai `ubuntu-latest` karena tidak menyentuh
  emulator.
- **Akselerasi emulator butuh `/dev/kvm`.** Langkah pertama job itu menulis aturan udev yang memberi
  mode `0666` pada `/dev/kvm`. Bila tetap tidak bisa ditulis, langkah itu hanya memberi `::warning::`
  dan **tidak menggagalkan rilis**: tanpa akselerasi emulatornya tetap boot, hanya jauh lebih lambat —
  dan waktu bootnya memang dibatasi longgar (900 detik) karena itu. Yang menentukan tetap uji nyalanya,
  bukan kecepatan emulatornya. Bila emulator gagal boot, turunkan `api-level` atau naikkan
  `emulator-boot-timeout` di job `smoke-test`; `-accel-check` hanya dicetak sebagai informasi.
- **Nomor API emulatornya `36` (`google_apis`, `x86_64`)**, bukan API 24 walau `minSdk` aplikasinya
  lebih rendah: yang diuji adalah APK-nya berjalan di Android yang dipakai sekarang. Untuk mencoba
  level lain, ubah input `api-level` pada langkah `ReactiveCircus/android-emulator-runner` di job itu,
  atau jalankan script ini sendiri di emulator apa pun yang sudah menyala.
- **Aplikasi hanya perlu menyala**, belum perlu sampai ke layar tertentu: uji ini gerbang rilis,
  bukan pengganti pengujian alur (bagian 7 dan `docs/QA_TEST_PLAN.md`).

### 6.10 Verifikasi berkas di halaman rilis

Setiap GitHub Release — produksi maupun pratinjau — ditutup bagian **🔒 Verifikasi berkas** berisi nama
berkas APK-nya (`RodaKawan-v0.2.0.apk` atau `app-preview.apk`), ukurannya dalam byte, **SHA-256**
berkas itu, dan sidik jari SHA-256 sertifikat penandatangannya.

Penguji yang mengunduh APK dari halaman itu membandingkan nilainya sendiri sebelum memasang:

```powershell
Get-FileHash RodaKawan-v0.2.0.apk -Algorithm SHA256   # Windows
```

```bash
sha256sum RodaKawan-v0.2.0.apk                        # Linux/macOS
```

Nilai yang berbeda berarti berkasnya bukan yang dihasilkan rilis ini. Pemeriksaan ini melengkapi
`scripts/verify-apk.mjs` (bagian 6.3): script itu membuktikan berkas yang **dirilis** benar dan utuh,
sedangkan bagian ini membuat pengunduhnya bisa membuktikan bahwa berkas yang **sampai di tangannya**
sama dengan berkas itu.

Pembagian tugasnya disengaja: SHA-256 baru diketahui setelah build selesai, sedangkan catatan rilis
disusun sebelum itu. Karena itu bagian ini **ditambahkan job `release`** tepat sebelum
`gh release create`, bukan oleh `scripts/release-notes.mjs`:

- Isinya hanya nilai yang sudah dihitung job `build-apk` (`apk_sha256`, `apk_signer_sha256`), dan APK
yang ada di job `release` memang berkas yang sama — langkah verifikasi tepat sebelumnya sudah
membandingkan sha256 unduhan itu dengan hasil build.
- Penambahannya memakai shell biasa, bukan script Node, karena job `release` di jalur produksi sengaja
  tidak melakukan checkout dan tidak menjalankan kode repository (ADR-043).
- **Hanya badan rilis** yang mendapatkannya; berkas catatan yang diunggah sebagai Actions artifact
  (`rodakawan-release-notes`, sumber entri `CHANGELOG.md`) tetap apa adanya, sehingga riwayat di
  repository tidak ikut membawa hash setiap artefak. Di jalur pratinjau bagian itu ditambahkan
  **sesudah** berkasnya diunggah sebagai artifact; di jalur produksi, ke salinan kerja di job
  `release`.
- Bila catatan rilisnya tidak ada atau kosong, langkahnya berhenti dengan `::error::`: rilis boleh
  dibatalkan, tetapi rilis tanpa catatan tidak diterbitkan.

### 6.11 Merapikan riwayat rilis preview

Satu rilis preview dibuat untuk **setiap push ke `main`**, jadi halaman Releases akan penuh olehnya dan
versi produksi — satu-satunya yang benar-benar dipasang pengguna — tenggelam di bawahnya. Job `prune` di
`release-on-push.yml` karena itu memangkas rilis preview lama **setelah** rilis barunya terbit:

- **Yang disimpan:** sepuluh rilis preview terbaru (tag `v<versi>-build<N>`).
- **Yang dihapus:** rilis preview di luar itu, beserta tag git-nya
  (`gh release delete --yes --cleanup-tag`) — tanpa `--cleanup-tag`, tag lama tetap mengotori checkout
  penuh di workflow lain.
- **Yang tidak pernah disentuh:** rilis produksi (`v<versi>`), tag yang tidak berbentuk
  `v<versi>-build<N>` (mis. rilis kandidat `v1.0.0-rc1`), dan tag berbentuk preview yang rilisnya bukan
  *prerelease*. Scriptnya gagal-tertutup: pola yang tidak dikenali dipertahankan, bukan dihapus.
- **Riwayatnya tidak hilang:** setiap rilis preview sudah dicatat `CHANGELOG.md` (bagian 6.8) oleh job
  `changelog` pada run yang membuatnya, dan yang dipangkas selalu sepuluh build di belakang rilis
  terbaru — entrinya sudah ditulis jauh sebelumnya, bukan oleh script pemangkas. Yang hilang hanya
  berkas APK-nya — artefak yang memang tidak dijanjikan bertahan lama. Bila sebuah build masih
  dibutuhkan untuk pengujian, unduh dan simpan berkasnya sendiri.

Menjalankannya sendiri (mis. untuk melihat apa yang akan dihapus tanpa menghapus apa pun):

```powershell
node scripts/prune-preview-releases.mjs --dry-run     # tampilkan saja
node scripts/prune-preview-releases.mjs --keep 20     # simpan 20 terbaru
node scripts/prune-preview-releases.mjs --limit 300   # jendela daftar lebih lebar
```

Butuh `gh` di PATH serta `GH_TOKEN` berisi token berizin tulis; di Actions, job `prune` memakai
`GITHUB_TOKEN` dan izin `contents: write` — job itu tidak memegang secret Expo apa pun dan tidak
menjalankan kode dari commit yang dirilis. Hasilnya diringkas sebagai `disimpan=`, `dipangkas=`, dan
`tidak_disentuh=`; scriptnya idempoten, jadi menjalankannya dua kali tidak menghapus apa pun pada kali
kedua.

Empat batasan yang perlu diketahui:

- **`--keep` tidak boleh nol**, dan sekurangnya satu rilis preview harus tetap ada: catatan rilis build
  berikutnya memakai tag rilis **terakhir** sebagai batas bawahnya (bagian 6.7), jadi memangkas sampai
  habis akan membuat catatan rilis berikutnya memuat seluruh perubahan sejak rilis produksi terakhir —
  daftar yang sudah pernah dibaca semua orang.
- **Jendela daftarnya terbatas** (`--limit`, default 200). Bila jumlah rilis menyentuh batas itu,
  script memberi `::warning::` alih-alih menyimpulkan sesuatu dari daftar yang belum tentu lengkap.
- **Tag yang tertinggal tanpa rilis** (mis. run yang gagal di antara `git push` tag dan pembuatan
  releasenya) tidak dibersihkan script ini: ia hanya bekerja dari daftar rilis.
- **Pemangkasan tidak memeriksa `CHANGELOG.md`.** Entri sebuah rilis ditulis job `changelog` pada run
  yang membuat rilis itu; bila job tersebut gagal saat itu, build tersebut tidak punya catatan apa pun,
  dan memangkasnya menghapus satu-satunya jejaknya. Kegagalannya terlihat di halaman Actions run itu —
  bukan sesuatu yang bisa ditambal belakangan oleh script pemangkas.

## 7. Fitur native jangan diuji hanya di Expo Go

Gunakan development build dan perangkat fisik untuk:

- background location / Android foreground service;
- permission background location;
- native map provider tertentu;
- WebRTC/voice PTT;
- audio background dan integrasi headset.

Perangkat vendor dapat menerapkan battery optimization secara berbeda. Tes perjalanan nyata dan catat model perangkat, Android version, jenis jaringan, serta perilaku permission.

## 8. Commands dan CI

```powershell
npm ci
npx expo start
npm run typecheck
npm run lint
npm run format:check
npm run deps:check
npm test
npm run test:scripts
npm run doctor
npm run export:android
```

Jalankan perintah sesuai script yang benar-benar tersedia di `package.json`; jangan melaporkan sukses
bila command belum dijalankan.

### 8.1 CI (GitHub Actions)

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) menjalankan seluruh pemeriksaan di atas pada
push ke `main` dan setiap pull request — termasuk `npm run test:scripts`, sehingga pengelompokan
catatan rilis (`feat`/`fix`/selain itu, penanda perubahan merusak) dan pemilihan batas bawah rentang
tidak bisa berubah diam-diam. Job itu **tidak** memakai secret apa pun, jadi tidak ada yang perlu
dikonfigurasi untuk mulai memakainya.

Job kedua (`workflows-lint`) memeriksa file workflow miliknya sendiri dengan `actionlint` lewat
container `docker://rhysd/actionlint:1.7.12` (tanpa instalasi, tanpa secret): sintaks YAML seluruh
berkas di `.github/workflows/`, ekspresi `${{ }}` — konteks yang tidak sah, referensi `needs`/`inputs`
yang tidak ada — serta shellcheck untuk tiap blok `run:`. File workflow tidak dijangkau tsc/eslint/
Prettier, jadi tanpa job ini kesalahan di `.github/workflows/` baru terlihat ketika workflow itu
berjalan — yaitu tepat pada rilis, setelah menit build terpakai; dengan job ini, pull request-nya
yang gagal lebih dulu. Naikkan versi container sebagai perubahan biasa, bukan diam-diam.

Uji RLS berdiri di workflow terpisah (`.github/workflows/database-rls.yml`) karena ia satu-satunya
pemeriksaan yang membutuhkan secret Supabase; `ci.yml` sengaja bebas secret sepenuhnya. Caranya:

- **Otomatis** — setiap push/PR yang mengubah `supabase/**`, `scripts/db-test.mjs`, atau workflow
  itu sendiri.
- **Manual** — **Actions → Database RLS → Run workflow**.
- Sebelum satu perintah pun menyentuh database, workflow memverifikasi connection string menunjuk
  project **development** (ref `xvmcpfkkveeaevfcvfug`); selain itu ia berhenti, sehingga secret yang
  salah tempat tidak bisa menjalankan uji apa pun. PR dari fork dilewati karena tidak menerima secret.
- Keluarannya harus memuat notice `UJI RLS PROFIL LULUS`; tanpa notice itu workflow dianggap gagal,
  sehingga berkas uji yang terpotong tidak bisa menghasilkan "hijau palsu".

Secret **`DB_TEST_DATABASE_URL`** sudah terpasang di **Settings → Secrets and variables → Actions**;
nilainya adalah connection string PostgreSQL project development dengan `?sslmode=require`, sama
seperti `.env.db` lokal. Ganti nilainya di sana bila password database development dirotasi —
mengubah `.env.db` lokal saja tidak berdampak apa-apa pada CI. Untuk memeriksanya tanpa mencetak
nilai: `gh secret list`.

Jangan pernah menaruh connection string atau service role key di berkas repo, log, atau dokumentasi
publik; nilai itu hanya boleh berada di secret GitHub atau environment server.

Rilis APK memakai workflow kedua,
[`.github/workflows/android-release.yml`](../.github/workflows/android-release.yml), yang hanya berjalan
manual lewat **Actions → Android APK Release → Run workflow** (input `version`) dan membuat tag `v<versi>`
beserta GitHub Release setelah build sukses. Workflow itu butuh keempat secret keystore dan ketiga
variable publik (bagian 5) dan tidak pernah menjalankan pengujian database.

## 9. Dokumentasi resmi

- Expo workflow: https://docs.expo.dev/workflow/overview/
- Development builds: https://docs.expo.dev/develop/development-builds/introduction/
- Expo prebuild (proyek native dari app config): https://docs.expo.dev/workflow/prebuild/
- Build rilis lokal (keystore + signing config): https://docs.expo.dev/guides/local-app-production/
- EAS app versions (local vs remote): https://docs.expo.dev/build-reference/app-versions/
- Android: menandatangani APK: https://developer.android.com/studio/publish/app-signing
- GitHub Actions: environment dan variables: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables
- Gradle di CI (cache): https://github.com/gradle/actions/blob/main/docs/setup-gradle.md
- GitHub CLI `gh release create`: https://cli.github.com/manual/gh_release_create
- Expo Location: https://docs.expo.dev/versions/latest/sdk/location/
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
