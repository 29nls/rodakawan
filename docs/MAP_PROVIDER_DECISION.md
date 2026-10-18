# Keputusan penyedia peta/tile (Milestone 3)

Status: **Belum diputuskan** — bahan keputusan, bukan keputusan. Tanggal riset: 2026-10-19.
Pemilik keputusan: pemilik produk + engineering. ADR terkait: ADR-009, ADR-064.

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
