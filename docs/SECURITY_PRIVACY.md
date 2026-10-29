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
- **Batas yang belum terbukti.** Uji allow/deny database lulus (67 perintah), tetapi perilaku perangkat — izin background, GPS mati, mode pesawat, force-stop, reboot, dan konsumsi baterai 30 menit — masih **Blocked** dan tidak boleh ditulis sebagai lulus. Adapter MapLibre untuk marker sudah terdaftar; render native tetap **Blocked** sampai style URL dan bukti uji perangkat tersedia, sementara layar mempertahankan daftar posisi.

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
| Baca chat ride | Sesuai membership; pesan teks dari pengguna yang ia blokir tidak dikirim | Ya, dengan aturan blokir yang sama per pengguna | Tidak | Tidak |
| Baca perjalanan klub (`club_id` terisi) | `visibility='club'`: anggota aktif klub. `invite_only`: anggota aktif klub **dan** (pembuat atau peserta `joined`) | Peserta `joined`, tetapi hanya selama masih anggota aktif klub itu | Tidak, kecuali `visibility='public'` | Tidak |
| Baca perjalanan pribadi (`club_id` kosong) | Pembuat atau peserta `joined` | Pembuat atau peserta `joined` | Tidak, kecuali `visibility='public'` | Tidak |
| Kirim chat | Member aktif sendiri | Member aktif sendiri | Tidak | Tidak |
| Baca laporan penyalahgunaan | Host perjalanan atau owner/admin klub pemilik perjalanan; pelapor tetap melihat laporannya sendiri | Tidak, kecuali moderator atas konten itu | Tidak | Tidak |
| Baca isi konten yang dilaporkan | Sama dengan baris di atas; `get_moderation_subject` hanya mengembalikan baris yang dilaporkan | Hanya lewat policy anggota biasa | Tidak | Tidak |
| Hapus konten / tutup laporan (moderasi) | Hanya RPC `moderate_hazard`/`moderate_chat_message`/`review_content_report` untuk host/admin klub pemilik perjalanan | Tidak | Tidak | Tidak |
| Baca jejak audit moderasi | Pelaku sendiri, atau host/admin atas target yang ia awasi (RPC `list_moderation_actions`) | Tidak | Tidak | Tidak |
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

### 8.1 Milestone 4 — jalur tulis hazard dan chat (21 Oktober 2026)

Perubahan yang **sudah ditulis** di migration (**sudah diterapkan** ke project development):

- `INSERT`/`UPDATE`/`DELETE` langsung pada `public.hazard_reports` dan `public.chat_messages`
  **dicabut** dari `authenticated` dan `anon`. Seluruh mutasi lewat RPC `security definer` dengan
  `set search_path = ''` dan grant hanya `authenticated`. Alasannya sama dengan ADR-065: rate limit,
  deteksi duplikat, jendela edit, dan expiry server tidak mungkin ditegakkan bila REST biasa masih
  bisa menulis.
- Policy yang dimusnahkan: `hazards_insert_self`, `chat_insert_self_member`, `chat_update_own_text`,
  `chat_delete_own`. Policy baca **tidak diubah**: `hazards_select_current_or_reporter` dan
  `chat_select_ride_member` (`is_ride_member` = `ride_members.status = 'joined'`).
- Tabel baru `public.hazard_confirmations` (PK `(hazard_id, user_id)`, RLS aktif, hanya policy
  `SELECT`, tanpa INSERT/UPDATE/DELETE klien). Satu konfirmasi per pengguna per laporan; konfirmasi
  tidak memperpanjang `expires_at` dan tidak dapat dicabut.
- Identitas pelapor/pengirim **tidak pernah** menjadi argumen RPC: selalu `auth.uid()`.
- `expires_at` dihitung trigger `hazard_reports_expiry_guard` dari `created_at` + `hazard_expiry_seconds`;
  percobaan mengubah `expires_at` ditolak (`hazard_expiry_immutable`).
- Batas laju di database: 5 laporan/10 menit/pengguna, duplikat kategori sama dalam ±50 m/10 menit,
  10 konfirmasi/jam/pengguna, 20 pesan teks/60 detik/pengguna, edit/hapus 15 menit, dan
  `completed`/`cancelled` menolak pesan baru.
- Idempotensi: unique index `(reporter_id, client_report_id)` dan
  `(ride_id, sender_id, client_message_id)` parsial; retry mengembalikan baris yang sama.
- Pesan sistem hanya dibuat trigger (`insert_ride_system_message`, grant dicabut dari `authenticated`),
  sehingga klien tidak bisa menyisipkan pesan `message_type = 'system'` palsu. Isinya dibatasi
  1–200 karakter dan tidak memuat koordinat.
- Moderasi memakai `content_reports` lama lewat RPC `report_content`. Pelapor dari `auth.uid()`;
  target pesan chat hanya bisa dilaporkan bila pelapor melihat pesan itu (anggota ride), sehingga
  fungsi ini tidak menjadi oracle keberadaan pesan ride lain. Laporan **tidak** menghapus konten.
- Pemblokiran: `user_blocks` tetap hanya dapat dibaca `blocker_id = auth.uid()`, dan hubungan blokir
  tidak dikirim ke pengguna lain. **Sejak ADR-068** penyaringan pindah ke server (lihat §8.3): klien
  tidak lagi menerima isi pesan dari pengguna yang diblokir, baik lewat REST maupun realtime.
- Realtime: `chat_messages` dan `ride_locations` ditambahkan ke publication `supabase_realtime`.
  Setiap baris tetap melewati policy `SELECT` tabelnya sebelum dikirim; tidak ada Broadcast publik.

**Batas yang harus disebut terbuka:** (1) policy baca hazard adalah data komunitas — pelapor melihat
laporannya sendiri walau sudah kedaluwarsa, dan pengguna terautentikasi mana pun melihat laporan aktif;
(2) tidak ada peran moderator global; moderasi hanya lewat wewenang atas konteks perjalanan (ADR-067),
sehingga laporan bahaya tanpa `ride_id` tetap hanya bisa ditutup lewat dashboard tepercaya;
(3) uji allow/deny M4 (`supabase/tests/rls_hazards_test.sql`, `rls_chat_test.sql`,
`rls_moderation_m4_test.sql`) belum pernah dieksekusi, sehingga jaminan di atas masih **klaim desain**,
bukan hasil pengujian; (4) penyembunyian pesan terblokir awalnya dilakukan di klien dan **sudah
digantikan** penyaringan server oleh ADR-068/§8.3, sehingga isi pesan itu tidak lagi dikirim ke
perangkat pemblokir.

### 8.2 Dashboard moderasi — wewenang atas konteks, bukan peran global (21 Oktober 2026)

Migration `20261021120000_moderation_dashboard.sql` menambahkan jalur tinjauan tanpa membuat peran
baru (ADR-067). Yang berwenang adalah pihak yang sudah memegang konteks kontennya:

- `can_moderate_ride(ride_id)` = `is_ride_host` **atau** `is_club_admin` atas klub pemilik perjalanan;
- `can_moderate_hazard`/`can_moderate_chat_message` = wewenang atas perjalanan tempat konten itu
  berada; `can_moderate_content_report` meneruskan wewenang itu ke laporan;
- laporan bahaya tanpa `ride_id` **tidak** dapat dimoderasi dari aplikasi.

Jalur baca dan tulis:

- `content_reports_select_moderator` menambah policy baca untuk moderator; policy pelapor
  (`content_reports_select_reporter`) tidak diubah. Tidak ada policy tulis: status laporan hanya
  berubah lewat `review_content_report`.
- `get_moderation_subject(p_target_type, p_target_id)` mengembalikan **satu baris yang dilaporkan**
  bila moderator tidak bisa membacanya lewat policy biasa (admin klub bukan peserta chat; hazard yang
  sudah kedaluwarsa), setelah otorisasi yang sama. Ia tidak membuka riwayat chat.
- `public.moderation_actions` mencatat pelaku, jenis/ID target, tindakan, alasan, catatan, dan waktu.
  RLS aktif **tanpa policy**, dan `INSERT/UPDATE/DELETE/SELECT` dicabut dari `authenticated`/`anon`;
  satu-satunya jalur baca adalah `list_moderation_actions`, yang menyaring baris dengan fungsi
  otorisasi di atas. Baris audit ditulis RPC dalam transaksi yang sama dengan perubahan konten, jadi
  tidak ada penghapusan tanpa jejak.
- Tindakan: `moderate_hazard` (`remove`/`dismiss`, hanya laporan belum final),
  `moderate_chat_message` (soft delete `deleted_at`, idempoten), `review_content_report`
  (`reviewed`/`removed`/`dismissed`, hanya laporan `open`). Meninjau laporan **tidak** menghapus konten:
  penghapusan adalah aksi terpisah dengan baris audit sendiri. Alasan yang dicatat adalah alasan
  laporan, bukan pilihan moderator.
- Semua RPC `security definer`, `set search_path = ''`, grant hanya `authenticated`. Identitas pelaku
  selalu `auth.uid()`.

**Batas:** dashboard menampilkan 50 laporan terbuka tertua tanpa paginasi; penghapusan bersifat soft
delete sehingga isi tetap ada di database untuk peninjauan; pelapor tidak menerima notifikasi hasil
tinjauan; dan uji SQL-nya (`rls_moderation_m4_test.sql`) sudah lulus di Database RLS #19 (22 Oktober 2026), sedangkan alurnya dengan tiga akun nyata di perangkat belum diuji.

### 8.3 Pesan dari pengguna yang diblokir disaring di server (21 Oktober 2026)

Migration `20261021130000_blocked_chat_server_filter.sql` memindahkan penyaringan dari UI ke policy
baca (ADR-068):

- `public.is_blocked_by_me(p_user_id)` — `security definer`, `search_path = ''`, hanya memeriksa
  `user_blocks` dengan `blocker_id = auth.uid()`. Tidak ada parameter identitas pemblokir, jadi fungsi
  ini tidak bisa dipakai memeriksa blokir orang lain.
- `chat_select_ride_member` diganti bentuknya menjadi: anggota ride **dan** bukan pesan teks dari
  pengguna yang memblokir saya. Penjaga keanggotaan tetap ada (syarat ADR-060).
- Efeknya berlaku untuk **dua** jalur baca sekaligus: REST/PostgREST dan Postgres Changes (realtime
  memakai policy SELECT yang sama). Sebelumnya baris dikirim lebih dulu lalu isinya diganti teks di
  klien — isi pesan sudah sampai ke perangkat.
- Pesan sistem (`message_type = 'system'`) tidak disaring: isinya bukan pesan pribadi, dan
  menyembunyikan “Perjalanan dimulai” karena host diblokir akan menghilangkan informasi keselamatan.
- Tidak ada data yang dihapus: membuka blokir memunculkan kembali riwayat (perlu muat ulang/reconnect
  karena baris lama tidak didorong ulang), dan pengirim tetap membaca pesannya sendiri.
- Moderasi tidak terpengaruh: `get_moderation_subject` adalah `security definer`, sehingga moderator
  yang memblokir penulis tetap bisa membaca konten yang dilaporkan.

**Batas:** blokir tetap satu arah — pengguna yang diblokir masih melihat pesan pemblokir dan tidak
diberi tahu tentang blokir; tidak ada rate limit atau penolakan follow berbasis blokir (masih dicatat
sebagai hardening M6 di ROADMAP). Uji `rls_blocked_chat_test.sql` **sudah** dieksekusi terhadap
project development: Database RLS run #19 (commit `1aa1480`, 22 Oktober 2026) menerima notice
`UJI FILTER BLOKIR CHAT LULUS` bersama enam notice lain (7/7 berkas lulus).

### 8.4 Hapus akun — penghapusan identitas dan retensi yang eksplisit (23 Oktober 2026)

Keputusan lengkapnya di ADR-077 (menggantikan sebagian ADR-076). Anonimisasi saja tidak cukup:
pengguna masih bisa login, dan `auth.uid()` masih cocok dengan baris profil. Alur sekarang:
Edge Function `delete-account` (JWT diverifikasi server) → Storage API → `purge_account_data()`
(satu transaksi) → Auth Admin API.

| Data | Perlakuan |
| --- | --- |
| Identitas login (`auth.users`) | **dihapus** lewat Auth Admin API setelah database/Storage bersih; login ulang gagal |
| Baris `public.profiles` | **dihapus**; tidak ada tombstone per pengguna yang masih memakai UUID lama |
| Token push, posisi terakhir, notifikasi pribadi, follow, blokir, reaksi, konfirmasi bahaya | baris dihapus |
| Kendaraan + `motorcycle_private_details` (nomor polisi, catatan) | baris dihapus |
| Keanggotaan klub dan perjalanan | baris dihapus **setelah** kepemilikan klub/perjalanan dialihkan ke admin/anggota aktif lain |
| Klub/perjalanan tanpa penerus | `created_by` → tombstone; perjalanan planned/active dibatalkan |
| Laporan bahaya | **dipertahankan**, `reporter_id` → tombstone, `client_report_id` dikosongkan; isi laporan tetap untuk keselamatan |
| Pesan konvoi | **dipertahankan** sebagai riwayat, isi diredaksi `[Pesan dihapus]`, pengirim → tombstone |
| Postingan/komentar klub | **dipertahankan** strukturnya agar balasan orang lain tidak hilang, isi diredaksi, penulis → tombstone |
| `content_reports`, `moderation_actions` | **dipertahankan** sebagai audit, pelaku/pelapor → tombstone |
| Avatar, foto kendaraan, logo klub yatim | dihapus lewat Storage API |
| Logo klub yang masih dipakai | disalin ke path baru (`<club_id>/logo-<uuid>.<ext>`), `clubs.logo_path` diperbarui, objek lama dihapus |
| Metadata `account_deletion_jobs` | UUID + status/langka terakhir, tanpa konten pribadi; untuk retry idempoten |

Tombstone bersama `00000000-0000-4000-8000-000000000001` (`deleted_account`) tidak punya auth user
dan disembunyikan policy `profiles_select_visible` (`deleted_at is not null`). Konten dari akun
berbeda yang dihapus tidak dapat dikaitkan satu sama lain.

**Batas yang diketahui dan disengaja:** access token lama secara teknis masih berlaku sampai
kedaluwarsa, tetapi tidak menemukan profil atau baris miliknya (diuji: baca 0 baris, tulis ditolak
FK); `signOut()` di klien tetap dijalankan setelah server menyatakan selesai. Metadata job belum
dibersihkan otomatis. Retensi laporan bahaya/audit/pesan yang diredaksi **perlu pengesahan
produk/legal**; kebijakan publik di `web/privacy/` menyatakannya, bukan mengklaim “semua data
dihapus”. Halaman web sudah ada tetapi **belum ter-deploy**, jadi URL publik masih **Blocked**.

**Bukti:** migration `20261023004946_account_deletion_identity.sql` diterapkan ke project
development (20 migration, `db:types:check` lulus). `supabase/tests/rls_account_delete_test.sql`
(48 perintah) lulus di `npm run db:test` **8/8** dengan notice `UJI HAPUS AKUN LULUS`; E2E terhadap
project development membuktikan Auth user hilang, profil hilang, laporan bahaya tetap, media pribadi
hilang, logo klub berpindah path dan bukan milik akun lagi, JWT lama tidak bisa membaca/menulis,
login ulang gagal, dan akun kedua tidak tersentuh. Uji layanan/layar ada di
`src/features/account/__tests__/api.test.ts` (7 test) dan `src/__tests__/account-delete.test.tsx`
(4 test). **Belum:** uji perangkat fisik; verifikasi CI/RLS untuk commit perubahan ini (baru berjalan
setelah branch di-push); dan pembersihan otomatis metadata job.

## 9. Security release checklist

Status per 24 Oktober 2026 (Milestone 5). Istilah status: **Implemented**,
**Passed locally**, **Passed against dev backend**, **Tested on physical device**, **Blocked**.

- RLS aktif pada tabel/API yang terekspos: **Passed against dev backend** untuk `public.profiles`, `public.follows`, `public.motorcycle_private_details`, tabel/RPC klub (`public.clubs`, `public.club_memberships`, `public.club_role_audit`), garasi (`public.motorcycles` + kendaraan utama), perjalanan, serta `storage.objects` untuk `vehicle-photos`, `club-logos`, dan `avatars` — uji allow/deny seluruh kelompok itu lulus (18 Oktober 2026, 171 perintah, `UJI RLS PROFIL LULUS`). **Diperluas 24 Oktober 2026:** `supabase/tests/rls_catalog_test.sql` memeriksa katalog — semua tabel/partisi `public` mengaktifkan RLS, seluruh view `public` memakai `security_invoker`, dan `chat_messages`/`ride_locations` ada di publikasi `supabase_realtime`; `npm run db:test` **9/9** berkas lulus. Temuan katalog itu kini **sudah diperbaiki**: migration `20261024003227_m5_catalog_hardening.sql` diterapkan ke project development (24 Oktober 2026, persetujuan pemilik) — 12 fungsi `security definer` kini memakai `search_path = ''` dan 4 fungsi trigger tidak lagi dapat dieksekusi `PUBLIC`/`anon`; daftar tunggu/pengecualian sementara di `rls_catalog_test.sql` sudah dihapus dan uji anti-usangnya lulus.
- Negative test lintas pengguna: **Passed against dev backend** — `supabase/tests/rls_profiles_test.sql` dijalankan lewat `npm run db:test` dan lulus, termasuk kasus "pengguna memberi dirinya sendiri akses lewat relasi follow" dan "detail privat kendaraan dipindahkan ke kendaraan orang lain"; jalur kegagalan runner (tanpa `DATABASE_URL`, host tidak terjangkau, berkas tanpa penanda) tetap **Passed locally**.
- Tidak ada service role/private key di bundle: **Passed locally** (24 Oktober 2026). `npm run export:android` exit 0; pada `dist/_expo/static/js/android/entry-*.hbc` tidak ada JWT utuh (`eyJ…` = 0), connection string `postgres://` = 0, dan tidak ada nilai berbentuk secret key (`sb_secret_` + 30 karakter atau lebih = 0). Literal `service_role` muncul 2 kali (regex pemeriksaan klien di `src/lib/env.ts` dan kode dependensi `@supabase/supabase-js`) dan prefiks `sb_secret_` 1 kali (tabel string dependensi, bukan nilai kunci; tidak cocok dengan nilai environment mana pun). Pada tree ter-track tidak ada nilai kredensial — `service_role` hanya muncul di dokumentasi, komentar migration, dan uji. `git log --all --diff-filter=A -- '.env*'` hanya menemukan `.env.example`; `.env`, `.env.local`, dan `.env.db` tidak pernah masuk riwayat. Verifikasi ini harus diulang setiap kali kredensial nyata dipakai, karena inlining `EXPO_PUBLIC_*` berubah saat `.env.local` terisi.
- Kredensial database untuk pengujian: **Implemented** — `DATABASE_URL` dibaca dari environment (atau otomatis dari berkas `.env.db` oleh `npm run db:test`), hanya `user@host:port/database` yang dicetak, dan nilainya **tidak** boleh berada di `.env`/`.env.local` karena kedua berkas itu dibaca Expo sehingga variabel `EXPO_PUBLIC_*` di dalamnya ikut ke bundel aplikasi. `.env.db` diabaikan Git, tidak dibaca Expo, dan sudah dicoba tanpa pernah menampilkan password di output.
- CI tidak diberi akses database pada push/PR biasa: **Implemented** dan **berjalan di GitHub** — job `quality` di `ci.yml` berjalan tanpa satu pun secret Supabase. Uji RLS mempunyai workflow terpisah (`database-rls.yml`, ADR-055) yang memegang secret `DB_TEST_DATABASE_URL`, berjalan otomatis hanya ketika file database berubah, **memverifikasi connection string menunjuk project development sebelum menyentuhnya**, dan menolak lulus bila notice penanda dari server tidak diterima. Pada `749424c` run **#4** hijau (kedua notice: `UJI RLS PROFIL LULUS` 171 perintah + `UJI POLICY OWNER-GUARD LULUS` 17 perintah); run **#3** sempat gagal di langkah `gen types` tanpa target dan diperbaiki di ADR-061. Status terbaru: pada `1aa1480` run **#19** hijau untuk ketujuh berkas uji (M3 + M4, termasuk `UJI FILTER BLOKIR CHAT LULUS`) dan `npm run db:types:check` lulus di job yang sama. PR dari fork tidak menerima secret dan jobnya dilewati.
- Storage policies: **Passed against dev backend** (bucket privat, owner-only foto kendaraan, logo klub per peran, penolakan `anon`, dan CHECK path; 17 Oktober 2026). Yang belum diuji adalah unggahan HTTP nyata dari perangkat dan kedaluwarsa signed URL di klien — lihat `docs/QA_TEST_PLAN.md` (GAR-05/CLUB-11).
- **Sudah dibangun tetapi belum diuji perangkat:** berbagi lokasi opt-in dan pembersihannya (bagian 4.2), dengan Realtime Postgres Changes yang tunduk pada RLS, serta flow hapus akun penuh (bagian 8.4) dan halaman kebijakan privasi. **Belum dibangun:** rate limit untuk endpoint auth, retensi otomatis metadata job, dan renderer peta. **Blocked:** URL publik halaman web (belum ada deployment).

- [x] RLS aktif pada semua tabel/API yang terekspos — **Passed against dev backend** lewat `rls_catalog_test.sql` dan `rls_policy_guard_test.sql` (`npm run db:test` 9/9, 24 Oktober 2026); temuan grant `security definer` di butir pertama bagian ini sudah diperbaiki lewat migration `20261024003227_m5_catalog_hardening.sql` (diterapkan ke development 24 Oktober 2026).
- [x] Negative tests untuk akses non-member dan revoked member lulus — **Passed against dev backend** (24 Oktober 2026). `rls_profiles_test.sql` menolak akses lintas pengguna dan detail privat yang dipindahkan; `rls_rides_test.sql` menolak non-anggota dan `anon` membaca perjalanan/lokasi; `rls_chat_test.sql` bagian 15b (ditambahkan di branch ini) membuktikan peserta berstatus `removed` membaca 0 pesan dan ditolak saat mengirim. Seluruhnya berjalan lewat `npm run db:test` **9/9** lulus; `rls_policy_guard_test.sql` tetap memeriksa policy wadah. Jalur kegagalan runner tetap **Passed locally**.
- [x] Pagar policy otomatis: `supabase/tests/rls_policy_guard_test.sql` menolak policy pada tabel wadah
      (`club_id`/`ride_id`) yang memberi akses lewat kolom kepemilikan tanpa penjaga keanggotaan;
      detektornya diuji-diri dan daftar pengecualiannya diperiksa anti-usang — lulus 18 Oktober 2026
      (18 policy wadah diperiksa, 4 pengecualian beralasan), jalur gagal terbukti exit 1 (ADR-060).
- [ ] Realtime private channel diuji menggunakan user lain — **Passed against dev backend**: lapisan database (24 Oktober 2026) dan dua klien WebSocket nyata lewat `npm run e2e:shared-ride` (25 Oktober 2026: dua supabase-js dengan JWT GoTrue asli, chat/lokasi diterima ≤5 detik, non-anggota menerima 0 event). Bukti SQL: `npm run db:test` **12/12** lulus (27 Oktober 2026); `rls_catalog_test.sql` membuktikan `chat_messages` dan `ride_locations` ada di publikasi `supabase_realtime` dan RLS keduanya aktif; `rls_chat_test.sql` bagian 15b membuktikan peserta yang dikeluarkan (`removed`) tidak bisa membaca atau mengirim pesan; `rls_rides_test.sql` membuktikan non-anggota dan `anon` membaca 0 baris lokasi, penulisan langsung ditolak, dan lokasi terhapus saat berhenti berbagi/keluar/dikeluarkan/ride selesai. **Belum di perangkat:** reconnect saat jaringan putus/pulih dan filter blokir pada klien APK —
daftarnya di `docs/QA_TEST_PLAN.md` bagian 8d (butir 11 dan 15) dan 8f (PD-09, PD-15).
- [x] Tidak ada service role/private key di mobile bundle, git, issue, log, atau dokumentasi publik — **Passed locally** untuk bundel, tree, riwayat git, issue, dan PR (24 Oktober 2026): `npm run export:android` exit 0 dengan 0 JWT utuh, 0 `postgres://`, 0 nilai `sb_secret_` panjang; `git log --all` hanya memuat `.env.example`; `gh issue list --state all` = 0 issue dan 9 PR, tidak ada body yang memuat pola kunci. **Batasan:** log runtime Supabase dan riwayat Actions belum dipindai menyeluruh.
- [x] Storage policies sudah diuji, termasuk penolakan signed URL/direct URL dan delete — `npm run db:test` bagian 13, lulus 17 Oktober 2026 (bucket privat; foto kendaraan owner-only; logo klub hanya owner/admin yang menulis).
- [ ] Input disanitasi/ditangani aman; rate limits aktif — **Implemented sebagian**, belum boleh dicentang (inventaris 24 Oktober 2026). Validasi klien hanya untuk umpan balik; otoritas tetap CHECK constraint dan RPC database.

  | Titik masuk | Validasi klien | Batas/otoritas database |
  | --- | --- | --- |
  | Email, kata sandi | `auth/validation.ts` (email ≤ 254; sandi 8–72, huruf + angka) | Supabase Auth (GoTrue) |
  | Profil | `profile/validation.ts` (username 3–30 pola `[a-z0-9_]`, nama tampilan ≤ 80, bio ≤ 300, kota ≤ 80) | CHECK `public.profiles`; `avatar_url` tanpa batas panjang |
  | Garasi | `garage/validation.ts` (merek ≤ 80, model ≤ 100, panggilan ≤ 60, tahun 1950–2100, plat ≤ 16, catatan ≤ 500) | CHECK `public.motorcycles`; plat/catatan kini **dibatasi database** (CHECK ≤ 16/500 dari migration `20261024011825_m5_private_detail_limits.sql`, diterapkan 24 Oktober 2026) |
  | Klub | `clubs/validation.ts` (nama 2–100, deskripsi ≤ 2000, slug 3–80) | CHECK `public.clubs`; `logo_path` tanpa batas panjang |
  | Perjalanan | `rides/validation.ts` (judul 3–120, deskripsi ≤ 2000, label ≤ 120, jadwal) | CHECK `public.rides` termasuk rentang koordinat |
  | Hazard | `hazards/api.ts` (deskripsi ≤ 1000) | RPC tulis + CHECK ≤ 1000; **rate limit 5 laporan/10 menit** dan **10 konfirmasi/jam** |
  | Chat | `chat/api.ts` (isi ≤ 2000, dirapikan) | Hanya RPC (`send_chat_message`/`edit`/`delete`), CHECK 1–2000, **20 pesan/60 detik**, jendela edit 15 menit |
  | Laporan moderasi | `moderation/api.ts` (detail ≤ 2000) | RPC `report_content` + CHECK ≤ 2000; **rate limit 10 laporan/10 menit** lewat trigger `content_reports_rate_limit` (menutup RPC dan jalur REST) — diterapkan ke development 25 Oktober 2026 |
  | Follow, permintaan gabung/undang klub | Tombol UI, tanpa batas frekuensi | RLS + constraint identitas; **rate limit 10 follow/10 menit** (trigger) dan **5 permintaan gabung/10 menit** (RPC) — diterapkan ke development 25 Oktober 2026; undangan klub belum punya jalur tulis |
  | Lokasi perjalanan | Nilai dari GPS, tanpa validasi rentang di klien | RLS peserta aktif + CHECK rentang; **minimum 2 detik antar publikasi** per (perjalanan, pengguna) dan reset saat opt-out — diterapkan ke development 26 Oktober 2026 |
  | Hapus akun | Konfirmasi username di layar | Lease + retry **15 menit** setelah kegagalan |

  **Celah terbuka (bukan lulus):** rate limit follow, laporan moderasi, permintaan gabung klub, pembuatan klub/perjalanan, dan publikasi lokasi sudah diterapkan ke development (27 Oktober 2026, `db:test` 12/12, konkurensi dua koneksi lulus), sedangkan rate limit endpoint Auth, throttle `update_ride`, dan batas panjang kolom path (`avatar_url`, `logo_path`, `photo_path`, `media_path`) masih terbuka. Tidak ada dependency sanitasi baru — data dikirim lewat PostgREST/RPC berparameter, bukan SQL string.
- [x] Flow hapus akun penuh dan data terdokumentasi — Edge Function `delete-account` + `purge_account_data()`
      + Auth Admin API; layar `/account-delete`; uji SQL `rls_account_delete_test.sql` dan E2E
      development lulus (9/9 berkas pada 24 Oktober 2026; 8/8 pada 23 Oktober 2026); rincian di bagian 8.4 dan ADR-077.
- [x] Privacy policy tersedia di aplikasi — halaman `/privacy` (retensi, data yang disimpan, kontak
      dukungan lewat issue GitHub), plus versi statis di `web/privacy/`. **URL publik belum live**
      (blocker deployment); **syarat komunitas** belum ditulis sebagai halaman tersendiri.
- [x] Error log tidak membocorkan koordinat, isi chat, credential, atau identitas sensitif — **Passed locally** (audit statis, 24 Oktober 2026). `src/` tidak memuat satu pun `console.*`/`logger.*` di luar uji, jadi payload layar, isi chat, koordinat, dan token tidak pernah dicetak klien. `supabase/functions/delete-account/index.ts` hanya punya dua `console.error`: satu untuk konfigurasi platform yang hilang (tanpa nama/nilai) dan satu saat kegagalan yang memuat `{ jobId, step, code }` — tanpa email, token, koordinat, atau isi chat. `detailsOf()` membaca detail galat hanya untuk mengklasifikasi kode, tidak pernah mencatat atau mengembalikannya; respons galat memakai kode tetap dan pesan pemulihan Bahasa Indonesia. **Batasan:** log Edge Function/Postgres di dashboard belum diamati pada beban nyata, dan pemantauan otomatis belum ada.
- [x] Prosedur melaporkan dan menangani insiden dibuat sebelum membuka akses publik — **Implemented** di [`docs/INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) (24 Oktober 2026): deteksi/triase, rotasi secret key, password database, JWT, penonaktifan Edge Function (`functions delete`), pencabutan rilis GitHub, pemberitahuan pengguna tanpa kanal karangan, dan penutupan dengan uji regresi. **Belum:** latihan meja (tabletop) dan kanal broadcast push/email; kontak hanya halaman GitHub Issues.

- [x] Pagar katalog hardening untuk gerbang beta — **Passed against dev backend** (25 Oktober 2026). `supabase/tests/rls_catalog_hardening_test.sql` menambahkan detektor teruji-diri untuk tabel public tanpa RLS, definer tanpa `search_path = ''`, fungsi public yang `EXECUTE`-nya terbuka ke `PUBLIC`/`anon`, view tanpa `security_invoker`, bucket Storage publik, dan baca anon atas `motorcycle_private_details` (satu baris fixture: pemilik membaca 1, `anon` 0). Tujuh fungsi masih terbuka dan didaftarkan beserta alasannya (enam helper RLS + `touch_updated_at()`), dengan pemeriksaan anti-usang. `npm run db:test` **12/12** lulus (27 Oktober 2026); notice `UJI KATALOG HARDENING LULUS` diperiksa `.github/workflows/database-rls.yml`.
- [ ] Jalur penerbitan halaman web publik — workflow **Implemented**; publikasi **Blocked** karena belum pernah berjalan. `.github/workflows/pages.yml` hanya mengunggah `web/` dan menjalankan uji statis `scripts/__tests__/web-static.test.mjs` (11 test) sebelum unggah, tetapi workflow build-nya **sudah pernah berjalan** (run `40180579692`: uji statis lama gagal karena `config.js` memuat ref development; uji lokal kini 11/11 lulus setelah `config.js` dikecualikan), GitHub Pages belum diaktifkan, dan `config.js` masih menunjuk **project development** — bukan backend rilis. Tidak ada URL publik yang diklaim; matriks lengkap di [`BETA_READINESS.md`](BETA_READINESS.md).

**Migration hardening M5 sudah diterapkan (24 Oktober 2026, persetujuan pemilik):** `npx supabase db push --yes` ke project development menerapkan `20261024003227_m5_catalog_hardening.sql` (kunci `search_path` 12 fungsi definer, cabut EXECUTE 4 fungsi trigger) dan `20261024011825_m5_private_detail_limits.sql` (CHECK plat ≤ 16 / catatan ≤ 500, `not valid`); daftar tunggu/pengecualian terkait sudah dihapus dari `supabase/tests/rls_catalog_test.sql`, `npm run db:test` **9/9** dan `npm run db:types:check` lulus setelahnya. **Belum dijalankan:** `validate constraint` untuk dua CHECK plat/catatan pada baris lama (aman karena migration `not valid`; jalankan setelah data lama diperiksa). Uji perangkat dan URL web publik tetap **Blocked**.

## 10. Referensi resmi

- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Realtime Broadcast: https://supabase.com/docs/guides/realtime/broadcast
- Expo permissions: https://docs.expo.dev/guides/permissions/
- Expo Location: https://docs.expo.dev/versions/latest/sdk/location/
- Expo Audio: https://docs.expo.dev/versions/latest/sdk/audio/
