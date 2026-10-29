/**
 * Perhitungan murni untuk laporan bahaya: label area perkiraan, jarak, dan
 * jendela kedaluwarsa.
 *
 * Laporan hazard tidak digambar pada peta konvoi ADR-082. Yang ditampilkan hanya
 * label area kasar yang benar-benar
 * diturunkan dari koordinat laporan — bukan nama tempat karangan dan bukan
 * koordinat presisi milik pelapor.
 */

/** Dua desimal ≈ 1,1 km di ekuator; cukup kasar untuk tidak membocorkan titik persis. */
const AREA_DECIMALS = 2;
const AREA_RADIUS_LABEL = '±1 km';

function validCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function fixed(value: number): string {
  return value.toFixed(AREA_DECIMALS).replace('.', ',');
}

/**
 * Label area perkiraan dari koordinat laporan, mis.
 * `Area ±1 km · 6,20° LS 106,82° BT`.
 *
 * Sengaja memakai derajat, bukan nama jalan/kelurahan: aplikasi tidak punya
 * layanan geocoding, dan menebak nama tempat akan menyesatkan pengendara.
 */
export function approximateAreaLabel(latitude: number, longitude: number): string {
  if (!validCoordinate(latitude, longitude)) return 'Area tidak diketahui';

  const lat = `${fixed(Math.abs(latitude))}° ${latitude < 0 ? 'LS' : 'LU'}`;
  const lng = `${fixed(Math.abs(longitude))}° ${longitude < 0 ? 'BB' : 'BT'}`;

  return `Area ${AREA_RADIUS_LABEL} · ${lat} ${lng}`;
}

/** Jarak great-circle dalam meter (haversine), tanpa dependency PostGIS. */
export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  if (!validCoordinate(from.latitude, from.longitude)) return Number.NaN;
  if (!validCoordinate(to.latitude, to.longitude)) return Number.NaN;

  const earthRadius = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Jarak yang dibulatkan ke atas supaya tidak terlihat lebih presisi dari aslinya. */
export function describeDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return 'jarak tidak diketahui';
  if (meters < 950) return `±${Math.round(meters / 10) * 10} m`;

  const kilometers = Math.round(meters / 100) / 10;
  return `±${kilometers.toString().replace('.', ',')} km`;
}

export type HazardWindowCopy = {
  label: string;
  expired: boolean;
};

/**
 * Sisa masa berlaku laporan dalam bahasa manusia. Laporan yang sudah lewat
 * `expires_at` tidak boleh tampil sebagai aktif walau sapuan `status` belum
 * berjalan (lihat `expire_hazard_reports`).
 */
export function hazardWindowCopy(expiresAt: string, now: number = Date.now()): HazardWindowCopy {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return { label: 'Masa berlaku tidak diketahui', expired: true };

  const remainingMs = expiry - now;
  if (remainingMs <= 0) return { label: 'Sudah berakhir', expired: true };

  const minutes = Math.floor(remainingMs / 60000);
  if (minutes < 1) return { label: 'Berakhir kurang dari 1 menit lagi', expired: false };
  if (minutes < 60) return { label: `Berakhir dalam ${minutes} menit`, expired: false };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { label: `Berakhir dalam ${hours} jam ${minutes % 60} menit`, expired: false };
  }

  return { label: `Berakhir dalam ${Math.floor(hours / 24)} hari`, expired: false };
}

/** Aktif = status `active` dan belum lewat `expires_at`. */
export function isHazardActive(
  hazard: { status: string; expires_at: string },
  now: number = Date.now(),
): boolean {
  if (hazard.status !== 'active') return false;
  const expiry = Date.parse(hazard.expires_at);
  return !Number.isNaN(expiry) && expiry > now;
}
