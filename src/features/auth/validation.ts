/**
 * Validasi input autentikasi (murni, tanpa dependency UI).
 *
 * Validasi ini untuk pengalaman pengguna; otoritas tetap ada di backend
 * (Supabase Auth) dan constraint database. Jangan menganggap validasi klien
 * sebagai pengganti validasi server (docs/AI_CODING_AGENT_PROMPT.md).
 */

/** Batas minimum kata sandi yang kita tetapkan (lebih ketat dari default GoTrue). */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * GoTrue/bcrypt memotong kata sandi pada 72 byte, jadi lebih dari itu tidak menambah
 * keamanan dan hanya membingungkan pengguna.
 */
export const PASSWORD_MAX_LENGTH = 72;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** @returns pesan kesalahan, atau `undefined` bila valid. */
export function emailError(value: string): string | undefined {
  const email = normalizeEmail(value);

  if (email.length === 0) return 'Email wajib diisi.';
  if (email.length > 254) return 'Email terlalu panjang.';

  const [localPart, domainPart, ...rest] = email.split('@');
  if (rest.length > 0 || !localPart || !domainPart) {
    return 'Format email belum benar. Contoh: nama@contoh.com';
  }
  if (!/^[^\s@]+$/.test(localPart)) return 'Format email belum benar. Contoh: nama@contoh.com';
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domainPart)) {
    return 'Domain email belum benar. Contoh: nama@contoh.com';
  }

  return undefined;
}

/** Kata sandi baru: memenuhi kebijakan minimum yang kita komunikasikan ke pengguna. */
export function passwordError(value: string): string | undefined {
  if (value.length === 0) return 'Kata sandi wajib diisi.';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Kata sandi maksimal ${PASSWORD_MAX_LENGTH} karakter.`;
  }
  if (!/[A-Za-z]/.test(value)) return 'Kata sandi harus memuat minimal satu huruf.';
  if (!/[0-9]/.test(value)) return 'Kata sandi harus memuat minimal satu angka.';

  return undefined;
}

/**
 * Kata sandi pada form masuk: hanya wajib diisi. Kebijakan panjang tidak
 * diterapkan di sini agar pengguna lama dengan kata sandi lama tetap bisa masuk.
 */
export function signInPasswordError(value: string): string | undefined {
  if (value.length === 0) return 'Kata sandi wajib diisi.';
  return undefined;
}

export function passwordConfirmationError(
  password: string,
  confirmation: string,
): string | undefined {
  if (confirmation.length === 0) return 'Ulangi kata sandi untuk memastikan tidak ada salah ketik.';
  if (confirmation !== password) return 'Konfirmasi kata sandi belum sama.';
  return undefined;
}

export function describePasswordPolicy(): string {
  return `Minimal ${PASSWORD_MIN_LENGTH} karakter dan memuat huruf serta angka.`;
}
