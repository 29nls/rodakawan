# Eksekusi pilot beta tertutup — RodaKawan

Dokumen operasional untuk pemilik dan peserta pilot. Ini bukan pernyataan bahwa beta sudah siap:
sebelum prasyarat backend dan build di bawah terpenuhi, statusnya **Blocked**. Instruksi deployment
mengikuti [`BETA_RUNBOOK.md`](BETA_RUNBOOK.md); kasus dan ID PD mengikuti
[`QA_TEST_PLAN.md`](QA_TEST_PLAN.md) bagian 8f.

## Status saat dokumen disiapkan

- Rilis yang terakhir diverifikasi: `v0.1.0-build71`, commit `e248d2595a057e081fdda0e79cb20e45a909a12a`, asset `app-preview.apk` (106.638.791 byte), SHA-256 `62151d6371cad99a78a478ec274c88929ad02877a5b10764a49c79722fe16462`, sertifikat penandatangan `3ea8bb4745b638be8fddf71e15edd9786d45aac65c0384b87be8fa2c32b3b14d`.
- Workflow CI, Database RLS, serta APK build71 berhasil untuk commit `e248d25`; smoke test itu hanya install/launch emulator.
- Build71 menunjuk development, bukan beta. Tidak ada project Supabase RodaKawan beta yang terverifikasi. Jangan distribusikan APK ini sebagai APK beta.
- Tidak ada bukti penerimaan fisik dalam sesi ini; seluruh PD-01…PD-22 tetap **Blocked** sampai peserta mengisi bukti nyata.

## 1. Gerbang backend beta — pemilik

- [ ] Buat project Supabase beta **terpisah dan kosong**; jangan memakai development `xvmcpfkkveeaevfcvfug` atau production.
- [ ] Catat ref, region, URL API, publishable key, dan database password di password manager. Jangan taruh database password atau service-role/secret key dalam APK, repository, issue publik, atau chat.
- [ ] Pastikan database benar-benar kosong; hitung migration lokal yang akan dipakai, tinjau urutan semua file `supabase/migrations/`, lalu terapkan berurutan sesuai `BETA_RUNBOOK.md`. Jangan mengedit migration lama.
- [ ] Deploy Edge Function `delete-account` dari commit yang sama dengan APK. Pastikan token wajib diverifikasi melalui Auth; atur `WEB_ALLOWED_ORIGINS` hanya jika account-deletion web akan digunakan.
- [ ] Storage: verifikasi bucket `avatars`, `vehicle-photos`, `club-logos` ada dan privat; jangan membuat bucket publik.
- [ ] Auth: Redirect URL `rodakawan://auth/callback`; putuskan konfirmasi email dengan sadar. Bila aktif, pasang/test SMTP untuk konfirmasi dan reset password. Simpan bukti konfigurasi tanpa kredensial.
- [ ] Jangan mengubah database Auth rate limit dashboard tanpa catatan; periksa pengaturannya dan catat nilai/status yang disetujui.
- [ ] Jalankan `npm run beta:preflight` hanya terhadap URL + database beta yang diverifikasi; syarat lulus 8 pemeriksaan, tanpa menganggap hasil development sebagai bukti beta. Preflight read-only; runner tulis `db:test`, `storage:test`, dan `e2e:*` khusus development.

## 2. Environment dan build APK — pemilik

Setelah workflow perubahan tersedia di branch default, siapkan GitHub Environment `beta` dan isi **nama berikut saja** (jangan mengganti variables/secrets repository development):

| Tipe | Nama | Keterangan |
| --- | --- | --- |
| Variable | `BETA_SUPABASE_PROJECT_REF` | Ref project beta yang sama dengan URL dan DB, tidak sama dengan development |
| Variable | `BETA_SUPABASE_URL` | URL `https://<ref-beta>.supabase.co` |
| Variable | `BETA_SUPABASE_PUBLISHABLE_KEY` | Publishable key beta; nilai publik, akan masuk APK |
| Variable | `BETA_MAP_STYLE_URL` | Kosong sampai keputusan ADR-064; jangan menambah provider peta |
| Secret | `BETA_SUPABASE_DATABASE_URL` | Connection string session pooler beta, rahasia |

Secrets keystore rilis yang sudah digunakan workflow harus tersedia; jangan menyalin/menampilkan nilainya. Build beta memvalidasi ref API, ref database, dan ref eksplisit, menjalankan preflight, membuat APK, memverifikasi signature/SHA-256, lalu menguji install/launch pada emulator. Beta hanya diunggah sebagai Actions artifact selama 30 hari; workflow tidak membuat GitHub Release/tag.

Jalankan hanya setelah commit target lulus CI, backend dan Environment beta siap:

```powershell
gh workflow run release-on-push.yml --ref main -f environment=beta -f commit=<sha-yang-sudah-lulus-ci>
```

- [ ] Workflow selesai sukses; tidak ada step build/preflight/emulator yang gagal atau dilewati tanpa alasan.
- [ ] Catat run URL/ID, commit SHA, nama artifact, versi/versionCode, ukuran APK, SHA-256, dan fingerprint sertifikat.
- [ ] Unduh artifact, hitung SHA-256 lokal dan cocokkan dengan output workflow sebelum instalasi. Jangan bagikan artifact jika hash berbeda atau smoke test emulator gagal.
- [ ] Pastikan URL/ref di konfigurasi artifact beta bukan project development. Jangan menaruh APK preview lama dalam daftar build beta.

## 3. Setup sesi pengujian

Gunakan data sintetis dan lokasi koordinat uji, bukan lokasi rumah atau rute nyata. Minimum dua perangkat Android fisik dari vendor berbeda bila tersedia:

| Peran | Perangkat/OS/ROM | Akun uji | Penyiap |
| --- | --- | --- | --- |
| HP A — host |  | A |  |
| HP B — peserta |  | B |  |
| Akun C — non-member | (perangkat terpisah atau sesi yang dikontrol) | C |  |

Sebelum setiap sesi:

1. Pastikan commit/build/hash APK sama di A dan B; catat model, versi Android, patch keamanan bila diketahui, vendor/ROM, status GPS/jaringan, dan waktu lokal beserta zona waktu.
2. Buat akun uji dengan email yang dapat menerima email konfirmasi/reset. Jangan masukkan alamat email asli ke bukti; gunakan A/B/C.
3. Host A buat klub/perjalanan uji; undang/join B. C tetap non-member. Set consent lokasi hanya setelah peserta setuju dan hanya pada ride uji.
4. Tutup aplikasi lain yang tidak diperlukan; jangan aktifkan sharing lokasi untuk perjalanan nyata.

## 4. Urutan penerimaan pilot

Penuhi gerbang sebelum memulai: backend beta preflight lulus, build beta diverifikasi, dan smoke test emulator sukses. Jalankan terlebih dahulu PD-01…PD-05, PD-09, PD-13…PD-15, PD-21. Tambahkan PD-06…PD-08, PD-10…PD-12 dan PD-16…PD-20/PD-22 sebelum memperluas pilot. Detail langkah/expected result adalah sumber kasus di `QA_TEST_PLAN.md` 8f; jangan mengubah expected result untuk membuat kasus tampak lulus.

| Kelompok | ID tetap | Fokus / peran |
| --- | --- | --- |
| Akun dan sesi | PD-01 | A/B: daftar, konfirmasi email bila aktif, login, sesi setelah restart, jaringan |
| Perjalanan | PD-02, PD-14 | A host membuat/mulai/selesai/batal; B menerima status yang tersimpan |
| Lokasi dan consent | PD-03…PD-08, PD-10…PD-13, PD-20, PD-22 | A/B: foreground/background, permission ditolak, GPS, battery saver, force-stop/reboot, opt-out, lokasi dibersihkan, vendor kedua, throttle sementara |
| Chat / jaringan | PD-09, PD-15 | A↔B: realtime, edit/hapus, idempotensi, reconnect; C diblokir sesuai kondisi kasus |
| Batas anggota | PD-21 | C non-member mencoba UI dan akses yang dicatat; backend harus menolak |
| Keselamatan dan operasi | PD-16, PD-17, PD-18, PD-19 | A/B: hazard, moderasi, Storage privat, hapus akun serta recovery |

Peta konvoi interaktif belum tersedia (ADR-064); jangan mencatat marker peta seolah-olah diuji. Push, voice PTT, dan musik lokal bukan fitur pilot yang dinyatakan tersedia.

## 5. Form bukti — salin satu formulir per kasus dan perangkat

Status yang diperbolehkan: **Blocked**, **Pass**, **Fail**, **Needs retest**. Mulai dari **Blocked**; hanya tester yang menjalankan kasus yang boleh mengganti status. `Pass` harus mencantumkan bukti yang aman dan dapat ditelusuri. Satu baris PD di `QA_TEST_PLAN.md` dapat diisi setelah formulir lengkap.

```text
Case ID (PD-01…PD-22):
Tester / peran tester:
Tanggal-waktu lokal + zona waktu:
Perangkat (model, Android, vendor/ROM):
Build (tag/run ID, commit SHA, versionCode):
APK filename + ukuran + SHA-256 + signer fingerprint:
Backend project ref (ref saja; jangan URL/credential):
Akun/peran yang dipakai: A host / B peserta / C non-member
Kondisi awal (jaringan, GPS, izin, baterai, ride status):
Langkah reproduksi (nomor urut, tanpa data pribadi):
Hasil yang diharapkan (salin dari QA_TEST_PLAN.md):
Hasil aktual (fakta, termasuk waktu/error yang terlihat):
Bukti aman (nama file screenshot/logcat atau issue; redaksi token, email, koordinat):
Severity: P0 / P1 / P2 / P3
Status: Blocked / Pass / Fail / Needs retest
Apakah lokasi sharing dinonaktifkan dan lokasi server dibersihkan setelah sesi?:
Issue/bug report ID:
```

Jangan unggah token/JWT, password, connection string, publishable key, alamat email, foto wajah/plat, atau koordinat akurat. Screenshot/logcat disimpan di kanal privat yang disetujui, bukan commit repository; jangan memakai `bukti-perangkat/` untuk data sensitif.

## 6. Pelaporan dan pemulihan kegagalan

1. Hentikan langkah yang bisa mengirim lokasi, menghapus akun, atau mengubah keanggotaan; jangan mengulang tindakan destruktif sebelum status server diketahui.
2. Catat ID kasus, build/hash, perangkat, waktu/zona waktu, langkah minimum, hasil aktual, severity, dan file bukti yang sudah disunting. Laporkan ke kanal privat yang ditetapkan pemilik; gunakan GitHub Security Advisory privat bila ada dugaan kebocoran/akses lintas pengguna.
3. P0 (data pribadi/kredensial atau penghapusan massal): hentikan pilot, cabut distribusi artifact, amankan bukti, hubungi pemilik/operator Supabase. P1 (akses lintas akun atau sharing lokasi salah): hentikan kasus dan nonaktifkan sharing/ride; jangan lanjutkan pada akun nyata. P2/P3: tandai Fail/Needs retest dan sertakan langkah pemulihan yang dicoba.
4. Untuk jaringan/email sementara: simpan bukti error, pulihkan jaringan atau minta ulang email sekali, lalu catat percobaan baru; jangan menandai lulus hanya karena retry berhasil.
5. Jika lokasi masih tersimpan setelah opt-out/finalisasi, jangan lanjut ride; minta operator memverifikasi row lewat prosedur backend yang aman dan dokumentasikan pembersihannya. Jangan jalankan SQL manual atau hapus `storage.objects` langsung.
6. Build yang salah backend/hash: jangan instal/sebar; hapus artifact lokal sesuai prosedur tim, perbaiki Environment `beta`, jalankan preflight/build baru dan cocokkan hash baru.
7. Setelah perbaikan, gunakan migration aditif dan ulangi gate lokal + development yang relevan; jangan menjalankan runner database tulis ke beta/production. Uji perilaku beta melalui kasus fisik setelah build baru diverifikasi.

## 7. Keputusan/tindakan pemilik yang masih diperlukan

- [ ] Buat project Supabase beta kosong dan validasi deployment function/configuration di sana.
- [ ] Tentukan konfirmasi email (disarankan aktif) dan sediakan SMTP yang diuji.
- [ ] Buat GitHub Environment `beta` serta variables/secrets khusus; jangan mengubah values repository development.
- [ ] Periksa batas signup/rate limit Auth pada Dashboard; repository tidak dapat membuktikannya.
- [ ] Sahkan rencana operasional/retensi beta yang sesuai keputusan privasi; backup dan proses penghapusan tetap mengikuti runbook.
- [ ] Siapkan perangkat Android fisik, peserta A/B/C, jadwal, kanal laporan privat, dan personel pemulihan.
- [ ] Putuskan ADR-064 sebelum pekerjaan peta; tidak ada peta interaktif pada pilot sekarang.
- [ ] Tinjau pencadangan/restore keystore; jangan memulai pilot dengan identitas signing yang tidak dapat diperbarui.

**Status akhir saat disiapkan: Blocked — belum ada backend beta terverifikasi, belum ada APK yang diarahkan ke beta, dan belum ada bukti uji perangkat fisik.**
