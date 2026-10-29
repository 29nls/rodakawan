# Tiket implementasi — peta konvoi realtime (tindak lanjut ADR-082)

Tanggal: 28 Oktober 2026 · Status: **MAP-1 dan MAP-2 diimplementasikan di source lokal; uji native di perangkat belum dilakukan** ·
Keputusan induk: **ADR-082** di [`PROJECT_DECISIONS.md`](PROJECT_DECISIONS.md) (menggantikan
ADR-064) · Prasyarat teknis: [`src/features/map/README.md`](../src/features/map/README.md)

Tujuan tiket: **mengganti layar daftar posisi di detail perjalanan dengan komponen peta yang
menampilkan marker posisi peserta secara realtime**, tanpa menghapus daftar peserta sebagai
lapisan kedua, dan dengan penanganan lokasi basi serta opt-out yang tetap jujur. Tanpa style URL
yang valid dan renderer yang terdaftar, layar harus tetap jatuh ke keadaan eksplisit yang sudah
ada (bukan peta tiruan).

## 0. Prasyarat di luar kode (pemilik)

| # | Prasyarat | Pihak | Status |
| --- | --- | --- | --- |
| P-1 | Buat akun MapTiler dan pilih paket: **Free $0** (non-komersial, 5.000 sesi + 100.000 request/bulan, logo MapTiler wajib) untuk pilot internal, atau **Flex US$30/bulan** bila RodaKawan dianggap komersial | Pemilik | **Blocked** — agent tidak membuat akun provider |
| P-2 | Isi `EXPO_PUBLIC_MAP_STYLE_URL` di `.env.local` (lokal) dan `BETA_MAP_STYLE_URL` (GitHub variable, lihat `BETA_RUNBOOK.md` §2) dengan style URL `https://api.maptiler.com/…style.json?key=…`. Nilai publik, bukan rahasia, tetapi **jangan di-commit** | Pemilik | **Blocked** menunggu P-1 |
| P-3 | Setel alert/batas kuota di dashboard MapTiler (kunci di klien selalu bisa diekstrak; pengikatan package+SHA-1 tidak tersedia di MapTiler) | Pemilik | **Blocked** menunggu P-1 |

Semua tiket di bawah boleh dikerjakan paralel untuk bagian kode yang tidak bergantung P-1/P-2.
MAP-1 dan MAP-2 dapat dipasang tanpa kredensial; adapter sudah terdaftar, tetapi peta baru
menggambar tile setelah P-1 + P-2 selesai — `resolveMapRenderState` memilih `unconfigured` bila
URL gaya tidak tersedia, dan itu memang perilaku yang benar.

## 1. Urutan tiket

### MAP-1 — Pasang dependency renderer (native)

- **Implemented:** `npx expo install @maplibre/maplibre-react-native` memasang versi 11.5.0 (peer:
  `expo >=54`, `react >=19.1`, `react-native >=0.80`); dependency dan lockfile direkam.
- **Implemented:** plugin `@maplibre/maplibre-react-native` ditambahkan ke `plugins` di `app.json`;
  `npx expo prebuild --platform android --no-install` berhasil menghasilkan proyek native.
- **Penerimaan native belum dibuktikan:** development build belum dibangun/dipasang dan aplikasi
  belum dibuka di emulator/perangkat. Paket ini **tidak jalan di Expo Go**.
- Risiko regresi: `deps:check`/lockfile berubah → jalankan `npm ci`, `npm run typecheck`, `npm test`.

### MAP-2 — Adapter renderer + pendaftaran di layar

- **Implemented:** `src/features/map/MapLibreRenderer.tsx` memakai API paket 11.5.0 yang
  terverifikasi dari tipe terpasang (`Map`, `Camera`, `Marker`; bukan `MapView`/`MarkerView`).
- **Implemented:** didaftarkan di `src/app/ride.tsx` melalui
  `renderer: { provider: 'maptiler', renderer: MapLibreRenderer }`.
- Marker memuat nama, status kesegaran dan umur posisi; basi/offline terlihat beda lewat teks,
  warna status, dan opasitas. Kamera awal ditentukan dari region marker.
- **Unit Passed locally:** `MapCanvas` menguji adapter yang terdaftar serta marker live/basi; tanpa
  konfigurasi fungsi `resolveMapRenderState` tetap menghasilkan notice `unconfigured`.
- **Penerimaan native masih Blocked:** peta belum dicoba di development build/perangkat; URL gaya
  MapTiler dan akun provider juga masih prasyarat sebelum tile bisa dimuat.

### MAP-3 — Konfigurasi build (gaya peta)

- Pastikan `.env.example` tetap memuat placeholder yang **dibuang** `readPublicEnv` (jangan pernah
  menggantinya dengan URL nyata).
- Workflow beta: `BETA_MAP_STYLE_URL` diisi dari GitHub variable setelah P-2; build menolak nilai
  non-https/placeholder (perilaku `resolveMapRenderState` sudah menguji ini).
- **Penerimaan:** build dengan style URL kosong → keadaan "Peta belum dikonfigurasi"; build dengan
  URL `http://` → pesan perbaikan; host tak dikenal → peta tidak digambar (tanpa tile tanpa
  atribusi).

### MAP-4 — Marker realtime dan penanganan lokasi basi

- Sumber data tetap yang sudah ada: `subscribeRideLocations` (Postgres Changes, RLS) →
  `details.locations` → `buildRideMarkers` (memo `ride.tsx` baris ~525). **Tidak ada jalur
  baru** — realtime tidak berubah, RLS tetap penentu akses.
- **Lokasi basi:** `freshness` dihitung `locationFreshness(recorded_at, now)` (ambang 60 detik,
  ADR-065). Renderer harus menampilkan perbedaan visual antara `fresh` / `stale` (mis. marker
  redup/berlabel "basi • 2 mnt lalu"); posisi basi **tidak boleh** tampak live. Perbarui label
  saat `now` berdetak (layar sudah memakai `now` untuk daftar).
- **Laju render:** update `ride_locations` datang per event (sampling 15 detik/25 m per ADR-065);
  jangan menambah polling. Bila interpolasi halus diinginkan, lakukan di klien antar dua titik
  terakhir (jangan menulis database lebih sering demi animasi).
- **Penerimaan:** dengan dua akun nyata, pergerakan B terlihat di A ≤ beberapa detik setelah
  event; membekukan jam (mock `now`) membuktikan marker berubah status menjadi basi dan labelnya
  ikut; tidak ada label "live" pada koordinat berumur > 60 detik.

### MAP-5 — Opt-out, keluar, dan akhir perjalanan

- Mekanisme database sudah ada dan tidak boleh diubah: opt-out/keluar/dikeluarkan **menghapus**
  baris `ride_locations` (trigger `20261019120000_ride_workflow.sql`), `completed`/`cancelled`
  menghapus seluruh lokasi ride. Karena itu marker hilang lewat event DELETE realtime.
- Filter keanggotaan sudah ada di `buildRideMarkers` (hanya `status = 'joined'` + koordinat
  valid) — cermin `ride_locations_select_active_member`. Jangan menambah cache marker lokal yang
  bisa menampilkan peserta yang sudah keluar.
- **Penerimaan (skenario):** (a) B opt-out → marker B hilang dari layar A dalam hitungan detik;
  (b) host mengeluarkan B → marker hilang; (c) ride `completed` → seluruh marker hilang; (d)
  setelah semua opt-out, layar tetap memuat peta kosong yang bermakna (region terakhir boleh
  dipertahankan) tanpa koordinat palsu tersisa di memori UI.

### MAP-6 — Atribusi, logo, dan kegagalan tile

- `MapAttribution` sudah merender `© MapTiler © OpenStreetMap contributors` sebagai tautan —
  **jangan disembunyikan/ditumpuk kontrol lain**.
- **Implemented:** logo MapTiler resmi dibundel di `src/features/map/maptiler-logo.svg`, dirender
  pada peta lewat `react-native-svg`, dan membuka situs MapTiler saat ditekan. Logo ditampilkan di
  semua paket; paket Free mewajibkannya. Sumber: <https://api.maptiler.com/resources/logo.svg> dan
  panduan atribusi resmi <https://docs.maptiler.com/guides/map-design/attribution/add-attribution/>.
- **Implemented:** `MapLibreRenderer` mengubah callback `onDidFailLoadingMap` menjadi pesan
  "Peta gagal dimuat" yang menyarankan pemeriksaan koneksi/URL gaya; tombol **Coba lagi** memuat
  ulang view native. Callback awal/berhasil membersihkan error. MapLibre tidak menyertakan detail
  penyebab pada callback, jadi UI tidak mengklaim tahu apakah sebabnya jaringan, key, kuota, atau
  style.
- **Unit Passed locally:** simulasi callback gagal → pesan tampak → coba lagi membuat ulang map;
  callback sukses membersihkan pesan; tes logo lokal dan tautannya.
- **Penerimaan perangkat masih Blocked:** mode pesawat/kuota/URL salah harus diverifikasi di
  development build; atribusi dan logo harus tampak di seluruh keadaan peta aktif.

### MAP-7 — Uji dan penerimaan

- **Unit (wajib, tanpa perangkat):** pendaftaran renderer, mapping `MapRendererProps`, keadaan
  `resolveMapRenderState`, marker basi/label, filter `joined`, region. Pada verifikasi 29 Oktober
  2026: **33 tes di 3 suite peta lulus**; `npm run typecheck`, `npm run lint`, dan
  `npm run format:check` lulus.
- **Perangkat (wajib sebelum mengklaim "lulus"):** isi baris `docs/QA_TEST_PLAN.md` §8f —
  **PD-03** (marker realtime + label segar/basi), **PD-13** (opt-out/keluar menghapus marker),
  **PD-21** (non-anggota tidak menerima baris/marker apa pun), plus penerimaan MAP-6. Isi dengan
  perangkat, waktu, versi APK/SHA-256, dan bukti — mulai dari **Blocked**.
- **Bukan bukti:** kelulusan unit/Jest, ekspor bundle JS, atau sinkronisasi prebuild tidak membuktikan
  APK native berhasil dibangun ataupun peta tergambar; jangan menandai PD berdasarkan kode.

### Persiapan verifikasi native Android (29 Oktober 2026)

- **Passed locally:** `npx expo prebuild --platform android --no-install --no-clean` berhasil
  menyelaraskan plugin MapLibre tanpa menghapus dan membuat ulang folder `android/` yang sudah ada.
- **Passed locally:** `npm run export:android` membundel entry Android dan aset logo SVG lokal.
  Ini hanya pemeriksaan bundle JavaScript/aset, bukan APK native.
- **Blocked:** `./android/gradlew -p android :app:assembleDebug --no-daemon --stacktrace`
  berhenti pada konfigurasi project karena lokasi Android SDK tidak ditemukan. `ANDROID_HOME` dan
  `ANDROID_SDK_ROOT` tidak terisi, tidak ada `android/local.properties`, dan `adb` tidak tersedia
  pada PATH; kompilasi APK belum terjadi.
- **Langkah operator berikutnya:** pasang/konfigurasikan Android SDK, platform/build-tools dan NDK
  sesuai versi pada log Gradle; arahkan `ANDROID_HOME` atau `ANDROID_SDK_ROOT` ke SDK lokal (atau
  buat `android/local.properties` lokal yang tidak di-commit), lalu pastikan `adb devices` melihat
  emulator/perangkat uji. Build development dengan konfigurasi MapTiler yang sah melalui
  `npx expo run:android` (atau `./android/gradlew -p android :app:assembleDebug` untuk build debug),
  pasang dan buka aplikasi, kemudian jalankan pemeriksaan peta di bawah. Jangan salin/rekam nilai
  style URL atau koordinat nyata ke bukti.
- **Pemeriksaan native peta:** dengan style URL MapTiler yang sah, pastikan tile tampil dan baris
  atribusi MapTiler/OSM serta logo tertaut terlihat; pastikan marker anggota dan label umur posisi
  benar. Uji kegagalan jaringan lalu **Coba lagi**, pemulihan setelah koneksi kembali, opt-out/keluar
  yang menghapus marker, dan penolakan akses bagi non-anggota. Catat hasil di PD-03/PD-13/PD-21
  beserta identitas perangkat, waktu, versi APK dan SHA-256 serta bukti tersanitasi. Sampai langkah
  ini benar-benar dijalankan, seluruh penerimaan native/perangkat tetap **Blocked**.

## 2. Kriteria penerimaan umum

1. Peta hanya tergambar dengan style URL https yang valid + provider dikenal + renderer
   terdaftar; selain itu keadaan eksplisit lama tetap tampil.
2. Marker = anggota `joined` dengan baris lokasi; label memuat nama + umur posisi; basi tidak
   tampak live.
3. Opt-out/keluar/dikeluarkan/ride final menghilangkan marker lewat event realtime yang sama —
   tanpa tombol "sembunyikan marker" di UI.
4. Non-anggota menerima 0 baris dan 0 marker (dibuktikan di backend + PD-21).
5. Atribusi provider selalu terlihat pada keadaan `ready`; tile gagal tidak menghasilkan layar
   kosong.
6. Tanpa konfigurasi, tidak ada tile yang dimuat, tidak ada marker contoh, tidak ada koordinat
   palsu.

## 3. Di luar lingkup (sengaja tidak dikerjakan)

- Geocoding/routing dan pengiriman koordinat pengendara ke provider (butuh keputusan privasi
  terpisah).
- Peta offline penuh (tanpa perjanjian tertulis dengan provider).
- Peta laporan bahaya ( layar hazard tetap daftar + label area; keputusan terpisah).
- Mengganti Postgres Changes dengan Broadcast (ADR-065; butuh policy `realtime.messages` oleh
  pemilik project).

## 4. Rollback

Keluarkan pendaftaran renderer di `ride.tsx` → layar kembali ke `renderer_missing` dengan daftar
posisi; kembalikan dependency lewat revert commit bila MAP-1 menimbulkan masalah native. Tidak ada
migration, tidak ada perubahan backend, tidak ada data yang diubah tiket ini.

## 5. Ringkasan status per tiket

| Tiket | Bergantung | Status |
| --- | --- | --- |
| MAP-1 dependency + plugin | — | **Implemented** (`@maplibre/maplibre-react-native` 11.5.0 di package/lock dan plugin Expo di `app.json`); prebuild/dev build Android dan uji buka aplikasi masih perlu diverifikasi |
| MAP-2 adapter + pendaftaran | MAP-1 | **Implemented** (`MapLibreRenderer.tsx`, pendaftaran di `ride.tsx`); unit/typecheck dijalankan lokal, render native menunggu development build |
| MAP-3 konfigurasi build | P-1, P-2 | **Blocked** |
| MAP-4 marker realtime + basi | MAP-2 | **Implemented** di rencana; data layer sudah ada |
| MAP-5 opt-out/lifecycle | MAP-2 | **Implemented** di rencana; trigger + filter sudah ada |
| MAP-6 atribusi + logo + galat tile | MAP-1 | **Implemented** di source lokal (atribusi teks + logo SVG resmi lokal dan tertaut; callback gagal/sukses + tombol coba ulang); uji mode pesawat/native masih **Blocked** menunggu development build |
| MAP-7 uji unit + perangkat | MAP-1…MAP-6 | Unit bisa dijalankan; perangkat **Blocked** (PD-03/PD-13/PD-21) |
