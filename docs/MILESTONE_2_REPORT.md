# Laporan Milestone 2 — Garasi & Klub

Status: **diterapkan dan diuji terhadap database development**. Tanggal: 2026-10-16.
Basis: `main` @ `1b1b029` (+ perubahan yang belum di-commit pada laporan ini).

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
| `npm run doctor`         | **GAGAL (pra-ada)** — patch drift `expo 57.0.29` vs `~57.0.30` dan `expo-router 57.0.27` vs `~57.0.28`; tidak ada perubahan dependensi pada pekerjaan ini |

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

- **Foto belum bisa diunggah**: tidak ada bucket/policy Storage dan tidak ada tombol
  unggah palsu; kolom `photo_path`/`logo_path` dibiarkan kosong dan disebut apa adanya.
- **Perangkat fisik & alur auth nyata masih BLOCKED** untuk pemilik aplikasi
  (APK `v0.1.0-build9`, SHA-256 `1eb92d04…25b`): registrasi, konfirmasi email,
  login, reset sandi, sesi, logout, edit profil, privasi lintas pengguna.
- `npm run doctor` masih gagal karena patch drift dependensi pra-ada.
- Uji layar di sini memakai client palsu (bukan jaringan nyata); bukti jaringan nyata
  ada pada uji RLS/RPC di database development.

## 5. Checklist uji perangkat fisik & auth nyata (BELUM dijalankan)

Milik pemilik aplikasi; tidak boleh ditandai lulus berdasarkan uji unit atau smoke
test emulator. APK: [v0.1.0-build9](https://github.com/29nls/rodakawan/releases/tag/v0.1.0-build9),
SHA-256 `1eb92d0472aa389ab364aeadafbffbc7c51dc2eafdcf31aff6f42ce38211bc5b`.

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
