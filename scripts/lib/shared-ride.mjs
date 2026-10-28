/**
 * Helper murni untuk runner `e2e:shared-ride` dan `beta:preflight`.
 *
 * Semua fungsi di sini tidak menyentuh jaringan maupun database, sehingga bisa
 * diuji dengan `node:test` tanpa project Supabase. Yang dijaga:
 * - URL project development dikenali dari host, bukan dari string bebas;
 * - pesan galat tidak pernah membocorkan JWT, kunci, atau connection string;
 * - payload realtime hanya diterima bila benar-benar milik perjalanan yang diuji.
 */

export const DEV_PROJECT_REF = 'xvmcpfkkveeaevfcvfug';

/** Ref project Supabase dari URL `https://<ref>.supabase.co`, atau `null`. */
export function projectRefFromUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return null;

    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** `true` hanya untuk project development yang menjadi target uji. */
export function isDevProjectUrl(rawUrl) {
  return projectRefFromUrl(rawUrl) === DEV_PROJECT_REF;
}

/** Ref project dari nama pengguna koneksi pooler atau host DB langsung Supabase. */
export function projectRefFromDatabaseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;

    const hostRef = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
    if (hostRef) return hostRef[1];

    const isSupabasePooler = /^[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/.test(url.hostname);
    if (!isSupabasePooler) return null;

    const usernameRef = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username));
    return usernameRef?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Pastikan URL konfigurasi aplikasi menunjuk ref beta eksplisit, bukan development. */
export function validateBetaProjectUrl(supabaseUrl, expectedProjectRef) {
  const reasons = [];
  const expected = typeof expectedProjectRef === 'string' ? expectedProjectRef.trim() : '';
  const actual = projectRefFromUrl(supabaseUrl);

  if (!/^[a-z0-9]+$/.test(expected)) reasons.push('expected_project_ref_missing_or_invalid');
  if (expected === DEV_PROJECT_REF) reasons.push('development_project_ref_forbidden');
  if (!actual) reasons.push('supabase_url_invalid');
  else if (actual === DEV_PROJECT_REF) reasons.push('development_project_forbidden');
  if (actual && expected && actual !== expected) reasons.push('supabase_project_ref_mismatch');

  return { ok: reasons.length === 0, reasons, projectRef: actual };
}

/** Pastikan URL API dan koneksi database mengarah ke project beta yang sama. */
export function evaluateBetaTarget({ supabaseUrl, databaseUrl, expectedProjectRef }) {
  const api = validateBetaProjectUrl(supabaseUrl, expectedProjectRef);
  const reasons = [...api.reasons];
  const databaseRef = projectRefFromDatabaseUrl(databaseUrl);

  if (!databaseRef) reasons.push('database_project_ref_unverifiable');
  else if (databaseRef === DEV_PROJECT_REF) reasons.push('development_database_forbidden');
  else if (api.projectRef && databaseRef !== api.projectRef) {
    reasons.push('database_project_ref_mismatch');
  }

  return { ok: reasons.length === 0, reasons, projectRef: api.projectRef };
}

/**
 * Ganti nilai sensitif dengan placeholder sebelum dicetak. Dipakai untuk pesan
 * galat dari SDK/database yang kadang memuat URL atau token.
 */
export function redactSensitive(value) {
  return String(value)
    .replace(/eyJ[A-Za-z0-9._-]+/g, '<jwt>')
    .replace(/sb_(publishable|secret)_[A-Za-z0-9_-]+/g, '<kunci>')
    .replace(/[?&]token=[^&\s]+/g, '?token=<disunting>')
    .replace(/postgres(ql)?:\/\/\S+/gi, '<database-url>');
}

/** Host + nama database saja; tidak pernah memuat user atau password. */
export function describeDatabaseTarget(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    return '<tidak terbaca>';
  }

  try {
    const url = new URL(connectionString);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return '<tidak terbaca>';
  }
}

/**
 * Payload Postgres Changes dianggap cocok bila barisnya milik `rideId` dan
 * bentuknya sesuai tabel. Event untuk tabel lain atau ride lain diabaikan.
 */
export function matchesRealtimePayload(payload, { table, rideId }) {
  const row = payload?.new;
  if (!row || row.ride_id !== rideId) return false;

  if (table === 'chat_messages') {
    return typeof row.content === 'string' && typeof row.id === 'string';
  }

  if (table === 'ride_locations') {
    return typeof row.latitude === 'number' && typeof row.longitude === 'number';
  }

  return false;
}

/** Umur event dalam milidetik, dibulatkan; dipakai untuk batas 5 detik. */
export function elapsedMs(startedAt, finishedAt = Date.now()) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return Number.NaN;
  return Math.max(0, Math.round(finishedAt - startedAt));
}
