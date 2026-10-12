# Product Requirements Document (PRD)

## RodaKawan — Aplikasi Pendamping Berkendara Komunitas

| Metadata | Nilai |
|---|---|
| Versi | 1.0 |
| Tanggal | 12 Oktober 2026 |
| Status | Draft untuk validasi |
| Platform rilis pertama | Android |
| Platform aplikasi | React Native + Expo + TypeScript |
| Backend awal | Supabase |
| Nama produk | RodaKawan (nama kerja, belum final) |

## 1. Ringkasan eksekutif

RodaKawan adalah aplikasi pendamping perjalanan kelompok untuk komunitas motor, klub sepeda, dan penggemar touring. Produk menggabungkan pelacakan lokasi anggota selama perjalanan, titik peringatan kondisi jalan, komunikasi grup, klub komunitas, profil kendaraan, feed sosial, notifikasi, voice room Push-To-Talk (PTT), dan pemutar musik lokal.

Nilai utama produk bukan sekadar peta atau media sosial. RodaKawan harus membantu rombongan **berkumpul, berangkat, tetap terhubung, mengetahui kondisi jalan, dan menutup perjalanan dengan jelas**, dengan pengaturan berbagi lokasi yang transparan dan interaksi yang meminimalkan gangguan ketika kendaraan bergerak.

PRD ini menyusun fitur menjadi fase yang dapat diuji. MVP yang disarankan berfokus pada akun, klub, perjalanan/konvoi, live location, laporan bahaya, dan chat. Voice PTT dan musik lokal masuk fase lanjutan karena integrasi audio native, background service, kompatibilitas headset, baterai, dan jaringan menambah kompleksitas.

## 2. Masalah dan peluang

### Masalah pengguna

1. Anggota rombongan mudah tertinggal atau salah belok ketika rute ramai atau tidak dikenal.
2. Informasi lubang, kecelakaan, kemacetan, cuaca, atau hambatan jalan terlambat menyebar di grup chat yang padat.
3. Koordinator perjalanan perlu mengelola peserta, titik kumpul, status anggota, dan perubahan rute dari banyak aplikasi terpisah.
4. Komunitas membutuhkan ruang untuk profil anggota dan kendaraan, agenda, dokumentasi perjalanan, dan interaksi sosial.
5. Pengguna menginginkan komunikasi suara yang praktis, tetapi desain tidak boleh mengasumsikan bahwa menyentuh layar saat berkendara aman.

### Pernyataan visi

Menjadi pendamping digital yang membantu komunitas berkendara melakukan perjalanan kelompok dengan lebih terorganisir, peka terhadap kondisi jalan, dan saling menjaga.

### Prinsip produk

- **Safety-first:** tidak mendorong pengguna membaca/mengetik saat kendaraan bergerak.
- **Explicit consent:** berbagi lokasi selalu terlihat statusnya, dibatasi pada perjalanan aktif, dan dapat dihentikan.
- **Useful offline/poor-network behavior:** tampilkan lokasi terakhir dan waktu pembaruannya, bukan menyamarkan data lama seolah live.
- **Community-led, abuse-aware:** fitur sosial memiliki blokir, laporan, dan moderasi.
- **Incremental delivery:** ukur manfaat perjalanan sebelum menambah fitur yang mahal atau berisiko.

## 3. Sasaran produk dan metrik

### Sasaran

- Membantu road captain melihat peserta yang masih terhubung selama konvoi.
- Mengurangi ketidakjelasan status anggota dan posisi terakhir yang diketahui.
- Mempercepat penyebaran laporan kondisi jalan yang relevan dan belum kedaluwarsa.
- Memberi komunitas ruang dasar untuk membuat klub dan menjadwalkan perjalanan.
- Menetapkan fondasi teknis aman untuk komunikasi suara dan fitur sosial lanjutan.

### Metrik awal (target untuk beta, bukan jaminan)

| Metrik | Definisi | Target awal |
|---|---|---|
| Keberhasilan mulai perjalanan | Perjalanan yang berhasil dimulai oleh pembuat perjalanan / percobaan mulai | ≥ 95% pada perangkat dan jaringan uji yang didukung |
| Waktu tampil posisi baru | Waktu dari update lokasi diterima server hingga muncul di perangkat peserta lain | p95 ≤ 5 detik pada jaringan stabil untuk fase uji |
| Kejelasan lokasi stale | Marker tidak diperbarui ditandai sebagai lokasi lama | 100% marker stale memiliki indikator waktu/status |
| Kebocoran lokasi | Akses oleh non-anggota pada pengujian RLS | 0 akses yang tidak berwenang |
| Pelaporan bahaya | Laporan valid bisa dibuat dan dilihat peserta berwenang | ≥ 95% pada pengujian aplikasi |
| Crash-free sessions | Sesi tanpa crash pada beta | ≥ 99% sebagai target awal setelah tersedia sampel memadai |
| Keberhasilan onboarding | Pengguna uji menyelesaikan daftar/masuk dan membuat profil | ≥ 80% dari peserta pengujian terarah |

Metrik ditinjau kembali setelah pilot. Jangan gunakan metrik ini sebagai klaim pemasaran sebelum memiliki data produksi.

## 4. Pengguna sasaran dan kebutuhan

### Persona A — Road Captain / koordinator

- Membuat perjalanan, menetapkan titik kumpul dan tujuan, memulai/mengakhiri perjalanan.
- Melihat daftar peserta, status berbagi lokasi, dan lokasi terakhir yang diketahui.
- Memastikan anggota yang keluar dari koneksi tidak keliru dianggap masih live.

### Persona B — Sweeper / pengawal belakang

- Memantau anggota yang tertinggal atau berhenti.
- Mengirim laporan bahaya yang ringkas.
- Memerlukan update posisi yang hemat baterai namun cukup berguna.

### Persona C — Rider peserta

- Bergabung dengan kode/link undangan.
- Melihat posisi anggota lain yang ikut dalam perjalanan yang sama.
- Mengirim chat atau laporan bahaya dengan sesedikit mungkin interaksi.
- Menghentikan berbagi lokasi dengan jelas saat keluar dari perjalanan.

### Persona D — Admin klub

- Mengelola profil klub, anggota, postingan, acara, dan aturan komunitas.
- Menangani laporan konten dan anggota sesuai wewenang.

### Persona E — Pengguna komunitas/sepeda

- Menemukan klub dan agenda, membuat profil, membagikan foto kegiatan.
- Pada fase awal, jenis kegiatan dapat menjadi atribut perjalanan; validasi dukungan khusus untuk klub sepeda dilakukan sebelum pemasaran lintas segmen.

## 5. Ruang lingkup

### MVP yang direkomendasikan (P0)

1. Registrasi/login dan profil pengguna.
2. Garasi kendaraan dengan informasi publik yang terpisah dari data sensitif.
3. Klub: buat/temukan klub, permintaan bergabung, anggota, dan peran.
4. Perjalanan/konvoi: buat perjalanan, atur titik kumpul/tujuan, gabung, peserta dan status perjalanan.
5. Live location saat perjalanan aktif, dengan permission foreground/background yang dijelaskan transparan.
6. Peta dengan marker posisi, waktu update terakhir, dan status koneksi.
7. Laporan kondisi jalan: lubang, kecelakaan, kemacetan, cuaca/bahaya, hambatan/operasi lalu lintas, serta kategori lain yang dapat dikonfigurasi. Semua laporan memiliki masa berlaku dan mekanisme laporan penyalahgunaan.
8. Chat teks per perjalanan.
9. Push notification minimum untuk undangan perjalanan dan perubahan status penting.
10. Privasi, blokir/lapor pengguna dasar, dan kontrol berbagi lokasi.

### Fase berikutnya (P1)

- Feed klub dan post foto.
- Like, komentar, follow/follow-back, daftar aktivitas.
- Agenda klub/kopdar, histori perjalanan ringkas dan statistik pribadi yang disetujui pengguna.
- Notifikasi sosial dan moderasi admin yang lebih lengkap.
- Peta rute dengan opsi penyedia tiles/routing yang diputuskan setelah analisis biaya, lisensi, dan kualitas cakupan.

### Fase lanjutan (P2)

- Voice room dan Push-To-Talk berbasis WebRTC.
- Optimalisasi audio untuk headset Bluetooth dan mode latar belakang.
- Pemutar musik file lokal dengan kontrol media sesuai dukungan Android.
- Fitur lanjutan: deteksi anggota tertinggal berbasis aturan yang transparan, ekspor perjalanan, dan integrasi pihak ketiga.

### Tidak termasuk dalam MVP

- Navigasi turn-by-turn milik sendiri setara aplikasi peta besar.
- Rekaman audio percakapan secara default.
- Pemantauan lokasi pengguna di luar perjalanan tanpa tindakan/izin yang jelas.
- Jaminan penyelamatan darurat, pelacakan GPS kelas perangkat khusus, atau akurasi GPS yang tidak mungkin dijamin aplikasi.
- Pembayaran, marketplace, asuransi, dan sistem reputasi berbayar.

## 6. Requirement fungsional

Prioritas: **P0** wajib MVP, **P1** fase berikutnya, **P2** lanjutan.

### FR-01 — Akun dan autentikasi (P0)

- Pengguna dapat membuat akun, masuk, keluar, dan memulihkan akses sesuai metode yang dipilih.
- Profil menampilkan nama, username unik, avatar opsional, bio opsional, dan kota opsional.
- Sistem mencegah user tanpa sesi mengakses data privat.
- Acceptance: sesi tetap valid setelah aplikasi dibuka ulang sesuai konfigurasi; logout membersihkan sesi lokal; kesalahan login tampil dalam bahasa yang mudah dipahami.

### FR-02 — Garasi kendaraan (P0)

- Pengguna dapat menambah, mengubah, menghapus, dan memilih kendaraan utama.
- Data yang dapat ditampilkan publik: merek, model, tahun, foto, dan deskripsi yang disetujui pemilik.
- Nomor polisi/plat disimpan di ruang data privat dan tidak pernah ikut ke payload profil publik secara default.
- Acceptance: profil pengunjung tidak mengungkap plat privat; pemilik dapat menghapus foto/kendaraan.

### FR-03 — Klub dan keanggotaan (P0)

- Pengguna dapat membuat klub, mencari klub publik, melihat detail, dan mengajukan/menyelesaikan keanggotaan sesuai aturan klub.
- Peran minimum: owner, admin, member.
- Klub privat tidak muncul sebagai konten terbuka dan detailnya tidak dapat dibaca non-anggota selain informasi minimum yang memang diizinkan.
- Acceptance: hanya admin/owner dapat mengubah pengaturan klub; perubahan peran dan penghapusan anggota dicatat pada audit log.

### FR-04 — Perjalanan/konvoi (P0)

- Creator mengatur judul, tanggal/waktu, titik kumpul, tujuan opsional, klub opsional, catatan, dan aturan bergabung.
- Status perjalanan: `planned`, `active`, `completed`, `cancelled`.
- Perjalanan tidak mengaktifkan tracking otomatis hanya karena dibuat; creator memulai perjalanan secara eksplisit.
- Peserta dapat bergabung/keluar. Pengelola dapat mengeluarkan peserta sesuai izin.
- Acceptance: hanya peserta aktif yang diotorisasi bisa melihat posisi dan chat perjalanan; setelah perjalanan selesai, live channel ditutup dan posisi berhenti dipublikasikan.

### FR-05 — Live location (P0)

- Peserta yang sudah bergabung dapat mengaktifkan sharing untuk perjalanan aktif setelah permission foreground diberikan; permission background diminta hanya bila diperlukan dan dijelaskan sebelum dialog sistem.
- Peta menampilkan marker, arah/heading jika tersedia, waktu update, dan status (live, terlambat, offline, location unavailable).
- Default usulan: ketika bergerak, kirim update sekitar setiap 5 detik atau setelah bergerak ~20 meter; saat diam kurangi frekuensi sekitar 15 detik. Angka ini wajib dikalibrasi dari uji lapangan dan konsumsi baterai.
- Data dipancarkan lewat private realtime channel yang hanya dapat diakses peserta sah. Simpan hanya posisi terakhir dan timestamp yang diperlukan; histori breadcrumb mati secara default.
- Pengguna dapat menghentikan sharing; sistem menangani permission ditolak, GPS mati, koneksi putus, dan aplikasi dihentikan.
- Acceptance: lokasi stale ditandai; non-anggota gagal membaca channel/row; selesai/keluar menghentikan update; jika sinyal pulih, UI menunjukkan waktu update nyata dan tidak menyamarkan gap.

### FR-06 — Road Warning Reports (P0)

- Pengguna dapat menandai lokasi dari GPS saat ini atau memilih titik pada peta, memilih kategori, menambahkan deskripsi opsional, dan tingkat urgensi.
- Kategori awal: lubang/kerusakan jalan, kecelakaan, kemacetan, genangan/cuaca/bahaya, hambatan jalan, operasi lalu lintas, dan lainnya.
- Laporan memiliki created_at, expires_at, status, reporter_id, lokasi, dan mekanisme konfirmasi/laporan penyalahgunaan.
- Masa berlaku awal berdasarkan kategori (dapat diubah server): kemacetan 45 menit; kecelakaan/bahaya aktif 2 jam; operasi lalu lintas 30–60 menit; lubang jalan 7 hari. Tampilkan bahwa informasi berasal dari komunitas dan bisa sudah berubah.
- Acceptance: laporan kedaluwarsa tidak ditampilkan sebagai aktif; pengguna dapat melaporkan konten keliru; input lokasi tidak dipaksa jika permission tidak tersedia.

### FR-07 — Convoy chat (P0)

- Percakapan teks terikat pada satu perjalanan, dengan nama, timestamp, dan status pengiriman yang sederhana.
- Pengguna dapat menampilkan instruksi/pesan sistem seperti perjalanan dimulai atau berakhir.
- Acceptance: hanya peserta berwenang yang dapat membaca/mengirim pesan; pesan baru masuk real-time; koneksi terputus memiliki status yang jelas; tidak ada klaim enkripsi end-to-end jika belum benar-benar diterapkan.
- Prinsip keselamatan: UI menyarankan berhenti di tempat aman sebelum membaca/mengetik pesan. Jangan munculkan keyboard otomatis ketika kendaraan bergerak.

### FR-08 — Feed, like, komentar, follow (P1)

- Member klub bisa membuat posting teks/foto sesuai izin klub; pengguna bisa memberi like, komentar, dan follow.
- Pengguna dapat memblokir akun dan melaporkan post/komentar.
- Acceptance: operasi like idempotent; pencegahan duplicate reaction; konten terblokir tidak ditampilkan kepada pengguna yang memblokir.

### FR-09 — Push notifications (P0/P1)

- MVP: undangan, permintaan bergabung, perjalanan akan dimulai/perubahan status yang penting.
- P1: like, komentar, follow, follow-back, agenda.
- Pengguna dapat mengatur kategori notifikasi dan menarik izin OS; notifikasi tidak berisi koordinat detail secara default di lock screen.
- Acceptance: token perangkat dapat diperbarui/dihapus; notifikasi duplikat diminimalkan; gagal kirim tidak menggagalkan transaksi utama.

### FR-10 — Voice room / PTT (P2)

- Anggota yang berwenang dapat masuk ke voice room perjalanan dan menekan/tahan tombol PTT untuk berbicara; indikator jelas saat mic aktif.
- Token room diterbitkan backend terautentikasi dan dibatasi ke ride/role yang sah; tidak boleh dibuat dengan secret di client.
- Harus dites dengan beberapa headset Bluetooth/helmet intercom, layar terkunci, perpindahan jaringan, audio focus, noise, dan izin mikrofon.
- Produk tidak boleh mengklaim hands-free universal atau latensi terjamin sebelum diuji pada perangkat nyata. Tombol PTT di layar bukan alasan untuk memegang ponsel saat berkendara.
- Acceptance: user dapat mute/disconnect, indikator mic akurat, anggota non-peserta ditolak, token tidak dapat dipakai untuk join room lain.

### FR-11 — Pemutar musik lokal (P2)

- Pengguna dapat memilih dan memutar file lokal yang memang dapat diakses melalui API media Android.
- Playback mempunyai kontrol play/pause/next bila didukung, menghormati audio focus, dan tidak otomatis mengalahkan audio PTT.
- Acceptance: permission media dijelaskan, tidak mengunggah file tanpa tindakan eksplisit, dan playback/background service diuji pada build produksi.

## 7. Alur pengguna utama

### Alur A — Membuat dan menjalankan touring

1. Login → buat profil.
2. Buat klub atau pilih klub yang diikuti.
3. Buat perjalanan → tentukan titik kumpul dan tujuan → bagikan undangan/kode.
4. Anggota bergabung dan membaca aturan perjalanan.
5. Saat siap berangkat, creator menekan **Mulai perjalanan**.
6. Setiap rider mengaktifkan berbagi lokasi setelah penjelasan permission.
7. Peta menampilkan lokasi anggota, status stale/offline, laporan bahaya dan chat.
8. Creator menekan **Akhiri perjalanan**; tracking dihentikan, status disimpan, dan sesi realtime ditutup.

### Alur B — Melaporkan kondisi jalan

1. Rider berhenti di tempat aman atau menggunakan interaksi hands-free yang benar-benar didukung.
2. Memilih kategori dan konfirmasi titik lokasi.
3. Server memvalidasi autentikasi, rate limit, koordinat, dan masa berlaku.
4. Laporan muncul untuk pengguna dengan akses yang sesuai.
5. Pengguna lain dapat mengonfirmasi atau melaporkan informasi yang salah.
6. Laporan hilang dari daftar aktif setelah kedaluwarsa/moderasi.

### Alur C — Keanggotaan klub

1. Pengguna mencari klub.
2. Untuk klub publik, bergabung sesuai aturan; klub privat mengirim permintaan.
3. Admin menyetujui/menolak permintaan.
4. Peran menentukan hak mengelola anggota, acara, dan konten.

## 8. Kebutuhan nonfungsional

| Area | Kebutuhan |
|---|---|
| Keamanan | RLS aktif pada semua tabel yang terekspos; secret hanya di backend; negative tests untuk akses non-anggota. |
| Privasi | Lokasi aktif hanya dalam trip; kontrol stop sharing terlihat; retensi minimal; kebijakan privasi dapat dibaca sebelum rilis. |
| Performa | Peta dan feed tidak merender ulang seluruh layar setiap update; daftar memakai virtualized list; gambar di-resize/cache. |
| Ketahanan jaringan | Reconnect channel, indikator koneksi, timestamp last-known, penanganan offline, retry dengan backoff. |
| Baterai | Tracking event-driven dengan interval adaptif; uji perjalanan nyata; berikan tombol akhiri yang mudah ditemukan. |
| Aksesibilitas | Kontras memadai, target sentuh besar, label screen reader, tidak mengandalkan warna saja untuk status. |
| Kompatibilitas | Versi Android minimum diputuskan setelah tes perangkat sasaran; uji berbagai vendor karena perilaku background berbeda. |
| Maintainability | TypeScript strict, modul per domain, schema migration versioned, lint/typecheck/test dijalankan sebelum merge. |
| Observability | Error log tanpa koordinat presisi yang tidak diperlukan, penanda versi aplikasi, dan pemantauan error network/native. |
| Bahasa | MVP Bahasa Indonesia; string UI tidak tersebar hard-coded di komponen jika memungkinkan. |

## 9. Keselamatan, privasi, dan batasan

- Sebelum minta izin lokasi, jelaskan alasan, kapan lokasi dibagikan, siapa yang bisa melihat, dan cara menghentikan.
- Sharing dimulai oleh peserta, tidak aktif diam-diam saat instalasi atau login.
- Tampilkan indikator tracking aktif persisten di layar perjalanan dan notifikasi foreground service bila platform mewajibkan.
- Saat peserta keluar/ride berakhir, hentikan update dan cabut akses channel.
- Tidak menyimpan sejarah rute secara default. Fitur histori masa depan harus opt-in dengan periode retensi yang jelas.
- Pisahkan nomor polisi atau atribut kendaraan privat dari data publik.
- Laporan kondisi jalan adalah informasi komunitas, bukan jaminan kebenaran. Sediakan timestamp, expiry, konfirmasi, pelaporan konten, dan moderasi.
- Jangan mendesain interaksi yang mengharuskan rider mengetik saat kendaraan melaju. Gunakan voice/hardware control hanya setelah uji kompatibilitas.
- Sediakan cara menghapus akun dan menghapus/menganonimkan data sesuai kebijakan yang ditetapkan sebelum peluncuran.

## 10. Dependensi dan risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| GPS tidak akurat/tidak tersedia | Marker meleset atau berhenti update | Tampilkan accuracy + last seen; filter lompatan tidak wajar; jangan klaim presisi mutlak. |
| Background execution dibatasi OS/vendor | Sharing terputus saat app di background | Development build; konfigurasi foreground service yang sesuai; panduan battery optimization; uji perangkat lapangan. |
| Jaringan tidak stabil | Live location/chat terlambat | Reconnect, stale indicator, antrean pesan yang aman, status pengiriman, update terakhir. |
| Biaya tiles/routing/audio meningkat | Beban biaya tak terduga | Tetapkan provider setelah pilot; cache sesuai lisensi; kuota/alert biaya; jangan gunakan demo tiles untuk produksi. |
| Voice PTT kompleks | Rilis terlambat, audio tidak bekerja pada headset | Isolasi proof-of-concept; uji kompatibilitas; gunakan SDK WebRTC khusus; tidak menghalangi rilis MVP. |
| Abuse pada report sosial | Informasi palsu, pelecehan | Expiry, rate limiting, report, blokir, trust signals tanpa mengandalkan reputasi tunggal. |
| Kebocoran lokasi/plat | Risiko keselamatan pribadi | Minimalisasi data, RLS, pemisahan data sensitif, negative tests, incident plan. |
| Ruang lingkup membesar | MVP tidak selesai | Fitur P2 tidak dimulai sebelum acceptance P0 lulus. |

## 11. Analytics dan event produk

Event disarankan: `signup_completed`, `profile_completed`, `club_created`, `club_join_requested`, `ride_created`, `ride_joined`, `ride_started`, `location_sharing_started`, `location_permission_denied`, `location_update_stale`, `hazard_report_created`, `chat_message_sent`, `ride_ended`, `location_sharing_stopped`, `ptt_room_joined` (fase P2).

Jangan memasukkan lintang/bujur presisi, plat nomor, isi pesan, atau rekaman audio ke analytics. Terapkan persetujuan dan aturan privasi untuk analytics sebelum instrumentasi produksi.

## 12. Acceptance criteria rilis beta

Rilis beta MVP hanya dapat dilanjutkan apabila:

- Alur akun, profil, klub, buat/gabung/perjalanan berfungsi pada perangkat target.
- Live location berhasil diuji pada foreground dan skenario background yang didukung, termasuk izin ditolak, GPS mati, jaringan hilang, dan app dihentikan.
- Semua marker menunjukkan waktu update; posisi lama tidak tampak live.
- Pengujian memastikan non-anggota tidak dapat membaca lokasi atau chat melalui API/Realtime.
- Road report kedaluwarsa sesuai aturan dan dapat dilaporkan sebagai penyalahgunaan.
- Chat membatasi akses berdasarkan anggota perjalanan.
- Kunci service role tidak ada di bundle aplikasi; secrets dikelola backend.
- Crash/permission/network errors ditangani dengan pesan yang bisa dimengerti.
- Kebijakan privasi, proses penghapusan akun, dan kontak pelaporan tersedia.
- Tidak ada blocker severity tinggi pada test plan.

## 13. Keputusan yang masih harus divalidasi

1. Nama final, target brand, domain, dan identitas visual.
2. Apakah rilis pertama Android saja atau juga iOS.
3. Apakah klub privat memerlukan approval wajib atau konfigurasi per klub.
4. Penyedia peta/tiles, routing, batas biaya, dan lisensinya.
5. Durasi retensi lokasi terakhir, laporan, chat, dan media.
6. Penyedia layanan voice room (LiveKit Cloud atau self-host), region, dan model biaya.
7. Versi Android minimum yang ingin didukung setelah tes perangkat target.
8. Kebijakan community standards, moderasi, dan kanal eskalasi laporan berbahaya.

## 14. Sumber teknis resmi

Dokumentasi berikut perlu diperiksa ulang saat dependency benar-benar dipasang karena versi SDK dan aturan platform dapat berubah:

- Expo development builds: https://docs.expo.dev/develop/development-builds/introduction/
- Expo Location: https://docs.expo.dev/versions/latest/sdk/location/
- Expo EAS APK builds: https://docs.expo.dev/build-reference/apk/
- Supabase Realtime: https://supabase.com/docs/guides/realtime/overview
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- LiveKit React Native: https://docs.livekit.io/transport/sdk-platforms/react-native/
- MapLibre React Native Expo setup: https://maplibre.org/maplibre-react-native/docs/setup/expo/
