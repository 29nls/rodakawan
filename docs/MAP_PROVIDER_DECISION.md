# Keputusan penyedia peta/tile (Milestone 3)

Status: **Diputuskan** — ADR-082 (28 Oktober 2026) menetapkan **MapLibre + MapTiler** dan menggantikan ADR-064.
Dokumen ini tetap menjadi arsip bahan perbandingan. Tanggal riset: 2026-10-19; riset susulan 2026-10-28 (§6).
Pemilik keputusan: pemilik produk + engineering. ADR terkait: ADR-009, ADR-064 (Superseded), ADR-065, ADR-082.

**Catatan historis 19 Oktober 2026:** alur perjalanan dan berbagi lokasi saat itu dirilis tanpa
renderer peta; layar detail menampilkan daftar peserta dan umur posisi. Rekomendasi waktu itu adalah
MapLibre + MapTiler Flex, tetapi keputusan pemilik produk belum ada.

**Status saat ini (28 Oktober 2026):** ADR-082 telah menetapkan MapLibre + MapTiler dan dependency
serta adapter native telah dipasang. Logo resmi MapTiler kini dibundel secara lokal dan callback
kegagalan gaya menampilkan pemulihan/coba lagi (MAP-6). Dokumen ini adalah arsip perbandingan, bukan
gerbang persetujuan saat ini. Pemilik tetap perlu mengatur akun/paket, style URL dan kuota;
development build serta uji perangkat masih diperlukan sebelum menyatakan peta tervalidasi.

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

Pilihan final dicatat di ADR-082 (menggantikan status "Belum final" ADR-009); dependency
`@maplibre/maplibre-react-native` dipasang mengikuti keputusan tersebut. Bagian awal dokumen ini
mempertahankan konteks historis dari riset sebelumnya.

## 5. Pembaruan riset 20 Oktober 2026 dan usulan keputusan

Bagian ini mencatat keadaan pada 20 Oktober 2026. Saat itu ADR-064 masih **Proposed**, dependency
peta belum ditambahkan, dan layar perjalanan menampilkan daftar posisi + label kesegaran. Keputusan
final berikutnya dicatat sebagai ADR-082 pada 28 Oktober 2026.

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

### Rekomendasi saat riset dilakukan (status saat itu: Proposed)

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

### Lapisan renderer yang sudah disiapkan (20 Oktober 2026)

Pada saat catatan 20 Oktober dibuat, tanpa menambahkan dependency, kontrak renderer sudah dipisahkan
dari layar di [`src/features/map/`](../src/features/map/README.md): `provider.ts` (keadaan peta,
atribusi wajib, marker dari lokasi terakhir, region awal), `MapAttribution.tsx`, dan `MapCanvas.tsx`
(slot renderer + keadaan “belum dikonfigurasi/gagal”). Pemasangan MapLibre kemudian mengikuti
kontrak itu.

Konsekuensi yang sudah diuji: URL gaya non-https, host provider tak dikenal (atribusi tidak bisa
ditentukan), dan nilai contoh `.env.example` semuanya berhenti sebagai keadaan eksplisit — bukan peta
tanpa atribusi.

### Gerbang yang dicatat sebelum keputusan final (historis)

Daftar di atas mencerminkan gerbang yang berlaku sebelum ADR-082. Pada 28 Oktober 2026 keputusan
final memilih MapLibre + MapTiler. Dependency dan adapter kemudian ditambahkan; penerimaan native
masih memerlukan development build dan style URL yang sah. Lihat [`MAP_REALTIME_TICKET.md`](MAP_REALTIME_TICKET.md)
untuk prasyarat pemilik serta status perangkat terbaru.

### Catatan 26 Oktober 2026: pilot internal berjalan tanpa peta

Pada tanggal itu keputusan gerbang adalah **tidak** memasang renderer: ADR-064 masih **Proposed**, belum
ada akun/kunci provider, dan uji perangkat belum dijadwalkan. Kontrak `src/features/map/` beserta 27
tesnya tetap lulus. Keputusan tersebut bersifat historis; ADR-082 dan status implementasi terkini
tercatat sesudahnya.

## 6. Riset 28 Oktober 2026: `react-native-maps` vs MapLibre React Native

Riset ini menjawab pertanyaan yang tersisa sebelum ADR-082 dibuat. Angka diverifikasi dari
halaman resmi pada 28 Oktober 2026; dua koreksi terhadap dokumen lama dicatat di bawah.

| Aspek | `react-native-maps` | `@maplibre/maplibre-react-native` |
| --- | --- | --- |
| Lisensi | **MIT** (lisensi pustaka tidak memberi hak atas data/tile) | Paket RN: **MIT**; inti `maplibre-native`: **BSD-2-Clause**. (Koreksi: BSD-3-Clause milik MapLibre GL JS, bukan dua artefak ini) |
| Biaya | Renderer gratis; di Android mengunci ke Google Maps — **billing account wajib** walau SKU Maps SDK Android kini "Unlimited"/tanpa biaya; riwayat kredit US$200/bulan sudah tidak berlaku sebagai cara membaca harga | Renderer gratis; biaya ada di tile provider. MapTiler Free $0 (5.000 sesi + 100.000 request/bulan, non-komersial) / **Flex $30/bulan**; meteran untuk SDK pihak ketiga = request tile |
| Dukungan Expo | **Jalan di Expo Go** (docs Expo); untuk Google Maps butuh API key + rebuild. Fabric/RN ≥0.81.1 sejak 1.26.1 (cocok RN 0.86) | **Tidak jalan di Expo Go**: butuh config plugin + `expo prebuild` + dev client. v11 hanya New Architecture; peer `expo >=54`, `react-native >=0.80` (cocok SDK 57) |
| Performa realtime (2–10 marker, update beberapa detik) | Cukup; catatan isu Android: custom marker view berat — pakai marker gambar/default dan interpolasi lokal (`AnimatedRegion`) | Cukup; keunggulan praktisnya sumber `GeoJSONSource` + layer native untuk banyak fitur sekaligus, bukan benchmark yang membuktikan lebih cepat |
| Integrasi Supabase Realtime | Netral — keduanya mengonsumsi event JS yang sama; ADR-065 memakai Postgres Changes + RLS | Sama; tidak ada library peta yang memengaruhi jalur realtime |
| Dukungan tile provider | `UrlTile` = overlay raster XYZ di atas basemap (di Android perlu `mapType="none"`); bukan gaya vektor first-class | Style URL/Style JSON langsung: MapTiler, Protomaps, gaya sendiri; raster dan vektor lewat sistem gaya |
| Status rilis (2026) | 1.29.11 (27 Sept 2026) — aktif | 11.5.0 (4 Okt 2026) — aktif |

Sumber: <https://github.com/react-native-maps/react-native-maps> (lisensi, tabel kompatibilitas,
catatan marker), <https://docs.expo.dev/versions/latest/sdk/map-view/> (Expo Go + plugin),
<https://developers.google.com/maps/documentation/android-sdk/usage-and-billing> (billing wajib),
<https://maplibre.org/maplibre-react-native/docs/setup/expo/> dan
<https://maplibre.org/maplibre-react-native/docs/setup/migrations/v11/> (Expo + v11),
<https://github.com/maplibre/maplibre-react-native/blob/main/package/package.json> (lisensi MIT),
<https://github.com/maplibre/maplibre-native/blob/main/LICENSE.md> (BSD-2-Clause),
<https://www.maptiler.com/cloud/pricing/>, <https://docs.maptiler.com/guides/account/sessions-vs-requests/>,
<https://operations.osmfoundation.org/policies/tiles/>.

**Kesimpulan (diadopsi sebagai ADR-082):** untuk konvoi 2–10 pengguna, performa bukan pemilih —
keduanya cukup. Pemilihnya adalah (a) kebebasan mengganti tile provider tanpa mengganti renderer,
(b) menghindari akun billing + telemetri Google di Android, dan (c) kenyataan bahwa pipeline proyek
sudah memakai development build sehingga batasan "tidak bisa di Expo Go" bukan kerugian nyata.
Rencana implementasi: [`MAP_REALTIME_TICKET.md`](MAP_REALTIME_TICKET.md).
