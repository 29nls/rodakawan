# Keputusan penyedia peta/tile (Milestone 3)

Status: **Belum diputuskan** — bahan keputusan, bukan keputusan. Tanggal riset: 2026-10-19.
Pemilik keputusan: pemilik produk + engineering. ADR terkait: ADR-009, ADR-064, ADR-065.

**Pembaruan 19 Oktober 2026:** alur perjalanan dan berbagi lokasi sudah dirilis di lapisan aplikasi
tanpa renderer peta. Layar detail menampilkan daftar peserta beserta umur posisi dan menyatakan peta
belum tersedia; tidak ada tile publik, URL contoh, atau marker palsu. Rekomendasi teknis yang masih
menunggu persetujuan pemilik produk adalah **MapLibre + MapTiler Flex** (biaya/kuota jelas, atribusi
OSM, dan paket berbayar untuk penggunaan komersial), tetapi dependency peta **belum** ditambahkan
sampai provider, lisensi komersial, dan kredensial yang dibatasi per aplikasi disetujui.

Dokumen ini tidak menambahkan dependency apa pun. Jangan memasang library peta atau memanggil tile
provider produksi sebelum salah satu opsi di bawah dipilih dan dicatat sebagai ADR final.

## 1. Yang perlu dipisahkan

Ada dua keputusan yang sering tercampur:

1. **Renderer** — library React Native yang menggambar peta. Opsi yang dirawat saat ini:
   `@maplibre/maplibre-react-native` (MapLibre Native; butuh config plugin + `expo prebuild`,
   tidak jalan di Expo Go) dan `@rnmapbox/maps` (Mapbox SDK; juga config plugin/prebuild, tidak
   jalan di Expo Go). Keduanya perlu diuji dengan Expo SDK 57 / React Native 0.86 di development
   build sebelum dipakai.
2. **Tile/geocoding provider** — layanan yang menyajikan tile dan API lain. Renderer tidak memberi
   kuota, SLA, hak offline, atau lisensi data; semuanya berasal dari provider.

Untuk Milestone 3, marker posisi pengendara dapat digambar sebagai layer di atas peta. Itu **tidak
otomatis** mengirim koordinat pengendara ke provider peta: yang dikirim adalah permintaan tile untuk
area yang terlihat, ditambah metadata jaringan. Koordinat baru terkirim bila aplikasi/SDK mengirimnya
(mis. routing, geocoding, atau telemetri lokasi).

## 2. Perbandingan

Angka di bawah adalah hasil riset 19 Oktober 2026 dan **harus diperiksa ulang** sebelum dipakai.

| Opsi | Biaya/kuota | Lisensi & atribusi | Offline | Privasi | Catatan operasional |
| --- | --- | --- | --- | --- | --- |
| **MapTiler Cloud** + MapLibre | Gratis: 100.000 request/bulan, 5.000 sesi/bulan, berhenti saat kuota habis; Flex US$30/bulan: 500.000 request, 25.000 sesi, kelebihan US$0,15/1.000 request | Atribusi MapTiler + OpenStreetMap; paket gratis juga mewajibkan logo MapTiler | Cache sementara di perangkat diizinkan; unduhan massal/ekspor dilarang tanpa perjanjian. Fitur offline SDK tidak otomatis menjadi hak untuk MapLibre | Menyatakan tidak melacak/menjual data pengguna; CDN menyimpan IP di memori hingga ±20 menit; permintaan tile mengungkap area | Paket gratis non-komersial; konfirmasi tertulis untuk penggunaan komersial dan untuk unduhan offline |
| **Mapbox** + `@rnmapbox/maps` | Maps SDK mobile: 25.000 MAU/bulan gratis, lalu mulai US$4/1.000 MAU | Logo/atribusi Mapbox + OpenStreetMap, tombol atribusi tidak boleh disembunyikan | Didukung SDK (batas 750 tile pack unik); termasuk tagihan MAU | SDK mengirim telemetri lokasi/perangkat; aplikasi wajib menyediakan opt-out; ada session ID berputar dan penyimpanan IP | Ketentuan "vehicle usage" dapat menuntut lisensi terpisah untuk aplikasi terkait kendaraan — perlu konfirmasi tertulis |
| **Stadia Maps** + MapLibre | Gratis 200.000 kredit/bulan, **non-komersial**; Starter US$20/bulan (1 juta kredit), Standard US$80 (7,5 juta), Professional US$250 (25 juta) | © Stadia Maps © OpenMapTiles © OpenStreetMap; atribusi yang dihasilkan tidak boleh dihapus | Cache offline kecil diizinkan hingga 100 MB per perangkat; cache server dilarang | Menyatakan request stateless/tanpa cookie dan tidak menyimpan riwayat lokasi; log layanan/IP ±7–14 hari | Paket berbayar diperlukan untuk komersial; kredit per tile perlu dihitung dari pola pemakaian |
| **Google Maps Platform** (native Android) | SKU Maps SDK Android saat ini tanpa batas gratis, tetapi billing dan API key tetap wajib; layanan lain (Routes, Places, Map Tiles API) punya SKU sendiri — Map Tiles API 100.000 event/bulan gratis lalu US$0,60/1.000 | Atribusi Google bawaan UI tidak boleh diubah/disembunyikan | Map Tiles API melarang prefetch/penyimpanan/offline; jangan menganggap cache SDK sebagai hak unduh | SDK mengumpulkan metadata perangkat, crash, IP, dan identifier pseudonim; interaksi peta dapat tercatat | Paling mudah di Android, tetapi mengunci ke ekosistem Google dan aturan kontennya lebih ketat |
| **Raster `tile.openstreetmap.org`** + MapLibre | Tidak ada harga/kuota/SLA komersial; layanan komunitas dan dapat memblokir pemakaian yang membebani | © OpenStreetMap contributors | **Dilarang** untuk offline/prefetch; cache normal harus mengikuti header HTTP (atau 7 hari) | Server menerima koordinat tile, IP, dan User-Agent; area yang dilihat dapat disimpulkan | Tidak layak sebagai layanan produksi komersial; hanya untuk prototipe lokal |

Sumber:

- MapTiler: <https://www.maptiler.com/cloud/pricing/>, <https://docs.maptiler.com/guides/account/sessions-vs-requests/>, <https://docs.maptiler.com/guides/map-design/attribution/add-attribution/>, <https://www.maptiler.com/terms/cloud/>, <https://docs.maptiler.com/guides/maps-apis/maps-platform/personal-data-in-maptiler-cloud/>
- Mapbox: <https://www.mapbox.com/pricing>, <https://docs.mapbox.com/help/dive-deeper/attribution/>, <https://docs.mapbox.com/help/dive-deeper/mobile-offline/>, <https://www.mapbox.com/telemetry>, <https://www.mapbox.com/legal/tos>
- Stadia Maps: <https://stadiamaps.com/pricing/>, <https://docs.stadiamaps.com/attribution/>, <https://stadiamaps.com/terms-of-service/>, <https://stadiamaps.com/privacy/privacy-commitment/>
- Google: <https://developers.google.com/maps/billing-and-pricing/pricing>, <https://developers.google.com/maps/documentation/android-sdk/usage-and-billing>, <https://developers.google.com/maps/documentation/tile/policies>, <https://developers.google.com/maps/documentation/android-sdk/play-data-disclosure>
- OSM: <https://operations.osmfoundation.org/policies/tiles/>, <https://osmfoundation.org/wiki/Privacy_Policy>
- Renderer: <https://maplibre.org/maplibre-react-native/docs/setup/expo/>, <https://github.com/maplibre/maplibre-react-native/releases>, <https://rnmapbox.github.io/docs/install>, <https://github.com/rnmapbox/maps/releases>

## 3. Pertanyaan yang harus dijawab pemilik produk

1. **Komersial atau tidak?** Paket gratis MapTiler dan Stadia tidak boleh dipakai untuk produk
   komersial. Bila RodaKawan akan dipublikasikan sebagai produk, pilih opsi berbayar atau konfirmasi
   lisensi tertulis.
2. **Perlu offline?** Bila ya, Mapbox dan Stadia punya mekanisme resmi; MapTiler dan OSM public tiles
   tidak boleh dipakai untuk unduhan massal tanpa perjanjian. Bila tidak, batasan ini hilang.
3. **Seberapa besar toleransi berbagi data dengan provider?** Semua provider melihat area peta dan
   IP. Bila kebijakan privasi RodaKawan ingin meminimalkan itu, Stadia/MapTiler lebih mudah
   dijelaskan daripada Google/Mapbox yang secara eksplisit mengumpulkan telemetri SDK.
4. **Apakah peta hanya dekorasi atau bagian inti?** Bila marker/ routing menjadi inti, biaya per MAU
   (Mapbox) atau per tile (MapTiler/Stadia) harus dihitung dengan perkiraan pengguna, bukan dipilih
   dari harga awal.
5. **Siapa yang mengoperasikan kunci API?** Semua opsi memerlukan kunci yang dibatasi per aplikasi
   (package name + SHA-1 untuk Android); kunci tidak boleh masuk repo dan harus punya kuota/alert.

## 4. Rekomendasi untuk diputuskan (bukan keputusan)

- **Prototipe lokal:** MapLibre + tile vektor dari provider berbayar yang lisensinya jelas; jangan
  memakai `tile.openstreetmap.org` untuk build yang dibagikan.
- **Bila prioritasnya kontrol biaya dan privasi:** MapTiler Flex atau Stadia Starter, dengan catatan
  paket komersial dan konfirmasi offline bila fitur itu dibutuhkan.
- **Bila prioritasnya kemudahan Android dan tidak butuh offline:** Google Maps SDK native, dengan
  konsekuensi telemetri dan aturan konten Google.

Pilihan final harus dicatat sebagai ADR (menggantikan status "Belum final" ADR-009) sebelum
`@maplibre/maplibre-react-native` atau `@rnmapbox/maps` ditambahkan ke `package.json`.

## 5. Pembaruan riset 20 Oktober 2026 dan usulan keputusan

Status ADR-064 kini **Proposed**, bukan final: rekomendasi teknis sudah diperbarui, tetapi pemilik
produk belum menyetujuinya. Dependency peta tetap belum ditambahkan, dan layar perjalanan tetap
menampilkan daftar posisi + label kesegaran (tanpa peta, tile publik, atau koordinat contoh).

Angka di bawah diverifikasi ulang dari halaman resmi pada 20 Oktober 2026. Yang berubah dari bagian 2:

| Opsi | Angka/ketentuan terverifikasi | Sumber |
| --- | --- | --- |
| **MapTiler Cloud** | Gratis **5.000 sesi + 100.000 request/bulan**, non-komersial, berhenti saat kuota habis. **Flex US$30/bulan**: 25.000 sesi + 500.000 request; kelebihan **US$2,50/1.000 sesi** atau **US$0,15/1.000 request** menurut model penagihan yang berlaku. Atribusi `© MapTiler © OpenStreetMap contributors`; paket gratis juga mewajibkan logo MapTiler bertaut. Cache sementara di perangkat diizinkan, **ekspor/unduh massal dilarang** tanpa perjanjian tertulis. Menyatakan peta tidak memuat kode pelacak dan tidak melacak aktivitas peta pengguna. | <https://www.maptiler.com/cloud/pricing/>, <https://www.maptiler.com/terms/cloud/>, <https://docs.maptiler.com/guides/map-design/attribution/add-attribution/> |
| **Stadia Maps** | Gratis **200.000 kredit/bulan**, **non-komersial**. **Starter US$20/bulan** = 1.000.000 kredit; kelebihan **US$0,03/1.000 kredit**; satu tile vektor/raster = satu kredit. Atribusi `© Stadia Maps © OpenMapTiles © OpenStreetMap`. Cache offline seluler maksimum **100 MB per perangkat**; cache biasa mengikuti header HTTP atau 7 hari. Log server/IP **±7–14 hari**. | <https://stadiamaps.com/pricing/>, <https://stadiamaps.com/terms-of-service/>, <https://docs.stadiamaps.com/attribution/> |
| **Mapbox** | Maps SDK seluler: **25.000 MAU/bulan gratis**, tier berikutnya **US$4/1.000 MAU**. SDK mengirim data lokasi/penggunaan tanpa identitas dan opt-out individual wajib (kontrol atribusi). Ketentuan *vehicle usage* menuntut lisensi terpisah untuk penggunaan produksi terkait kendaraan. | <https://www.mapbox.com/pricing>, <https://docs.mapbox.com/android/maps/guides/>, <https://www.mapbox.com/legal/tos> |
| **Google Maps Platform** | SKU **Maps SDK for Android** kini tercatat dengan batas gratis **"Unlimited"**, berbeda dari SKU **Dynamic Maps** (10.000 event/bulan gratis lalu US$7/1.000). Billing dan API key tetap wajib. **Map Tiles API**: 100.000 tile 2D/bulan gratis. Map Tiles API melarang prefetch/penyimpanan. | <https://developers.google.com/maps/billing-and-pricing/pricing>, <https://developers.google.com/maps/documentation/tile/usage-and-billing> |
| **OpenStreetMap raster publik** | Tetap bukan opsi produksi: layanan komunitas tanpa SLA, offline/prefetch dilarang, dan pemakaian berat dapat diblokir. | <https://operations.osmfoundation.org/policies/tiles/> |
| **`@maplibre/maplibre-react-native`** | Rilis terbaru **11.5.0** (4 Oktober 2026). Peer dependency menyatakan `expo >=54` dan `react-native >=0.80`, jadi SDK 57 / RN 0.86 berada di dalam rentang yang dideklarasikan — **tidak ada pernyataan resmi** bahwa SDK 57 diuji khusus. Versi 11 hanya untuk arsitektur baru. Butuh **config plugin + prebuild** dan **tidak jalan di Expo Go**. Default Android: minSdk 24, Kotlin 2.0.21, compileSdk 35, NDK 27.1.12297006. | <https://github.com/maplibre/maplibre-react-native/releases>, <https://maplibre.org/maplibre-react-native/docs/setup/expo/> |

### Koreksi penting: pembatasan kunci API

Bagian 3 pertanyaan 5 menyebut "kunci yang dibatasi per aplikasi (package name + SHA-1)". Setelah
diperiksa, pembatasan itu adalah fitur **Google Cloud**; tidak semua provider menyediakannya:

- **Google Maps**: kunci dapat dibatasi ke **Android apps** dengan package name + SHA-1 (ada di
  Google Cloud Console).
- **MapTiler**: panduan aplikasi native menyebut pengamanan kunci lewat **"Allowed User-Agent"**
  (substring), bukan package name + SHA-1.
- **Stadia Maps**: menyarankan API key + penyimpanan aman (mis. Android Keystore) dan pembatasan
  pemakaian; pengikatan kunci ke package name + SHA-1 **tidak terverifikasi** ada.

Artinya untuk MapLibre + MapTiler, "kunci yang dibatasi per aplikasi" **tidak bisa** dijanjikan
seperti pada Google. Pengamannya: kunci hanya di env build (bukan repo), batas kuota + alert di
dashboard MapTiler, rotasi kunci bila bocor, dan kesadaran bahwa kunci di aplikasi klien selalu bisa
diekstrak. Ini risiko yang harus disetujui pemilik produk, bukan sesuatu yang bisa dihilangkan
dengan konfigurasi.

### Rekomendasi (status: Proposed)

**MapLibre + MapTiler Flex** untuk renderer dan tile.

- Renderer open-source, tanpa tagihan per MAU, dan tetap bisa diganti provider tile lain bila harga
  MapTiler berubah — berbeda dari `@rnmapbox/maps` yang mengunci ke Mapbox.
- Flex US$30/bulan memberi 25.000 sesi + 500.000 request; untuk pilot dengan puluhan pengendara,
  pemakaian tile jauh di bawah kuota, dan batasnya terlihat serta berhenti (bukan tagihan kejutan).
- Tidak ada telemetri SDK lokasi pengendara; yang terlihat provider hanya area tile + IP.
- Perlu disetujui: (a) paket berbayar sejak awal bila RodaKawan dipakai komersial, (b) tidak ada
  peta offline penuh (hanya cache sementara), (c) pengamanan kunci memakai User-Agent + kuota, bukan
  package + SHA-1.

Alternatif bila ingin menghindari biaya bulanan pada pilot non-komersial: **MapLibre + Stadia Maps
Starter** (US$20/bulan, 1 juta kredit, cache offline 100 MB). Alternatif bila prioritasnya kemudahan
Android dan siap menerima telemetri serta lisensi kendaraan: **Google Maps SDK**.

### Yang harus terjadi sebelum implementasi

1. Pemilik produk menerima salah satu opsi dan status ADR-064 diubah dari **Proposed** menjadi
   **Disetujui** di [`PROJECT_DECISIONS.md`](PROJECT_DECISIONS.md).
2. Akun provider + paket yang sesuai dibuat, lalu kunci/URL gaya peta disimpan sebagai
   `EXPO_PUBLIC_MAP_STYLE_URL` (variabel publik yang **sudah** dibaca `src/lib/env.ts`; nilainya
   bukan rahasia, tetapi tetap tidak boleh di-commit).
3. `@maplibre/maplibre-react-native` ditambahkan, config plugin dipasang, dan **development build**
   dibangun — bukan Expo Go.
4. Renderer dibungkus lapisan provider tunggal, atribusi MapTiler + OSM ditampilkan, dan keadaan
   "peta belum dikonfigurasi"/galat tetap eksplisit.
5. Baru setelah itu marker posisi peserta (hanya anggota aktif, lewat RLS yang sudah ada) dikerjakan.
