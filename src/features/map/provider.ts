/**
 * Lapisan provider peta — kontrak, bukan renderer.
 *
 * ADR-064 belum disetujui, jadi modul ini **tidak** mengimpor library peta apa pun.
 * Tugasnya hanya memutuskan apakah peta boleh digambar dan apa yang harus
 * ditampilkan bila belum bisa:
 *
 * - `missing_style_url` / `invalid_style_url` / `unknown_provider` → peta tidak
 *   digambar, dengan penjelasan yang bisa ditindaklanjuti;
 * - `renderer_missing` → gaya peta sudah dikonfigurasi tetapi build ini belum
 *   memuat renderer (keadaan hari ini);
 * - `ready` → hanya terjadi bila renderer benar-benar didaftarkan pemanggil.
 *
 * Aturan atribusi mengikuti ketentuan provider yang dirangkum di
 * `docs/MAP_PROVIDER_DECISION.md`. Atribusi hanya ditampilkan ketika tile
 * benar-benar digambar; build tanpa peta tidak boleh mengklaim atribusi.
 */

import type { ReactElement } from 'react';

import type { RideMemberWithProfile } from '@/features/rides/api';
import {
  locationFreshness,
  isValidCoordinate,
  type LocationFreshness,
} from '@/features/rides/location';
import { isHttpsUrl } from '@/lib/env';
import type { RideLocationRow } from '@/lib/supabase/database.types';

export type MapProviderId = 'maptiler' | 'stadia' | 'mapbox' | 'google' | 'unknown';

export type KnownMapProvider = Exclude<MapProviderId, 'unknown'>;

export type MapAttributionLine = { label: string; url: string };

/** Atribusi wajib per provider; tidak boleh dihapus dari tampilan peta. */
export const MAP_ATTRIBUTION: Record<KnownMapProvider, MapAttributionLine[]> = {
  maptiler: [
    { label: '© MapTiler', url: 'https://www.maptiler.com/copyright/' },
    { label: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  ],
  stadia: [
    { label: '© Stadia Maps', url: 'https://stadiamaps.com/' },
    { label: '© OpenMapTiles', url: 'https://openmaptiles.org/' },
    { label: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  ],
  mapbox: [
    { label: '© Mapbox', url: 'https://www.mapbox.com/about/maps/' },
    { label: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  ],
  google: [{ label: '© Google', url: 'https://maps.google.com/help/terms_maps/' }],
};

export type MapMarker = {
  userId: string;
  label: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  recordedAt: string;
  freshness: LocationFreshness;
};

export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type MapRendererProps = {
  styleUrl: string;
  markers: MapMarker[];
  attribution: MapAttributionLine[];
  initialRegion: MapRegion | null;
};

export type MapRenderer = (props: MapRendererProps) => ReactElement;

export type MapRenderState =
  | {
      kind: 'unconfigured';
      reason: 'missing_style_url' | 'invalid_style_url' | 'unknown_provider';
      notice: string;
    }
  | {
      kind: 'renderer_missing';
      provider: KnownMapProvider;
      styleUrl: string;
      attribution: MapAttributionLine[];
      notice: string;
    }
  | {
      kind: 'ready';
      provider: KnownMapProvider;
      styleUrl: string;
      attribution: MapAttributionLine[];
      renderer: MapRenderer;
    };

export type MapRendererRegistration = {
  provider: KnownMapProvider;
  renderer: MapRenderer;
} | null;

const NOTICE = {
  missing:
    'Peta belum dikonfigurasi untuk build ini. Tidak ada peta tiruan atau koordinat contoh; posisi asli ditampilkan sebagai daftar.',
  invalid:
    'EXPO_PUBLIC_MAP_STYLE_URL harus berupa URL https yang sah. Peta tidak digambar sampai nilainya diperbaiki.',
  unknown:
    'Penyedia peta pada URL gaya tidak dikenali, sehingga atribusi wajibnya tidak dapat ditentukan. Peta tidak digambar agar tidak ada tile tanpa atribusi.',
  rendererMissing:
    'Gaya peta sudah dikonfigurasi, tetapi renderer peta belum dipasang di build ini. Posisi ditampilkan sebagai daftar dengan waktu pembaruan.',
} as const;

/** Menebak provider dari URL gaya peta; hanya untuk memilih atribusi yang benar. */
export function inferMapProvider(styleUrl: string): MapProviderId {
  let host: string;
  try {
    host = new URL(styleUrl).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }

  if (host === 'maptiler.com' || host.endsWith('.maptiler.com')) return 'maptiler';
  if (host === 'stadiamaps.com' || host.endsWith('.stadiamaps.com')) return 'stadia';
  if (host === 'mapbox.com' || host.endsWith('.mapbox.com')) return 'mapbox';
  if (host === 'googleapis.com' || host.endsWith('.googleapis.com')) return 'google';

  return 'unknown';
}

/**
 * Menentukan keadaan peta dari URL gaya yang sudah dinormalisasi
 * (`readPublicEnv` membuang nilai contoh, jadi `.env.example` tidak pernah
 * dianggap terkonfigurasi) plus renderer yang benar-benar terdaftar.
 */
export function resolveMapRenderState({
  styleUrl,
  renderer = null,
}: {
  styleUrl: string | undefined;
  renderer?: MapRendererRegistration;
}): MapRenderState {
  if (!styleUrl)
    return { kind: 'unconfigured', reason: 'missing_style_url', notice: NOTICE.missing };
  if (!isHttpsUrl(styleUrl)) {
    return { kind: 'unconfigured', reason: 'invalid_style_url', notice: NOTICE.invalid };
  }

  const provider = inferMapProvider(styleUrl);
  if (provider === 'unknown') {
    return { kind: 'unconfigured', reason: 'unknown_provider', notice: NOTICE.unknown };
  }

  const attribution = MAP_ATTRIBUTION[provider];

  if (renderer === null || renderer.provider !== provider) {
    return {
      kind: 'renderer_missing',
      provider,
      styleUrl,
      attribution,
      notice: NOTICE.rendererMissing,
    };
  }

  return {
    kind: 'ready',
    provider,
    styleUrl,
    attribution,
    renderer: renderer.renderer,
  };
}

/**
 * Marker hanya dari anggota yang masih `joined` dan punya baris lokasi terakhir.
 * Ini cermin `ride_locations_select_active_member`: peserta yang keluar atau
 * dikeluarkan tidak boleh muncul, walaupun barisnya sempat terbaca dari cache.
 */
export function buildRideMarkers(
  members: RideMemberWithProfile[],
  locations: RideLocationRow[],
  now: number = Date.now(),
): MapMarker[] {
  const byUser = new Map<string, RideLocationRow>();
  for (const location of locations) byUser.set(location.user_id, location);

  const markers: MapMarker[] = [];
  for (const member of members) {
    if (member.status !== 'joined') continue;

    const location = byUser.get(member.user_id);
    if (!location) continue;
    if (!isValidCoordinate(location)) continue;

    const displayName = member.profiles?.display_name?.trim();
    const username = member.profiles?.username;

    markers.push({
      userId: member.user_id,
      label: displayName || (username ? `@${username}` : 'Peserta'),
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyM: location.accuracy_m,
      recordedAt: location.recorded_at,
      freshness: locationFreshness(location.recorded_at, now),
    });
  }

  return markers;
}

const MIN_DELTA = 0.01; // ±1 km: satu marker tidak memaksa zoom ekstrem.
const REGION_PADDING = 1.4;

/** Region awal untuk renderer; `null` bila tidak ada marker yang bisa dipakai. */
export function regionForMarkers(markers: MapMarker[]): MapRegion | null {
  if (markers.length === 0) return null;

  const latitudes = markers.map((marker) => marker.latitude);
  const longitudes = markers.map((marker) => marker.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * REGION_PADDING, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * REGION_PADDING, MIN_DELTA),
  };
}
