import {
  approximateAreaLabel,
  describeDistance,
  distanceMeters,
  hazardWindowCopy,
  isHazardActive,
} from '@/features/hazards/geo';

/**
 * Pengujian label area dan masa berlaku.
 *
 * Label area sengaja tidak memakai nama tempat (tidak ada layanan geocoding di
 * build ini) dan tidak menampilkan koordinat presisi laporan. Yang diuji:
 * pembulatan, arah lintang/bujur, serta penolakan koordinat tidak valid.
 */

describe('approximateAreaLabel', () => {
  it('membulatkan koordinat ke ±1 km dengan arah LS/BT', () => {
    expect(approximateAreaLabel(-6.2001, 106.8166)).toBe('Area ±1 km · 6,20° LS 106,82° BT');
  });

  it('memakai LU/BB untuk belahan lain', () => {
    expect(approximateAreaLabel(3.5952, -98.6722)).toBe('Area ±1 km · 3,60° LU 98,67° BB');
  });

  it('tidak menampilkan area untuk koordinat tidak valid', () => {
    expect(approximateAreaLabel(91, 0)).toBe('Area tidak diketahui');
    expect(approximateAreaLabel(0, Number.NaN)).toBe('Area tidak diketahui');
  });
});

describe('distanceMeters dan describeDistance', () => {
  it('menghitung jarak haversine antar dua titik', () => {
    const meters = distanceMeters(
      { latitude: -6.2, longitude: 106.8166 },
      { latitude: -6.209, longitude: 106.8166 },
    );

    expect(Math.round(meters)).toBe(1001);
  });

  it('mengembalikan NaN untuk koordinat tidak valid', () => {
    expect(
      Number.isNaN(distanceMeters({ latitude: 100, longitude: 0 }, { latitude: 0, longitude: 0 })),
    ).toBe(true);
  });

  it('membulatkan jarak supaya tidak terlihat lebih presisi dari aslinya', () => {
    expect(describeDistance(847)).toBe('±850 m');
    expect(describeDistance(2430)).toBe('±2,4 km');
    expect(describeDistance(Number.NaN)).toBe('jarak tidak diketahui');
  });
});

describe('hazardWindowCopy', () => {
  const now = Date.parse('2026-10-20T10:00:00.000Z');

  it('menampilkan sisa menit', () => {
    expect(hazardWindowCopy('2026-10-20T10:45:00.000Z', now)).toEqual({
      label: 'Berakhir dalam 45 menit',
      expired: false,
    });
  });

  it('menampilkan jam dan menit untuk laporan berdurasi panjang', () => {
    expect(hazardWindowCopy('2026-10-20T12:30:00.000Z', now)).toEqual({
      label: 'Berakhir dalam 2 jam 30 menit',
      expired: false,
    });
  });

  it('menandai laporan yang sudah lewat masa berlaku', () => {
    expect(hazardWindowCopy('2026-10-20T09:59:00.000Z', now)).toEqual({
      label: 'Sudah berakhir',
      expired: true,
    });
  });
});

describe('isHazardActive', () => {
  const now = Date.parse('2026-10-20T10:00:00.000Z');

  it('aktif hanya bila status active dan belum kedaluwarsa', () => {
    expect(isHazardActive({ status: 'active', expires_at: '2026-10-20T11:00:00.000Z' }, now)).toBe(
      true,
    );
    expect(isHazardActive({ status: 'active', expires_at: '2026-10-20T09:00:00.000Z' }, now)).toBe(
      false,
    );
    expect(isHazardActive({ status: 'removed', expires_at: '2026-10-20T11:00:00.000Z' }, now)).toBe(
      false,
    );
  });
});
