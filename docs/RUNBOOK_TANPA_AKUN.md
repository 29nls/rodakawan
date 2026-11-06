# Runbook: RodaKawan tanpa akun

Dokumen ini dipakai saat mengoperasikan build yang memakai **identitas anonim per perangkat**
(ADR-083), bukan akun email. Isinya: konfigurasi yang wajib benar, gejala yang sering muncul beserta
tindakannya, dan langkah pemulihan. Semua contoh ditulis untuk project **development**
(`xvmcpfkkveeaevfcvfug`); jangan menjalankan langkah tulis di project live.

Istilah status mengikuti `AGENTS.md`: **Implemented**, **Passed locally**, **Passed against dev
backend**, **Tested on physical device**, **Blocked**. Dokumen ini tidak menaikkan status apa pun;
ia hanya mencatat cara memeriksa.

## 1. Konfigurasi yang harus benar

| Setelan | Nilai wajib | Gejala bila salah |
|---|---|---|
| Authentication → Sign In / Providers → **Anonymous sign-ins** | aktif | Aplikasi berhenti di "Butuh internet untuk memulai"; galat `anonymous_sign_in_disabled` |
| Authentication → Sign In / Providers → **Email** | nonaktif (opsional, disarankan) | Tidak ada gejala di aplikasi; hanya menambah permukaan yang tidak terpakai |
| `supabase/config.toml` → `[auth] enable_anonymous_sign_ins` | `true` | Hanya berlaku untuk `supabase start` lokal; project berjalan diubah lewat dashboard |
| `supabase/config.toml` → `[auth.email] enable_signup` | `false` | Idem |
| `.env.local` → `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | project development | Aplikasi menampilkan layar "backend belum dikonfigurasi" |
| Edge Function `delete-account` | ter-deploy + secret CORS terisi | Hapus data gagal dengan `account_deletion_unavailable` |

Perintah pemeriksa yang aman (tidak mencetak nilai rahasia): lihat `.env.example` untuk daftar variabel
dan `docs/SETUP_GUIDE.md` §4.4–4.5 untuk urutan pengisian.

## 2. Gejala → diagnosis → tindakan

| Gejala di aplikasi | Kemungkinan penyebab | Tindakan |
|---|---|---|
| "Butuh internet untuk memulai" menetap meski jaringan ada | Anonymous sign-ins dimatikan, atau URL/key salah project | Nyalakan provider, cocokkan URL dengan project development, lalu buka ulang aplikasi |
| Layar `identity_lost` | Session tersimpan tidak bisa dipulihkan (token dicabut, data aplikasi dibersihkan, project dipindah) | Jelaskan bahwa identitas lama tidak bisa diambil kembali; minta admin klub mengundang identitas baru. Jangan "memperbaiki" dengan mengubah database |
| Profil kosong setelah onboarding | `bootstrap_profile()` tidak berjalan (migration belum diterapkan) | Terapkan migration, lalu buat identitas baru; jangan mengisi profil manual lewat SQL |
| Undangan klub ditolak `club_invite_invalid` | Kode salah, sudah dipakai, dicabut, atau kedaluwarsa | Buat kode baru dari akun admin; pesan sengaja seragam agar kode tidak bisa ditebak |
| Hapus data gagal `deletion_incomplete` | Langkah Storage/purge/Auth gagal di tengah | Ulangi dari layar yang sama (job melanjutkan langkah yang belum selesai); bila berulang, periksa log Edge Function sebelum menyatakan data hilang |
| Hapus data gagal `session_expired` | Identitas sudah tidak ada di Auth | Tidak ada yang perlu dihapus; buka ulang aplikasi agar identitas baru dibuat |

## 3. Mengundang anggota

1. Admin klub membuat kode sekali-pakai (`create_club_invite`); kode ditampilkan **sekali** — server
   hanya menyimpan hash SHA-256-nya (ADR-084).
2. Kirim kode lewat kanal pribadi, bukan grup publik.
3. Anggota menempelkan kode di layar klub; setelah berhasil, kode tidak bisa dipakai lagi.
4. Kode yang bocor dicabut (`revoke_club_invite`), lalu dibuat kode baru. Mencabut tidak mengeluarkan
   anggota yang sudah masuk.

## 4. Menghapus data pengguna

Ada tiga jalur; semuanya berakhir di Edge Function `delete-account` (ADR-076/ADR-077).

1. **Pengguna sendiri:** Profil → **Hapus data saya** → ketik username → konfirmasi. Setelah selesai,
   aplikasi membuat identitas anonim baru; data lama tidak bisa dipulihkan.
2. **Web statis** (`web/account-deletion/`): belum ter-deploy; masih memakai alur email + kata sandi
   yang tidak berlaku untuk pengguna aplikasi — **Blocked** sampai halaman ditinjau ulang.
3. **Operator:** jangan menghapus baris manual dari `auth.users`/`profiles`. Bila pengguna tidak bisa
   memakai aplikasi, minta mereka memasang ulang lalu menghapus dari dalam aplikasi; penghapusan
   manual melewati pemindahan logo klub dan meninggalkan objek Storage yatim.

Verifikasi setelah penghapusan (dari sisi operator, tanpa data pribadi): profil hilang, objek pribadi
hilang, logo klub masih ada di path baru, laporan bahaya tetap ada sebagai tombstone, dan refresh token
lama ditolak.

## 5. Identitas hilang & anggota yang terkunci

- Identitas hilang **tidak bisa dipulihkan**; tidak ada email untuk reset. Satu-satunya jalan adalah
  undangan baru dari admin klub.
- Klub yang kehilangan admin aktifnya belum punya jalur pemulihan resmi (ADR-086, **Diusulkan**).
  Sementara itu: jangan memindahkan admin dengan SQL kecuali sebagai insiden yang dicatat, lalu
  dokumentasikan di `docs/INCIDENT_RESPONSE.md`.

## 6. Identitas anonim yang ditinggalkan

Setiap instalasi membuat satu baris `auth.users`. Instalasi ulang meninggalkan baris lama tanpa profil
aktif. **Belum ada pembersihan otomatis** (ADR-083).

- Untuk mengukur, hitung saja (jangan menghapus):
  `select count(*) from auth.users where is_anonymous and created_at < now() - interval '90 days';`
- Jangan menghapus baris `auth.users` langsung: hapus lewat jalur `delete-account` per pengguna, atau
  tunggu keputusan retensi pemilik. Menghapus manual memutus objek Storage dan meninggalkan konten
  bersama tanpa tombstone.

## 7. Insiden dan rotasi

| Kejadian | Tindakan |
|---|---|
| Publishable key disalahgunakan | Rotasi key di dashboard, perbarui `.env.local`, build ulang; RLS tetap penentu akses, jadi tidak ada data yang terbuka hanya karena key publik diketahui |
| Password database pernah tercetak | Reset password database, perbarui `.env.db`; jangan tempel connection string di chat/issue |
| `service_role` bocor | Rotasi segera; key itu tidak boleh ada di repo, bundel, atau log |
| Edge Function salah menghapus | Hentikan deployment fungsi, periksa `account_deletion_jobs`, pulihkan dari backup — jangan menjalankan ulang purge tanpa bukti |

## 8. Rollback

Mode tanpa akun tidak bisa "dimatikan" untuk pengguna yang sudah ada: tidak ada email untuk memigrasikan
identitas anonim menjadi akun. Bila build bermasalah:

1. Kembalikan APK ke build sebelumnya (identitas perangkat tetap sama selama data aplikasi tidak
   dibersihkan).
2. Jangan mematikan Anonymous sign-ins: build lama akan langsung berhenti di layar awal.
3. Bila harus menutup akses sementara, cabut undangan dan hentikan pembuatan klub — jangan menghapus
   data.

## 9. Checklist sebelum pilot

- [ ] Anonymous sign-ins aktif, provider Email nonaktif
- [ ] Migration terbaru diterapkan; `npm run db:test` menerima seluruh notice penanda
- [ ] `npm run db:types:check` hijau (tipe generated sama dengan skema)
- [ ] Edge Function `delete-account` ter-deploy dan `WEB_ALLOWED_ORIGINS` terisi bila halaman web dipakai
- [ ] Dua perangkat: identitas berbeda, undangan klub berhasil, hapus data mengembalikan ke onboarding
- [ ] `docs/QA_TEST_PLAN.md` §8f diisi dengan bukti per butir (bukan disalin dari "hasil yang diharapkan")
