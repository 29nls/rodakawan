# Nama paket Android final — keputusan & rencana migrasi

Tanggal: 28 Oktober 2026 · Status: **Rekomendasi menunggu konfirmasi pemilihan pemilik** ·
ADR terkait: ADR-015 (Sementara → akan diganti setelah dipilih) · Gerbang: `BETA_READINESS.md`
B-07 dan D-05

## 1. Lima alternatif (semua reverse-domain)

Cek ketersediaan 28 Oktober 2026: `nslookup` (DNS bekerja — kontrol `google.com` resolve) untuk
domain ber-Kecuali `com.github.*`, semua kandidat berbasis domain yang **harus benar-benar
didaftarkan pemilik** sebagai prasyarat.

| # | Kandidat nama paket | Domain yang dibalik | Hasil cek 28 Okt 2026 | Catatan |
| --- | --- | --- | --- | --- |
| 1 | **`com.rodakawan`** | `rodakawan.com` | **Tidak terdaftar** — RDAP Verisign `404` + DNS NXDOMAIN | Rekomendasi. Brand-eksak, singkat, konvensi `com.` yang paling lazim di Play, tanpa segmen generik. Google Search `"com.rodakawan"` **0 hasil** — tidak ditemukan aplikasi lain yang memakainya (verifikasi pasti terjadi saat unggah pertama di Play Console) |
| 2 | `com.rodakawan.app` (pertahankan saat ini) | `app.rodakawan.com` (subdomain dari `rodakawan.com`) | Sah **hanya setelah** `rodakawan.com` dibeli | **Nol migrasi** — tidak ada satu berkas pun yang diubah. Opsi terbaik bila biaya perubahan dianggap lebih besar dari estetika nama |
| 3 | `id.rodakawan` | `rodakawan.id` | **NXDOMAIN** (belum terdaftar) | Identitas Indonesia; paket `id.rodakawan` valid (dua segmen). Catatan: registrasi `.id` lewat PANDI dapat meminta verifikasi identitas; pastikan prosesnya lancar sebelum memilih |
| 4 | `app.rodakawan` | `rodakawan.app` | **Tidak terdaftar** — RDAP `404` + NXDOMAIN | TLD `.app` (Google) selalu HTTPS; segmen `app.` di depan jarang dipakai dan terasa generik |
| 5 | `com.github.29nls.rodakawan` | `github.io/29nls` (namespace GitHub) | Tidak perlu beli domain | Paling kebal terhadap lupa-perpanjang-domain, tetapi kurang cocok untuk aplikasi Play komersial dan memperpanjang nama |

### Rekomendasi: **`com.rodakawan`** (dengan pendaftaran `rodakawan.com` sebagai prasyarat)

Alasan:
1. **Brand-eksak dan stabil selamanya.** `com.rodakawan` adalah reverse-DNS paling langsung dari
   `rodakawan.com`; tidak ada segmen generik (`app`/`mobile`) yang bisa terasa menyusul.
2. **Waktu paling murah untuk berubah.** Belum ada unggahan Play (unggah pertama mengunci
   identitas selamanya — ADR-015); yang terdampak hanya pilot internal yang APK-nya perlu
   diinstall ulang (data peserta/riwayat ada di server; yang hilang hanya sesi login di perangkat).
3. **Domain tersedia dan murah.** `rodakawan.com` belum terdaftar (bukti RDAP di §1); biaya
   pendaftaran ~US$10–15/tahun, jauh di bawah biaya mengganti nama paket setelah rilis Play
   (arti: listing aplikasi baru dari nol).
4. **Tidak ada bentrok yang terlihat.** Pencarian web `com.rodakawan` 0 hasil.

**Alternatif nol-migrasi yang tetap sah:** bila pemilik membeli `rodakawan.com` tetapi tidak
ingin menyentuh kode sama sekali, `com.rodakawan.app` saat ini sah sebagai reverse-DNS
`app.rodakawan.com` (subdomain ikut dimiliki bersama domain utama). Pilih ini bila pilot yang
sudah terpasang tidak ingin diinstall ulang. Keduanya (1 maupun 2) **tetap mensyaratkan
pembelian `rodakawan.com`** — tanpa domain itu, `com.rodakawan.app` saat ini hanyalah placeholder
seperti tertulis di ADR-015.

## 2. Kenapa daftarnya pendek: sumber kebenaran tunggal `app.json`

Fakta yang diverifikasi dari repo (28 Oktober 2026):

- **Tidak ada folder `android/` yang di-commit** (`/android` di `.gitignore`, baris 10; tidak ada
  di disk maupun di Git). `android/app/build.gradle` **dibuat oleh `expo prebuild`** di dalam
  workflow rilis, jadi **tidak ada berkas `build.gradle` untuk diedit di repo** — nilainya
  mengikuti `expo.android.package` di `app.json` secara otomatis.
- **`eas.json` tidak memuat nama paket sama sekali** — tidak perlu diubah.
- **Workflow tidak memuat nama paket.** Kedua workflow memanggil
  `node scripts/smoke-test-apk.mjs …` **tanpa** `--package`; skrip itu (dan `device-checklist.mjs`)
  membaca default dari `expo.android.package` di `app.json`. Mengganti `app.json` otomatis
  mengubah perilaku smoke test dan checklist perangkat.
- **`scripts/configure-android-release.mjs`** menambahkan blok signing ke `app/build.gradle`
  hasil prebuild **di akhir berkas** berdasarkan penanda blok — tidak memuat nama paket, jadi
  otomatis mengikuti.

## 3. Daftar berkas yang perlu diubah (untuk kandidat yang mengganti nama)

### Wajib (satu commit atomik)

| Berkas | Baris/perubahan | Jenis |
| --- | --- | --- |
| `app.json` | `expo.android.package`: `com.rodakawan.app` → nama baru | **Sumber kebenaran** |
| `scripts/__tests__/smoke-test-apk.test.mjs` | `PACKAGE` (baris 34) + fixture log: `MainActivity.onCreate` (41), banner crash (252), ringkasan `paket=…` (502) | Fixture uji |
| `scripts/__tests__/device-checklist.test.mjs` | `PACKAGE` (baris 43) | Fixture uji |
| `scripts/__tests__/configure-android-release.test.mjs` | `namespace`/`applicationId` di fake `build.gradle` (44, 46) dan fixture `app.json` (76) | Fixture uji |
| `scripts/__tests__/support/fake-adb.mjs` | default `scenario.package` (baris 59) | Fixture uji |

### Dokumen (ikut commit yang sama)

| Berkas | Baris | Konteks |
| --- | --- | --- |
| `docs/PROJECT_DECISIONS.md` | 26 (ADR-015) | Status "Sementara" → **Disetujui** + nama final + tanggal |
| `docs/BETA_READINESS.md` | 35 (B-07), 102 (D-05) | "Needs decision" → selesai |
| `docs/PRODUCTION_MIGRATION_PLAN.md` | 18, 76, 464 | Identitas APK beta/produksi |
| `docs/SETUP_GUIDE.md` | 590 | Keystore terikat id paket |
| `docs/BETA_RUNBOOK.md` | 152 | Paket beta = paket rilis |
| `README.md` | 649 | "masih sementara dan wajib diganti" |
| `docs/ANDROID_PACKAGE_MIGRATION.md` | — | Dokumen ini (tabel §1 diperbarui dengan pilihan final) |

`CHANGELOG.md` **tidak** disunting (entri historis ditulis workflow/bersifat arsip).

### Sengaja TIDAK diubah

- `eas.json` — tidak memuat nama paket.
- `.github/workflows/*` — tidak memuat nama paket; membaca default dari `app.json`.
- Folder `android/` — tidak ada di repo (hasil prebuild).
- Keystore/`configure-android-release.mjs` — identitas tanda tangan tetap sama; mengganti
  keystore bersamaan dengan paket justru memperkecil jejak audit.

## 4. Rencana migrasi agar build tidak putus

Prinsip: **satu commit berisi seluruh perubahan**, karena gerbang CI membandingkan berkas satu
sama lain; berpisah-pisah akan membuat uji fixture dan `app.json` tidak konsisten sementara.

| Fase | Langkah | Bukti lulus |
| --- | --- | --- |
| 0 | Pemilik memilih kandidat (1–5) dan **mendaftarkan domain** yang sesuai (prasyarat kandidat 1–4) | Bukti whois/RDAP tercatat di dokumen ini |
| 1 | Ubah `app.json` + 4 fixture uji + 7 dokumen dalam **satu commit** | `git grep 'com.rodakawan.app'` hanya menyisakan `CHANGELOG.md`/arsip (dan baris dokumen ini yang menjelaskan migrasi) |
| 2 | Jalankan quality gate lokal: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test -- --ci`, `npm run test:scripts` — **khususnya** 4 suite fixture yang diubah | Semua exit 0; `test:scripts` tidak boleh menyebut `com.rodakawan.app` sebagai ekspektasi |
| 3 | (Opsional, lokal) `npx expo prebuild -p android --no-install` lalu grep `applicationId` di `android/app/build.gradle` hasil generate | `applicationId '<nama-baru>'`; folder `android/` tidak di-commit |
| 4 | Buka PR; CI + Database RLS hijau dulu sebelum merge (aturan rilis repo) | Run CI hijau |
| 5 | Setelah merge: `should-release.mjs` menghitung `app.json` sebagai **input build** (ADR-074) → workflow membangun APK baru otomatis; smoke test memakai paket baru karena defaultnya dari `app.json` | Run rilis sukses; ringkasan smoke menyebut `paket=<nama-baru>` |
| 6 | **Pilot:** instruksikan peserta **uninstall APK lama lalu install APK baru** (applicationId berbeda = instalasi baru, tidak bisa update-over). Akun Supabase, klub, riwayat, dan chat tetap di server; yang hilang hanya sesi login di perangkat | Peserta bisa login ulang; PD-01 tetap berlaku |
| 7 | Sebelum unggah Play pertama: pastikan nama final **tidak pernah berubah lagi** (setelah unggah, mengganti = listing baru) | ADR-015 ditutup; B-07/D-05 selesai |

### Risiko dan rollback

- **Risiko utama:** ketidakkonsistenan bila perubahan dipecah (uji fixture gagal dulu, atau APK
  terbit dengan nama lama). Mitigasi: fase 1 satu commit + gate CI.
- **Risiko pilot:** peserta yang tidak membaca instruksi memasang APK lama (pakai ulang berkas
  lama). Mitigasi: beri nama artefak jelas dan umumkan uninstall/reinstall di kanal pilot.
- **Risiko domain:** kandidat 1–4 batal bila domain ternyata tidak jadi dibeli — karena itu fase 0
  lebih dulu; **kandidat 5** (`com.github.29nls.rodakawan`) adalah fallback tanpa pembelian.
- **Rollback:** selama belum ada unggahan Play, kembalikan satu commit (fase 1) → nama lama
  aktif kembali dan seluruh fixture konsisten lagi. Setelah unggah Play pertama, rollback berarti
  **tidak bisa** — itulah alasan keputusan ini diambil sekarang.
- **Tidak terpengaruh:** RLS/database (tidak ada perubahan backend), keystore/sertifikat
  penandatangan, `versionCode` (lanjut naik, tidak perlu direset — applicationId baru berarti
  instalasi baru yang mulai dari mana pun), dan URL deep-scheme (`rodakawan://` di `app.json`
  `scheme` — berbeda dari nama paket, tidak wajib ikut berubah).

## 5. Yang belum bisa dibuktikan dari repo

- Kepemilikan/aktual ketersediaan domain saat pendaftaran (RDAP/NXDOMAIN hanya membuktikan
  *belum terdaftar saat dicek* — siapa pun bisa mendaftarkan di antaranya).
- Ketiadaan bentrok nama paket di Play Store diverifikasi penuh hanya oleh Play Console saat
  unggah pertama; pencaring web hanyal indikasi awal.
- Uji perangkat pilot pasca-migrasi (PD-01) tetap **Blocked** sampai APK baru dibagikan.
