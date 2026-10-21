#!/usr/bin/env node
/**
 * Runner uji RLS Supabase untuk project *development*.
 *
 * Kenapa runner ini ada:
 * - Setiap skrip di `supabase/tests/*.sql` membungkus semua asersinya dalam satu
 *   transaksi dan diakhiri `ROLLBACK`, jadi tidak ada data uji yang tertinggal.
 *   Berkas yang dijalankan tercantum di `DEFAULT_TEST_FILES`; setiap berkas
 *   menyatakan notice penanda lulusnya sendiri lewat direktif
 *   `-- db:test notice: <teks>`, dan runner gagal bila notice itu tidak diterima.
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

/**
 * Berkas uji yang dijalankan `npm run db:test`, berurutan. Setiap berkas menyatakan
 * sendiri notice penanda lulusnya lewat direktif `-- db:test notice: <teks>`, sehingga
 * berkas baru tidak bisa diam-diam lolos tanpa notice (dulu notice-nya di-hardcode di
 * sini, dan berkas kedua akan memakai penanda berkas pertama).
 */
const DEFAULT_TEST_FILES = [
  'supabase/tests/rls_profiles_test.sql',
  'supabase/tests/rls_policy_guard_test.sql',
  'supabase/tests/rls_rides_test.sql',
  'supabase/tests/rls_hazards_test.sql',
  'supabase/tests/rls_chat_test.sql',
  'supabase/tests/rls_moderation_m4_test.sql',
  'supabase/tests/rls_blocked_chat_test.sql',
];

/** Direktif di dalam berkas uji: notice yang harus diterima dari server. */
const NOTICE_DIRECTIVE = /^\s*--\s*db:test notice:\s*(.+?)\s*$/m;

const HELP = `Uji RLS Supabase (project development).

Pemakaian:
  npm run db:test                        jalankan seluruh berkas uji RLS
  npm run db:test -- --file <berkas.sql> jalankan satu berkas saja (mis. saat mengembangkan)

Berkas uji (berurutan):
${DEFAULT_TEST_FILES.map((file) => `  - ${file}`).join('\n')}

  Setiap berkas wajib memuat direktif notice penanda lulus, mis.:
    -- db:test notice: UJI RLS PROFIL LULUS
  Runner hanya melaporkan lulus bila notice itu benar-benar diterima dari server,
  jadi berkas yang terpotong di tengah tidak bisa tampil hijau.

Environment:
  DATABASE_URL (wajib)   Connection string PostgreSQL project DEVELOPMENT (host session pooler),
                         mis. postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
  SUPABASE_DB_URL        Dipakai bila DATABASE_URL tidak ada.
  DB_TEST_FILE           Berkas uji tunggal, menggantikan daftar di atas (untuk pengembangan).

Berkas .env.db:
  Simpan connection string di .env.db (root repo, diabaikan Git dan tidak dibaca Expo):
    DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
  Nilai itu dimuat otomatis oleh npm run db:test, jadi tidak perlu diketik di baris perintah.

Catatan:
  - Setiap skrip uji mengakhiri dirinya dengan ROLLBACK, jadi tidak ada data uji yang
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
    '[db:test] Alternatif tanpa runner: tempel seluruh isi berkas uji yang gagal ke Supabase Dashboard → SQL Editor dan pastikan notice penanda lulus di baris direktifnya muncul.',
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
  const singleFile = readOption(argv, '--file', '-f') ?? process.env.DB_TEST_FILE;
  const testFiles = singleFile ? [singleFile] : DEFAULT_TEST_FILES;

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

  // Semua berkas dibaca dan diperiksa lebih dulu: kesalahan penulisan direktif
  // harus ketahuan sebelum satu transaksi pun dibuka di database.
  const tests = [];

  for (const file of testFiles) {
    const relative = path.relative(process.cwd(), path.resolve(file));
    let sql;

    try {
      sql = await readFile(path.resolve(file), 'utf8');
    } catch {
      console.error(`[db:test] Berkas uji tidak ditemukan: ${relative}`);
      return 1;
    }

    const notice = NOTICE_DIRECTIVE.exec(sql)?.[1];

    if (!notice) {
      console.error(
        `[db:test] Berkas uji ${relative} tidak memuat direktif notice penanda lulus (contoh: "-- db:test notice: UJI ..."), sehingga keberhasilannya tidak dapat diverifikasi.`,
      );
      return 1;
    }

    tests.push({ file: relative, sql, notice });
  }

  const { config: clientOptions, note: sslNote } = clientConfig(connectionString);

  console.log(`[db:test] Target : ${describeTarget(connectionString)}`);
  console.log(`[db:test] Berkas : ${tests.map((test) => test.file).join(', ')}`);
  console.log('[db:test] Kredensial dibaca dari environment dan tidak ditampilkan di sini.');
  if (sslNote) console.log(`[db:test] TLS    : ${sslNote}`);

  const client = new pg.Client(clientOptions);

  /** Berkas yang sedang berjalan; notice hanya dihitung untuk berkas itu. */
  let current = null;

  client.on('notice', (notice) => {
    const message = String(notice?.message ?? '').trim();
    if (!message) return;

    console.log(`[db:test] server: ${message}`);
    if (current && message.includes(current.notice)) current.seen = true;
  });

  try {
    await client.connect();

    for (const test of tests) {
      current = { file: test.file, notice: test.notice, seen: false };

      const results = await client.query(test.sql);
      const statementCount = Array.isArray(results) ? results.length : 1;

      console.log(`[db:test] ${test.file}: ${statementCount} perintah selesai dijalankan.`);

      if (!current.seen) {
        console.error(
          `[db:test] GAGAL: notice "${test.notice}" dari ${test.file} tidak diterima, jadi uji tidak dianggap lulus walaupun server tidak mengembalikan error.`,
        );
        return 1;
      }

      console.log(`[db:test] LULUS: ${test.file} — notice "${test.notice}" diterima dari server.`);
    }

    console.log(
      `[db:test] LULUS: ${tests.length} berkas uji RLS berjalan dan seluruh notice penanda diterima.`,
    );
    return 0;
  } catch (error) {
    if (current) console.error(`[db:test] Berkas yang gagal: ${current.file}`);
    logError(error);
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const exitCode = await main();
process.exitCode = exitCode;
