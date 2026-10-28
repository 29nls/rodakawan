#!/usr/bin/env node
/**
 * Preflight beta tertutup — pemeriksaan HANYA-BACA terhadap project Supabase.
 *
 * Kenapa skrip ini ada
 * ---------------------------------------------------------------------------
 * Sebelum APK dibagikan ke peserta beta, pemilik perlu tahu bahwa project
 * backend benar-benar siap: schema serupa dengan repository, RLS menyala di
 * semua tabel, bucket media privat, Edge Function hapus akun menolak request
 * tanpa JWT, pendaftaran tidak diam-diam memakai autoconfirm, dan tidak ada
 * akun uji yang tertinggal. Semua pemeriksaan memakai `SELECT` dan
 * `GET`/probe penolakan; tidak ada baris yang ditulis, diubah, atau dihapus.
 *
 * Pemeriksaan
 * ---------------------------------------------------------------------------
 * 1. Jumlah + daftar versi migration remote = lokal (set, bukan hanya jumlah)
 * 2. RLS aktif di semua tabel `public`
 * 3. Bucket `avatars`, `vehicle-photos`, `club-logos` ada dan privat
 * 4. Edge Function `delete-account` menolak request tanpa JWT (HTTP 401)
 * 5. `GET /auth/v1/settings` tidak menunjukkan autoconfirm yang aktif
 * 6. Tidak ada akun uji tersisa (domain `contoh.test`)
 *
 * Pemakaian
 * ---------------------------------------------------------------------------
 *   npm run beta:preflight
 *   node --env-file-if-exists=.env.local --env-file-if-exists=.env.db scripts/beta-preflight.mjs
 *
 * Environment: BETA_SUPABASE_PROJECT_REF (wajib), EXPO_PUBLIC_SUPABASE_URL
 * (wajib), DATABASE_URL atau SUPABASE_DB_URL (wajib),
 * EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (opsional,
 * untuk probe penolakan kedua yang menyertakan apikey).
 *
 * Keluaran: daftar LULUS/GAGAL per butir. Tidak pernah mencetak JWT, kunci,
 * kata sandi, maupun connection string.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import pg from 'pg';

import {
  evaluateAuthSettings,
  evaluateBuckets,
  evaluateFunctionAuth,
  evaluateRls,
  isTestAccountEmail,
  migrationVersionFromFilename,
  summarizeMigrationSync,
} from './lib/beta-preflight.mjs';
import { evaluateBetaTarget } from './lib/shared-ride.mjs';
import { projectRefFromUrl, redactSensitive } from './lib/shared-ride.mjs';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations', import.meta.url));
const HTTP_TIMEOUT_MS = 15_000;

const HELP = `Preflight beta tertutup (pemeriksaan hanya-baca).

Pemakaian:
  npm run beta:preflight
  node --env-file-if-exists=.env.local --env-file-if-exists=.env.db scripts/beta-preflight.mjs

Environment:
  BETA_SUPABASE_PROJECT_REF           ref project beta yang disetujui (wajib)
  EXPO_PUBLIC_SUPABASE_URL            URL project beta (wajib)
  DATABASE_URL atau SUPABASE_DB_URL   koneksi database project beta (wajib)
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY  opsional; dipakai probe penolakan Edge Function

Skrip ini tidak pernah menulis data. Keluaran 0 = semua lulus, 1 = ada
pemeriksaan gagal, 2 = environment/URL tidak layak.
`;

let jumlahLulus = 0;
let jumlahGagal = 0;

function lulus(pesan) {
  jumlahLulus += 1;
  console.log(`[beta:preflight] LULUS  ${pesan}`);
}

function gagal(pesan) {
  jumlahGagal += 1;
  console.log(`[beta:preflight] GAGAL  ${pesan}`);
}

function catat(ok, pesanLulus, pesanGagal) {
  if (ok) lulus(pesanLulus);
  else gagal(pesanGagal);
}

async function fetchJson(url, { headers = {} } = {}) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch (error) {
    return { status: null, json: null, error: redactSensitive(error?.message ?? error) };
  }
}

/** Probe penolakan: kirim POST tanpa badan ke Edge Function. */
async function probeFunction(url, headers) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: '',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return { status: response.status };
  } catch (error) {
    return { status: null, error: redactSensitive(error?.message ?? error) };
  }
}

function localMigrationVersions() {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql'));
  const versions = files.map(migrationVersionFromFilename);

  const tanpaPola = files.filter((_, index) => versions[index] === null);
  return { versions: versions.filter(Boolean), tanpaPola };
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(HELP);
    return 0;
  }

  const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

  const expectedProjectRef = process.env.BETA_SUPABASE_PROJECT_REF ?? '';
  const kurang = [];
  if (!expectedProjectRef) kurang.push('BETA_SUPABASE_PROJECT_REF');
  if (!supabaseUrl) kurang.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!connectionString) kurang.push('DATABASE_URL');

  if (kurang.length > 0) {
    console.error(`[beta:preflight] Environment belum lengkap: ${kurang.join(', ')}.`);
    console.error(HELP);
    return 2;
  }

  const projectRef = projectRefFromUrl(supabaseUrl);
  if (!projectRef) {
    console.error(
      '[beta:preflight] EXPO_PUBLIC_SUPABASE_URL bukan URL project Supabase yang sah (https://<ref>.supabase.co).',
    );
    return 2;
  }

  const target = evaluateBetaTarget({
    supabaseUrl,
    databaseUrl: connectionString,
    expectedProjectRef,
  });
  if (!target.ok) {
    console.error(
      `[beta:preflight] Target ditolak (${target.reasons.join(', ')}); gunakan URL dan database beta dengan ref yang sama, bukan project development.`,
    );
    return 2;
  }

  console.log(`[beta:preflight] Project : ${projectRef} (beta; ref API dan database cocok)`);
  console.log('[beta:preflight] Database: ref project terverifikasi; endpoint tidak ditampilkan');
  console.log('[beta:preflight] Mode    : hanya-baca (SELECT + probe penolakan tanpa otorisasi)');

  const client = new pg.Client({
    connectionString,
    ssl: connectionString.includes('localhost') ? undefined : { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    /* 1. Migration remote = migration lokal (per versi, bukan hanya jumlah). */
    const { versions: localVersions, tanpaPola } = localMigrationVersions();
    catat(
      tanpaPola.length === 0,
      `semua ${localVersions.length} berkas migration lokal mengikuti pola <versi>_<nama>.sql`,
      `berkas migration lokal tidak mengikuti pola: ${tanpaPola.join(', ')}`,
    );

    const remote = await client.query(
      'select version::text as version from supabase_migrations.schema_migrations order by version',
    );
    const sync = summarizeMigrationSync(
      localVersions,
      remote.rows.map((row) => row.version.trim()),
    );
    catat(
      sync.ok,
      `migration sinkron: ${sync.localCount} lokal = ${sync.remoteCount} remote`,
      `migration tidak sinkron: ${sync.localCount} lokal vs ${sync.remoteCount} remote; ` +
        `belum diterapkan: ${sync.missing.join(', ') || '(tidak ada)'}; ` +
        `hanya di remote: ${sync.extra.join(', ') || '(tidak ada)'}`,
    );

    /* 2. RLS aktif di semua tabel public. */
    const rls = await client.query(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`,
    );
    const rlsResult = evaluateRls(rls.rows);
    catat(
      rlsResult.ok,
      `RLS aktif di semua ${rlsResult.total} tabel public`,
      `tabel public tanpa RLS: ${rlsResult.tanpaRls.join(', ') || '(tidak ada)'}`,
    );

    /* 3. Bucket media privat. */
    const buckets = await client.query(
      `select name, public from storage.buckets where name in ('avatars', 'vehicle-photos', 'club-logos')`,
    );
    const bucketResult = evaluateBuckets(buckets.rows);
    catat(
      bucketResult.ok,
      'bucket avatars, vehicle-photos, club-logos ada dan privat',
      [
        bucketResult.hilang.length > 0 ? `bucket hilang: ${bucketResult.hilang.join(', ')}` : '',
        bucketResult.publik.length > 0 ? `bucket publik: ${bucketResult.publik.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; '),
    );

    /* 4. Akun uji tersisa. */
    const sisa = await client.query(
      `select count(*)::int as count from auth.users where lower(email) like '%@contoh.test'`,
    );
    const sisaCount = sisa.rows[0]?.count ?? 0;
    catat(
      sisaCount === 0 &&
        isTestAccountEmail('uji.x@contoh.test') &&
        !isTestAccountEmail('budi@contoh.lain'),
      `tidak ada akun uji tersisa (domain contoh.test)`,
      `masih ada ${sisaCount} akun uji tersisa di auth.users`,
    );

    await client.end();

    /* 5. Edge Function delete-account menolak tanpa JWT.
     * Dipakai jalur `supabase.co/functions/v1` karena host `functions.dev`
     * tidak selalu bisa diresolusi DNS di jaringan pemilik; semantik
     * gateway + pemeriksaan JWT fungsi sama persis. */
    const functionUrl = `${supabaseUrl}/functions/v1/delete-account`;
    const probeTanpaHeader = await probeFunction(functionUrl, {});
    const evalTanpaHeader = evaluateFunctionAuth(probeTanpaHeader.status, 'tanpa header');
    catat(
      evalTanpaHeader.ok,
      'Edge Function delete-account menolak request tanpa JWT (401)',
      `Edge Function delete-account ${evalTanpaHeader.alasan}` +
        (probeTanpaHeader.error ? ` (${probeTanpaHeader.error})` : ''),
    );

    if (publishableKey) {
      const probeApikey = await probeFunction(functionUrl, { apikey: publishableKey });
      const evalApikey = evaluateFunctionAuth(
        probeApikey.status,
        'dengan apikey tanpa JWT pengguna',
      );
      catat(
        evalApikey.ok,
        'Edge Function delete-account menolak request dengan apikey saja (401)',
        `Edge Function delete-account ${evalApikey.alasan}` +
          (probeApikey.error ? ` (${probeApikey.error})` : ''),
      );
    } else {
      console.log(
        '[beta:preflight] LEWAT  probe kedua delete-account (EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY tidak diset)',
      );
    }

    /* 6. Settings auth publik: autoconfirm tidak aktif. */
    const settings = await fetchJson(`${supabaseUrl}/auth/v1/settings`, {
      headers: publishableKey ? { apikey: publishableKey } : {},
    });
    const settingsResult =
      settings.status === null
        ? { ok: false, alasan: `settings tidak terjangkau (${settings.error})` }
        : settings.status !== 200
          ? { ok: false, alasan: `settings membalas HTTP ${settings.status}` }
          : evaluateAuthSettings(settings.json);
    catat(
      settingsResult.ok,
      `auth settings aman: ${settingsResult.alasan}`,
      `auth settings: ${settingsResult.alasan}`,
    );
  } catch (error) {
    try {
      await client.end();
    } catch {
      // Koneksi mungkin sudah tertutup karena kegagalan jaringan.
    }
    console.error(`\n[beta:preflight] GAGAL: ${redactSensitive(error?.message ?? error)}`);
    return 1;
  }

  console.log(`\n[beta:preflight] ${jumlahLulus} lulus, ${jumlahGagal} gagal.`);

  if (jumlahGagal > 0) {
    console.log('[beta:preflight] Perbaiki pemeriksaan GAGAL di atas sebelum membagikan APK beta.');
    return 1;
  }

  console.log('[beta:preflight] PREFLIGHT BETA LULUS');
  return 0;
}

const exitCode = await main();
process.exitCode = exitCode;
