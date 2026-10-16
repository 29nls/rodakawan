# QA Test Plan

## 1. Lapisan pengujian

1. **Unit:** validators, state transitions, expiry rules, parser payloads, permissions state mapping.
2. **Integration:** Supabase query/service, Edge Function auth, storage policies, push token registration.
3. **Security/RLS:** allow + deny matrix dengan minimal dua user dan role berbeda.
4. **E2E:** onboarding → klub → ride → tracking → hazard/chat → end ride.
5. **Device/manual:** background location, GPS, screen lock, battery saver, Bluetooth, low memory, different Android vendors.
6. **Release smoke:** verifikasi unduhan, install APK, login, critical actions, rollback/error
   behavior, privacy/settings.
   Bagian pertamanya sudah otomatis: job `smoke-test` di kedua workflow rilis memasang APK hasil build
   di emulator dan memastikan aplikasinya menyala sebelum rilis dibuat (`docs/SETUP_GUIDE.md` §6.9).
   Sebelum memasang di perangkat fisik, cocokkan dulu SHA-256 berkas unduhan dengan bagian
   **🔒 Verifikasi berkas** di badan rilis itu; nilai yang berbeda berarti berkasnya bukan yang dirilis
   workflow ini, dan berkas seperti itu tidak perlu diuji lebih jauh. Sisanya tetap manual.

## 2. Test environment

- Development Supabase project dengan data dummy.
- Minimal dua akun test (host dan participant), serta akun non-member.
- Android fisik dengan GPS dan data seluler/Wi-Fi; tambahkan perangkat vendor berbeda pada beta.
- Development build yang sesuai native config; jangan menilai background location hanya dari Expo Go.
- Seed data menggunakan UUID dan koordinat fiktif; jangan gunakan lokasi rumah pengguna.

## 3. Functional test cases

| ID | Skenario | Hasil yang diharapkan |
|---|---|---|
| AUTH-01 | Daftar dan login valid | User terautentikasi dan profil dibuat/dapat dilengkapi. |
| AUTH-02 | Password/token salah | Pesan aman dan jelas; tidak menampilkan detail internal. |
| AUTH-03 | Logout lalu buka kembali | Session tertutup sesuai desain; private screen tidak terbuka. |
| AUTH-04 | Daftar dengan email sudah terpakai | Pesan jelas di Bahasa Indonesia; tidak menyebut akun lain ada/hilang secara berlebihan. |
| AUTH-05 | Daftar dengan username sudah terpakai | Pendaftaran tetap berhasil; profil memakai username sementara `rider_…` dan aplikasi meminta penggantian. |
| AUTH-06 | Email konfirmasi diperlukan | Aplikasi menyatakan akun menunggu konfirmasi; tidak mengklaim sudah masuk. |
| AUTH-07 | Tautan konfirmasi dibuka | Postur awal session diperbarui; pengguna diarahkan ke area aplikasi tanpa redirect loop. |
| AUTH-08 | Tautan kedaluwarsa / sudah dipakai | Pesan jelas dan saran meminta tautan baru; tidak crash. |
| AUTH-09 | Minta reset password | Pesan sukses tidak membocorkan apakah email terdaftar. |
| AUTH-10 | Ganti password dari tautan pemulihan | Password lama tidak berlaku; kata sandi baru dapat dipakai login. |
| AUTH-11 | Kata sandi lemah / konfirmasi tidak sama | Ditolak di aplikasi dengan pesan spesifik sebelum request dikirim. |
| AUTH-12 | Jaringan gagal saat masuk | Pesan jaringan jelas; tidak mengklaim berhasil; tombol bisa dicoba lagi. |
| AUTH-13 | Env Supabase belum diisi | Banner "konfigurasi belum tersedia"; tidak ada request jaringan; aplikasi tidak crash dan tidak menampilkan nilai key. |
| AUTH-14 | Buka rute privat tanpa session | Dialihkan ke alur masuk; layar privat tidak pernah dirender. |
| PROF-01 | User A mengubah profile User B lewat API | Ditolak oleh policy/server. |
| PROF-02 | User A membaca profil privat User B | Tidak ada baris yang terlihat (bukan pesan error yang membocorkan keberadaan). |
| PROF-03 | Peran anon membaca `public.profiles` | Nol baris. |
| PROF-04 | Username duplikat lewat API | Ditolak unique constraint; aplikasi menampilkan pesan yang bisa dipahami. |
| PROF-05 | Username dengan format tidak valid | Ditolak validasi aplikasi dan CHECK constraint database. |
| PROF-06 | Profil belum ada (mis. bootstrap trigger belum terpasang) | Aplikasi menampilkan state eksplisit, bukan layar kosong, dan tetap dapat membuat profil. |
| PROF-07 | Sesi kedaluwarsa saat menyimpan profil | Diarahkan keluar dengan pesan jelas; tidak menyimpan sebagai pengguna lain. |
| PROF-08 | User A membuat relasi follow ke profil privat User B | Tidak ada akses baru: permintaan berstatus `pending` sampai pemilik menyetujui, dan status tidak dapat dipaksa klien. |
| PROF-09 | Pemilik profil menyetujui atau mencabut relasi follow | Akses baca muncul setelah disetujui dan hilang kembali setelah relasi dihapus. |
| GAR-01 | User lain membuka garage publik | Hanya field yang diizinkan terlihat. |
| GAR-02 | User lain membaca plat pribadi | Ditolak tanpa kebocoran payload. |
| GAR-03 | User A membuat/mengubah detail privat untuk kendaraan User B | Ditolak policy dan foreign key komposit, termasuk ketika `motorcycle_id` diubah. |
| CLUB-01 | Buat klub | Creator menjadi owner; data valid. |
| CLUB-02 | Non-member membaca klub privat | Ditolak atau hanya metadata minimum sesuai aturan final. |
| CLUB-03 | Member biasa mengubah role anggota | Ditolak. |
| RIDE-01 | Creator membuat ride | Ride status `planned`, host membership tersedia. |
| RIDE-02 | Host memulai ride | State menjadi `active`; hanya anggota sah bergabung channel. |
| RIDE-03 | User non-member join private channel | Join ditolak. |
| LOC-01 | Peserta memberi izin foreground dan mengaktifkan sharing | Marker peserta lain bergerak dengan timestamp. |
| LOC-02 | Permission lokasi ditolak | Fitur menjelaskan akibatnya dan tidak mengklaim sharing aktif. |
| LOC-03 | GPS dimatikan | UI menyatakan lokasi tidak tersedia; tidak memakai koordinat lama sebagai live. |
| LOC-04 | Data tidak masuk 30 detik | Marker ditandai stale dengan last-updated. |
| LOC-05 | Pengguna stop sharing | Update berhenti dan status peserta berubah. |
| LOC-06 | User keluar / ride diakhiri | Server menolak update selanjutnya dan channel tertutup untuk akses yang tidak lagi sah. |
| LOC-07 | Payload mengklaim userId milik peserta lain | Server mengabaikan/menolak; identity berasal dari session. |
| LOC-08 | Lompatan GPS tak wajar / timestamp masa depan | Di-filter/ditandai dan tidak merusak peta. |
| HAZ-01 | Buat laporan valid | Report terlihat pada peta/list untuk audience yang sesuai. |
| HAZ-02 | Report kedaluwarsa | Tidak ditampilkan sebagai bahaya aktif. |
| HAZ-03 | Spam report berulang | Rate limit atau langkah mitigasi diterapkan. |
| CHAT-01 | Anggota mengirim pesan | Pesan tersimpan dan diterima anggota yang berwenang. |
| CHAT-02 | Non-member membaca/mengirim melalui API | Ditolak oleh RLS/server. |
| CHAT-03 | Retry request yang sama | Tidak membuat duplicate bila idempotency tersedia. |
| NOTIF-01 | Device token berubah | Token diperbarui; token lama bisa dibersihkan. |
| NOTIF-02 | User menolak push permission | App tetap usable; preferensi/state ditangani dengan baik. |
| VOICE-01 | Non-member meminta token PTT | Backend menolak. (P2) |
| VOICE-02 | User mute/disconnect | Indikator audio benar; publish audio berhenti. (P2) |
| MUSIC-01 | File tidak diizinkan/tidak tersedia | Error yang jelas; tidak meminta izin berlebihan. (P2) |

## 4. Realtime dan jaringan

- Mulai ride pada satu perangkat, join peserta lain, verifikasi koneksi sukses.
- Matikan data selama 30–60 detik, lalu nyalakan kembali.
- Simulasikan reconnect/duplicate events dan pastikan UI idempotent.
- Gunakan latency tinggi dan packet loss; status harus jujur dan mudah dibaca.
- Periksa `CHANNEL_ERROR`, timeout, dan subscribe status. Jangan menganggap channel live tanpa status sukses.
- Pesan chat tersimpan tetap dapat dimuat ulang walaupun event realtime terlewat.
- Posisi awal setelah reconnect dibedakan dari update live yang baru.

## 5. Background location & baterai

- Mulai ride lalu minimalkan aplikasi; screen off; periksa updates sesuai dukungan OS.
- Coba vendor berbeda dan battery saver.
- Cabut permission dari Settings ketika ride aktif; pastikan tracking berhenti dan UI memberi status.
- Force stop/terminate app; verifikasi perilaku yang sebenarnya didukung OS dan jangan menjanjikan resume otomatis.
- Ukur baterai selama 30–60 menit pada skenario perjalanan dan bandingkan interval update.
- Uji ketika user berada di area GPS lemah/di antara gedung.
- Pastikan notifikasi foreground service, apabila diaktifkan, menerangkan aktivitas lokasi dengan benar.

## 6. Peta dan hazard

- Marker bergerak tanpa membuat seluruh list/layar rerender setiap event.
- Laporan dengan expiry berbeda tersaring benar.
- Koordinat invalid ditolak.
- Tidak ada marker `live` untuk timestamp stale.
- API key tiles dibatasi sesuai konfigurasi provider; penggunaan quota/error terlihat oleh developer.
- Attribution dan cache mengikuti ketentuan lisensi tiles.

## 7. Security testing

- Jalankan RLS negative test pada tabel exposed.
- Tes access lintas user/club/ride.
- Coba direct REST query, Realtime subscribe, direct storage URL, IDOR dengan mengganti UUID, dan token expired.
- Cek build bundle/JS source map untuk service role/API secrets.
- Coba upload tipe/file ukuran tidak valid.
- Coba payload berisi script/HTML di post/chat; tampilan tidak boleh mengeksekusinya.
- Pastikan logs tidak berisi secret, plat pribadi, isi pesan sensitif, atau koordinat presisi tanpa alasan.

## 8. Release blocker severity tinggi

Jangan rilis jika ditemukan salah satu:

- Non-member membaca lokasi, chat, private club, atau media privat.
- Tracking tetap berjalan setelah sharing dihentikan atau consent tidak diberikan.
- Marker menampilkan lokasi lama sebagai live.
- Service-role/private key ada di client.
- User dapat mengubah role/ownership melalui payload client.
- App crash berulang pada alur ride inti.
- Permission request menyesatkan pengguna atau kontrol stop-sharing tidak berfungsi.
- Peringatan bahaya kedaluwarsa masih tampil sebagai aktif tanpa indikator.

## 9. Status otomatisasi dan verifikasi (Milestone 1 + 1.5)

Istilah status yang dipakai: **Implemented**, **Passed locally**, **Passed against dev backend**,
**Tested on physical device**, **Blocked**.

Yang **sudah otomatis** (`npm test`, jaringan dimatikan; client Supabase diganti fake di `src/test-support/fakeSupabase.ts`):

| Berkas | Cakupan |
|---|---|
| `src/features/auth/__tests__/validation.test.ts` | Email, kata sandi, konfirmasi kata sandi, kebijakan password. |
| `src/features/profile/__tests__/validation.test.ts` | Username (format, panjang, normalisasi), display name, bio, kota. |
| `src/features/auth/__tests__/errors.test.ts` | Pemetaan error Supabase → pesan Bahasa Indonesia, termasuk jaringan dan konfigurasi belum ada. |
| `src/features/auth/__tests__/linkParams.test.ts` | Parser tautan email: `code` di query, `access_token` di fragment, tautan rusak/kedaluwarsa. |
| `src/features/auth/__tests__/api.test.ts` | Registrasi, login, logout, reset, resend; termasuk penolakan saat konfigurasi kosong. |
| `src/features/profile/__tests__/api.test.ts` | Baca dan ubah profil; kasus profil belum ada dan sesi tidak valid. |
| `src/features/auth/__tests__/session.test.tsx` | State `loading`/`ready`, perubahan session, pembersihan saat logout. |
| `src/lib/__tests__/supabaseClient.test.ts` | Konfigurasi auth client (PKCE, persist session, satu instance) dan lifecycle auto-refresh mengikuti `AppState` (aktif, background, perpindahan status, pembersihan listener, promise yang gagal). |
| `src/__tests__/navigation.test.tsx` | Rute asli: gerbang awal, alur auth, area privat, dan tidak ada redirect loop. |
| `src/features/garage/__tests__/*.test.ts` | Validasi kendaraan (selaras CHECK constraint) dan API garasi: tambah, ubah, jadikan utama, hapus, pemetaan galat. |
| `src/features/clubs/__tests__/*.test.ts` | Validasi klub, jelajah/buat klub, dan alur keanggotaan lewat RPC (ajukan, batalkan, tinjau, peran, keluarkan, keluar). |
| `src/components/ui/__tests__/*` | Perilaku dasar komponen yang dipakai form (tombol, field). |

Hasil terakhir dijalankan (16 Oktober 2026, Node 24.18, commit `a9858a9`, setelah `npm ci`):
`npm test -- --ci` → **20 suite, 222 test lulus**; `npm run test:scripts` → **172 test lulus**;
`npm run deps:check`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run doctor`
(21/21), dan `npm run export:android` semuanya exit 0.

Yang **sudah diverifikasi terhadap dev backend** (13 Oktober 2026, project development khusus
RodaKawan — ADR-035; diperluas pada Milestone 1.6):

- `supabase/tests/rls_profiles_test.sql` — `npm run db:test` mencetak notice `UJI RLS PROFIL LULUS`
  (**120 perintah**, exit 0) pada database development yang memuat kedelapan migration; dijalankan
  ulang 16 Oktober 2026 dengan hasil yang sama.
  - **Profil — PROF-01…PROF-05.** Bootstrap trigger membuat profil dengan username yang dinormalkan,
    A tidak dapat membaca profil privat B maupun mengubah baris B (0 baris, `INSERT` ditolak),
    username duplikat ditolak unique constraint, format salah ditolak CHECK, `anon` tidak melihat
    baris apa pun, kontrol positif profil publik, dan `DELETE` profil sendiri ditolak.
  - **Privasi follow — PROF-08, PROF-09.** A membuat permintaan follow ke profil privat B → status
    `pending` (nilai `accepted` yang dikirim klien ditimpa server) dan **A tetap membaca 0 baris**;
    A tidak dapat menerima permintaannya sendiri; B melihat permintaan, menerimanya (setelah itu A
    membaca 1 baris), dan menolaknya lewat `DELETE` (akses hilang kembali); tidak ada policy `UPDATE`
    sehingga `UPDATE` langsung selalu 0 baris; `anon` tidak melihat dan tidak dapat membuat baris.
  - **Detail privat kendaraan — GAR-03.** A dapat membuat dan mengubah detail privat kendaraannya
    sendiri; B membaca 0 baris dan mengubah 0 baris milik A; B gagal membuat baris untuk kendaraan A
    (ditolak policy, dan jalur lain ditolak foreign key komposit); A gagal memindahkan `motorcycle_id`
    ke kendaraan B — ditolak policy `with check` (SQLSTATE 42501) dan barisnya tidak berubah.
  - **Paritas skema.** Blok pertama berkas uji gagal dengan pesan eksplisit bila migration Milestone
    1.6 belum diterapkan (kolom `follows.status`, fungsi `accept_follow_request`, trigger
    `follows_set_status`, foreign key komposit, dan tidak adanya policy `UPDATE` pada `follows`).
  - **Garasi — GAR-04 (Milestone 2).** Hanya boleh ada satu kendaraan utama per pengguna
    (partial unique index `motorcycles_single_primary_idx` + trigger penjaga), termasuk saat
    kendaraan utama dihapus atau dipindahkan.
  - **Klub — CLUB-01…CLUB-10 (Milestone 2).** Pembuatan klub menjadikan pembuatnya owner dan slug
    bentrok ditolak; non-anggota tidak membaca klub privat; anggota `pending` tidak dapat menyetujui
    dirinya sendiri; klub `invite_only` menolak pengajuan; owner terakhir tidak bisa diturunkan atau
    dikeluarkan; hanya owner yang mengubah peran; pengguna tak dikenal ditolak `P0002`; owner wajib
    mengalihkan kepemilikan sebelum keluar (`23514`); pengeluaran anggota non-aktif ditolak (`22023`);
    anggota yang dikeluarkan **langsung kehilangan akses** dan harus mengajukan ulang, begitu pula
    pembuat klub yang sudah bukan anggota (temuan keamanan yang ditutup); permintaan bisa
    dibatalkan/diajukan ulang tanpa baris ganda; jejak `club_role_audit` mencatat 19 perubahan dan
    **tidak bisa dibaca anggota biasa**; dan `anon` ditolak pada seluruh EXECUTE RPC klub.
- Demonstrasi sebelum/sesudah pada project development (satu transaksi `ROLLBACK`, tidak meninggalkan
data): dengan policy **lama**, A membuat relasi follow sendiri lalu membaca profil privat B → **1
baris terbaca** (kerentanan nyata, bukan teoretis); dengan policy **baru**, percobaan yang sama → **0
baris**, penerimaan oleh A sendiri → `false`, dan setelah B (pemilik) menerima → 1 baris.

Yang **masih Blocked** (butuh perangkat / alur aplikasi / akun):

- PROF-06 — sisi database sudah tertutup oleh uji RLS, tetapi state "profil belum ada" di aplikasi
  belum diuji di perangkat.
- AUTH-01 dan AUTH-04 s.d. AUTH-14 — butuh alur aplikasi terhadap backend dan/atau perangkat.
- PROF-07 — butuh sesi nyata yang kedaluwarsa.
- Job `database-rls` pada CI — belum pernah berjalan; job ini hanya aktif lewat `workflow_dispatch`
  dengan input `run_db_tests` dan secret `DB_TEST_DATABASE_URL` yang belum diatur. Job `quality`
  diamati **hijau** di GitHub pada commit yang berlaku (run `38857101603`, `a9858a9`, 16 Oktober 2026),
  setelah run `38855099318` gagal di langkah `Expo doctor` karena drift patch `expo`/`expo-router`.
- Alur follow dari **aplikasi** (kirim permintaan, terima permintaan) belum ada; yang terbukti baru
  aturan dan fungsi di database.
- **GAR-01…GAR-04 dan CLUB-01…CLUB-10 lewat aplikasi di perangkat fisik** — butuh APK dari commit
  Milestone 2 (`cf818be`/`a9858a9`) dan dua akun nyata. Aturan di database sudah lulus; yang belum
  dibuktikan adalah alur layarnya (bagian 5 `docs/MILESTONE_2_REPORT.md` memuat checklist-nya).
- **Unggah foto kendaraan dan logo klub — tidak ada yang bisa diuji.** Supabase Storage sengaja belum
  disiapkan (0 bucket, 0 policy di project development) dan tidak ada tombol unggah, jadi statusnya
  **belum diimplementasikan**, bukan gagal.

Aturan pelaporan: jangan mencatat AUTH/PROF sebagai lulus pada tabel di atas bila hanya test lokal yang
dijalankan. Tandai "lulus (unit)" atau "belum dijalankan". Runner `db:test` hanya melaporkan lulus bila
notice penanda dari server diterima, jadi berkas uji yang terpotong tidak bisa menghasilkan "hijau".

## 10. Sign-off

Catat versi APK, commit SHA, device model/Android version, jaringan, tester, hasil test, screenshot/video bug bila aman, severity, dan status regresi. Jangan menyertakan data lokasi personal pada bukti uji.
