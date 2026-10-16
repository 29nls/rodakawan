/**
 * Validasi isian klub di sisi aplikasi.
 *
 * Angka di sini mengikuti CHECK constraint pada
 * `supabase/migrations/20261013022938_initial_schema.sql` supaya pengguna
 * menerima pesan yang bisa ditindaklanjuti sebelum query dikirim, sementara
 * database tetap menjadi otoritas terakhir.
 */

export const CLUB_NAME_MIN_LENGTH = 2;
export const CLUB_NAME_MAX_LENGTH = 100;
export const CLUB_DESCRIPTION_MAX_LENGTH = 2000;
export const CLUB_SLUG_MIN_LENGTH = 3;
export const CLUB_SLUG_MAX_LENGTH = 80;

/** Merapikan nama klub: buang spasi pinggir dan lipat spasi ganda. */
export function normalizeClubName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function nameError(value: string): string | undefined {
  const name = normalizeClubName(value);

  if (name.length < CLUB_NAME_MIN_LENGTH) {
    return `Nama klub minimal ${CLUB_NAME_MIN_LENGTH} karakter.`;
  }

  if (name.length > CLUB_NAME_MAX_LENGTH) {
    return `Nama klub maksimal ${CLUB_NAME_MAX_LENGTH} karakter.`;
  }

  return undefined;
}

export function descriptionError(value: string | null): string | undefined {
  if (value !== null && value.length > CLUB_DESCRIPTION_MAX_LENGTH) {
    return `Deskripsi maksimal ${CLUB_DESCRIPTION_MAX_LENGTH} karakter.`;
  }

  return undefined;
}

/**
 * Hash FNV-1a 32-bit, dipakai hanya untuk memberi akhiran stabil pada nama yang
 * tidak menyisakan cukup karakter untuk dijadikan slug. Bukan untuk keamanan.
 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Membuat slug klub dari namanya.
 *
 * Hasilnya selalu memenuhi `char_length(slug) between 3 and 80`: bila nama tidak
 * menyisakan cukup karakter (mis. "AB" atau "!!!"), akhiran hash yang stabil
 * ditambahkan. Deterministik supaya bisa diuji dan supaya dua klub dengan nama
 * yang sama menghasilkan slug yang sama — benturan itu ditolak unique constraint
 * dan dilaporkan sebagai `conflict` ke pemanggil.
 */
export function clubSlugFromName(value: string): string {
  const base = slugify(normalizeClubName(value));

  const candidate =
    base.length >= CLUB_SLUG_MIN_LENGTH
      ? base
      : base.length > 0
        ? `${base}-${shortHash(base)}`
        : `club-${shortHash(normalizeClubName(value))}`;

  const trimmed = candidate.slice(0, CLUB_SLUG_MAX_LENGTH).replace(/-+$/, '');

  return trimmed.length >= CLUB_SLUG_MIN_LENGTH ? trimmed : `club-${shortHash(trimmed + value)}`;
}
