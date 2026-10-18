/**
 * Validasi formulir perjalanan.
 *
 * Batasnya sama dengan CHECK constraint di `public.rides` (judul 3-120,
 * deskripsi maksimal 2000). Validasi di klien hanya untuk umpan balik cepat;
 * RPC `create_ride`/`update_ride` tetap menolak payload yang tidak sah.
 */

export const RIDE_TITLE_MIN_LENGTH = 3;
export const RIDE_TITLE_MAX_LENGTH = 120;
export const RIDE_DESCRIPTION_MAX_LENGTH = 2000;
export const RIDE_LABEL_MAX_LENGTH = 120;

export function rideTitleError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Isi judul perjalanan.';
  if (trimmed.length < RIDE_TITLE_MIN_LENGTH) return 'Judul minimal 3 karakter.';
  if (trimmed.length > RIDE_TITLE_MAX_LENGTH) return 'Judul maksimal 120 karakter.';
  return undefined;
}

export function rideDescriptionError(value: string): string | undefined {
  if (value.trim().length > RIDE_DESCRIPTION_MAX_LENGTH) {
    return 'Deskripsi maksimal 2000 karakter.';
  }
  return undefined;
}

export function rideLabelError(value: string, label: string): string | undefined {
  if (value.trim().length > RIDE_LABEL_MAX_LENGTH) {
    return `${label} maksimal 120 karakter.`;
  }
  return undefined;
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

export type ParsedStartsAt = { value: string | null; error?: string };

/**
 * Menerima `YYYY-MM-DD HH:mm` (waktu lokal perangkat) atau ISO-8601 lengkap.
 * Kosong berarti "belum dijadwalkan" dan dikirim sebagai `null`.
 */
export function parseStartsAt(input: string, now: Date = new Date()): ParsedStartsAt {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { value: null };

  const local = LOCAL_DATE_TIME.exec(trimmed);
  if (local) {
    const [, year, month, day, hour, minute] = local;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      0,
      0,
    );

    const valid =
      date.getFullYear() === Number(year) &&
      date.getMonth() === Number(month) - 1 &&
      date.getDate() === Number(day) &&
      date.getHours() === Number(hour) &&
      date.getMinutes() === Number(minute);

    if (!valid) return { value: null, error: 'Tanggal atau jam tidak valid.' };

    // Jadwal yang jauh di masa lalu hampir selalu salah ketik tahun.
    if (date.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 365) {
      return { value: null, error: 'Jadwal berada lebih dari setahun di masa lalu.' };
    }

    return { value: date.toISOString() };
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { value: null, error: 'Gunakan format 2026-10-20 19:30 atau tanggal ISO.' };
  }

  return { value: parsed.toISOString() };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Format jadwal ringkas dalam waktu lokal perangkat. */
export function formatRideSchedule(iso: string | null): string {
  if (!iso) return 'Belum dijadwalkan';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Jadwal tidak valid';

  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()} · ${hour}:${minute}`;
}
