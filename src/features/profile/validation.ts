/**
 * Aturan identitas profil: username, display name, bio, dan kota.
 *
 * Aturan yang sama dipakai di form pendaftaran (metadata awal) dan di layar edit
 * profil supaya pengguna melihat perilaku yang konsisten. Otoritas keunikan dan
 * format tetap ada di database (`public.profiles` + unique index + CHECK).
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const DISPLAY_NAME_MAX_LENGTH = 80;
export const BIO_MAX_LENGTH = 300;
export const CITY_MAX_LENGTH = 80;

/** Pola username: huruf kecil, angka, dan garis bawah. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;

/**
 * Awalan khusus username yang dibuat otomatis oleh bootstrap trigger saat username
 * pilihan pengguna tidak tersedia/tidak valid. Pengguna tidak boleh memilihnya agar
 * penanda ini tetap bisa dipercaya untuk memberi tahu bahwa username perlu diganti.
 */
export const GENERATED_USERNAME_PREFIX = 'rider_';

/** Menormalkan username ke bentuk yang disimpan database (huruf kecil, tanpa spasi). */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isGeneratedUsername(value: string): boolean {
  return value.startsWith(GENERATED_USERNAME_PREFIX);
}

/** @returns pesan kesalahan, atau `undefined` bila valid. */
export function usernameError(value: string): string | undefined {
  const username = normalizeUsername(value);

  if (username.length === 0) return 'Username wajib diisi.';
  if (username.length < USERNAME_MIN_LENGTH) {
    return `Username minimal ${USERNAME_MIN_LENGTH} karakter.`;
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return `Username maksimal ${USERNAME_MAX_LENGTH} karakter.`;
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    return 'Username hanya boleh berisi huruf kecil, angka, dan garis bawah (_).';
  }
  if (isGeneratedUsername(username)) {
    return `Awalan "${GENERATED_USERNAME_PREFIX}" dipakai untuk username sementara. Pilih username lain.`;
  }

  return undefined;
}

export function displayNameError(value: string): string | undefined {
  const displayName = value.trim();

  if (displayName.length === 0) return 'Nama tampilan wajib diisi.';
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    return `Nama tampilan maksimal ${DISPLAY_NAME_MAX_LENGTH} karakter.`;
  }

  return undefined;
}

export function bioError(value: string): string | undefined {
  if (value.trim().length > BIO_MAX_LENGTH) {
    return `Bio maksimal ${BIO_MAX_LENGTH} karakter.`;
  }

  return undefined;
}

export function cityError(value: string): string | undefined {
  if (value.trim().length > CITY_MAX_LENGTH) {
    return `Kota maksimal ${CITY_MAX_LENGTH} karakter.`;
  }

  return undefined;
}

/** Field opsional disimpan sebagai `null` bila kosong, bukan string kosong. */
export function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
