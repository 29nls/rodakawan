# Lapisan provider peta

ADR-064 masih **Proposed** (lihat [`docs/MAP_PROVIDER_DECISION.md`](../../../docs/MAP_PROVIDER_DECISION.md)),
jadi folder ini **tidak** mengimpor library peta apa pun. Isinya adalah kontrak supaya
pemasangan renderer nanti hanya menyentuh satu berkas, bukan layar perjalanan.

## Isi

| Berkas | Tugas |
| --- | --- |
| `provider.ts` | Murni, tanpa React: menebak provider dari URL gaya, memilih atribusi wajib, memutuskan keadaan peta (`unconfigured` / `renderer_missing` / `ready`), membangun marker dari lokasi terakhir peserta, dan menghitung region awal |
| `MapAttribution.tsx` | Menampilkan baris atribusi provider (mis. `© MapTiler © OpenStreetMap contributors`) sebagai tautan yang dapat ditekan |
| `MapCanvas.tsx` | Slot renderer: menggambar peta + atribusi bila renderer terdaftar, atau menampilkan alasan eksplisit bila belum |

Keadaan yang dijamin hari ini:

- tanpa `EXPO_PUBLIC_MAP_STYLE_URL` → "Peta belum dikonfigurasi untuk build ini…";
- URL ada tetapi bukan https → pesan perbaikan konfigurasi;
- host provider tidak dikenali → peta **tidak** digambar, karena atribusi wajibnya tidak bisa
  ditentukan (lebih baik tidak ada peta daripada tile tanpa atribusi);
- nilai contoh `.env.example` (`https://YOUR_TILE_PROVIDER/STYLE.json`) dibuang `readPublicEnv`,
  jadi tidak pernah dianggap terkonfigurasi;
- gaya valid tetapi renderer belum ada → "Gaya peta sudah dikonfigurasi, tetapi renderer peta belum
  dipasang di build ini."

Tidak ada peta tiruan, tile publik, marker contoh, atau koordinat palsu di semua keadaan di atas.

## Memasang MapLibre setelah ADR-064 disetujui

1. **Dependency.** `npx expo install @maplibre/maplibre-react-native` (versi yang cocok dengan SDK
   57; peer-dependency paket ini menyatakan `expo >=54`, `react-native >=0.80`). Catat versinya di
   `docs/PROJECT_DECISIONS.md` sebagai bagian dari keputusan provider, bukan sebagai dependency
   "sementara".
2. **Config plugin.** Tambahkan `"@maplibre/maplibre-react-native"` ke `plugins` di
   [`app.json`](../../../app.json), lalu `npx expo prebuild --platform android`. Paket ini **tidak**
   jalan di Expo Go; APK harus dibangun ulang (workflow rilis sudah memakai `expo prebuild`).
3. **Gaya peta.** Isi `EXPO_PUBLIC_MAP_STYLE_URL` dengan URL gaya **https** dari akun provider
   (mis. `https://api.maptiler.com/maps/streets/style.json?key=…`). Nilai ini masuk bundel publik:
   jangan pernah menaruh kunci server/rahasia di sini, dan jangan memakai
   `tile.openstreetmap.org`.
4. **Adapter.** Buat `src/features/map/MapLibreRenderer.tsx` yang memenuhi `MapRenderer`:

   ```tsx
   // Kerangka: periksa nama komponen pada versi paket yang benar-benar terpasang.
   import { Camera, MapView, MarkerView } from '@maplibre/maplibre-react-native';

   import type { MapRendererProps } from '@/features/map/provider';

   export const MapLibreRenderer = ({ styleUrl, markers, initialRegion }: MapRendererProps) => (
     <MapView style={{ flex: 1 }} mapStyle={styleUrl}>
       <Camera
         centerCoordinate={initialRegion ? [initialRegion.longitude, initialRegion.latitude] : undefined}
         zoomLevel={12}
       />
       {markers.map((marker) => (
         <MarkerView
           coordinate={[marker.longitude, marker.latitude]}
           key={marker.userId}
         >
           {/* label + status kesegaran, bukan warna saja */}
         </MarkerView>
       ))}
     </MapView>
   );
   ```

5. **Daftarkan renderer** di [`src/app/ride.tsx`](../../app/ride.tsx):

   ```tsx
   const mapState = useMemo(
     () =>
       resolveMapRenderState({
         styleUrl: readPublicEnv().EXPO_PUBLIC_MAP_STYLE_URL,
         renderer: { provider: 'maptiler', renderer: MapLibreRenderer },
       }),
     [],
   );
   ```

   Itu satu-satunya perubahan yang diperlukan di layar; `MapCanvas` langsung menggambar peta dan
   atribusi, dan tetap menampilkan daftar peserta dengan label kesegaran.
6. **Atribusi wajib.** `MapAttribution` sudah merender baris provider + OSM. Jangan menyembunyikan,
   mengecilkan, atau menutupinya dengan kontrol lain. Untuk paket gratis MapTiler, logo MapTiler
   juga wajib — itu belum digambar oleh komponen ini, jadi harus ditambahkan sebelum memakai paket
   gratis.
7. **Batas yang tetap berlaku.** Tanpa perjanjian tertulis: tidak ada unduhan tile massal/offline,
   tidak ada cache di luar kebijakan provider, dan tidak ada pengiriman koordinat pengendara ke
   layanan provider (routing/geocoding) tanpa keputusan privasi terpisah.

## Uji

`src/features/map/__tests__` menguji keadaan, atribusi, marker, dan region tanpa perangkat. Setelah
renderer terpasang, tambahkan uji perangkat: atribusi terlihat, peta tetap terbuka tanpa jaringan
(tile gagal dimuat dengan pesan jelas, bukan layar kosong), dan marker basi tidak berlabel live.
