# Laporan Milestone 2 — Garasi & Klub

Status: **Implemented · Passed locally · Passed against dev backend**; **Tested on physical device**
masih **Blocked**. Tanggal verifikasi terakhir: 2026-10-19.

Basis kode: `main` @ `749424c` — commit yang **sama** dengan tag rilis
[`v0.1.0-build19`](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build19). Implementasi
garasi + klub ada di `cf818be`, checklist perangkat di `1ef13a8`, perbaikan versi Expo di `a9858a9`,
dan perbaikan generator tipe database di `ca2461c`. Setelah tag itu `origin/main` hanya maju satu
commit dokumentasi (`ee0a0bd`, `CHANGELOG.md` saja) — **tidak ada perubahan kode aplikasi**.

Bukti otomatis pada commit tersebut: CI **#26** hijau, Database RLS **#4** hijau, dan Release APK
**#19** sukses (18 Oktober 2026). Rilisnya `v0.1.0-build19`, sebuah *prerelease*.

## 1. Migrasi

Seluruh **dua belas** migration sudah diterapkan ke project development lewat `supabase db push`;
paritas lokal/remote diverifikasi dengan `npx supabase migration list`.

Dua migration pertama adalah **sejarah penyiapan awal** (skema fondasi + bootstrap profil). Angka
"dua migration" pada dokumentasi lama hanya benar untuk titik waktu itu, bukan jumlah migration
sekarang. Sepuluh migration berikutnya bersifat aditif dan tidak menyunting migration yang sudah
diterapkan.

Migration Milestone 2:

| Migrasi                                    | Isi                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `20261016093000_club_membership_rpc.sql`   | `create_club`, `request_club_membership`, `review_club_membership`, `set_club_member_role`, `remove_club_member`, `leave_club`, tabel `club_role_audit`, grant hanya `authenticated` (anon nol) |
| `20261016094500_single_primary_vehicle.sql`| trigger `motorcycles_single_primary` + partial unique index `motorcycles_single_primary_idx`             |
| `20261016100000_club_membership_owns_private_access.sql` | mengganti policy `clubs_select_public_or_member` dan `clubs_update_admin` tanpa klausa `created_by` |

Migrasi Storage yang menyusul untuk Milestone 2: `20261017120000_private_photo_storage.sql`
(bucket `vehicle-photos` dan `club-logos`), `20261017121000_club_logo_policy_qualified_name.sql`
(perbaikan nama policy), dan `20261018120000_profile_avatar_storage.sql` (bucket `avatars`).

Temuan keamanan yang ditutup: policy lama memberi pembuat klub (`created_by`) akses baca **dan**
ubah klub privat selamanya, termasuk setelah ia keluar/dikeluarkan. Uji RLS membuktikannya
(`mantan anggota masih membaca klub privat`), lalu policy diganti pada migrasi ketiga dan uji itu
lulus.

## 2. Bukti eksekusi (diukur ulang 19 Oktober 2026)

| Perintah                 | Hasil                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `npm ci`                 | Exit 0 — 1.082 paket dari `package-lock.json` (lockfile v3).  |
| `npm run deps:check`     | LULUS — TypeScript editor = pin repo; dependency cocok dengan Expo SDK 57.0.30 |
| `npm run typecheck`      | LULUS                                                        |
| `npm run lint`           | LULUS (0 error, 0 warning)                                   |
| `npm run format:check`   | LULUS                                                        |
| `npm test -- --ci`       | LULUS — 27 suite / 316 test                                  |
| `npm run test:scripts`   | LULUS — 240 test (236 + 4 penjaga draf M3; sebelumnya 235 dengan satu kegagalan CRLF) |
| `npm run db:test`        | **LULUS** — `UJI RLS PROFIL LULUS` 171 perintah + `UJI POLICY OWNER-GUARD LULUS` 17 perintah |
| `npm run db:types:check` | LULUS — `database.generated.ts` sama dengan skema database    |
| `npm run storage:test`   | LULUS — 27 langkah HTTP Storage, nol sisa data uji            |
| `npm run export:android` | LULUS — bundel Hermes `entry-*.hbc` 3,8 MB                    |
| `npm run doctor`         | **Tidak dapat dipastikan** — 20 dari 21 pemeriksaan berjalan, pemeriksaan skema config gagal `EAI_AGAIN exp.host` (DNS lingkungan ini), bukan temuan proyek |

Cakupan uji RLS baru (dua pengguna terautentikasi + anggota ketiga + `anon`):
pembuatan klub atomik, slug bentrok, non-anggota tidak membaca klub privat,
anggota pending tidak menyetujui dirinya sendiri, klub `invite_only` menolak,
owner terakhir tidak bisa diturunkan/dikeluarkan, hanya owner yang mengubah peran,
penolakan pengguna tak dikenal (`P0002`), anggota dikeluarkan kehilangan akses dan
harus mengajukan ulang, permintaan bisa dibatalkan/diajukan ulang tanpa baris ganda,
jejak audit tidak bisa dibaca anggota biasa, dan `anon` menolak semua EXECUTE.

## 3. Aplikasi

- **Garasi** — `src/app/garage.tsx` (daftar, tambah, jadikan utama, hapus dengan
  konfirmasi, state loading/kosong/error/retry) dan `src/app/vehicle.tsx` (detail,
  edit, serta bagian privat nomor polisi + catatan). Pintu masuk dari tab Profil.
- **Klub** — `src/app/(tabs)/community.tsx` (jelajah + cari + buat klub),
  `src/app/club.tsx` (detail, ajukan, batalkan permintaan, keluar),
  `src/app/club-admin.tsx` (dashboard terpisah: setujui/tolak, ubah peran,
  keluarkan). Semua mutasi lewat RPC di `src/features/clubs/api.ts`.
- Validasi garasi baru: `src/features/garage/validation.ts` (selaras CHECK constraint).
- Pemetaan kesalahan baru: `mapRpcError` (`PGRST202`/`42883`) plus `22023`, `23514`,
  `P0002` pada `mapTableError`, sehingga kegagalan tidak pernah tampil sebagai sukses.

## 4. Foto, logo, dan avatar

Bucket privat `vehicle-photos` (owner-only), `club-logos` (owner/admin menulis, anggota atau
pengunjung klub publik membaca), dan `avatars` (owner-only). Aplikasi mengunggah, mengganti, dan
menghapus dari layar detail kendaraan, dashboard klub, dan tab Profil; tampilan memakai signed URL
berumur 1 jam. Foto diperkecil dan dikompres di perangkat (`expo-image-manipulator`), dan objek
kendaraan yatim disapu dengan sesi pemilik.

**Modul native sudah ada di APK build19 — bukan lagi alasan untuk menunda uji perangkat.** Diperiksa
pada berkas rilis yang diunduh ulang (19 Oktober 2026):

- ukuran `105.904.027` byte dan SHA-256 `775a3309…b3d9` sama dengan metadata GitHub Release;
- `node scripts/verify-apk.mjs` lulus: 1.290 entri, CRC-32 cocok, skema tanda tangan **v2**,
  sertifikat `3ea8bb47…b14d`;
- `classes*.dex` memuat `expo.modules.imagepicker`, `expo.modules.imagemanipulator`, dan
  `expo.modules.filesystem`;
- `assets/index.android.bundle` menyebut `vehicle-photos`, `club-logos`, dan `avatars`.

Yang tetap **Blocked** adalah pemakaian nyata di HP: izin galeri, pemilihan foto, hasil kompresi,
signed URL setelah aplikasi dibuka ulang, dan penolakan lintas pengguna lewat layar.

## 5. Checklist uji perangkat fisik & auth nyata (BELUM dijalankan)

Milik pemilik aplikasi; tidak boleh ditandai lulus berdasarkan uji unit, emulator, atau smoke test.

**Pakai APK dari commit Milestone 2:
[v0.1.0-build19](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build19)** (pratinjau,
terbit 18 Oktober 2026 06:20 UTC). Tag-nya menunjuk `749424c`, yang memuat seluruh implementasi
Milestone 2 dan modul native foto.

- Berkas: `app-preview.apk` · 105.904.027 byte
- SHA-256: `775a3309fce38416fe04222652031282047f0197bb149da8520b13e73d42b3d9`
- Sertifikat penandatangan: `3ea8bb4745b638be8fddf71e15edd9786d45aac65c0384b87be8fa2c32b3b14d`
- `versionCode`/nama versi mengikuti `app.json` (`0.1.0`); nomor build ada di nama tag.

APK ini **sudah** melewati verifikasi tanda tangan dan uji nyala otomatis di emulator (job smoke test
hijau). Yang belum, dan tidak bisa digantikan oleh uji itu: dijalankan manusia di HP fisik dengan dua
akun nyata.

`v0.1.0-build11` (SHA-256 `4417798e…2d48`) dan `v0.1.0-build9` adalah build lama; jangan memakai
hash-nya untuk build19. `v0.1.0-build9` dibuat dari `7639ba9`, **sebelum** garasi dan klub ada,
sehingga hanya membuktikan alur Milestone 1.

### Langkah pemilik (HP fisik)

1. **Unduh** `app-preview.apk` dari halaman Release `v0.1.0-build19` (atau
   `gh release download v0.1.0-build19 --repo 29nls/rodakawan -p app-preview.apk`).
2. **Cocokkan SHA-256** sebelum memasang:
   `Get-FileHash .\app-preview.apk -Algorithm SHA256` (PowerShell) atau
   `sha256sum app-preview.apk`. Nilainya **harus**
   `775a3309fce38416fe04222652031282047f0197bb149da8520b13e73d42b3d9`. Bila berbeda, berhenti —
   berkas itu bukan artefak rilis ini.
3. **Sambungkan HP** dengan USB debugging aktif dan izinkan komputer ini: `adb devices` harus
   menampilkan perangkat berstatus `device` (bukan `unauthorized`).
4. **Pasang** APK: `node scripts/device-checklist.mjs --apk app-preview.apk --expect-sha256 <hash>`;
   script memasangnya sendiri dan menolak melanjutkan bila hash tidak cocok. Alternatif manual:
   `adb install -r app-preview.apk`.
5. **Jalankan checklist** 1–14. Untuk setiap langkah, amati layar, lalu pilih `r` (sesuai harapan),
   `g` (tidak sesuai), `s` (lewati), atau `q` (berhenti), dan tulis catatan apa adanya.
6. **Tinjau bukti** di `bukti-perangkat/<waktu>/`: `ringkasan.md`, `ringkasan.json`, `perangkat.txt`,
   `logcat-lengkap.txt`, dan `langkah-NN/` (tangkapan layar, hierarki UI, logcat, `meta.json`).
7. **Catat hasil** per langkah di laporan ini atau di lembar terpisah: lulus / gagal / dilewati,
   beserta tanggal, model HP, versi Android, dan akun uji yang dipakai. Gunakan data fiktif; jangan
   memakai nomor polisi atau data pribadi nyata.

| # | Langkah | Bukti yang harus dicatat |
| - | ------- | ------------------------ |
| 1 | Registrasi akun baru di perangkat fisik | email + waktu, layar sukses |
| 2 | Konfirmasi email / callback tautan masuk | tautan diterima dan mendarat di layar masuk |
| 3 | Masuk dengan akun terkonfirmasi | sesi aktif setelah aplikasi dibuka ulang |
| 4 | Masuk dengan sandi salah | pesan galat, tidak ada sesi |
| 5 | Reset sandi dari email | sandi baru bisa dipakai untuk masuk |
| 6 | Keluar dari akun | kembali ke layar masuk, sesi tidak pulih |
| 7 | Edit profil (username, nama tampilan, bio, kota) | tersimpan dan terbaca kembali |
| 8 | Garasi: tambah, jadikan utama, edit, hapus | perubahan bertahan setelah aplikasi dibuka ulang |
| 9 | Garasi: isi nomor polisi lalu buka profil publik akun lain | plat tidak pernah terlihat pengguna lain |
| 10 | Klub: buat klub, ajukan gabung dari akun kedua, setujui/tolak | status anggota berubah sesuai aturan |
| 11 | Klub: klub privat tidak muncul di jelajah akun non-anggota | daftar hanya berisi klub publik |
| 12 | Privasi lintas pengguna: akun B membuka kendaraan/klub akun A | ditolak dengan pesan jelas, bukan data kosong yang membingungkan |
| 13 | Klub: ubah peran anggota dan keluarkan anggota dari akun owner | peran berubah, anggota yang dikeluarkan kehilangan akses, owner terakhir tidak bisa diturunkan |
| 14 | Putuskan jaringan (mode pesawat) saat membuka garasi/klub, lalu sambungkan kembali | pesan galat jelas, tombol coba lagi bekerja, data benar setelah pulih |

Tambahan yang wajib dicatat untuk foto/logo/avatar (bukan bagian 14 langkah script, jalankan setelah
langkah 8 dan 10): unggah, ganti, hapus foto kendaraan; logo klub dari akun owner/admin; avatar dari
tab Profil; foto besar (≥12 MP), PNG transparan, penolakan izin galeri, dan signed URL setelah
aplikasi dibuka ulang. Akun kedua tidak boleh bisa membuka objek akun pertama.

### Merekam bukti checklist

Perekaman bukti tidak bergantung pada ingatan operator. Dengan HP fisik tersambung dan `adb` di PATH:

```powershell
node scripts/device-checklist.mjs --apk app-preview.apk `
  --expect-sha256 775a3309fce38416fe04222652031282047f0197bb149da8520b13e73d42b3d9
```

Script membaca tabel di atas **langsung dari dokumen ini** (teks langkah tidak disalin ke kode),
memilih satu perangkat berstatus `device` (atau yang disebut `--serial`), menolak emulator kecuali
`--allow-emulator`, memasang APK bila `--apk` diberikan, dan mencocokkan SHA-256 build sebelum
langkah pertama — checklist terhadap build yang salah tidak bisa dimulai.

Yang direkam otomatis untuk setiap langkah, di `bukti-perangkat/<waktu>/langkah-NN/`: tangkapan
layar, hierarki UI (`uiautomator dump`), irisan logcat sejak langkah dimulai, aktivitas/jendela
terdepan, dan `meta.json` (waktu, status, catatan). Di akar direktori: `perangkat.json` dan
`perangkat.txt` (identitas HP, versi aplikasi, SHA-256 APK), `logcat-lengkap.txt`, serta
`ringkasan.md`/`ringkasan.json`. Langkah 14 dijalankan sebagian oleh script: jaringan dimatikan,
layar tanpa jaringan direkam (`layar-offline.*`), lalu jaringan dinyalakan kembali **sebelum**
script menunggu input berikutnya — termasuk saat run dihentikan di tengah jalan.

Yang tetap milik manusia adalah penilaiannya. Setelah layar direkam, operator memilih `r` (sesuai
harapan), `g` (tidak sesuai, bukti tetap diambil), `s` (lewati), atau `q` (berhenti), lalu menulis
catatan. Ringkasan menyebut status itu sebagai penilaian operator, dan script keluar 0 hanya bila
**semua** langkah terpilih berstatus direkam; langkah yang dilewati, ditandai gagal, atau belum
sempat dijalankan membuatnya keluar 1.

`node scripts/device-checklist.mjs --list` menampilkan ke-14 langkah tanpa menyentuh perangkat.
Direktori bukti bawaan (`bukti-perangkat/<waktu>`) ada di `.gitignore`, karena isinya bisa memuat
data akun nyata. Test-nya ada di `scripts/__tests__/device-checklist.test.mjs` dan berjalan dengan
`adb` tiruan di `npm run test:scripts`; itu membuktikan perekamannya, bukan hasil checklist-nya.

## 6. Batas yang diketahui

- Semua uji aplikasi di atas memakai client Supabase palsu; bukti jaringan nyata ada pada uji RLS,
  `db:types`, dan HTTP Storage terhadap project development.
- `npm run doctor` tidak bisa memastikan pemeriksaan skema config karena DNS lingkungan ini tidak
  menjangkau `exp.host`; jalankan ulang di jaringan/CI yang terjangkau sebelum menyimpulkan apa pun.
- Status **Tested on physical device** tidak berubah sampai langkah 1–14 di atas dijalankan manusia
  dengan akun nyata dan hasilnya dicatat.
