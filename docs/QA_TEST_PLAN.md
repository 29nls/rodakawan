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
| PROF-01 | User A mengubah profile User B lewat API | Ditolak oleh policy/server. |
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

## 9. Sign-off

Catat versi APK, commit SHA, device model/Android version, jaringan, tester, hasil test, screenshot/video bug bila aman, severity, dan status regresi. Jangan menyertakan data lokasi personal pada bukti uji.
