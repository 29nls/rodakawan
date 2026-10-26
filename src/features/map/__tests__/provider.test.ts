import { normalizeEnvValue } from '@/lib/env';
import {
  MAP_ATTRIBUTION,
  buildRideMarkers,
  inferMapProvider,
  regionForMarkers,
  resolveMapRenderState,
  type MapRenderer,
} from '@/features/map/provider';
import type { RideMemberWithProfile } from '@/features/rides/api';
import type { RideLocationRow } from '@/lib/supabase/database.types';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

const NOW = Date.parse('2026-10-20T10:00:00.000Z');

function member(overrides: Partial<RideMemberWithProfile> = {}): RideMemberWithProfile {
  return {
    ride_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    user_id: USER_A,
    role: 'rider',
    status: 'joined',
    joined_at: '2026-10-20T09:00:00.000Z',
    last_location_published_at: null,
    last_seen_at: null,
    sharing_location: true,
    created_at: '2026-10-20T09:00:00.000Z',
    updated_at: '2026-10-20T09:00:00.000Z',
    profiles: { id: USER_A, username: 'budi', display_name: 'Budi', avatar_url: null },
    ...overrides,
  };
}

function location(overrides: Partial<RideLocationRow> = {}): RideLocationRow {
  return {
    ride_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    user_id: USER_A,
    latitude: -6.2,
    longitude: 106.8,
    accuracy_m: 12,
    heading_deg: null,
    speed_mps: null,
    recorded_at: '2026-10-20T09:59:40.000Z',
    updated_at: '2026-10-20T09:59:40.000Z',
    ...overrides,
  };
}

const renderer: MapRenderer = () => null as never;

describe('inferMapProvider', () => {
  it('mengenali host provider yang didukung', () => {
    expect(inferMapProvider('https://api.maptiler.com/maps/streets/style.json?key=x')).toBe(
      'maptiler',
    );
    expect(inferMapProvider('https://tiles.stadiamaps.com/styles/alidade_smooth.json')).toBe(
      'stadia',
    );
    expect(inferMapProvider('https://api.mapbox.com/styles/v1/mapbox/streets-v12')).toBe('mapbox');
    expect(inferMapProvider('https://maps.googleapis.com/maps/api/staticmap')).toBe('google');
  });

  it('mengembalikan unknown untuk host lain dan URL rusak', () => {
    expect(inferMapProvider('https://tile.openstreetmap.org/{z}/{x}/{y}.png')).toBe('unknown');
    expect(inferMapProvider('bukan url')).toBe('unknown');
  });
});

describe('resolveMapRenderState', () => {
  it('tanpa URL gaya: peta tidak dikonfigurasi dan tidak ada atribusi', () => {
    const state = resolveMapRenderState({ styleUrl: undefined });

    expect(state).toEqual({
      kind: 'unconfigured',
      reason: 'missing_style_url',
      notice:
        'Peta belum dikonfigurasi untuk build ini. Tidak ada peta tiruan atau koordinat contoh; posisi asli ditampilkan sebagai daftar.',
    });
  });

  it('nilai contoh .env.example tidak dianggap konfigurasi nyata', () => {
    const placeholder = normalizeEnvValue('https://YOUR_TILE_PROVIDER/STYLE.json');

    expect(placeholder).toBeUndefined();
    expect(resolveMapRenderState({ styleUrl: placeholder }).kind).toBe('unconfigured');
  });

  it('menolak URL non-https', () => {
    const state = resolveMapRenderState({ styleUrl: 'http://api.maptiler.com/style.json' });

    expect(state.kind).toBe('unconfigured');
    if (state.kind !== 'unconfigured') throw new Error('jenis keadaan salah');
    expect(state.reason).toBe('invalid_style_url');
    expect(state.notice).toMatch(/harus berupa URL https/);
  });

  it('menolak provider tak dikenal agar tidak ada tile tanpa atribusi', () => {
    const state = resolveMapRenderState({
      styleUrl: 'https://tile.openstreetmap.org/1/2/3.png',
    });

    expect(state.kind).toBe('unconfigured');
    if (state.kind !== 'unconfigured') throw new Error('jenis keadaan salah');
    expect(state.reason).toBe('unknown_provider');
    expect(state.notice).toMatch(/atribusi wajibnya tidak dapat ditentukan/);
  });

  it('gaya valid tanpa renderer: menjelaskan bahwa peta belum dipasang', () => {
    const state = resolveMapRenderState({
      styleUrl: 'https://api.maptiler.com/maps/streets/style.json?key=x',
    });

    expect(state.kind).toBe('renderer_missing');
    if (state.kind !== 'renderer_missing') throw new Error('jenis keadaan salah');
    expect(state.provider).toBe('maptiler');
    expect(state.attribution).toEqual(MAP_ATTRIBUTION.maptiler);
    expect(state.notice).toMatch(/renderer peta belum dipasang di build ini/);
  });

  it('renderer dengan provider berbeda tidak dianggap siap', () => {
    const state = resolveMapRenderState({
      styleUrl: 'https://api.maptiler.com/maps/streets/style.json?key=x',
      renderer: { provider: 'stadia', renderer },
    });

    expect(state.kind).toBe('renderer_missing');
  });

  it('siap hanya bila renderer yang terdaftar cocok dengan provider', () => {
    const state = resolveMapRenderState({
      styleUrl: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json',
      renderer: { provider: 'stadia', renderer },
    });

    expect(state.kind).toBe('ready');
    if (state.kind !== 'ready') throw new Error('jenis keadaan salah');
    expect(state.provider).toBe('stadia');
    expect(state.renderer).toBe(renderer);
    expect(state.attribution.map((line) => line.label)).toEqual([
      '© Stadia Maps',
      '© OpenMapTiles',
      '© OpenStreetMap contributors',
    ]);
  });
});

describe('atribusi', () => {
  it('selalu memuat OpenStreetMap untuk provider berbasis OSM', () => {
    for (const provider of ['maptiler', 'stadia', 'mapbox'] as const) {
      expect(MAP_ATTRIBUTION[provider].map((line) => line.label)).toContain(
        '© OpenStreetMap contributors',
      );
    }
  });

  it('setiap baris atribusi punya URL https', () => {
    for (const lines of Object.values(MAP_ATTRIBUTION)) {
      for (const line of lines) {
        expect(line.url.startsWith('https://')).toBe(true);
      }
    }
  });
});

describe('buildRideMarkers', () => {
  it('hanya membuat marker untuk peserta joined yang punya lokasi', () => {
    const markers = buildRideMarkers(
      [
        member(),
        member({
          user_id: USER_B,
          profiles: { id: USER_B, username: 'sari', display_name: '', avatar_url: null },
        }),
        member({ user_id: '33333333-3333-3333-3333-333333333333', status: 'left' }),
      ],
      [location(), location({ user_id: USER_B, latitude: -6.21 })],
      NOW,
    );

    expect(markers.map((marker) => marker.userId)).toEqual([USER_A, USER_B]);
    expect(markers[0]?.label).toBe('Budi');
    expect(markers[1]?.label).toBe('@sari');
    expect(markers[0]?.freshness).toBe('live');
  });

  it('menandai lokasi basi dan melewati koordinat tidak valid', () => {
    const markers = buildRideMarkers(
      [member(), member({ user_id: USER_B })],
      [
        location({ recorded_at: '2026-10-20T09:50:00.000Z' }),
        location({ user_id: USER_B, latitude: Number.NaN }),
      ],
      NOW,
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]?.freshness).toBe('stale');
  });

  it('tidak membuat marker untuk peserta yang keluar walau baris lokasinya masih ada', () => {
    const markers = buildRideMarkers(
      [member({ status: 'left' }), member({ user_id: USER_B, status: 'removed' })],
      [location(), location({ user_id: USER_B })],
      NOW,
    );

    expect(markers).toEqual([]);
  });
});

describe('regionForMarkers', () => {
  it('null bila tidak ada marker', () => {
    expect(regionForMarkers([])).toBeNull();
  });

  it('memakai delta minimum untuk satu marker', () => {
    const region = regionForMarkers([
      {
        userId: USER_A,
        label: 'Budi',
        latitude: -6.2,
        longitude: 106.8,
        accuracyM: 12,
        recordedAt: '2026-10-20T09:59:40.000Z',
        freshness: 'live',
      },
    ]);

    expect(region).toEqual({
      latitude: -6.2,
      longitude: 106.8,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });
  });

  it('mencakup semua marker dengan padding', () => {
    const region = regionForMarkers([
      {
        userId: USER_A,
        label: 'Budi',
        latitude: -6.2,
        longitude: 106.8,
        accuracyM: null,
        recordedAt: '2026-10-20T09:59:40.000Z',
        freshness: 'live',
      },
      {
        userId: USER_B,
        label: '@sari',
        latitude: -6.3,
        longitude: 106.9,
        accuracyM: null,
        recordedAt: '2026-10-20T09:59:40.000Z',
        freshness: 'live',
      },
    ]);

    expect(region?.latitude).toBeCloseTo(-6.25, 6);
    expect(region?.longitude).toBeCloseTo(106.85, 6);
    expect(region?.latitudeDelta).toBeCloseTo(0.14, 6);
    expect(region?.longitudeDelta).toBeCloseTo(0.14, 6);
  });
});
