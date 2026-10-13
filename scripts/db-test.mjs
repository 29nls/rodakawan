#!/usr/bin/env node
/**
 * Runner uji RLS Supabase untuk project *development*.
 *
 * Kenapa runner ini ada:
 * - Skrip `supabase/tests/rls_profiles_test.sql` sudah membungkus semua asersi dalam
 *   satu transaksi dan diakhiri `ROLLBACK`, jadi tidak ada data uji yang tertinggal.
 * - Yang belum ada sebelumnya adalah cara menjalankannya yang dapat diulang tanpa
 *   menyalin-tempel ke dashboard, dan tanpa menaruh kredensial di baris perintah.
 *
 * Aturan keamanan yang dipegang file ini:
 * - Kredensial hanya dibaca dari environment (`DATABASE_URL`, atau `SUPABASE_DB_URL`). `npm run
 *   db:test` memuat berkas `.env.db` secara otomatis (`node --env-file-if-exists=.env.db`), jadi
 *   password tidak perlu ditulis di baris perintah proses dan tidak pernah ikut ke bundel aplikasi
 *   (Expo hanya membaca `.env`, `.env.local`, dan varian mode-nya).
 *   Nilainya tidak pernah dikirim sebagai argumen proses, tidak pernah ditampilkan,
 *   dan tidak pernah ditulis ke log — yang dicetak hanya `user@host:port/database`
 *   tanpa password.
 * - Runner hanya membuktikan hasil bila notice penanda lulus benar-benar diterima dari
 *   server. Exit code 0 tanpa notice itu tidak mungkin terjadi, sehingga "hijau palsu"
 *   (mis. berkas uji terpotong) tidak bisa lolos.
 * - Jangan memakai berkas `.env` / `.env.local` untuk `DATABASE_URL`: keduanya dibaca Expo dan
 *   variabel `EXPO_PUBLIC_*` di dalamnya ikut masuk ke bundel aplikasi. Pakai `.env.db` (diabaikan
 *   Git, tidak dibaca Expo) atau isi `DATABASE_URL` langsung di shell untuk satu perintah.
 *
 * Pemakaian:
 *   Berkas .env.db: isi satu baris `DATABASE_URL=...`, lalu `npm run db:test`
 *   Bash      : DATABASE_URL="postgresql://..." npm run db:test
 *   PowerShell: $env:DATABASE_URL="postgresql://..."; npm run db:test
 *   Berkas lain: npm run db:test -- --file supabase/tests/<nama>.sql
 *
 * SSL:
 * - Connection string memakai host *session pooler* (`aws-0-<region>.pooler.supabase.com`),
 *   karena host langsung `db.<ref>.supabase.co` hanya punya record AAAA (tanpa IPv4) sehingga
 *   sering gagal `ENOTFOUND`. Di pooler, user ditulis `postgres.<ref>`.
 * - `sslmode=require` di URL diperlakukan mengikuti semantik libpq: enkripsi aktif, tetapi
 *   rantai sertifikat *tidak* diverifikasi. Itu perlu karena sejak pg-connection-string 2.14
 *   node-postgres memetakan `require` ke `verify-full`, sedangkan pooler Supabase memakai CA
 *   internal (bukan CA publik) sehingga koneksi gagal `SELF_SIGNED_CERT_IN_CHAIN`. Nilai
 *   `require` juga tetap dipahami psql/pgx/`npx supabase`, jadi satu URL yang sama bisa dipakai
 *   untuk CLI maupun runner ini. Gunakan `sslmode=verify-full` bila ingin verifikasi penuh
 *   (perlu `sslrootcert` berisi CA project Supabase).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import pg from 'pg';

const DEFAULT_TEST_FILE = 'supabase/tests/rls_profiles_test.sql';

/** Notice penanda lulus dari berkas uji; dipakai untuk memverifikasi hasil. */
const SUCCESS_NOTICE = 'UJI RLS PROFIL LULUS';

const HELP = `Uji RLS Supabase (project development).

Pemakaian:
  npm run db:test [-- --file <berkas.sql>]

Environment:
  DATABASE_URL (wajib)   Connection string PostgreSQL project DEVELOPMENT (host session pooler),
                         mis. postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
  SUPABASE_DB_URL        Dipakai bila DATABASE_URL tidak ada.
  DB_TEST_FILE           Berkas uji alternatif (default ${DEFAULT_TEST_FILE}).

Berkas .env.db:
  Simpan connection string di .env.db (root repo, diabaikan Git dan tidak dibaca Expo):
    DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
  Nilai itu dimuat otomatis oleh npm run db:test, jadi tidak perlu diketik di baris perintah.

Catatan:
  - Skrip uji mengakhiri dirinya dengan ROLLBACK, jadi tidak ada data uji yang
    tertinggal di database.
  - Password tidak pernah dicetak; hanya user@host:port/database yang ditampilkan.
`;

function readOption(argv, ...names) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    for (const name of names) {
      if (argument === name) return argv[index + 1];
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
    }
  }

  return undefined;
}

/** Deskripsi target koneksi tanpa rahasia apa pun. */
function describeTarget(connectionString) {
  try {
    const url = new URL(connectionString);
    const user = url.username ? decodeURIComponent(url.username) : '(tanpa user)';
    const host = url.hostname || '(tanpa host)';
    const port = url.port || '5432';
    const database = url.pathname.replace(/^\//, '') || '(tanpa nama database)';
    const sslmode = url.searchParams.get('sslmode');

    return `${user}@${host}:${port}/${database}${sslmode ? ` (sslmode=${sslmode})` : ''}`;
  } catch {
    return '(connection string tidak dapat dibaca)';
  }
}

/**
 * Terjemahkan connection string menjadi konfigurasi client pg.
 *
 * `sslmode=require` ditangani sendiri dengan semantik libpq (enkripsi tanpa verifikasi CA),
 * lihat catatan SSL di atas; nilainya dihapus dari URL supaya tidak dipetakan ulang oleh
 * pg-connection-string menjadi `verify-full`.
 */
function clientConfig(connectionString) {
  const base = {
    application_name: 'rodakawan-rls-test',
    connectionTimeoutMillis: 15_000,
    statement_timeout: 60_000,
  };

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return { config: { ...base, connectionString }, note: undefined };
  }

  if (url.searchParams.get('sslmode') !== 'require') {
    return { config: { ...base, connectionString }, note: undefined };
  }

  url.searchParams.delete('sslmode');

  return {
    config: { ...base, connectionString: url.toString(), ssl: { rejectUnauthorized: false } },
    note: 'sslmode=require → enkripsi aktif tanpa verifikasi CA (semantik libpq; pooler Supabase memakai CA internal).',
  };
}

function connectionHint(error) {
  const code = String(error?.code ?? '');

  switch (code) {
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'Sertifikat TLS server tidak dapat diverifikasi dengan CA publik (pooler Supabase memakai CA internal). Pakai `sslmode=require` pada connection string, atau `sslmode=verify-full` bila Anda menyediakan CA project lewat `sslrootcert`.';
    case 'ENOTFOUND':
      // Pesan khusus untuk host langsung yang hanya punya record AAAA.
      return 'Host tidak ditemukan. Host langsung `db.<ref>.supabase.co` hanya punya record AAAA (tanpa IPv4), jadi sering gagal di jaringan IPv4 — pakai host session pooler `aws-0-<region>.pooler.supabase.com` dengan user `postgres.<ref>`. Periksa juga koneksi internet dan apakah IP Anda diizinkan pada project tersebut.';
    case '28P01':
      return 'Password/kredensial database ditolak. Pastikan DATABASE_URL memakai kredensial project development, bukan yang lama.';
    case '3D000':
      return 'Nama database tidak ditemukan pada server tersebut. Periksa bagian akhir connection string (biasanya `/postgres`).';
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'ENOTFOUND':
    case 'EHOSTUNREACH':
      return 'Server database tidak dapat dihubungi. Periksa koneksi internet, host/port, dan apakah IP Anda diizinkan pada project tersebut.';
    case '42501':
      return 'Izin ditolak server. Pengujian ini biasanya perlu kredensial pemilik database (mis. `postgres`).';
    case '3F000':
    case '42P01':
    case 'PGRST205':
      return 'Objek database belum ada. Jalankan migration yang belum diterapkan lebih dulu (lihat docs/SETUP_GUIDE.md bagian 4.3).';
    default:
      return undefined;
  }
}

function logError(error) {
  const code = error?.code ? ` [${error.code}]` : '';
  console.error(`[db:test] GAGAL${code}: ${error?.message ?? error}`);

  if (error?.detail) console.error(`[db:test] detail: ${error.detail}`);
  if (error?.hint) console.error(`[db:test] hint: ${error.hint}`);
  if (error?.where) console.error(`[db:test] lokasi: ${error.where}`);

  const hint = connectionHint(error);
  if (hint) console.error(`[db:test] saran: ${hint}`);

  console.error(
    '[db:test] Alternatif tanpa runner: tempel seluruh isi berkas uji ke Supabase Dashboard → SQL Editor dan pastikan notice "UJI RLS PROFIL LULUS" muncul.',
  );
  console.error(
    '[db:test] Jangan pernah menampilkan DATABASE_URL, password database, atau kunci service_role di laporan, issue, maupun chat.',
  );
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }

  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  const testFile = path.resolve(
    readOption(argv, '--file', '-f') ?? process.env.DB_TEST_FILE ?? DEFAULT_TEST_FILE,
  );

  if (!connectionString) {
    console.error('[db:test] DATABASE_URL belum diatur.');
    console.error(
      '[db:test] Contoh (PowerShell): $env:DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"; npm run db:test',
    );
    console.error('[db:test] Contoh (Bash)      : DATABASE_URL="postgresql://..." npm run db:test');
    console.error(
      '[db:test] Simpan connection string di berkas .env.db (diabaikan Git, tidak dibaca Expo), jangan di .env/.env.local.',
    );
    return 1;
  }

  let sql;
  try {
    sql = await readFile(testFile, 'utf8');
  } catch {
    console.error(
      `[db:test] Berkas uji tidak ditemukan: ${path.relative(process.cwd(), testFile)}`,
    );
    return 1;
  }

  if (!sql.includes(SUCCESS_NOTICE)) {
    console.error(
      `[db:test] Berkas uji tidak memuat notice penanda lulus "${SUCCESS_NOTICE}", jadi keberhasilan tidak dapat diverifikasi.`,
    );
    return 1;
  }

  const { config: clientOptions, note: sslNote } = clientConfig(connectionString);

  console.log(`[db:test] Target : ${describeTarget(connectionString)}`);
  console.log(`[db:test] Berkas : ${path.relative(process.cwd(), testFile)}`);
  console.log('[db:test] Kredensial dibaca dari environment dan tidak ditampilkan di sini.');
  if (sslNote) console.log(`[db:test] TLS    : ${sslNote}`);

  const client = new pg.Client(clientOptions);

  let sawSuccessNotice = false;

  client.on('notice', (notice) => {
    const message = String(notice?.message ?? '').trim();
    if (!message) return;

    console.log(`[db:test] server: ${message}`);
    if (message.includes(SUCCESS_NOTICE)) sawSuccessNotice = true;
  });

  try {
    await client.connect();
    const results = await client.query(sql);
    const statementCount = Array.isArray(results) ? results.length : 1;

    console.log(`[db:test] ${statementCount} perintah selesai dijalankan.`);

    if (!sawSuccessNotice) {
      console.error(
        `[db:test] GAGAL: notice "${SUCCESS_NOTICE}" tidak diterima, jadi uji tidak dianggap lulus walaupun server tidak mengembalikan error.`,
      );
      return 1;
    }

    console.log('[db:test] LULUS: semua asersi RLS pada berkas ini terpenuhi.');
    return 0;
  } catch (error) {
    logError(error);
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const exitCode = await main();
process.exitCode = exitCode;
