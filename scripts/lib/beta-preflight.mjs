/**
 * Helper murni untuk runner `beta:preflight`.
 *
 * Semua fungsi di sini bekerja pada data mentah hasil query/HTTP sehingga bisa
 * diuji `node:test` tanpa project Supabase. Aturan yang dijaga:
 * - perbandingan migration memakai set versi, bukan hanya jumlah;
 * - penilaian RLS/bucket/settings tidak pernah memuat secret;
 * - surel uji dikenali dari domain `contoh.test` yang dipakai seluruh skrip uji.
 */

/** Domain khusus akun uji; surel pengguna nyata tidak memakainya. */
export const TEST_EMAIL_DOMAIN = 'contoh.test';

/** Bucket yang wajib ada dan privat sebelum beta dibuka. */
export const REQUIRED_BUCKETS = ['avatars', 'vehicle-photos', 'club-logos'];

/**
 * Versi migration dari nama berkas `<versi>_<nama>.sql`, atau `null` bila
 * namanya tidak mengikuti pola Supabase.
 */
export function migrationVersionFromFilename(filename) {
  const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(filename ?? '');
  return match ? match[1] : null;
}

/**
 * Ringkasan sinkronisasi migration: cocok bila set versi lokal dan remote
 * identik. `missing` = ada di lokal, belum diterapkan; `extra` = ada di remote
 * tapi tidak ada di lokal (migrasi asing/berkas terhapus).
 */
export function summarizeMigrationSync(localVersions, remoteVersions) {
  const local = new Set((localVersions ?? []).filter(Boolean).map(String));
  const remote = new Set((remoteVersions ?? []).filter(Boolean).map(String));

  const missing = [...local].filter((version) => !remote.has(version)).sort();
  const extra = [...remote].filter((version) => !local.has(version)).sort();

  return {
    ok: local.size === remote.size && missing.length === 0 && extra.length === 0,
    localCount: local.size,
    remoteCount: remote.size,
    missing,
    extra,
  };
}

/**
 * RLS dinilai aktif hanya bila `rowsecurity` true di semua tabel public yang
 * dikembalikan kueri.
 */
export function evaluateRls(tables) {
  const rows = Array.isArray(tables) ? tables : [];
  const tanpaRls = rows.filter((row) => row?.rowsecurity !== true).map((row) => row?.tablename);

  return { ok: rows.length > 0 && tanpaRls.length === 0, total: rows.length, tanpaRls };
}

/**
 * Bucket wajib ada semuanya dan semuanya privat. `hilang` = nama wajib yang
 * tidak ditemukan; `publik` = nama yang ternyata publik.
 */
export function evaluateBuckets(buckets, required = REQUIRED_BUCKETS) {
  const rows = Array.isArray(buckets) ? buckets : [];
  const byName = new Map(rows.map((row) => [row?.name, row]));

  const hilang = required.filter((name) => !byName.has(name));
  const publik = required.filter((name) => byName.get(name)?.public !== false);

  return { ok: hilang.length === 0 && publik.length === 0, hilang, publik };
}

/**
 * `GET /auth/v1/settings` dianggap aman bila autoconfirm email tidak aktif.
 * `mailer_autoconfirm` adalah alias fitur yang sama; keduanya harus nonaktif
 * agar beta tidak menerima akun yang tidak diverifikasi.
 */
export function evaluateAuthSettings(json) {
  if (!json || typeof json !== 'object') {
    return { ok: false, alasan: 'respons settings tidak berbentuk objek' };
  }

  const autoconfirm = json.autoconfirm === true || json.mailer_autoconfirm === true;
  if (autoconfirm) {
    return { ok: false, alasan: 'autoconfirm aktif; email peserta beta tidak diverifikasi' };
  }

  return { ok: true, alasan: 'autoconfirm nonaktif' };
}

/**
 * Penolakan Edge Function tanpa JWT dinilai dari status HTTP. 401 adalah
 * hasil yang diharapkan; status lain dilaporkan apa adanya.
 */
export function evaluateFunctionAuth(status, label) {
  if (status === 401) {
    return { ok: true, alasan: 'ditolak 401' };
  }

  if (typeof status !== 'number') {
    return { ok: false, alasan: `${label}: tidak mendapat respons HTTP` };
  }

  return { ok: false, alasan: `${label}: mendapat HTTP ${status}, bukan 401` };
}

/** Akun uji dikenali dari domain `contoh.test` (case-insensitive). */
export function isTestAccountEmail(email) {
  if (typeof email !== 'string') return false;
  return email.toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`);
}
