import {
  distanceMeters,
  isValidCoordinate,
  locationAgeLabel,
  locationFreshness,
  shouldPublishLocation,
  LOCATION_MAX_FIX_AGE_MS,
  LOCATION_MIN_INTERVAL_MS,
  type LocationFix,
} from '@/features/rides/location';

const NOW = Date.parse('2026-10-19T10:00:00.000Z');

function fix(overrides: Partial<LocationFix> = {}): LocationFix {
  return {
    latitude: -6.2,
    longitude: 106.8,
    accuracy: 10,
    heading: null,
    speed: null,
    recordedAt: NOW,
    ...overrides,
  };
}

describe('jarak dan koordinat', () => {
  it('menghitung jarak satu derajat lintang sekitar 111 km', () => {
    expect(
      distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }),
    ).toBeCloseTo(111_195, -2);
  });

  it('menolak koordinat di luar rentang', () => {
    expect(isValidCoordinate({ latitude: -6.2, longitude: 106.8 })).toBe(true);
    expect(isValidCoordinate({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isValidCoordinate({ latitude: Number.NaN, longitude: 0 })).toBe(false);
  });
});

describe('shouldPublishLocation', () => {
  it('mengirim fix pertama yang akurat dan baru', () => {
    expect(shouldPublishLocation(fix(), null, NOW)).toEqual({ publish: true });
  });

  it('menolak akurasi buruk dan fix basi', () => {
    expect(shouldPublishLocation(fix({ accuracy: 500 }), null, NOW)).toEqual({
      publish: false,
      reason: 'accuracy',
    });

    expect(
      shouldPublishLocation(fix({ recordedAt: NOW - LOCATION_MAX_FIX_AGE_MS - 1 }), null, NOW),
    ).toEqual({ publish: false, reason: 'age' });
  });

  it('menahan pembaruan dalam interval bila posisi hampir sama', () => {
    const previous = { latitude: -6.2, longitude: 106.8, sentAt: NOW - 5_000 };

    expect(shouldPublishLocation(fix(), previous, NOW)).toEqual({
      publish: false,
      reason: 'throttled',
    });
  });

  it('tetap mengirim bila pengguna bergerak cukup jauh', () => {
    const previous = { latitude: -6.2, longitude: 106.8, sentAt: NOW - 5_000 };
    const moved = fix({ latitude: -6.201, longitude: 106.8 });

    expect(shouldPublishLocation(moved, previous, NOW)).toEqual({ publish: true });
  });

  it('mengirim setelah interval minimum lewat', () => {
    const previous = { latitude: -6.2, longitude: 106.8, sentAt: NOW - LOCATION_MIN_INTERVAL_MS };

    expect(shouldPublishLocation(fix(), previous, NOW)).toEqual({ publish: true });
  });
});

describe('kesegaran lokasi', () => {
  it('membedakan live, basi, dan belum pernah ada', () => {
    expect(locationFreshness('2026-10-19T09:59:30.000Z', NOW)).toBe('live');
    expect(locationFreshness('2026-10-19T09:58:00.000Z', NOW)).toBe('stale');
    expect(locationFreshness(null, NOW)).toBe('offline');
    expect(locationFreshness('bukan tanggal', NOW)).toBe('offline');
  });

  it('memberi label umur yang dapat dibaca', () => {
    expect(locationAgeLabel('2026-10-19T09:59:55.000Z', NOW)).toBe('Baru saja diperbarui');
    expect(locationAgeLabel('2026-10-19T09:59:30.000Z', NOW)).toBe('30 detik lalu');
    expect(locationAgeLabel('2026-10-19T09:55:00.000Z', NOW)).toBe('5 menit lalu');
    expect(locationAgeLabel('2026-10-19T07:00:00.000Z', NOW)).toBe('3 jam lalu');
    expect(locationAgeLabel(null, NOW)).toBe('Belum ada lokasi');
  });
});
