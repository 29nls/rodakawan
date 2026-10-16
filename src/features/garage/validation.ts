/**
 * Validasi isian garasi di sisi aplikasi.
 *
 * Angka di sini mengikuti CHECK constraint pada
 * `supabase/migrations/20261013022938_initial_schema.sql` (make ≤ 80, model ≤ 100,
 * nickname ≤ 60, model_year 1950-2100) supaya pengguna menerima pesan yang bisa
 * ditindaklanjuti sebelum query dikirim; database tetap otoritas terakhir.
 */

export const MOTORCYCLE_MAKE_MAX_LENGTH = 80;
export const MOTORCYCLE_MODEL_MAX_LENGTH = 100;
export const MOTORCYCLE_NICKNAME_MAX_LENGTH = 60;
export const MOTORCYCLE_YEAR_MIN = 1950;
export const MOTORCYCLE_YEAR_MAX = 2100;
export const PLATE_MAX_LENGTH = 16;
export const PRIVATE_NOTES_MAX_LENGTH = 500;

export type MotorcycleFormValues = {
  make: string;
  model: string;
  nickname: string;
  modelYear: string;
};

export type MotorcycleFormErrors = {
  make?: string;
  model?: string;
  nickname?: string;
  modelYear?: string;
};

/** Buang spasi pinggir dan lipat spasi ganda. */
export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Tahun kendaraan boleh kosong; bila diisi harus angka dalam rentang yang sah.
 * Dipisah dari `motorcycleFormErrors` supaya layar bisa memakainya saat menyimpan
 * (mengubah teks menjadi angka) tanpa memvalidasi ulang seluruh formulir.
 */
export function parseModelYear(
  value: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = value.trim();

  if (trimmed.length === 0) return { ok: true, value: null };

  if (!/^\d{4}$/.test(trimmed)) {
    return { ok: false, error: 'Tahun harus 4 angka, mis. 2019. Kosongkan bila tidak yakin.' };
  }

  const year = Number(trimmed);

  if (year < MOTORCYCLE_YEAR_MIN || year > MOTORCYCLE_YEAR_MAX) {
    return {
      ok: false,
      error: `Tahun harus antara ${MOTORCYCLE_YEAR_MIN} dan ${MOTORCYCLE_YEAR_MAX}.`,
    };
  }

  return { ok: true, value: year };
}

export function motorcycleFormErrors(values: MotorcycleFormValues): MotorcycleFormErrors {
  const errors: MotorcycleFormErrors = {};
  const make = normalizeText(values.make);
  const model = normalizeText(values.model);
  const nickname = normalizeText(values.nickname);

  if (make.length === 0) {
    errors.make = 'Merek kendaraan wajib diisi.';
  } else if (make.length > MOTORCYCLE_MAKE_MAX_LENGTH) {
    errors.make = `Merek maksimal ${MOTORCYCLE_MAKE_MAX_LENGTH} karakter.`;
  }

  if (model.length === 0) {
    errors.model = 'Model kendaraan wajib diisi.';
  } else if (model.length > MOTORCYCLE_MODEL_MAX_LENGTH) {
    errors.model = `Model maksimal ${MOTORCYCLE_MODEL_MAX_LENGTH} karakter.`;
  }

  if (nickname.length > MOTORCYCLE_NICKNAME_MAX_LENGTH) {
    errors.nickname = `Nama panggilan maksimal ${MOTORCYCLE_NICKNAME_MAX_LENGTH} karakter.`;
  }

  const year = parseModelYear(values.modelYear);
  if (!year.ok) errors.modelYear = year.error;

  return errors;
}

export function hasFormErrors(errors: MotorcycleFormErrors): boolean {
  return Object.values(errors).some((value) => typeof value === 'string');
}

/** Nomor polisi bersifat privat; hanya dibatasi panjang agar tidak salah tempel. */
export function plateError(value: string): string | undefined {
  const plate = normalizeText(value);

  if (plate.length === 0) return 'Nomor polisi wajib diisi bila bagian ini disimpan.';

  if (plate.length > PLATE_MAX_LENGTH) {
    return `Nomor polisi maksimal ${PLATE_MAX_LENGTH} karakter.`;
  }

  return undefined;
}

export function privateNotesError(value: string): string | undefined {
  if (value.length > PRIVATE_NOTES_MAX_LENGTH) {
    return `Catatan privat maksimal ${PRIVATE_NOTES_MAX_LENGTH} karakter.`;
  }

  return undefined;
}
