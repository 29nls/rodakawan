import {
  describeBackendStatus,
  isHttpsUrl,
  isPlaceholderValue,
  decodeBase64Url,
  looksLikePrivilegedKey,
  normalizeEnvValue,
  readPublicEnv,
} from '@/lib/env';

/** Membuat JWT palsu untuk pengujian tanpa bergantung pada tipe Node. */
function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildJwt(payload: Record<string, unknown>): string {
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url(payload)}.signature`;
}

describe('normalizeEnvValue', () => {
  it('memangkas spasi', () => {
    expect(normalizeEnvValue('  https://example.test  ')).toBe('https://example.test');
  });

  it('menganggap string kosong sebagai tidak diisi', () => {
    expect(normalizeEnvValue('')).toBeUndefined();
    expect(normalizeEnvValue('   ')).toBeUndefined();
  });

  it('mengabaikan nilai yang secara harfiah "undefined" atau "null"', () => {
    expect(normalizeEnvValue('undefined')).toBeUndefined();
    expect(normalizeEnvValue('null')).toBeUndefined();
    expect(normalizeEnvValue('false')).toBeUndefined();
  });

  it('mengabaikan nilai contoh dari .env.example', () => {
    expect(normalizeEnvValue('https://YOUR_PROJECT.supabase.co')).toBeUndefined();
    expect(normalizeEnvValue('YOUR_PUBLIC_CLIENT_KEY')).toBeUndefined();
  });
});

describe('isPlaceholderValue', () => {
  it('mengenali penanda contoh', () => {
    expect(isPlaceholderValue('YOUR_TILE_PROVIDER')).toBe(true);
    expect(isPlaceholderValue('https://peta.example.test/style.json')).toBe(false);
  });
});

describe('isHttpsUrl', () => {
  it('menerima URL https', () => {
    expect(isHttpsUrl('https://proyek.supabase.co')).toBe(true);
  });

  it('menolak http dan teks biasa', () => {
    expect(isHttpsUrl('http://proyek.supabase.co')).toBe(false);
    expect(isHttpsUrl('proyek.supabase.co')).toBe(false);
  });
});

describe('readPublicEnv', () => {
  it('hanya membaca tiga variabel publik yang dideklarasikan', () => {
    const env = readPublicEnv({
      EXPO_PUBLIC_SUPABASE_URL: 'https://proyek.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxx',
      EXPO_PUBLIC_MAP_STYLE_URL: '',
    });

    expect(env.EXPO_PUBLIC_SUPABASE_URL).toBe('https://proyek.supabase.co');
    expect(env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe('sb_publishable_xxx');
    expect(env.EXPO_PUBLIC_MAP_STYLE_URL).toBeUndefined();
  });
});

describe('decodeBase64Url', () => {
  it('mendekode teks base64url', () => {
    expect(decodeBase64Url('eyJhIjoxfQ')).toBe('{"a":1}');
  });

  it('menolak karakter di luar alfabet base64', () => {
    expect(decodeBase64Url('bukan base64!')).toBeUndefined();
  });
});

describe('looksLikePrivilegedKey', () => {
  it('mendeteksi service role key dalam bentuk JWT', () => {
    expect(looksLikePrivilegedKey(buildJwt({ role: 'service_role' }))).toBe(true);
  });

  it('mendeteksi penyebutan service_role secara literal', () => {
    expect(looksLikePrivilegedKey('service_role_key_anda')).toBe(true);
  });

  it('tidak menandai anon key yang sah', () => {
    expect(looksLikePrivilegedKey(buildJwt({ role: 'anon' }))).toBe(false);
    expect(looksLikePrivilegedKey('sb_publishable_abc123')).toBe(false);
    expect(looksLikePrivilegedKey(undefined)).toBe(false);
  });
});

describe('describeBackendStatus', () => {
  const emptyEnv = readPublicEnv({});

  it('menyatakan belum dikonfigurasi bila semua kosong', () => {
    const status = describeBackendStatus(emptyEnv);
    expect(status.label).toBe('Belum dikonfigurasi');
    expect(status.tone).toBe('neutral');
    expect(status.missing).toHaveLength(3);
  });

  it('menyatakan terkonfigurasi bila Supabase dan peta terisi', () => {
    const status = describeBackendStatus(
      readPublicEnv({
        EXPO_PUBLIC_SUPABASE_URL: 'https://proyek.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
        EXPO_PUBLIC_MAP_STYLE_URL: 'https://peta.example.test/style.json',
      }),
    );
    expect(status.label).toBe('Terkonfigurasi');
    expect(status.tone).toBe('success');
    expect(status.missing).toHaveLength(0);
  });

  it('menyatakan sebagian terisi bila hanya satu variabel yang ada', () => {
    const status = describeBackendStatus(
      readPublicEnv({ EXPO_PUBLIC_SUPABASE_URL: 'https://proyek.supabase.co' }),
    );
    expect(status.label).toBe('Sebagian terisi');
    expect(status.hasSupabase).toBe(true);
    expect(status.hasMapStyle).toBe(false);
  });

  it('memperingatkan format URL yang tidak valid', () => {
    const status = describeBackendStatus(
      readPublicEnv({ EXPO_PUBLIC_SUPABASE_URL: 'proyek.supabase.co' }),
    );
    expect(status.label).toBe('Format tidak valid');
    expect(status.invalidUrls).toContain('EXPO_PUBLIC_SUPABASE_URL');
  });

  it('memberi peringatan keras bila kunci istimewa terpasang', () => {
    const status = describeBackendStatus(
      readPublicEnv({
        EXPO_PUBLIC_SUPABASE_URL: 'https://proyek.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: buildJwt({ role: 'service_role' }),
      }),
    );
    expect(status.label).toBe('Konfigurasi tidak aman');
    expect(status.privilegedKeyWarning).toBeDefined();
  });
});
