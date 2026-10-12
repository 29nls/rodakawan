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
| Tulis lokasi | User sendiri, member aktif | User sendiri, member aktif | Tidak | Tidak |
| Baca chat ride | Sesuai membership | Ya | Tidak | Tidak |
| Kirim chat | Member aktif sendiri | Member aktif sendiri | Tidak | Tidak |
| Kelola anggota klub | Owner/admin | Tidak | Tidak | Tidak |
| Buat hazard | User terautentikasi sesuai policy | Ya | Tidak | Tidak |
| Buat voice token | Member sah dan ride aktif | Sesuai policy | Tidak | Tidak |

Matrix ini harus disesuaikan dengan kebijakan final, lalu diimplementasikan menjadi automated DB/RLS tests untuk allowed dan denied cases.

## 9. Security release checklist

- [ ] RLS aktif pada semua tabel/API yang terekspos.
- [ ] Negative tests untuk akses non-member dan revoked member lulus.
- [ ] Realtime private channel diuji menggunakan user lain.
- [ ] Tidak ada service role/private key di mobile bundle, git, issue, log, atau dokumentasi publik.
- [ ] Storage policies sudah diuji, termasuk direct URL dan delete.
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
