/**
 * Konfigurasi lingkungan publik RodaKawan.
 *
 * Aturan keamanan (docs/ARCHITECTURE.md bagian 8, docs/SECURITY_PRIVACY.md):
 * - Hanya variabel berprefix `EXPO_PUBLIC_` yang boleh dibaca di sini, karena nilainya
 *   ikut masuk ke bundle aplikasi.
 * - Service role key, database password, LiveKit secret, dan token admin tidak pernah
 *   dibaca aplikasi mobile.
 *
 * Catatan implementasi: `process.env.EXPO_PUBLIC_*` harus ditulis sebagai member
 * expression literal agar diganti inline oleh bundler Expo saat build.
 */
export const PUBLIC_ENV_KEYS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_MAP_STYLE_URL',
] as const;

export type PublicEnvKey = (typeof PUBLIC_ENV_KEYS)[number];

export type PublicEnv = Record<PublicEnvKey, string | undefined>;

/** Nilai mentah dari bundler; dapat diganti pada pengujian. */
const declaredEnv: Record<PublicEnvKey, string | undefined> = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_MAP_STYLE_URL: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
};

/**
 * Nilai contoh dari `.env.example` tidak boleh dianggap sebagai konfigurasi nyata,
 * supaya UI tidak menampilkan status "terkonfigurasi" yang menyesatkan.
 */
export function isPlaceholderValue(value: string): boolean {
  return /^your[_-]/i.test(value) || value.includes('YOUR_PROJECT') || value.includes('YOUR_TILE');
}

export function normalizeEnvValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (/^(undefined|null|false)$/i.test(trimmed)) return undefined;
  if (isPlaceholderValue(trimmed)) return undefined;
  return trimmed;
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decoder base64/base64url minimal (tanpa dependency dan tanpa Buffer)
 * agar aman dipakai di Hermes maupun Node saat pengujian.
 */
export function decodeBase64Url(input: string): string | undefined {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  let output = '';
  let buffer = 0;
  let bits = 0;

  for (const character of normalized) {
    if (character === '=') break;
    const index = BASE64_ALPHABET.indexOf(character);
    if (index === -1) return undefined;

    buffer = ((buffer << 6) | index) & 0xffffff;
    bits += 6;

    while (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }

  return output;
}

/**
 * Mendeteksi kredensial dengan hak istimewa (mis. service role key Supabase) yang
 * keliru ditempatkan pada variabel publik. Nilai seperti ini tidak aman ada di
 * bundle aplikasi, jadi UI wajib memberi peringatan keras.
 */
export function looksLikePrivilegedKey(value: string | undefined): boolean {
  const normalized = normalizeEnvValue(value);
  if (!normalized) return false;
  if (/service[_-]?role/i.test(normalized)) return true;

  const segments = normalized.split('.');
  if (segments.length < 2) return false;

  const payload = decodeBase64Url(segments[1] ?? '');
  return typeof payload === 'string' && /"role"\s*:\s*"service_role"/.test(payload);
}

export function readPublicEnv(source: Record<string, string | undefined> = declaredEnv): PublicEnv {
  return {
    EXPO_PUBLIC_SUPABASE_URL: normalizeEnvValue(source.EXPO_PUBLIC_SUPABASE_URL),
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: normalizeEnvValue(
      source.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
    EXPO_PUBLIC_MAP_STYLE_URL: normalizeEnvValue(source.EXPO_PUBLIC_MAP_STYLE_URL),
  };
}

export type BackendStatusTone = 'neutral' | 'warning' | 'success';

export type BackendStatus = {
  label: string;
  detail: string;
  tone: BackendStatusTone;
  missing: PublicEnvKey[];
  hasSupabase: boolean;
  hasMapStyle: boolean;
  privilegedKeyWarning: string | undefined;
  invalidUrls: PublicEnvKey[];
};

export function describeBackendStatus(env: PublicEnv = readPublicEnv()): BackendStatus {
  const privilegedKeyWarning = looksLikePrivilegedKey(env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    ? 'Kunci Supabase yang terpasang terlihat seperti service role key. Hapus segera: kunci itu memberikan akses penuh dan tidak boleh ada di aplikasi mobile.'
    : undefined;

  const invalidUrls: PublicEnvKey[] = [];
  if (env.EXPO_PUBLIC_SUPABASE_URL && !isHttpsUrl(env.EXPO_PUBLIC_SUPABASE_URL)) {
    invalidUrls.push('EXPO_PUBLIC_SUPABASE_URL');
  }
  if (env.EXPO_PUBLIC_MAP_STYLE_URL && !isHttpsUrl(env.EXPO_PUBLIC_MAP_STYLE_URL)) {
    invalidUrls.push('EXPO_PUBLIC_MAP_STYLE_URL');
  }

  const missing = PUBLIC_ENV_KEYS.filter((key) => env[key] === undefined);
  const hasSupabase = env.EXPO_PUBLIC_SUPABASE_URL !== undefined;
  const hasMapStyle = env.EXPO_PUBLIC_MAP_STYLE_URL !== undefined;

  if (privilegedKeyWarning) {
    return {
      label: 'Konfigurasi tidak aman',
      detail: privilegedKeyWarning,
      tone: 'warning',
      missing,
      hasSupabase,
      hasMapStyle,
      privilegedKeyWarning,
      invalidUrls,
    };
  }

  if (invalidUrls.length > 0) {
    return {
      label: 'Format tidak valid',
      detail: `Nilai berikut bukan URL https yang valid: ${invalidUrls.join(', ')}.`,
      tone: 'warning',
      missing,
      hasSupabase,
      hasMapStyle,
      privilegedKeyWarning: undefined,
      invalidUrls,
    };
  }

  if (hasSupabase && hasMapStyle) {
    return {
      label: 'Terkonfigurasi',
      detail: 'Variabel backend dan peta sudah terisi.',
      tone: 'success',
      missing,
      hasSupabase,
      hasMapStyle,
      privilegedKeyWarning: undefined,
      invalidUrls,
    };
  }

  if (hasSupabase || hasMapStyle) {
    return {
      label: 'Sebagian terisi',
      detail: `Variabel berikut belum diisi: ${missing.join(', ')}.`,
      tone: 'warning',
      missing,
      hasSupabase,
      hasMapStyle,
      privilegedKeyWarning: undefined,
      invalidUrls,
    };
  }

  return {
    label: 'Belum dikonfigurasi',
    detail:
      'Belum ada kredensial backend. Aplikasi berjalan tanpa Supabase dan tanpa peta, jadi belum ada data yang dikirim keluar perangkat.',
    tone: 'neutral',
    missing,
    hasSupabase,
    hasMapStyle,
    privilegedKeyWarning: undefined,
    invalidUrls,
  };
}
