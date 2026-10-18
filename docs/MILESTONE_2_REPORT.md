# Laporan Milestone 2 — Garasi & Klub

Status: **Implemented · Passed locally · Passed against dev backend**; **Tested on physical device**
masih **Blocked**. Tanggal: 2026-10-16 (seluruh status di bawah diverifikasi ulang pada tanggal ini,
bukan dikutip dari laporan sebelumnya).

Basis: `main` @ `a9858a9` — implementasinya ada di `cf818be` (garasi + klub), `1ef13a8` (checklist
perangkat), dan `a9858a9` (perbaikan versi Expo). Ketiganya **sudah di-push** ke `origin/main`.
CI pada `a9858a9` **hijau** (run `38857101603`), setelah run `38855099318` pada `1ef13a8` **gagal** di
langkah `Expo doctor` — akar masalah dan perbaikannya di ADR-053/ADR-054.

## 1. Migrasi (aditif, tidak mengubah migrasi lama)

Semua sudah **diterapkan** ke project development `xvmcpfkkveeaevfcvfug` lewat
`supabase db push`; paritas lokal/remote diverifikasi sebelum push.

| Migrasi                                    | Isi                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `20261016093000_club_membership_rpc.sql`   | `create_club`, `request_club_membership`, `review_club_membership`, `set_club_member_role`, `remove_club_member`, `leave_club`, tabel `club_role_audit`, grant hanya `authenticated` (anon nol) |
| `20261016094500_single_primary_vehicle.sql`| trigger `motorcycles_single_primary` + partial unique index `motorcycles_single_primary_idx`             |
| `20261016100000_club_membership_owns_private_access.sql` | mengganti policy `clubs_select_public_or_member` dan `clubs_update_admin` tanpa klausa `created_by` |

Temuan keamanan yang ditutup: policy lama memberi pembuat klub (`created_by`) akses
baca **dan** ubah klub privat selamanya, termasuk setelah ia keluar/dikeluarkan.
Uji RLS membuktikannya (`mantan anggota masih membaca klub privat`), lalu policy
diganti pada migrasi ketiga dan uji itu lulus.

## 2. Bukti eksekusi

| Perintah                 | Hasil                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `npm run db:test`        | **LULUS** — 120 perintah (sebelumnya 88), asersi klub/garasi baru hijau |
| `npm run typecheck`      | LULUS                                                        |
| `npm run lint`           | LULUS (0 error, 0 warning)                                   |
| `npm run format:check`   | LULUS                                                        |
| `npx jest --ci`          | LULUS — 20 suite / 222 test (sebelumnya 18 / 205)            |
| `npm run test:scripts`   | LULUS                                                        |
| `npm run export:android` | LULUS                                                        |
| `npm run doctor`         | LULUS — 21/21 pemeriksaan (sebelumnya GAGAL karena patch drift `expo 57.0.29` dan `expo-router 57.0.27`; keduanya dinaikkan ke `~57.0.30` / `~57.0.28`, lihat ADR-053) |

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

## 4. Yang belum selesai (jujur)

- **Foto kendaraan dan logo klub ditambahkan 17 Oktober 2026**, setelah laporan ini pertama ditulis:
  bucket privat `vehicle-photos`/`club-logos`, policy owner-only untuk kendaraan dan owner/admin
  untuk logo, unggah/ganti/hapus dari layar detail kendaraan dan dashboard klub, serta uji Storage
  RLS (`npm run db:test`, 171 perintah). **Foto profil** menyusul 18 Oktober 2026 dengan bucket privat
  `avatars` (owner-only) dan unggah/ganti/hapus dari tab Profil. Yang tetap **Blocked** adalah
  verifikasi galeri/unggah di perangkat fisik karena modul native baru memerlukan APK yang dibangun
  ulang.
- **Perangkat fisik & alur auth nyata masih BLOCKED** untuk pemilik aplikasi: registrasi,
  konfirmasi email, login, reset sandi, sesi, logout, edit profil, privasi lintas pengguna,
  serta seluruh alur garasi/klub lewat layar. Yang dipakai harus APK dari commit Milestone 2 —
  `v0.1.0-build9` dibuat dari `7639ba9` dan **tidak memuat** fitur ini (bagian 5).
- `npm run doctor` sudah lulus: drift patch `expo`/`expo-router` ditutup dengan menaikkan dua paket itu ke versi yang diminta SDK 57 (ADR-053). Karena itu angka pada tabel bagian 2 di atas diukur ulang **setelah** kenaikan tersebut.
- Uji layar di sini memakai client palsu (bukan jaringan nyata); bukti jaringan nyata
  ada pada uji RLS/RPC di database development.

## 5. Checklist uji perangkat fisik & auth nyata (BELUM dijalankan)

Milik pemilik aplikasi; tidak boleh ditandai lulus berdasarkan uji unit atau smoke
test emulator.

**Pakai APK yang dibangun dari commit Milestone 2:
[v0.1.0-build11](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build11)** (pratinjau,
terbit 16 Oktober 2026 06:10 UTC). Tag-nya menunjuk `a9858a9` dan catatan rilisnya memuat commit
implementasi Milestone 2 (`cf818be`), jadi **build inilah yang pertama bisa membuktikan fitur garasi
dan klub** — build preview sebelumnya tidak memuatnya.

- Berkas: `app-preview.apk` · 105.350.425 byte
- SHA-256: `4417798e7596db33dd92c497583a09a79c2d8a091ae002211794602687ee2d48`
- Sertifikat penandatangan: `3ea8bb4745b638be8fddf71e15edd9786d45aac65c0384b87be8fa2c32b3b14d`

APK ini **sudah** melewati uji nyala otomatis di emulator (job smoke test hijau). Yang belum, dan tidak
bisa digantikan oleh uji itu: dijalankan manusia di HP fisik dengan dua akun nyata.

`v0.1.0-build9` ([tautan](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build9), SHA-256
`1eb92d0472aa389ab364aeadafbffbc7c51dc2eafdcf31aff6f42ce38211bc5b`) **tidak boleh** dipakai untuk
membuktikan fitur Milestone 2: build itu berasal dari commit `7639ba9` (15 Oktober), **sebelum**
garasi dan klub ada — ia hanya membuktikan alur Milestone 1.

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

### Merekam bukti checklist

Perekaman bukti tidak lagi bergantung pada ingatan operator. Dengan HP fisik tersambung dan `adb`
di PATH:

```powershell
node scripts/device-checklist.mjs --apk app-preview.apk `
  --expect-sha256 4417798e7596db33dd92c497583a09a79c2d8a091ae002211794602687ee2d48
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
