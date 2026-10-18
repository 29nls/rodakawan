/**
 * Aturan lokasi perjalanan yang murni dan dapat diuji tanpa perangkat.
 *
 * Kebijakan sampling (ADR-065):
 * - interval minimum 15 detik;
 * - kirim ulang bila bergerak minimal 25 meter walau interval belum lewat;
 * - tolak fix dengan akurasi lebih buruk dari 150 m;
 * - tolak fix yang lebih tua dari 30 detik (kecuali fix pertama, tetap divalidasi
 *   umurnya) agar marker tidak dibangun dari posisi lama;
 * - marker dianggap basi setelah 60 detik tanpa pembaruan.
 *
 * Tidak ada riwayat GPS: hanya satu baris terakhir per peserta.
 */

export const LOCATION_STALE_AFTER_MS = 60_000;
export const LOCATION_MIN_INTERVAL_MS = 15_000;
export const LOCATION_MIN_DISTANCE_M = 25;
export const LOCATION_MAX_ACCURACY_M = 150;
export const LOCATION_MAX_FIX_AGE_MS = 30_000;

export type Coordinate = { latitude: number; longitude: number };

export type LocationFix = Coordinate & {
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recordedAt: number;
};

export type PreviousLocation = Coordinate & {
  sentAt: number;
};

export type PublishDecision =
  { publish: true } | { publish: false; reason: 'accuracy' | 'age' | 'throttled' | 'invalid' };

/** Jarak dua koordinat dalam meter (haversine). */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;

  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidCoordinate(value: Coordinate): boolean {
  return (
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

/** Apakah fix ini layak dikirim ke server. */
export function shouldPublishLocation(
  next: LocationFix,
  previous: PreviousLocation | null,
  now: number = Date.now(),
): PublishDecision {
  if (!isValidCoordinate(next)) return { publish: false, reason: 'invalid' };

  if (next.accuracy !== null && next.accuracy > LOCATION_MAX_ACCURACY_M) {
    return { publish: false, reason: 'accuracy' };
  }

  if (now - next.recordedAt > LOCATION_MAX_FIX_AGE_MS) {
    return { publish: false, reason: 'age' };
  }

  if (!previous) return { publish: true };

  const distance = distanceMeters(previous, next);
  const elapsed = now - previous.sentAt;

  if (elapsed < LOCATION_MIN_INTERVAL_MS && distance < LOCATION_MIN_DISTANCE_M) {
    return { publish: false, reason: 'throttled' };
  }

  return { publish: true };
}

export type LocationFreshness = 'live' | 'stale' | 'offline';

/**
 * `live` = pembaruan dalam 60 detik terakhir.
 * `stale` = masih ada posisi terakhir tetapi sudah basi.
 * `offline` = belum pernah ada posisi.
 */
export function locationFreshness(
  recordedAt: string | number | null,
  now: number = Date.now(),
): LocationFreshness {
  if (recordedAt === null) return 'offline';

  const timestamp = typeof recordedAt === 'number' ? recordedAt : Date.parse(recordedAt);
  if (Number.isNaN(timestamp)) return 'offline';

  return now - timestamp <= LOCATION_STALE_AFTER_MS ? 'live' : 'stale';
}

export function locationAgeLabel(
  recordedAt: string | number | null,
  now: number = Date.now(),
): string {
  if (recordedAt === null) return 'Belum ada lokasi';

  const timestamp = typeof recordedAt === 'number' ? recordedAt : Date.parse(recordedAt);
  if (Number.isNaN(timestamp)) return 'Waktu lokasi tidak valid';

  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return 'Baru saja diperbarui';
  if (seconds < 60) return `${seconds} detik lalu`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;

  const hours = Math.round(minutes / 60);
  return `${hours} jam lalu`;
}
