# Lapisan provider peta

ADR-082 (28 Oktober 2026) menetapkan **MapLibre + MapTiler** dan menggantikan ADR-064
(lihat [`docs/MAP_PROVIDER_DECISION.md`](../../../docs/MAP_PROVIDER_DECISION.md) dan
[`docs/MAP_REALTIME_TICKET.md`](../../../docs/MAP_REALTIME_TICKET.md)). Dependency MapLibre
11.5.0 terpasang; adapter dan pendaftarannya ada di `MapLibreRenderer.tsx` dan layar perjalanan.

## Isi

| Berkas | Tugas |
| --- | --- |
| `provider.ts` | Menebak provider dari URL gaya, memilih atribusi wajib, memutuskan keadaan peta (`unconfigured` / `renderer_missing` / `ready`), membangun marker dari lokasi terakhir peserta, dan menghitung region awal |
| `MapAttribution.tsx` | Menampilkan baris atribusi provider (mis. `© MapTiler © OpenStreetMap contributors`) sebagai tautan yang dapat ditekan |
| `maptiler-logo.svg` | Aset logo resmi MapTiler yang dibundel lokal untuk kewajiban paket Free |
| `MapCanvas.tsx` | Slot renderer: menggambar peta + atribusi bila renderer terdaftar, atau menampilkan alasan eksplisit bila belum |
| `MapLibreRenderer.tsx` | Adapter native MapLibre: kamera awal dari marker, marker berlabel nama dan usia lokasi, logo MapTiler lokal, serta pesan dan coba ulang bila gaya gagal dimuat |

Keadaan yang dijamin hari ini:

- tanpa `EXPO_PUBLIC_MAP_STYLE_URL` → "Peta belum dikonfigurasi untuk build ini…";
- URL ada tetapi bukan https → pesan perbaikan konfigurasi;
- host provider tidak dikenali → peta **tidak** digambar, karena atribusi wajibnya tidak bisa
  ditentukan (lebih baik tidak ada peta daripada tile tanpa atribusi);
- nilai contoh `.env.example` (`https://YOUR_TILE_PROVIDER/STYLE.json`) dibuang `readPublicEnv`,
  jadi tidak pernah dianggap terkonfigurasi;
- gaya valid tanpa renderer yang cocok/terdaftar → keadaan `renderer_missing` dan pesan yang dapat ditindaklanjuti (layar perjalanan dan diagnostik memasang MapLibre untuk MapTiler).

Tidak ada peta tiruan, tile publik, marker contoh, atau koordinat palsu di semua keadaan di atas.

## Integrasi MapLibre (MAP-1 dan MAP-2; kelanjutan ada di `docs/MAP_REALTIME_TICKET.md`)

1. **Dependency (MAP-1).** `@maplibre/maplibre-react-native` 11.5.0 sudah dipasang untuk SDK
   57. Peer dependency menyatakan `expo >=54`, `react-native >=0.80`; versi dan keputusan final
   dicatat di `docs/PROJECT_DECISIONS.md`.
2. **Config plugin (MAP-1).** Plugin `@maplibre/maplibre-react-native` sudah terdaftar di
   [`app.json`](../../../app.json); `npx expo prebuild --platform android --no-install` berhasil.
   Paket ini **tidak** jalan di Expo Go; perubahan native memerlukan development build baru.
3. **Gaya peta.** Isi `EXPO_PUBLIC_MAP_STYLE_URL` dengan URL gaya **https** dari akun provider
   (mis. `https://api.maptiler.com/maps/streets/style.json?key=…`). Nilai ini masuk bundel publik:
   jangan pernah menaruh kunci server/rahasia di sini, dan jangan memakai
   `tile.openstreetmap.org`.
4. **Adapter.** `src/features/map/MapLibreRenderer.tsx` memenuhi `MapRenderer` dengan API paket
   11.5.0 (`Map`, `Camera`, `Marker`; versi ini tidak mengekspor `MapView`/`MarkerView`). Marker
   menampilkan nama, status `Live`/`Basi`, dan umur posisi; kamera awal menghitung zoom dari region
   marker yang sudah dibangun di `MapCanvas`. Status basi dibedakan dengan label, warna, dan opasitas.
   Peta memakai tinggi minimum agar area native memiliki ruang render.

5. **Pendaftaran renderer (MAP-2)** sudah dilakukan di [`src/app/ride.tsx`](../../app/ride.tsx)
   dengan `renderer: { provider: 'maptiler', renderer: MapLibreRenderer }`. Bila URL kosong,
   non-HTTPS, atau host-nya bukan provider yang dikenal, kontrak `resolveMapRenderState` tetap
   mencegah pemanggilan renderer; layar mempertahankan pesan eksplisit dan daftar peserta.
6. **Atribusi dan logo wajib.** `MapAttribution` merender baris provider + OSM. Logo resmi MapTiler
   `maptiler-logo.svg` dibundel lokal dan ditautkan ke situs MapTiler di atas peta; jangan
   menyembunyikan, mengecilkan, atau menutupinya. Logo wajib untuk paket Free. Sumber logo:
   <https://api.maptiler.com/resources/logo.svg>; kewajiban paket: <https://docs.maptiler.com/guides/map-design/attribution/add-attribution/>.
7. **Batas yang tetap berlaku.** Tanpa perjanjian tertulis: tidak ada unduhan tile massal/offline,
   tidak ada cache di luar kebijakan provider, dan tidak ada pengiriman koordinat pengendara ke
   layanan provider (routing/geocoding) tanpa keputusan privasi terpisah.

## Kegagalan gaya peta

Adapter menangkap `onDidFailLoadingMap` MapLibre dan menampilkan pesan yang menyarankan pemeriksaan
koneksi serta URL gaya; tombol **Coba lagi** membuat ulang view native agar pemuatan dimulai ulang.
`onWillStartLoadingMap` dan `onDidFinishLoadingMap` membersihkan pesan pada pemuatan ulang/berhasil.
Callback native ini tidak menyertakan rincian penyebab; UI tidak menebak apakah masalahnya jaringan,
kunci, kuota, atau style.

## Uji

`src/features/map/__tests__` menguji keadaan, atribusi, logo lokal/tautannya, callback gagal-berhasil,
aksi coba ulang, marker, dan region tanpa perangkat. Uji native masih diperlukan untuk memastikan
tile/atribusi/logonya tampil pada development build serta verifikasi kegagalan jaringan dan marker
basi di perangkat.
