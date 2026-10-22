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
| PROF-10 | Unggah/ganti/hapus foto profil | Foto tampil dari signed URL di tab Profil; user B tidak bisa membaca atau menulis objek itu; foto lama hilang setelah diganti; kolom `avatar_url` kosong setelah dihapus; pengguna lain tidak melihat avatar tersebut. |
| GAR-01 | User lain membuka garage publik | Hanya field yang diizinkan terlihat. |
| GAR-02 | User lain membaca plat pribadi | Ditolak tanpa kebocoran payload. |
| GAR-03 | User A membuat/mengubah detail privat untuk kendaraan User B | Ditolak policy dan foreign key komposit, termasuk ketika `motorcycle_id` diubah. |
| GAR-05 | Unggah/ganti/hapus foto kendaraan | Foto tampil dari signed URL; user B tidak bisa membaca/menghapus objek yang sama; foto lama hilang setelah diganti; kolom `photo_path` kosong setelah dihapus; objek yang tidak lagi dirujuk baris mana pun hilang dari bucket setelah garasi dibuka lagi (sapuan latar belakang, tenggang 1 jam). |
| CLUB-01 | Buat klub | Creator menjadi owner; data valid. |
| CLUB-02 | Non-member membaca klub privat | Ditolak atau hanya metadata minimum sesuai aturan final. |
| CLUB-03 | Member biasa mengubah role anggota | Ditolak. |
| CLUB-12 | Buka dashboard admin klub dari detail klub | Tombol hanya tampil untuk owner/admin; anggota biasa dan non-anggota yang membuka `/club-admin` melihat state "Bukan admin klub", bukan data keanggotaan. |
| CLUB-13 | Ubah nama, deskripsi, visibilitas, dan cara bergabung | Tersimpan lewat service klub; slug tetap sehingga tautan lama masih bekerja; perubahan terlihat setelah reload. |
| CLUB-14 | Setujui atau tolak permintaan bergabung | Status keanggotaan berubah; persetujuan memberi akses, penolakan tetap ada dan terlihat saat filter status mencakup riwayat. |
| CLUB-15 | Ubah peran atau keluarkan anggota | Owner dapat menaikkan/menurunkan peran dan mengeluarkan anggota; mencabut akses data klub; owner terakhir ditolak database. |
| CLUB-11 | Unggah/ganti/hapus logo klub | Owner/admin berhasil; member biasa dan non-anggota ditolak; logo klub privat tidak terbaca non-anggota; logo klub publik tetap terlihat. |
| CLUB-16 | Cari, filter, dan paginasi daftar anggota | Pencarian mencocokkan user ID/peran/status tanpa membedakan huruf besar-kecil; filter status dan peran dapat digabung; hasil dipotong 5 baris per halaman dan nomor halaman dijepit setelah anggota disetujui/dikeluarkan. |
| RIDE-01 | Creator membuat ride dari klub aktif | Ride `planned`, pembuat otomatis `host/joined`, consent lokasi tetap `false`. |
| RIDE-02 | Host memulai / menyelesaikan / membatalkan | State hanya `planned→active→completed` atau `planned/active→cancelled`; `started_at`/`ended_at` diisi server. |
| RIDE-03 | Anggota biasa atau non-anggota memindahkan status | Ditolak RPC (`42501`), bukan hanya tombol yang disembunyikan. |
| RIDE-04 | Undangan `invite_only` | Undangan host berstatus `invited`; target menerima; `join_ride` langsung ditolak sebelum menerima. |
| RIDE-05 | Host mengeluarkan peserta | Status `removed`, lokasi peserta langsung hilang, akses baca lokasi hilang. |
| RIDE-06 | Host mencoba keluar sebelum final | Ditolak `23514`; host harus menyelesaikan/membatalkan dulu. |
| RIDE-07 | Ride final | Tidak bisa kembali `active`/`cancelled`; seluruh `ride_locations` terhapus dan consent dimatikan. |
| RIDE-08 | REST langsung ke `ride_locations` | `INSERT`/`UPDATE` ditolak karena grant dicabut; hanya RPC `publish_ride_location` yang sah. |
| LOC-01 | Peserta memberi izin foreground lalu menyalakan sharing | Consent database aktif, task berjalan, peserta lain melihat posisi + timestamp. |
| LOC-02 | Permission lokasi ditolak | UI menjelaskan akibatnya, consent tidak dinyalakan, pelacakan tidak dimulai, tetapi peserta tetap bisa ikut ride. |
| LOC-03 | GPS dimatikan / tidak ada fix | UI menyatakan lokasi belum tersedia; tidak memakai koordinat lama sebagai live. |
| LOC-04 | Tidak ada update >60 detik | Label berubah menjadi “Basi” dengan waktu pembaruan terakhir. |
| LOC-05 | Pengguna stop sharing | Task berhenti, RPC consent `false`, baris lokasi pengguna terhapus, status peserta berubah. |
| LOC-06 | Peserta keluar / ride selesai | Task berhenti, server menolak update berikutnya, baris lokasi dihapus, langganan tidak lagi menerima baris. |
| LOC-07 | Payload mengklaim `user_id` peserta lain | Tidak mungkin lewat RPC (server memakai `auth.uid()`); REST langsung ditolak grant. |
| LOC-08 | Koordinat di luar rentang / timestamp masa depan / fix basi | Ditolak `publish_ride_location` dengan `22023`; tidak ada baris yang tersimpan. |
| LOC-09 | Izin background ditolak setelah foreground | Foreground tetap berjalan; UI menyatakan pembaruan berhenti saat aplikasi ditutup, bukan mengklaim background aktif. |
| LOC-10 | Aplikasi di background, mode pesawat, force-stop, reboot | Catat perilaku nyata per perangkat; aplikasi tidak boleh mengklaim pelacakan tanpa jeda saat task mati. |
| HAZ-01 | Buat laporan valid | Report terlihat pada peta/list untuk audience yang sesuai. |
| HAZ-02 | Report kedaluwarsa | Tidak ditampilkan sebagai bahaya aktif. |
| HAZ-03 | Spam report berulang | Rate limit atau langkah mitigasi diterapkan. |
| CHAT-01 | Anggota mengirim pesan | Pesan tersimpan dan diterima anggota yang berwenang. |
| CHAT-02 | Non-member membaca/mengirim melalui API | Ditolak oleh RLS/server. |
| CHAT-03 | Retry request yang sama | Tidak membuat duplicate bila idempotency tersedia. |
| ACC-01 | Pemilik memanggil hapus akun | Profil dianonimkan (`deleted_at` terisi), username/nama/avatar/bio/kota kosong atau anonim; akun keluar dan diarahkan ke halaman masuk. |
| ACC-02 | Panggilan hapus akun diulang | Tidak ada perubahan kedua dan tidak ada galat: RPC mengembalikan sukses tanpa menyentuh baris lagi (idempoten). |
| ACC-03 | Pengguna B memanggil hapus akun untuk akun A | Tidak mungkin lewat RPC (identitas dari `auth.uid()`); `anon` ditolak. |
| ACC-04 | Setelah akun dihapus | Profil tidak lagi terbaca (termasuk oleh dirinya), follow/blokir/kendaraan/token push/posisi terakhir hilang, laporan bahaya dan pesan konvoi tetap ada tanpa identitas. |
| ACC-05 | Sebagian objek Storage gagal dihapus | Layar menyatakan sebagian foto akan dibersihkan pengelola; akun tetap terhapus dan tidak ada klaim "semua foto terhapus". |
| ACC-06 | Buka `/privacy` tanpa sesi | Retensi per jenis data, apa yang tidak dibagikan, dan kontak dukungan terbaca; tidak ada data pribadi atau kredensial di halaman. |
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
- **Pagar policy otomatis (SEC-01):** `npm run db:test` menjalankan
  `supabase/tests/rls_policy_guard_test.sql`, yang menolak policy pada tabel wadah
  (`club_id`/`ride_id`) yang memberi akses lewat kolom kepemilikan (`created_by`, `author_id`,
  `owner_id`, `user_id`, `sender_id`, …) tanpa penjaga keanggotaan. Pengecualian harus tertulis
  beserta alasannya dan ikut diperiksa anti-usang. Berjalan di CI `database-rls` setiap kali
  `supabase/**`, `scripts/db-test.mjs`, atau tipe database berubah.
- **Pagar literal UUID (SEC-02):** `npm run db:test:lint` memindai berkas uji SQL untuk
  literal teks yang diberikan ke parameter bertipe `uuid` — kelas galat yang ditolak
  PostgreSQL dengan SQLSTATE 22P02 tepat saat pemanggilan, jadi satu ketiksepele bisa
  menghentikan seluruh berkas uji. Pemeriksaan ini **statis**: membaca tanda tangan fungsi
  dari `supabase/migrations/*.sql` tanpa membuka koneksi, sehingga bisa berjalan di job CI
  yang tanpa secret dan juga sebagai pra-syarat `npm run db:test` sebelum transaksi
  pertama dibuka (ADR-069).
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

## 8a. Status otomatisasi dan verifikasi (Milestone 4)

Ditambahkan 21 Oktober 2026. Status yang dipakai sama dengan bagian 9, ditambah **Deferred by owner**.

| Area | Implemented | Passed locally | Dev backend | Perangkat fisik |
| --- | --- | --- | --- | --- |
| Hazard: RPC + expiry server + idempotensi + rate limit + duplikat | Ya | Ya (29 test) | **Lulus** — Database RLS #19 (SQL RLS/RPC) | — |
| Hazard: tab Peringatan (filter, form, ubah/lepas, konfirmasi, lapor) | Ya | Ya (6 test layar) | **Blocked** | **Blocked** |
| Chat: RPC + keyset pagination + pesan sistem + realtime | Ya | Ya (24 test API + 9 test panel) | **Lulus untuk RPC/paginasi** (Database RLS #19); pengiriman realtime belum diuji | **Blocked** |
| Chat: pesan teks dari pengguna yang diblokir disaring di server (REST + realtime) | Ya (policy `chat_select_ride_member` + `is_blocked_by_me`) | Ya (tidak ada daftar blokir di klien) | **Lulus** — Database RLS #19 (`UJI FILTER BLOKIR CHAT LULUS`) | **Blocked** |
| Moderasi: layanan antrean/aksi/audit + layar dashboard | Ya (16 test layanan + 8 test layar) | Ya | **Lulus untuk RPC/policy** (Database RLS #19); alur dua akun nyata belum diuji | **Blocked** |
| Uji RLS/RPC SQL M4 (hazard, chat, moderasi, filter blokir) | Ya (4 berkas, ada di `DEFAULT_TEST_FILES`) | `db:test:lint` lulus | **Lulus** — Database RLS #19: 7 berkas, 7 lulus (22 Okt 2026) | — |
| Peta/marker hazard | **Deferred by owner** — ADR-064 masih Proposed | — | — | — |
| Uji M3 dua perangkat, izin dicabut, GPS mati, force-stop/reboot, baterai 30 menit | **Deferred by owner** — bukan lulus | — | — | **Blocked** |

Perintah yang benar-benar dijalankan pada 21 Oktober 2026: `npm run typecheck` (0), `npm run lint`
(0 setelah 430 galat CRLF diperbaiki), `npm run format:check` (0), `npm test -- --ci` (**43 suite /
483 test lulus**, termasuk 16 test layanan dan 8 test layar moderasi), `npm run test:scripts`
(**240 lulus**), `npm run export:android` (0), `npm run doctor` (gagal karena DNS `exp.host`),
`npm run db:test` (exit 1, `ECONNREFUSED`).

Diperbarui 22 Oktober 2026 (sore): password database development dirotasi dan `.env.db` diarahkan ke
**Session Pooler** (`aws-0-ap-southeast-1.pooler.supabase.com:5432`, user `postgres.xvmcpfkkveeaevfcvfug`)
— bukan lagi `localhost`. `npm run db:test` di mesin lokal kini **exit 0**: 7/7 berkas lulus dan seluruh
notice penanda diterima (`UJI RLS PROFIL LULUS`, `UJI POLICY OWNER-GUARD LULUS`, `UJI RLS PERJALANAN M3
LULUS`, `UJI RLS LAKUAN M4 LULUS`, `UJI RLS CHAT M4 LULUS`, `UJI MODERASI M4 LULUS`, `UJI FILTER BLOKIR
CHAT LULUS`). Jalur lokal dan **Database RLS run #19** di GitHub Actions karena itu sepakat; secret
`DB_TEST_DATABASE_URL` ikut diperbarui setelah rotasi. Bukti perangkat tetap terpisah dan belum ada —
lihat bagian 8d.
Pada 22 Oktober 2026 juga dijalankan ulang penuh: `npm test -- --ci` **0** (43 suite / 483 test),
`npm run test:scripts` **0** (71 suite / 318 test), `typecheck`/`lint`/`format:check` **0**,
`export:android` **0**. `db:types:check` ikut dijalankan ulang dan **exit 0** (tipe generated sama dengan
skema); `storage:test` **belum** dijalankan karena butuh kunci Storage project development.

Uji manual yang **belum** dilakukan dan tidak boleh dianggap lulus: dua perangkat pada chat yang sama,
realtime saat koneksi putus/nyambung ulang, izin lokasi ditolak saat melapor, GPS mati, laporan
duplikat nyata dalam radius 50 m, dan alur moderasi dengan dua akun nyata.### 8b. Uji manual dashboard moderasi (ADR-067)

Dengan tiga akun: **A** host perjalanan, **B** peserta yang melapor, **C** anggota biasa klub.

1. B mengirim pesan chat kasar di perjalanan A, lalu melaporkannya; B juga melaporkan satu laporan
   bahaya yang tertaut perjalanan A. Buka `Profil → Moderasi konten` sebagai A: kedua laporan tampil,
   lengkap dengan isi konten, alasan, dan nama pelapor.
2. Sebagai C, buka layar yang sama: **tidak ada** laporan yang tampil. Panggil RPC moderasi langsung
   dari REST/psql sebagai C: ditolak dengan `moderation_not_allowed`.
3. Sebagai A, tekan **Hapus konten** pada laporan chat → dialog konfirmasi dulu → setelah konfirmasi,
   pesan hilang dari chat (placeholder “Pesan dihapus”) dan laporan hilang dari antrean.
4. Periksa **Jejak aksi terakhir**: tercatat “Konten dihapus”, jenis konten, alasan laporan, waktu,
   dan catatan (bila diisi). Baris audit yang sama tidak bertambah saat aksi diulang.
5. Sebagai A, tekan **Abaikan laporan** pada laporan hazard → hazard tetap tampil di tab Peringatan,
   laporan hilang dari antrean, dan audit mencatat “Laporan diabaikan”.
6. Sebagai admin klub yang **bukan** peserta perjalanan, buka antrean: laporan chat tetap bisa dibaca
   isinya lewat `get_moderation_subject`, tetapi riwayat chat lengkap tidak terbuka di detail perjalanan.
7. Putuskan jaringan saat menekan **Hapus konten**: layar menampilkan galat, status laporan tidak
   berubah, dan setelah jaringan kembali antrean bisa dimuat ulang tanpa data ganda.
8. Sebagai anon (tanpa sesi), panggil setiap RPC moderasi dan `list_moderation_actions`: ditolak.

### 8c. Uji manual filter blokir di server (ADR-068)

Dengan akun **A** (host), **B**, dan **C** di perjalanan yang sama, dan pesan teks dari B yang sudah ada:

1. Sebagai A, masukkan blokir ke B (`user_blocks`) lewat jalur admin/psql, lalu muat ulang chat: pesan
teks B **tidak muncul** dan tidak ada baris placeholder.
2. Inspeksi trafik (mis. proxy/dev tools): isi pesan B tidak ada di respons REST **maupun** payload
realtime. Ini inti perubahannya — sebelumnya isinya tetap terkirim.
3. Pesan sistem dari B (mis. “B bergabung”) tetap tampil untuk A.
4. Sebagai C, chat tetap menampilkan pesan teks B.
5. Sebagai B, pesan sendiri tetap terlihat (blokir tidak menyembunyikan pesan dari penulisnya).
6. Hapus blokir A, muat ulang chat: pesan B muncul kembali tanpa ada data yang ditulis ulang.

### 8d. Uji manual hazard dan chat (sisa M4)

Backend SQL-nya sudah lulus di Database RLS #19, jadi daftar ini **hanya** untuk perilaku aplikasi
yang tidak bisa dibuktikan runner database. Jalankan pada APK preview terbaru dengan dua akun
(**A** pelapor/host, **B** peserta lain) di satu perjalanan aktif.

**Laporan bahaya**

1. A membuat laporan dari tab Peringatan (satu per kategori, termasuk `pothole`) → laporan muncul di
daftar dengan kategori, tingkat, dan waktu kedaluwarsa; B melihat laporan yang sama.
2. A membuat laporan kedua dengan kategori dan lokasi yang sama dalam 10 menit → aplikasi
   menampilkan pesan "Laporan serupa baru saja dikirim", bukan galat mentah, dan **tidak** ada baris
ganda di daftar.
3. A mengirim lima laporan berbeda dalam 10 menit lalu laporan keenam → pesan batas laju muncul dan
   laporan keenam tidak tersimpan; setelah ~10 menit percobaan berikutnya berhasil.
4. A mengubah deskripsi/tingkat laporannya dalam 15 menit → perubahan terlihat oleh B setelah muat
   ulang; percobaan setelah 15 menit ditolak dengan pesan yang bisa dipahami.
5. B menekan konfirmasi "masih ada" → jumlah konfirmasi bertambah satu; menekan lagi tidak menambah
   (satu konfirmasi per pengguna).
6. A melepas laporannya → laporan hilang dari daftar aktif B setelah muat ulang, dan tidak muncul
   sebagai bahaya aktif.
7. Biarkan satu laporan `pothole` melewati 24 jam (atau pakai laporan yang dibuat kemarin) → tidak
tampil sebagai aktif; bila UI menampilkan riwayat, statusnya jelas kedaluwarsa.
8. Tolak izin lokasi saat membuka form laporan → form menjelaskan akibatnya dan tidak mengirim
   koordinat 0,0.

**Chat konvoi**

9. A mengirim pesan → B menerimanya tanpa muat ulang (realtime), dan pesan tetap ada setelah aplikasi
ditutup lalu dibuka lagi.
10. Gulir ke atas sampai lebih dari satu halaman → halaman sebelumnya dimuat tanpa duplikat dan tanpa
    lompatan posisi (keyset pagination).
11. Kirim pesan saat mode pesawat, lalu nyalakan jaringan dan coba lagi → pesan terkirim **sekali**
    (idempotensi), tidak muncul dua kali.
12. A menyunting pesannya dalam jendela yang diizinkan → B melihat isi baru dengan penanda "diedit";
    percobaan setelah jendela habis ditolak dengan pesan, bukan gagal diam-diam.
13. A menghapus pesannya → B melihat placeholder "Pesan dihapus", bukan isi aslinya.
14. B keluar dari perjalanan (atau dikeluarkan host) lalu buka chat → isi chat tidak terbaca dan
    pengiriman ditolak; pesan sistem tentang kejadian itu tetap tampil bagi peserta yang masih sah.
15. Bukan peserta membuka detail perjalanan dan memanggil API chat langsung → ditolak; aplikasi tidak
    menampilkan riwayat kosong yang menyesatkan.

Hasil yang tidak bisa dibuktikan tanpa perangkat tetap dicatat **Blocked**, bukan lulus. Untuk butir
backend (RLS/RPC) jangan mengulang pengujian yang sudah dicakup Database RLS #19.

### 8e. Status otomatisasi dan verifikasi (Milestone 5 — hapus akun)

Ditambahkan 23 Oktober 2026. Keputusan dan batas retensinya di ADR-076 dan
`docs/SECURITY_PRIVACY.md` bagian 8.4.

| Area | Implemented | Passed locally | Dev backend | Perangkat fisik |
| --- | --- | --- | --- | --- |
| RPC `delete_my_account()` (anonimisasi, idempoten, `security definer`, `search_path = ''`) | Ya | — | **Lulus** — `rls_account_delete_test.sql` (34 perintah, notice `UJI HAPUS AKUN LULUS`) | — |
| Uji RLS hapus akun di runner + workflow | Ya — `DEFAULT_TEST_FILES` dan pemeriksaan notice `database-rls.yml` | `db:test:lint` lulus (8 berkas uji, 19 migration) | **Lulus** — `npm run db:test` 8/8, exit 0 (23 Okt 2026) | — |
| Layanan klien (kumpulkan media, Storage API, RPC, pemetaan galat) | Ya (10 test) | Ya | **Tidak diuji HTTP dari perangkat** | — |
| Layar `/account-delete` + halaman `/privacy` | Ya (4 test layar) | Ya | **Blocked** | **Blocked** |
| Penghapusan `auth.users` dan pembersihan berkas yatim | **Belum** — tindakan operator, bukan SQL aplikasi | — | — | — |

Perintah yang dijalankan pada 23 Oktober 2026: `npm test -- --ci` **0** (45 suite / 497 test),
`npm run test:scripts` **0** (71 suite / 318 test), `npm run db:test` **0** (8/8 berkas),
`npm run db:types:check` **0** (skema development sama dengan tipe generated), `npm run storage:test`
**0** (27 langkah), `npm run db:test:lint` **0**, `typecheck`/`lint`/`format:check` **0**.

Uji manual yang **belum** dilakukan dan tidak boleh dianggap lulus: menekan tombol hapus di perangkat
nyata (termasuk saat jaringan putus di tengah proses), memastikan signed URL foto benar-benar mati
setelah akun dihapus, dan menghapus `auth.users` sebagai operator. Butir ACC-01..ACC-06 di bagian 3
adalah daftar periksa untuk itu.

## 9. Status otomatisasi dan verifikasi (Milestone 1–3)

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
| `src/features/rides/__tests__/*.test.ts` | Validasi perjalanan/jadwal, kebijakan sampling & kesegaran lokasi, API perjalanan (RPC, konsent, Postgres Changes tanpa `user_id` klien). |
| `src/__tests__/rides-list.test.tsx` | Tab Perjalanan: daftar nyata, status, keadaan kosong, dan aksi buat. |
| `src/__tests__/ride-detail.test.tsx` | Detail perjalanan: consent lokasi, penolakan izin, undangan, dan pembatasan non-anggota. |
| `src/features/map/__tests__/*.test.ts?(x)` | Lapisan peta: keadaan belum dikonfigurasi/renderer belum ada/siap, atribusi wajib per provider, marker hanya untuk peserta `joined`, region awal, dan tidak ada peta tanpa atribusi. |
| `src/__tests__/ride-new.test.tsx` | Formulir buat/ubah perjalanan: render & label aksesibilitas, validasi judul/klub/jadwal, payload `createRide`/`updateRide`, mode ubah (hanya host, hanya `planned`), pesan galat, retry, dan pencegahan kiriman ganda. |
| `src/components/ui/__tests__/*` | Perilaku dasar komponen yang dipakai form (tombol, field). |

Hasil terakhir dijalankan (19 Oktober 2026, Node 24.18.1, npm 12.0.2, setelah `npm ci` dari
`package-lock.json`):
`npm test -- --ci` → **35 suite, 386 test lulus** (20 Oktober 2026; termasuk suite perjalanan Milestone 3, 11 test komponen formulir perjalanan, 22 test lapisan peta, dan 2 test siklus task lokasi, 14 test kompresi foto, 18 test
pembersihan objek yatim, dan 17 test foto profil: 12 API + 5 komponen layar); `npm run test:scripts`
→ **240 test lulus, exit 0** (termasuk 4 test penjaga Milestone 3);
`npm run deps:check`, `npm run typecheck`, `npm run lint`, `npm run format:check`, dan
`npm run export:android` semuanya exit 0. `npm run doctor` **tidak dapat dipastikan**: 20 dari 21
pemeriksaan berjalan, pemeriksaan skema config gagal `EAI_AGAIN exp.host` karena DNS lingkungan ini
(dua percobaan). Riwayat sebelumnya: 23 suite/250 test dan 172 test script (17 Oktober 2026).

**Kegagalan Windows yang sudah diperbaiki (19 Oktober 2026).** Sebelumnya `npm run test:scripts`
melaporkan 228/229 (lalu 234/235) karena asersi baris pertama `CHANGELOG.md` membandingkan CRLF di
disk (`core.autocrlf=true`) dengan `HEADER` ber-LF. Perbaikannya **bukan** menonaktifkan asersi atau
mengubah `core.autocrlf`, melainkan menyeragamkan akhir baris di batas perbandingan
(`normalizeLineEndings`), ditambah test regresi untuk input LF/CRLF/CR dan test bahwa judul yang
diubah tetap ditolak (ADR-063). Versi sekarang (22 Oktober 2026): **318/318 lulus, 71 suite**
(termasuk 24 test gate rilis `should-release` di `scripts/__tests__/should-release.test.mjs` dan
empat penjaga
Milestone 3 di `scripts/__tests__/milestone-3.test.mjs`).

Yang **sudah diverifikasi terhadap dev backend** (13 Oktober 2026, project development khusus
RodaKawan — ADR-035; diperluas pada Milestone 1.6):

- `supabase/tests/rls_profiles_test.sql` — `npm run db:test` mencetak notice `UJI RLS PROFIL LULUS`
  (**171 perintah**, exit 0) pada database development yang memuat tiga belas migration; dijalankan
  ulang 19 Oktober 2026 dengan hasil yang sama (termasuk `rls_rides_test.sql`: 67 perintah).
- `supabase/tests/rls_policy_guard_test.sql` (SEC-01, 18 Oktober 2026) — notice
  `UJI POLICY OWNER-GUARD LULUS`, **17 perintah**, exit 0. Yang dibuktikan: **18 policy wadah**
  diperiksa dan tidak ada temuan kepemilikan tanpa penjaga di luar daftar pengecualian; detektornya
  **diuji-diri** dengan tabel probe (satu policy tanpa penjaga harus tertangkap, satu dengan penjaga
  tidak boleh) sehingga "nol temuan" tidak bisa berarti "detektor buta"; empat pengecualian
  (`chat_delete_own`, `ride_locations_delete_self`, dua policy hazard) diverifikasi masih
  diperlukan dan masih berbentuk sama (entri usang menggagalkan uji); dan keenam token penjaga
  (`is_club_member`, `is_club_admin`, `is_ride_member`, `is_ride_active_member`, `is_ride_host`,
  `can_publish_ride_location`) masih dipakai policy nyata. Jalur gagalnya juga terukur: saat
  pemeriksaan pertama dijalankan, dua policy hazard belum terdaftar dan runner **exit 1** dengan
  pesan yang menyebut `tabel.policy` dan ekspresi pelanggarannya.
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
  - **Storage foto dan foto profil — GAR-05 / CLUB-11 / PROF-10 (17–18 Oktober 2026).** Ketiga
    bucket privat dengan batas ukuran/MIME yang benar; A membaca/menghapus objek kendaraan dan foto
    profilnya sendiri tetapi tidak objek B; `INSERT` ke folder B dan ke folder sendiri dengan id
    kendaraan B ditolak RLS; logo klub publik terbaca non-anggota, logo klub privat hanya anggota,
    dan hanya owner/admin yang bisa menulis; `anon` tidak melihat objek apa pun; CHECK menolak
    `photo_path`/`logo_path`/`avatar_url` milik entitas lain.
  - **Storage lewat HTTP API (18 Oktober 2026).** `npm run storage:test` membuat dua akun uji
    sementara lewat SQL (tanpa service_role), sign-in lewat GoTrue password grant, lalu membuktikan
    pada API Storage yang sesungguhnya: A mengunggah foto kendaraannya (HTTP 200), signed URL dibaca
    tanpa token dan isinya identik (SHA-256), B ditolak saat mengunggah ke folder A, menautkan motor A
    ke foldernya sendiri, membuat signed URL, dan mengunduh objek A; `anon` juga ditolak; objek yang
    ditolak diverifikasi tidak terbentuk di database. Pola yang sama dibuktikan untuk foto profil
    (`avatars/<A>/uji-avatar.png`): A unggah/sign/hapus, B dan `anon` ditolak untuk unggah, sign,
    dan unduh. A kemudian menghapus objeknya lewat API sehingga signed URL baru untuk path itu
    ditolak. Runner selalu membersihkan (objek lewat Storage API, akun + baris turunan lewat
    `ON DELETE CASCADE`) dan memverifikasi nol sisa sebelum mencetak `UJI INTEGRASI STORAGE LULUS`
    (27 langkah, exit 0, idempotent).
  - **Pembersihan objek yatim — GAR-05 (18 Oktober 2026).** `src/features/media/photoCleanup.ts`
    diuji tanpa jaringan (18 test): fungsi murni `findOrphanPhotoPaths` menyimpan objek yang masih
    dirujuk, menghapus objek lama yang tidak dirujuk, **membiarkan** objek yang baru dibuat
    (< tenggang 1 jam) dan objek bertimestamp tak terbaca, membersihkan seluruh isi folder kendaraan
    yang barisnya sudah dihapus, membersihkan berkas yang tertinggal di akar folder pengguna,
    mengabaikan path di luar folder sesi, serta mengembalikan path terurut tanpa duplikat;
    `sweepOrphanVehiclePhotos` mengambil halaman berikutnya saat satu halaman penuh, menghapus semua
    yatim dalam satu panggilan `remove`, tidak memanggil `remove` bila tidak ada yatim, memetakan
    penolakan listing/remove sebagai error (tidak berpura-pura berhasil), dan tidak melempar saat
    klien tidak punya `storage` — sifat yang membuat pemanggil `void` di layar garasi aman.
    `cleanUpVehiclePhotosAfterDelete` membuktikan urutannya: objek kendaraan yang dihapus lebih dulu,
    lalu folder kendaraan itu disapu untuk sisa unggahan lama.
  - **Foto profil — PROF-10 (18 Oktober 2026).** 12 test unit di `photos.test.ts` dan 5 test komponen
    di `src/features/profile/__tests__/profile-avatar.test.tsx` (tombol unggah memakai `userId` sesi,
    batal memilih foto tidak memanggil backend, izin galeri ditolak ditampilkan sebagai pesan,
    hapus hanya lewat dialog konfirmasi, dan kegagalan unggah tidak tampil sebagai sukses) untuk
    `uploadProfileAvatar`/`deleteProfileAvatar`: path selalu `<user_id>/<berkas>`, unggahan ditolak
    sebelum menyentuh Storage bila baris profil belum ada, objek baru dibersihkan bila baris gagal
    diperbarui, objek lama dihapus setelah path baru tersimpan, penolakan Storage tidak menyentuh
    baris, foto persegi 4000 px diperkecil ke 512 px dengan format dipertahankan, dan penghapusan
    mengosongkan kolom sebelum menghapus objek (idempoten, dan nilai lama yang bukan path milik sesi
    tidak dipakai untuk menghapus objek). `isOwnProfileAvatarPath` menolak folder pengguna lain,
    URL lama, dan path tanpa nama berkas.
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

- Uji yang sama kini **juga berjalan di GitHub Actions**, bukan hanya di mesin developer:
  [`.github/workflows/database-rls.yml`](../.github/workflows/database-rls.yml) memicunya otomatis
  ketika file database berubah, memverifikasi connection string menunjuk project development
  sebelum menyentuhnya, lalu menolak lulus bila notice penanda dari server tidak diterima. Pada
  commit `749424c` run **#4** hijau: kedua notice diterima (171 + 17 perintah). Run **#3** pada
  `575b166` sempat gagal di langkah `gen types` yang tidak punya target; penyebab dan perbaikannya
  ada di ADR-061.

Yang **masih Blocked** (butuh perangkat / alur aplikasi / akun):

- PROF-06 — sisi database sudah tertutup oleh uji RLS, tetapi state "profil belum ada" di aplikasi
  belum diuji di perangkat.
- AUTH-01 dan AUTH-04 s.d. AUTH-14 — butuh alur aplikasi terhadap backend dan/atau perangkat.
- PROF-07 — butuh sesi nyata yang kedaluwarsa.
- Alur follow dari **aplikasi** (kirim permintaan, terima permintaan) belum ada; yang terbukti baru
  aturan dan fungsi di database.
- **RIDE-01…RIDE-08 dan LOC-01…LOC-08 — bukti per langkah di perangkat** masih Blocked untuk
  alur dua perangkat. Pemilik aplikasi melaporkan `v0.1.0-build23` dipakai tanpa galat yang teramati
  (**owner-reported**, tanpa rekaman per kasus); laporan itu tidak membuktikan alur dua akun, izin
  yang dicabut di tengah perjalanan, GPS mati/mode pesawat, force-stop/reboot, atau angka baterai.
  Yang sudah lulus otomatis: seluruh aturan RLS/RPC (`npm run db:test`, berkas
  `rls_rides_test.sql`) dan 47 test Jest fitur/layar perjalanan.
- **GAR-01…GAR-04 dan CLUB-01…CLUB-10 — bukti per langkah** masih Blocked, meskipun pemilik
  aplikasi melaporkan build sudah dicoba di HP tanpa error yang teramati (owner-reported, tanpa tag
  rilis/kasus uji per kasus). APK yang dimaksud: `fa4397e`, rilis `v0.1.0-build20`; baseline
  `749424c`/build19; APK terbaru sekarang `b0c8361`/`v0.1.0-build26` (build23 tetap yang dilaporkan
  pemilik). Aturan di database sudah lulus;
  yang belum terdokumentasi adalah bukti alur layarnya (bagian 5 `docs/MILESTONE_2_REPORT.md` memuat checklist-nya).
  Bukti tiap langkah direkam otomatis oleh `node scripts/device-checklist.mjs` (tangkapan layar,
  hierarki UI, logcat, identitas perangkat dan APK); penilaian langkah tetap dilakukan manusia.
- **GAR-05 / CLUB-11 lewat aplikasi di perangkat** — logika unggah/ganti/hapus, kompresi otomatis
  (14 test unit: batas dimensi + penghematan luas piksel, pemilihan format, ambang lewati, dan fallback),
  pembersihan objek yatim (18 test unit), policy Storage
  (`npm run db:test` bagian 13), serta jalur HTTP nyata (`npm run storage:test`) sudah lulus, tetapi
  alur galeri → perkecil → unggah → signed URL dari **perangkat fisik** belum dijalankan.
  `v0.1.0-build20` (dan build sesudahnya, termasuk `v0.1.0-build23`/`v0.1.0-build26`) **sudah memuat** modul native itu
  (build20 diperiksa langsung di `classes*.dex` dan bundel JS; dependency-nya tidak berubah sejak itu),
  jadi tidak perlu build baru hanya untuk mendapatkannya. Yang harus dibuktikan manual: izin galeri muncul hanya saat tombol ditekan, foto HEIC
  iPhone terkonversi/diterima, foto 12 MP benar-benar turun ukurannya sebelum diunggah (kuota
  Storage hemat) dan hasilnya tetap tajam — termasuk foto potret yang tinggi, foto PNG berlogo
  transparan yang tidak berubah menjadi latar hitam, EXIF lokasi tidak ikut terunggah, pesan batas
  ukuran hanya muncul bila kompresi gagal, foto lama hilang setelah ganti, dan akun kedua tidak bisa
  membuka foto kendaraan akun pertama.
- **PROF-10 lewat aplikasi di perangkat** — unggah/ganti/hapus foto profil dari tab Profil belum
  dijalankan di perangkat fisik (modul native yang sama sudah ada di `v0.1.0-build20`). Aturan bucket,
  kebijakan owner-only, dan jalur HTTP-nya sudah lulus (`npm run db:test` bagian 13 dan
  `npm run storage:test` langkah 15–23); yang perlu dibuktikan manual: foto dari galeri muncul di
  kartu setelah unggah, foto lama hilang dari bucket setelah diganti, tombol hapus bekerja,
  pratinjau tetap tampil setelah aplikasi dibuka ulang (signed URL baru), dan akun kedua tidak bisa
  membuka avatar akun pertama.

Aturan pelaporan: jangan mencatat AUTH/PROF sebagai lulus pada tabel di atas bila hanya test lokal yang
dijalankan. Tandai "lulus (unit)" atau "belum dijalankan". Runner `db:test` hanya melaporkan lulus bila
notice penanda dari server diterima, jadi berkas uji yang terpotong tidak bisa menghasilkan "hijau".

## 10. Sign-off

Catat versi APK, commit SHA, device model/Android version, jaringan, tester, hasil test, screenshot/video bug bila aman, severity, dan status regresi. Jangan menyertakan data lokasi personal pada bukti uji.
