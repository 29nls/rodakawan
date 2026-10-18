# Security, Privacy & Safety Requirements

## 1. Model ancaman minimum

Lindungi dari:

- Non-anggota yang mencoba membaca lokasi/chat ride.
- User yang memanipulasi `userId`, `rideId`, role, timestamp, atau coordinates dalam payload.
- Kebocoran nomor polisi atau informasi pribadi melalui profil, storage URL, analytics, atau log.
- Token push/voice yang dicuri atau dipakai ulang tanpa hak.
- Spam hazard reports, fake accounts, harassment, dan unggahan gambar berbahaya.
- Error konfigurasi RLS yang memberi akses berlebihan.
- Hilangnya perangkat ketika sharing lokasi aktif.

## 2. Prinsip kontrol akses

1. Aktifkan RLS pada semua tabel yang dapat diakses lewat client API.
2. Tetapkan policy per operasi `SELECT`, `INSERT`, `UPDATE`, `DELETE`; prinsip default adalah deny jika tidak ada policy yang cocok.
3. Uji akses dengan beberapa user berbeda, termasuk non-member, member, host, admin, dan user yang sudah dikeluarkan.
4. Gunakan Edge Functions/RPC untuk transisi role, create club dengan owner membership, join/start/end ride, token PTT, dan tindakan admin.
5. Service role hanya server-side. Jangan kirim melalui build config mobile atau source control.
6. Authorization Realtime channel harus diperiksa terpisah; RLS tabel saja tidak otomatis membuktikan channel aman.
7. Storage bucket menggunakan path dan policy per owner/entitas. Jangan menjadikan semua foto privat sebagai bucket publik.

## 3. Lokasi — data sensitif

- Tidak meminta lokasi sebelum pengguna memahami manfaatnya.
- Tidak memulai tracking sebelum pengguna bergabung dan secara eksplisit mengaktifkan sharing untuk ride aktif.
- Beri indikator visual dan, saat diwajibkan, notifikasi foreground service yang menunjukkan tracking berjalan.
- Lokasi peserta hanya bisa diakses peserta sah dalam ride yang sama.
- Stop sharing harus benar-benar menghentikan task, mengakhiri publish, dan memperbarui status.
- Jangan menyimpan breadcrumb lengkap secara default. Posisi terakhir disimpan hanya untuk state/reconnect, lalu dihapus sesuai retensi.
- Untuk log, analytics, crash reports, dan diagnostics, gunakan coarse location atau ID event; jangan log koordinat presisi tanpa kebutuhan yang terdokumentasi.
- Saat peserta keluar atau ride selesai, server menolak update berikutnya dan membatasi read data historis sesuai policy.
- Pertimbangkan tombol `Jeda berbagi lokasi` dan `Keluar dari perjalanan` yang mudah ditemukan.

### Retensi awal yang disarankan (perlu disetujui)

| Data | Retensi sementara |
|---|---|
| Lokasi terakhir ride | Hanya selama ride aktif + maksimal 24 jam setelah selesai untuk rekonsiliasi; kemudian hapus/anonymize. |
| Lokasi histori/breadcrumb | Tidak disimpan secara default. |
| Hazard report aktif | Sampai `expires_at`; simpan metadata audit terbatas sesuai kebutuhan. |
| Chat | Periode yang ditetapkan pemilik produk dan dikomunikasikan di kebijakan privasi; usulan awal 12 bulan sebelum penghapusan/anonymization. |
| Foto/post | Sampai user menghapus, sesuai retensi dan aturan moderasi. |
| Push token | Sampai token tidak valid, user logout/uninstall terdeteksi, atau user menghapus akun. |
| Audit security event | Periode terbatas, tidak mencakup data berlebihan. |

Jangan mengadopsi retensi tabel ini secara otomatis; tetapkan dasar, kebutuhan, dan aturan hukum yang berlaku sebelum produksi.

## 4. Garasi dan identitas

- Pisahkan nomor polisi, nomor telepon, email, dan detail sensitif dari data profil publik.
- Profil publik hanya memuat username/display name/avatar/bio/kota opsional yang disetujui user.
- Hindari menyebarkan metadata EXIF foto yang berisi lokasi jika tidak diperlukan; hapus metadata pada pipeline upload bila cocok.
- Sediakan kontrol siapa yang dapat melihat kendaraan/foto.

### 4.1 Implementasi profil Milestone 1

- **Pembuatan profil** dilakukan oleh trigger database `public.bootstrap_profile()` pada `after insert auth.users` (migration `20261013023038_auth_profile_bootstrap.sql`), bukan oleh klien. Fungsi berjalan `security definer` dengan `set search_path = ''` (semua referensi skema eksplisit), haknya dicabut dari `public`, dan identitas baris diambil dari `NEW.id` — bukan dari payload yang bisa dikirim pengguna.
- **Metadata pendaftaran hanya nilai awal.** `raw_user_meta_data` dipakai untuk mengisi username awal, tidak pernah untuk otorisasi. Username dari metadata dinormalkan (huruf kecil, hanya `[a-z0-9_]`) dan divalidasi `^[a-z0-9_]{3,30}$`; bila tidak valid atau bentrok, profil tetap dibuat dengan username sementara `rider_<acak>` dan aplikasi menandai bahwa username harus diganti.
- **Keunikan username** adalah tanggung jawab database: unique index + CHECK `profiles_username_format`. Klien hanya memberi pesan yang bisa dipahami; klien bukan penentu keunikan.
- **`updated_at` diisi server** oleh trigger `profiles_touch_updated_at`, supaya klien tidak bisa memalsukan waktu perubahan.
- **Profil privat memerlukan persetujuan pengikut (Milestone 1.6, ADR-039).** Policy `profiles_select_visible` memberi `SELECT` kepada pemilik, profil yang tidak privat (`is_private = false`), atau pengikut dengan `follows.status = 'accepted'`. Status diisi **server** oleh trigger `follows_set_status` — permintaan ke profil privat selalu `pending`, berapa pun nilai yang dikirim klien — dan satu-satunya cara mengubahnya adalah fungsi `security definer` `public.accept_follow_request(p_follower_id)` yang hanya bekerja untuk `followed_id = auth.uid()`. Tidak ada policy `UPDATE` pada `public.follows`, sehingga klien tidak dapat menaikkan status sendiri, sedangkan `DELETE` diizinkan untuk kedua pihak (berhenti mengikuti, menolak permintaan, atau mencabut pengikut). **Sebelum perbaikan ini**, satu `INSERT` ke `public.follows` sudah cukup untuk membuka profil privat orang lain; kerentanan itu direproduksi (1 baris terbaca) dan ditutup (0 baris) pada 13 Oktober 2026.
- **Profil tetap tertutup untuk peran sesi lain.** `INSERT`/`UPDATE` hanya untuk baris dengan `id = auth.uid()`; tidak ada policy `DELETE` (penghapusan akun ada di Milestone 5); tidak ada akses untuk peran `anon`, termasuk pada `public.follows`.
- **Detail privat kendaraan hanya untuk kendaraan sendiri (Milestone 1.6, ADR-040).** `public.motorcycle_private_details` memeriksa kepemilikan kendaraan pada `INSERT` **dan** `UPDATE` (termasuk saat `motorcycle_id` diubah), dan invarian "pemilik detail = pemilik kendaraan" juga dijaga di level struktur lewat foreign key komposit `(motorcycle_id, owner_id) -> motorcycles(id, owner_id)`. Policy `SELECT` dan `DELETE` tetap `owner_id = auth.uid()`.
- **Hak eksekusi fungsi tanpa sesi.** Supabase memberi `EXECUTE` kepada `anon` pada setiap fungsi baru; `accept_follow_request` dan `set_follow_status` dicabut eksplisit dari `anon` lewat migration tersendiri (ADR-041). Fungsi helper Milestone 1 (`is_club_member`, `is_ride_host`, `can_publish_ride_location`, dst.) masih membawa grant yang sama — semuanya mengembalikan `false` tanpa sesi karena dibandingkan dengan `auth.uid()` yang NULL — dan pembatasan grant menyeluruh tetap pekerjaan tersendiri (ADR-030).
- **Aplikasi tidak pernah menyimpan atau menampilkan kredensial.** Hanya publishable/anon key yang dipakai; service-role key tidak boleh ada di repo maupun bundle. Pesan error dari backend dipetakan ke kalimat Bahasa Indonesia tanpa menyalin detail internal, dan tidak ada log yang memuat token atau isi kata sandi.
- **Foto kendaraan dan logo klub memakai Storage privat (17 Oktober 2026).** Dua bucket dibuat lewat `20261017120000_private_photo_storage.sql`; policy klub yang sempat membaca kolom `clubs.name` alih-alih nama objek diperbaiki di `20261017121000_club_logo_policy_qualified_name.sql` setelah uji Storage menangkapnya. Detailnya:
  - `vehicle-photos` — privat, maksimal 5 MiB, hanya JPEG/PNG/WEBP. `SELECT`/`UPDATE`/`DELETE` hanya untuk folder `<owner_id>/<motorcycle_id>/`; `INSERT` juga mensyaratkan kendaraan itu benar-benar milik `auth.uid()`. Tidak ada jalur baca untuk pengguna lain, termasuk lewat signed URL.
  - `club-logos` — privat, maksimal 2 MiB. `SELECT` untuk anggota aktif atau siapa pun yang boleh melihat klub publik; `INSERT`/`UPDATE`/`DELETE` hanya untuk `is_club_admin(club_id)`.
  - `avatars` — privat, maksimal 2 MiB, JPEG/PNG/WEBP. Path `<user_id>/<berkas>`; keempat operasi hanya untuk folder `auth.uid()`, tanpa policy untuk `anon`. `profiles.avatar_url` menyimpan **path** (bukan URL) dan dijaga CHECK `profiles_avatar_path_owner`, sehingga pemilik sah tidak bisa menautkan avatar ke objek milik orang lain. Konsekuensi yang disengaja: sampai ada kebijakan visibilitas avatar, foto profil hanya terlihat oleh pemiliknya — orang lain melihat nama/inisial, bukan foto.
  - Path adalah bagian otorisasi (`storage.foldername(objects.name)`) dan kolom `photo_path`/`logo_path` dijaga CHECK: segmen pertama harus pemilik/klub yang sama, segmen kedua harus kendaraan yang sama. Menautkan objek orang lain ditolak database, bukan hanya disembunyikan UI.
  - Aplikasi hanya meminta signed URL berumur 1 jam; URL tidak disimpan di database maupun state global. Ganti foto berarti unggah objek baru → perbarui baris → hapus objek lama, dan objek baru dibersihkan bila baris gagal diperbarui. Hapus foto mengosongkan kolom lebih dulu, lalu menghapus objek.
  - Izin galeri diminta hanya saat pengguna menekan unggah; plugin `expo-image-picker` mematikan izin kamera/mikrofon. Picker meminta representasi kompatibel/JPEG untuk HEIC (`Compatible`); tipe yang tetap tidak didukung ditolak sebelum unggah, dan ukuran diperiksa di aplikasi serta di bucket.
  - **Foto ditulis ulang di perangkat sebelum diunggah (18 Oktober 2026).** Berkas galeri tidak pernah dikirim apa adanya: `expo-image-manipulator` memperkecil sisi terpanjang (1600 px kendaraan, 512 px logo dan foto profil) dan mengompres JPEG/WEBP pada kualitas 0.7, lalu menyimpannya sebagai berkas baru di cache. Karena modul native itu menulis ulang gambar dari bitmap-nya (bukan menyalin berkas), blok metadata asli seperti EXIF — termasuk GPS — tidak ikut; hanya orientasi yang dibakar ke piksel. Ini sekaligus memenuhi butir "hapus metadata pada pipeline upload bila cocok" di bagian 4. Pembuktian di perangkat (foto ber-EXIF GPS benar-benar bersih setelah unggah) masuk checklist GAR-05/CLUB-11.
  - **Objek yatim dibersihkan dari klien, bukan dengan kunci admin (18 Oktober 2026).** Karena hapus objek lama bersifat best-effort, berkas tanpa rujukan bisa tertinggal; Supabase menolak `delete from storage.objects` langsung dan `service_role` sengaja tidak disimpan di repo ini, jadi pembersihan berjalan dengan sesi pemilik lewat Storage API (`src/features/media/photoCleanup.ts`): `list` folder `<owner_id>/` dan setiap folder kendaraannya, bandingkan dengan `photo_path` yang masih dirujuk, lalu `remove` sisanya. Policy `SELECT`/`DELETE` bucket hanya cocok untuk folder pemiliknya, sehingga jalur ini **tidak** menambah kemampuan apa pun bagi klien: folder pengguna lain tetap tidak terbaca dan tidak terhapus, dan objek yatim pun selama ini hanya bisa dibaca pemiliknya. Jendela tenggang 1 jam mencegah sapuan menghapus objek yang baru diunggah sebelum barisnya sempat diperbarui (perangkat lain/sesi yang sedang di tengah alur). Sapuan berjalan di latar belakang saat garasi dibuka dan tidak pernah melempar; kegagalan hanya berarti objek dicoba lagi nanti, bukan risiko kehilangan foto yang dirujuk.
  - Batas ukuran/MIME ditegakkan Storage service, bukan hanya validasi aplikasi. Karena ada modul native (`expo-image-picker`, `expo-file-system`, dan `expo-image-manipulator`), dev client/APK harus dibangun ulang sebelum fitur ini bisa dicoba di perangkat.
- **Pagar policy dijalankan otomatis di CI (18 Oktober 2026).** Audit manual di butir berikut kini punya penjaganya sendiri: `supabase/tests/rls_policy_guard_test.sql` membaca katalog `pg_policies` dan **menggagalkan CI** bila ada policy pada tabel wadah (`club_id`/`ride_id`) yang memberi akses lewat kolom kepemilikan (`created_by`, `author_id`, `owner_id`, `user_id`, `sender_id`, `reporter_id`, `blocker_id`, `recipient_id`, `follower_id`, `followed_id`) tanpa penjaga keanggotaan (`is_club_member`, `is_club_admin`, `is_ride_member`, `is_ride_active_member`, `is_ride_host`, `can_publish_ride_location`, atau subquery `club_members`/`ride_members`). Policy UPDATE dinilai dari gabungan `USING` + `WITH CHECK`, karena `USING` yang longgar tetapi `WITH CHECK` berpenjaga tidak bisa menghasilkan baris yang melanggar penjaga itu. Empat pengecualian tertulis beserta alasannya — `chat_delete_own` dan `ride_locations_delete_self` (membersihkan data sendiri) serta dua policy hazard (data keselamatan jalan yang memang komunitas, `ride_id`-nya hanya konteks opsional) — dan daftar itu diperiksa anti-usang supaya tidak membusuk. Detektornya diuji-diri dengan tabel probe, dan jalur gagalnya sudah terbukti menghasilkan exit 1 dengan daftar `tabel.policy` yang melanggar. Batas yang diketahui: pemeriksaan ini membaca teks ekspresi policy, bukan semantik SQL yang sebenarnya, jadi ia bisa menandai policy yang aman (harus masuk daftar pengecualian, bukan diabaikan) dan tidak bisa membuktikan sebuah penjaga benar-benar tepat; tabel wadah ditentukan dari kolom `club_id`/`ride_id`, sehingga wadah baru dengan kolom lain harus ditambahkan manual di satu tempat (ADR-060).
- **Audit escape hatch `created_by` (17 Oktober 2026).** Seluruh policy `public` diperiksa untuk klausa kepemilikan yang tidak melihat keanggotaan aktif, dengan katalog diambil langsung dari `pg_policies` pada database development (52 policy). Tiga klausa sudah ditutup di migration sebelumnya (`clubs` di `20261016100000`, `follows` di `20261013140000`, `motorcycle_private_details` di `20261013140100`). Yang tersisa adalah `rides_select_allowed`: `created_by = auth.uid()` tanpa syarat membuat pembuat perjalanan klub tetap membaca perjalanan `visibility='club'` setelah keluar/dikeluarkan dari klub — direproduksi di database development (1 baris) lalu ditutup oleh `20261017090000_ride_access_requires_club_membership.sql` (0 baris). Perjalanan ber-`club_id` kini mensyaratkan keanggotaan klub **aktif**; perjalanan tanpa klub tetap memakai kepemilikan/peserta, dan `visibility='public'` tetap publik. Konten klub (`club_posts`, `post_comments`, `post_reactions`) diperiksa dengan cara yang sama: klausa `author_id` tidak membuka akses di luar keanggotaan karena policy `SELECT`-nya sudah dibatasi keanggotaan, sehingga `UPDATE`/`DELETE` atas baris yang tak terlihat menghasilkan 0 baris; sekarang ada uji eksplisit untuk itu (bagian 11–12 berkas uji RLS).
- **Uji RLS sudah dijalankan dan lulus pada project development (13 Oktober 2026, diperluas dan dijalankan ulang 16–17 Oktober 2026).** Seluruh migration (**tiga belas versi**, termasuk Milestone 1.6, Milestone 2, audit policy, Storage foto 17 Oktober 2026, bucket avatar 18 Oktober 2026, dan workflow perjalanan Milestone 3 19 Oktober 2026) diterapkan ke project development khusus RodaKawan, lalu `npm run db:test` (19 Oktober 2026) menerima ketiga notice penanda: `UJI RLS PROFIL LULUS` (171 perintah), `UJI POLICY OWNER-GUARD LULUS` (17 perintah), dan `UJI RLS PERJALANAN M3 LULUS` (67 perintah) — **255 perintah, exit 0**. Cakupan skrip: kontrol positif (profil publik memang terbaca), penolakan baca/ubah profil privat pengguna lain, aturan permintaan/persetujuan follow, detail privat kendaraan lintas pengguna, penolakan `DELETE`, penolakan `INSERT`/`UPDATE` oleh peran `anon`, aturan keanggotaan klub dan kendaraan utama (bagian 5 `docs/MILESTONE_2_REPORT.md`), kepemilikan konten klub (post/komentar/reaksi), akses perjalanan klub setelah keanggotaan berakhir, serta bucket/privat policy Storage (foto kendaraan dan foto profil owner-only, logo klub per peran, dan CHECK path) di bagian 13. Runner tetap hanya melaporkan lulus bila notice penanda diterima server. Uji ini membuktikan aturan di database, bukan unggahan HTTP maupun UI aplikasi, dan harus dijalankan ulang setiap kali policy/RPC berubah.

### 4.2 Implementasi perjalanan dan lokasi Milestone 3 (19 Oktober 2026)

- **Consent adalah state terpisah dari izin OS.** `ride_members.sharing_location` hanya berubah lewat RPC `set_ride_location_sharing`; menyalakannya mensyaratkan status ride `active` dan keanggotaan `joined`. Izin Android yang diberikan tidak pernah menyalakan consent, dan consent tidak pernah diberikan otomatis saat join. Menolak berbagi tidak menghalangi join.
- **Satu baris terakhir, tanpa riwayat.** `ride_locations` ber-primary key `(ride_id, user_id)`; tidak ada tabel breadcrumb. Nilai yang disimpan hanya posisi terakhir, akurasi, heading/speed opsional, dan `recorded_at`.
- **Klien tidak menulis tabel langsung.** `INSERT`/`UPDATE` pada `ride_locations` dicabut dari `authenticated` dan `anon`; satu-satunya jalur tulis adalah RPC `publish_ride_location`, yang memeriksa sesi, keanggotaan `joined`, consent, status ride `active`, rentang koordinat, akurasi (≤1000 m), heading, kecepatan, serta umur fix (≤5 menit, tidak lebih dari 1 menit di masa depan). Identitas selalu `auth.uid()`, bukan argumen klien.
- **Pembersihan tidak menunggu cron.** Trigger `ride_members_clear_location` menghapus baris lokasi pengguna saat consent dimatikan atau statusnya bukan `joined` (keluar/dikeluarkan); trigger `rides_clear_locations` menghapus seluruh lokasi ride dan mematikan consent saat status menjadi `completed`/`cancelled`. Dengan begitu “berhenti berbagi” berarti barisnya benar-benar hilang, bukan hanya disembunyikan dari UI.
- **Baca dibatasi anggota aktif.** Policy `ride_locations_select_active_member` hanya membuka baris bila `is_ride_active_member(ride_id)`; non-anggota, peserta yang keluar/dikeluarkan, dan `anon` tidak menerima baris — termasuk lewat Realtime Postgres Changes, yang memakai policy SELECT yang sama. Tidak ada Broadcast koordinat dan tidak ada kanal publik.
- **State machine di database.** `transition_ride` hanya menerima host `joined`, hanya transisi `planned→active→completed`, `planned→cancelled`, `active→cancelled`; `completed`/`cancelled` final. `started_at`/`ended_at` diisi server. Seluruh RPC M3 `security definer` dengan `search_path = ''` dan `EXECUTE` hanya untuk `authenticated`; `anon` dicabut eksplisit (diuji dengan `has_function_privilege`).
- **Tidak ada koordinat di log.** Task lokasi hanya meneruskan angka ke RPC; kegagalan tidak mencatat posisi. UI menampilkan umur posisi (“baru saja”, “N detik lalu”, “basi”) dan tidak pernah menampilkan marker diam sebagai live.
- **Batas yang belum terbukti.** Uji allow/deny database lulus (67 perintah), tetapi perilaku perangkat — izin background, GPS mati, mode pesawat, force-stop, reboot, dan konsumsi baterai 30 menit — masih **Blocked** dan tidak boleh ditulis sebagai lulus. Peta juga belum ada; layar menyatakan “peta belum tersedia” dan menampilkan daftar posisi.

## 5. Keamanan token dan storage

- Access token ditangani SDK auth; gunakan storage aman yang direkomendasikan untuk secure session pada platform.
- PTT token memiliki TTL pendek, room dan permission terbatas, serta diterbitkan setelah validasi membership.
- Secret LiveKit, push provider, dan Supabase service role berada di environment secret server.
- URL signed untuk media privat memiliki expiry terbatas.
- Batasi upload berdasarkan ukuran, MIME type, ekstensi dan jumlah; jangan mempercayai nama file dari user.
- Rotasi credential jika bocor dan siapkan prosedur response.

## 6. Abuse prevention & moderasi

- Rate limit create report, komentar, chat, follow dan permintaan join.
- Pengguna dapat block akun; laporan konten menyimpan referensi dan alasan yang terstruktur.
- Sediakan status moderation seperti `open`, `reviewed`, `removed`, `dismissed`.
- Gunakan expiry untuk kondisi jalan yang cepat berubah; tampilkan timestamp dan konfirmasi komunitas.
- Jangan mengandalkan satu konfirmasi atau skor reputasi untuk menyatakan laporan pasti benar.
- Peran moderator/admin harus dibatasi dan perubahan administratif memiliki audit trail.

## 7. Audio dan keselamatan berkendara

- Minta izin mikrofon hanya ketika user akan masuk voice room.
- Indikator mic aktif harus jelas; kontrol mute dan disconnect selalu tersedia.
- Jangan rekam audio secara default.
- Jangan klaim PTT berjalan dengan semua helm/headset/Bluetooth sampai diuji.
- PTT on-screen tidak menjadikan memegang ponsel aman saat mengemudi.
- Uji audio focus dan interaksi dengan musik/navigasi panggilan sistem.

## 8. RLS test matrix

| Tindakan | Pemilik/admin | Anggota ride | Non-member | Anon |
|---|---|---|---|---|
| Baca profil aman | Ya, sesuai visibilitas | Ya, sesuai visibilitas | Tidak sesuai policy | Tidak |
| Baca plat privat | Pemilik saja | Tidak, kecuali pemilik | Tidak | Tidak |
| Baca lokasi ride aktif | Host sesuai membership | Ya | Tidak | Tidak |
| Tulis lokasi | Hanya RPC `publish_ride_location` untuk diri sendiri, member aktif + consent | Sama | Tidak | Tidak |
| Baca chat ride | Sesuai membership | Ya | Tidak | Tidak |
| Baca perjalanan klub (`club_id` terisi) | `visibility='club'`: anggota aktif klub. `invite_only`: anggota aktif klub **dan** (pembuat atau peserta `joined`) | Peserta `joined`, tetapi hanya selama masih anggota aktif klub itu | Tidak, kecuali `visibility='public'` | Tidak |
| Baca perjalanan pribadi (`club_id` kosong) | Pembuat atau peserta `joined` | Pembuat atau peserta `joined` | Tidak, kecuali `visibility='public'` | Tidak |
| Kirim chat | Member aktif sendiri | Member aktif sendiri | Tidak | Tidak |
| Kelola anggota klub | Owner/admin | Tidak | Tidak | Tidak |
| Buat hazard | User terautentikasi sesuai policy | Ya | Tidak | Tidak |
| Buat voice token | Member sah dan ride aktif | Sesuai policy | Tidak | Tidak |
| Baca profil privat | Pemilik atau pengikut yang sudah disetujui | Hanya bila permintaannya disetujui | Tidak (permintaan follow berstatus `pending`) | Tidak |
| Baca/tulis detail privat kendaraan | Pemilik kendaraan saja | Tidak | Tidak | Tidak |
| Baca foto kendaraan | Pemilik kendaraan saja | Tidak | Tidak | Tidak |
| Unggah/ganti/hapus foto kendaraan | Pemilik kendaraan saja | Tidak | Tidak | Tidak |
| Baca logo klub | Anggota aktif; non-anggota hanya untuk klub publik | Ya (anggota aktif) | Hanya klub publik | Tidak |
| Unggah/ganti/hapus logo klub | Owner/admin aktif | Tidak | Tidak | Tidak |

Matrix ini harus disesuaikan dengan kebijakan final, lalu diimplementasikan menjadi automated DB/RLS tests untuk allowed dan denied cases.

## 9. Security release checklist

Status per Milestone 1.5 (diperbarui pada milestone ini). Istilah status: **Implemented**,
**Passed locally**, **Passed against dev backend**, **Tested on physical device**, **Blocked**.

- RLS aktif pada tabel/API yang terekspos: **Passed against dev backend** untuk `public.profiles`, `public.follows`, `public.motorcycle_private_details`, tabel/RPC klub (`public.clubs`, `public.club_memberships`, `public.club_role_audit`), garasi (`public.motorcycles` + kendaraan utama), perjalanan, serta `storage.objects` untuk `vehicle-photos`, `club-logos`, dan `avatars` — uji allow/deny seluruh kelompok itu lulus (18 Oktober 2026, 171 perintah, `UJI RLS PROFIL LULUS`).
- Negative test lintas pengguna: **Passed against dev backend** — `supabase/tests/rls_profiles_test.sql` dijalankan lewat `npm run db:test` dan lulus, termasuk kasus "pengguna memberi dirinya sendiri akses lewat relasi follow" dan "detail privat kendaraan dipindahkan ke kendaraan orang lain"; jalur kegagalan runner (tanpa `DATABASE_URL`, host tidak terjangkau, berkas tanpa penanda) tetap **Passed locally**.
- Tidak ada service role/private key di bundle: **Passed locally** untuk bundel Android (`npm run export:android`, exit 0; tidak ada JWT `eyJ…`, connection string, atau key yang ter-inline; string `service_role`/`sb_secret` yang muncul berasal dari pemeriksaan di `src/lib/env.ts` dan dari dependensi Supabase) dan pada tree repo. Verifikasi ini harus diulang setiap kali kredensial nyata dipakai, karena inlining `EXPO_PUBLIC_*` berubah saat `.env.local` terisi.
- Kredensial database untuk pengujian: **Implemented** — `DATABASE_URL` dibaca dari environment (atau otomatis dari berkas `.env.db` oleh `npm run db:test`), hanya `user@host:port/database` yang dicetak, dan nilainya **tidak** boleh berada di `.env`/`.env.local` karena kedua berkas itu dibaca Expo sehingga variabel `EXPO_PUBLIC_*` di dalamnya ikut ke bundel aplikasi. `.env.db` diabaikan Git, tidak dibaca Expo, dan sudah dicoba tanpa pernah menampilkan password di output.
- CI tidak diberi akses database pada push/PR biasa: **Implemented** dan **berjalan di GitHub** — job `quality` di `ci.yml` berjalan tanpa satu pun secret Supabase. Uji RLS mempunyai workflow terpisah (`database-rls.yml`, ADR-055) yang memegang secret `DB_TEST_DATABASE_URL`, berjalan otomatis hanya ketika file database berubah, **memverifikasi connection string menunjuk project development sebelum menyentuhnya**, dan menolak lulus bila notice penanda dari server tidak diterima. Pada `749424c` run **#4** hijau (kedua notice: `UJI RLS PROFIL LULUS` 171 perintah + `UJI POLICY OWNER-GUARD LULUS` 17 perintah); run **#3** sempat gagal di langkah `gen types` tanpa target dan diperbaiki di ADR-061. PR dari fork tidak menerima secret dan jobnya dilewati.
- Storage policies: **Passed against dev backend** (bucket privat, owner-only foto kendaraan, logo klub per peran, penolakan `anon`, dan CHECK path; 17 Oktober 2026). Yang belum diuji adalah unggahan HTTP nyata dari perangkat dan kedaluwarsa signed URL di klien — lihat `docs/QA_TEST_PLAN.md` (GAR-05/CLUB-11).
- **Sudah dibangun tetapi belum diuji perangkat:** berbagi lokasi opt-in dan pembersihannya (bagian 4.2), dengan Realtime Postgres Changes yang tunduk pada RLS. **Belum dibangun:** rate limit, flow hapus akun, kebijakan privasi, dan renderer peta.

- [ ] RLS aktif pada semua tabel/API yang terekspos.
- [ ] Negative tests untuk akses non-member dan revoked member lulus.
- [x] Pagar policy otomatis: `supabase/tests/rls_policy_guard_test.sql` menolak policy pada tabel wadah
      (`club_id`/`ride_id`) yang memberi akses lewat kolom kepemilikan tanpa penjaga keanggotaan;
      detektornya diuji-diri dan daftar pengecualiannya diperiksa anti-usang — lulus 18 Oktober 2026
      (18 policy wadah diperiksa, 4 pengecualian beralasan), jalur gagal terbukti exit 1 (ADR-060).
- [ ] Realtime private channel diuji menggunakan user lain.
- [ ] Tidak ada service role/private key di mobile bundle, git, issue, log, atau dokumentasi publik.
- [x] Storage policies sudah diuji, termasuk penolakan signed URL/direct URL dan delete — `npm run db:test` bagian 13, lulus 17 Oktober 2026 (bucket privat; foto kendaraan owner-only; logo klub hanya owner/admin yang menulis).
- [ ] Input disanitasi/ditangani aman; rate limits aktif.
- [ ] Flow hapus akun dan data terdokumentasi.
- [ ] Privacy policy dan syarat komunitas tersedia.
- [ ] Error log tidak membocorkan koordinat, isi chat, credential, atau identitas sensitif.
- [ ] Prosedur melaporkan dan menangani insiden dibuat sebelum membuka akses publik.

## 10. Referensi resmi

- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Realtime Broadcast: https://supabase.com/docs/guides/realtime/broadcast
- Expo permissions: https://docs.expo.dev/guides/permissions/
- Expo Location: https://docs.expo.dev/versions/latest/sdk/location/
- Expo Audio: https://docs.expo.dev/versions/latest/sdk/audio/
