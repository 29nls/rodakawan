# QA Test Plan

## 1. Lapisan pengujian

1. **Unit:** validators, state transitions, expiry rules, parser payloads, permissions state mapping.
2. **Integration:** Supabase query/service, Edge Function auth, storage policies, push token registration.
3. **Security/RLS:** allow + deny matrix dengan minimal dua user dan role berbeda.
4. **E2E:** onboarding → klub → ride → tracking → hazard/chat → end ride.
5. **Device/manual:** background location, GPS, screen lock, battery saver, Bluetooth, low memory, different Android vendors.
6. **Release smoke:** install APK, login, critical actions, rollback/error behavior, privacy/settings.

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
| GAR-01 | User lain membuka garage publik | Hanya field yang diizinkan terlihat. |
| GAR-02 | User lain membaca plat pribadi | Ditolak tanpa kebocoran payload. |
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
| `src/components/ui/__tests__/*` | Perilaku dasar komponen yang dipakai form (tombol, field). |

Hasil terakhir dijalankan (13 Oktober 2026, Node 24.18): `npm test -- --ci` → **15 suite, 164 test
lulus**; `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run doctor` (21/21), dan
`npm run export:android` semuanya exit 0.

Yang **sudah diverifikasi terhadap dev backend** (13 Oktober 2026, project development khusus
RodaKawan — ADR-035):

- `supabase/tests/rls_profiles_test.sql` — `npm run db:test` mencetak notice `UJI RLS PROFIL LULUS`
  (38 perintah, exit 0). Yang dibuktikan di sisi database: bootstrap trigger membuat profil dengan
  username yang dinormalkan, user A tidak dapat membaca profil privat user B maupun mengubah barisnya
  (0 baris terpengaruh, `INSERT` ditolak), username duplikat ditolak unique constraint, format salah
  ditolak CHECK, peran `anon` tidak melihat baris apa pun, kontrol positif (profil publik user B
  memang terbaca user A), dan `DELETE` profil sendiri ditolak. **PROF-01, PROF-02, PROF-03, PROF-04,
  PROF-05.**

Yang **masih Blocked** (butuh perangkat / alur aplikasi / akun):

- PROF-06 — sisi database sudah tertutup oleh uji RLS, tetapi state "profil belum ada" di aplikasi
  belum diuji di perangkat.
- AUTH-01 dan AUTH-04 s.d. AUTH-14 — butuh alur aplikasi terhadap backend dan/atau perangkat.
- PROF-07 — butuh sesi nyata yang kedaluwarsa.
- Job `database-rls` pada CI — butuh secret `DB_TEST_DATABASE_URL` dan run pertama di GitHub.

Aturan pelaporan: jangan mencatat AUTH/PROF sebagai lulus pada tabel di atas bila hanya test lokal yang
dijalankan. Tandai "lulus (unit)" atau "belum dijalankan". Runner `db:test` hanya melaporkan lulus bila
notice penanda dari server diterima, jadi berkas uji yang terpotong tidak bisa menghasilkan "hijau".

## 10. Sign-off

Catat versi APK, commit SHA, device model/Android version, jaringan, tester, hasil test, screenshot/video bug bila aman, severity, dan status regresi. Jangan menyertakan data lokasi personal pada bukti uji.
