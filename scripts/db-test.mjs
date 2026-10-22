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
 * - Sebelum satu koneksi pun dibuka, runner menjalankan pemeriksaan **statis**: berkas uji
 *   harus memuat direktif notice-nya, dan literal yang diberikan ke parameter bertipe
 *   `uuid` harus benar-benar UUID. Pemeriksaan itu tidak butuh kredensial, jadi kelas
 *   galat yang hanya muncul saat runtime database tertangkap lebih awal (ADR-069).
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
 * - Kegagalan satu berkas uji **tidak** menghentikan berkas lain: seluruh berkas tetap
 *   dijalankan dan semua kegagalan diringkas sekaligus di akhir, jadi satu putaran uji
 *   menunjukkan semua masalah — bukan hanya yang pertama. Kalau koneksinya sendiri yang
 *   putus, sisa berkas ditandai "tidak dijalankan" (bukan "gagal"), karena memang tidak
 *   pernah diuji.
 * - Jangan memakai berkas `.env` / `.env.local` untuk `DATABASE_URL`: keduanya dibaca Expo dan
 *   variabel `EXPO_PUBLIC_*` di dalamnya ikut masuk ke bundel aplikasi. Pakai `.env.db` (diabaikan
 *   Git, tidak dibaca Expo) atau isi `DATABASE_URL` langsung di shell untuk satu perintah.
 *
 * Pemakaian:
 *   Berkas .env.db: isi satu baris `DATABASE_URL=...`, lalu `npm run db:test`
 *   Bash      : DATABASE_URL="postgresql://..." npm run db:test
 *   PowerShell: $env:DATABASE_URL="postgresql://..."; npm run db:test
 *   Berkas lain: npm run db:test -- --file supabase/tests/<nama>.sql
 *                (opsi --file boleh diulang untuk menjalankan beberapa berkas)
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

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { checkTestFiles } from './lib/sql-uuid-literals.mjs';

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

/**
 * Folder migration: sumber tanda tangan fungsi untuk pemeriksaan statis
 * literal UUID. Alamatnya relatif ke berkas script ini, bukan ke folder kerja,
 * supaya pemeriksaan tetap berjalan dari mana pun runner dipanggil.
 */
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '..', 'supabase', 'migrations');

/**
 * Root repository. Berkas uji bawaan juga ditunjuk relatif ke root ini (bukan ke
 * folder kerja), jadi `npm run db:test` menemukan berkas yang sama dari mana pun
 * runner dipanggil.
 */
const ROOT_DIR = path.resolve(import.meta.dirname, '..');

/**
 * Kode galat yang berarti koneksi ke database tidak bisa dipakai lagi.
 *
 * Untuk galat seperti ini melanjutkan ke berkas berikutnya tidak ada gunanya: setiap
 * berkas berikutnya pasti gagal dengan sebab yang sama dan hanya menambah waktu. Sisa
 * berkas ditandai "tidak dijalankan", bukan "gagal" — dibedakan karena yang pertama
 * berarti ada masalah pada isi berkasnya, sedangkan yang kedua berarti berkas itu
 * belum pernah diuji sama sekali.
 */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '57P01',
  '57P02',
  '57P03',
  '53300',
]);

/**
 * Peringatan bawaan PostgreSQL yang tidak membawa informasi bagi pembaca log.
 *
 * Runner mengirim `ROLLBACK` untuk mengembalikan koneksi ke keadaan bersih setelah
 * sebuah berkas gagal. Bila tidak ada transaksi yang terbuka, PostgreSQL menjawab
 * dengan peringatan ini — keadaan yang justru kita inginkan, jadi tidak dicetak.
 */
const ROLLBACK_WARNING = 'there is no transaction in progress';

const HELP = `Uji RLS Supabase (project development).

Pemakaian:
  npm run db:test                        jalankan seluruh berkas uji RLS
  npm run db:test -- --file <berkas.sql> jalankan satu berkas saja (mis. saat developing)
  npm run db:test -- --file a.sql --file b.sql  jalankan beberapa berkas

Berkas uji (berurutan):
${DEFAULT_TEST_FILES.map((file) => `  - ${file}`).join('\n')}

  Setiap berkas wajib memuat direktif notice penanda lulus, mis.:
    -- db:test notice: UJI ... LULUS
  Runner hanya melaporkan lulus bila notice itu benar-benar diterima dari server,
  jadi berkas yang terpotong di tengah tidak bisa tampil hijau.

  Kegagalan satu berkas tidak menghentikan berkas lain: seluruh berkas tetap
  dijalankan, dan semua kegagalan diringkas sekaligus di akhir. Kalau koneksinya
  sendiri yang putus, sisa berkas ditandai "tidak dijalankan".

Sebelum membuka koneksi, runner memeriksa berkas uji secara statis:
  - direktif notice harus ada;
  - literal yang diberikan ke parameter bertipe uuid harus benar-benar UUID
    (PostgreSQL menolak yang lain dengan SQLSTATE 22P02 saat pemanggilan).
  Semua masalah statis dilaporkan sekaligus, bukan satu per satu.
  Pemeriksaan ini tidak butuh kredensial, jadi galatnya muncul lebih awal.
  Jalankan sendiri: npm run db:test:lint

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

/**
 * Baca seluruh migration untuk sumber tanda tangan fungsi.
 *
 * Berkas dibaca berurutan berdasarkan nama, jadi definisi yang lebih baru
 * menimpa definisi lama — sama seperti urutan saat migration diterapkan.
 */
async function readMigrations() {
  let names;

  try {
    names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  } catch {
    return [];
  }

  const migrations = [];

  for (const name of names) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), 'utf8');
    migrations.push({ path: name, sql });
  }

  return migrations;
}

/**
 * Baca semua nilai opsi yang diberikan. Opsi boleh diulang; hasilnya berurutan
 * seperti penulisan di baris perintah.
 */
function readOptions(argv, ...names) {
  const values = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    for (const name of names) {
      if (argument === name) {
        const value = argv[index + 1];
        if (value !== undefined) {
          values.push(value);
          index += 1;
        }
        break;
      }

      if (argument.startsWith(`${name}=`)) {
        values.push(argument.slice(name.length + 1));
        break;
      }
    }
  }

  return values;
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

/**
 * Apakah galat ini berarti koneksi database sudah tidak bisa dipakai lagi.
 *
 * Ringkasnya: SQLSTATE kelas 08 (connection exception) dan beberapa kode jaringan
 * termasuk. Galat lain — misalnya asersi yang gagal di dalam SQL — tidak termasuk,
 * karena sambungan masih hidup dan berkas berikutnya masih bisa dijalankan.
 */
export function isConnectionError(error) {
  const code = String(error?.code ?? '');

  if (CONNECTION_ERROR_CODES.has(code)) return true;
  // Kelas SQLSTATE 08 = connection exception; kode per-provider (mis. ENOTFOUND)
  // sudah ada di CONNECTION_ERROR_CODES.
  if (/^08[A-Z0-9]{3}$/.test(code)) return true;

  const message = String(error?.message ?? '');

  return (
    /connection (?:terminated|ended|closed|reset|failed)/i.test(message) ||
    /client has encountered a connection error/i.test(message) ||
    /the connection to the server was lost/i.test(message) ||
    /server closed the connection/i.test(message) ||
    /terminating connection due to administrator command/i.test(message)
  );
}

/**
 * Cetak detail galat database beserta saran perbaikannya.
 *
 * Tidak pernah mencetak kredensial: yang keluar hanya pesan galat dari server.
 */
function logError(error, err) {
  const code = error?.code ? ` [${error.code}]` : '';
  err(`[db:test] GAGAL${code}: ${error?.message ?? error}`);

  if (error?.detail) err(`[db:test] detail: ${error.detail}`);
  if (error?.hint) err(`[db:test] hint: ${error.hint}`);
  if (error?.where) err(`[db:test] lokasi: ${error.where}`);

  const hint = connectionHint(error);
  if (hint) err(`[db:test] saran: ${hint}`);

  err(
    '[db:test] Alternatif tanpa runner: tempel seluruh isi berkas uji yang gagal ke Supabase Dashboard → SQL Editor dan pastikan notice penanda lulus di baris direktifnya muncul.',
  );
  err(
    '[db:test] Jangan pernah menampilkan DATABASE_URL, password database, atau kunci service_role di laporan, issue, maupun chat.',
  );
}

/**
 * Kembalikan koneksi ke keadaan bersih setelah satu berkas uji selesai.
 *
 * Wajib dilakukan setelah berkas yang gagal: PostgreSQL membatalkan seluruh
 * transaksi yang sedang berjalan, jadi tanpa `ROLLBACK` perintah berikutnya
 * ditolak dengan "current transaction is aborted" — berkas berikutnya tidak akan
 * pernah bisa dijalankan. Galat di sini diabaikan (koneksi mungkin sudah putus),
 * karena yang penting berkas yang gagal tidak menghalangi berkas lain.
 */
async function rollbackQuietly(client, err) {
  try {
    await client.query('rollback;');
  } catch (error) {
    if (isConnectionError(error)) return;
    err(
      `[db:test] Peringatan: ROLLBACK setelah berkas uji tidak berhasil: ${error?.message ?? error}`,
    );
  }
}

/**
 * Baca semua berkas uji dan kumpulkan **seluruh** masalah statisnya sekaligus.
 *
 * Tidak berhenti pada masalah pertama: berkas yang hilang, literal UUID yang
 * pasti ditolak PostgreSQL, dan berkas tanpa direktif notice dikumpulkan bersama,
 * lalu dilaporkan dalam satu daftar.
 */
async function collectStaticProblems(fileArguments, cwd) {
  const problems = [];
  const tests = [];

  for (const argument of fileArguments) {
    // Berkas bawaan ditunjuk relatif ke root repo; berkas dari --file relatif ke
    // folder kerja pemanggil.
    const isDefault = DEFAULT_TEST_FILES.includes(argument);
    const resolved = isDefault ? path.resolve(ROOT_DIR, argument) : path.resolve(cwd, argument);
    const display = argument;

    let sql;
    try {
      sql = await readFile(resolved, 'utf8');
    } catch {
      problems.push(`Berkas uji tidak ditemukan: ${display}`);
      continue;
    }

    tests.push({ path: display, sql, isDefault, resolved });
  }

  return { problems, tests };
}

/**
 * Jalankan seluruh berkas uji pada satu koneksi dan kumpulkan hasilnya.
 *
 * Kegagalan satu berkas tidak menghentikan berkas lain. Setiap berkas dibersihkan
 * dengan `ROLLBACK` supaya berkas berikutnya selalu mulai dari keadaan bersih.
 * Bila koneksinya sendiri yang putus, sisa berkas ditandai "tidak dijalankan".
 */
async function runTestFiles({ tests, client, out, err }) {
  const results = [];

  /** Berkas yang sedang berjalan; notice hanya dihitung untuk berkas itu. */
  let current = null;

  client.on('notice', (notice) => {
    const message = String(notice?.message ?? '').trim();
    if (!message) return;
    // Peringatan "no transaction in progress" muncul justru karena runner
    // membersihkan koneksi dengan benar — bukan informasi yang perlu dibaca.
    if (message.includes(ROLLBACK_WARNING)) return;

    out(`[db:test] server: ${message}`);
    if (current && message.includes(current.notice)) current.seen = true;
  });

  try {
    await client.connect();
  } catch (error) {
    err('[db:test] Koneksi ke database gagal dibuka, tidak ada berkas uji yang bisa dijalankan.');
    logError(error, err);

    for (const test of tests) {
      results.push({ file: test.path, status: 'skipped', reason: 'koneksi tidak bisa dibuka' });
    }

    return results;
  }

  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index];
    current = { file: test.path, notice: test.notice, seen: false };

    try {
      const queryResult = await client.query(test.sql);
      const statementCount = Array.isArray(queryResult) ? queryResult.length : 1;

      out(`[db:test] ${test.path}: ${statementCount} perintah selesai dijalankan.`);

      if (!current.seen) {
        const reason = `notice "${test.notice}" tidak diterima dari server`;
        err(
          `[db:test] GAGAL: notice "${test.notice}" dari ${test.path} tidak diterima, jadi uji tidak dianggap lulus walaupun server tidak mengembalikan error.`,
        );
        results.push({ file: test.path, status: 'failed', reason });
      } else {
        out(`[db:test] LULUS: ${test.path} — notice "${test.notice}" diterima dari server.`);
        results.push({ file: test.path, status: 'passed', reason: undefined });
      }
    } catch (error) {
      const connectionBroken = isConnectionError(error);
      const reason = String(error?.message ?? error).split('\n')[0];

      err(`[db:test] GAGAL: berkas uji ${test.path} gagal dijalankan.`);
      logError(error, err);

      results.push({
        file: test.path,
        status: connectionBroken ? 'skipped' : 'failed',
        reason: connectionBroken
          ? `koneksi database terputus (${reason})`
          : reason || 'galat tidak diketahui',
      });

      if (connectionBroken) {
        // Sambungan sudah tidak berguna: sisa berkas hanya akan gagal dengan
        // sebab yang sama. Tandai "tidak dijalankan", bukan "gagal".
        for (const rest of tests.slice(index + 1)) {
          results.push({ file: rest.path, status: 'skipped', reason: 'koneksi database terputus' });
        }
        break;
      }
    } finally {
      await rollbackQuietly(client, err);
    }
  }

  return results;
}

/**
 * Cetak ringkasan seluruh hasil: berapa berkas yang lulus, gagal, dan tidak
 * dijalankan, serta daftar detail setiap kegagalan.
 */
function printSummary(results, out, err) {
  const passed = results.filter((result) => result.status === 'passed');
  const failed = results.filter((result) => result.status === 'failed');
  const skipped = results.filter((result) => result.status === 'skipped');

  out('');
  out(
    `[db:test] Ringkasan: ${results.length} berkas uji — ${passed.length} lulus, ${failed.length} gagal, ${skipped.length} tidak dijalankan.`,
  );

  if (failed.length > 0) {
    err(`[db:test] Berkas uji yang gagal (${failed.length}):`);
    for (const result of failed) err(`[db:test]   - ${result.file}: ${result.reason}`);
  }

  if (skipped.length > 0) {
    err(`[db:test] Berkas uji yang tidak dijalankan (${skipped.length}):`);
    for (const result of skipped) err(`[db:test]   - ${result.file}: ${result.reason}`);
  }
}

/**
 * Titik masuk runner.
 *
 * Semua dependensi yang menyentuh dunia luar (environment, client pg, logger)
 * bisa disuntikkan, sehingga seluruh perilaku runner bisa diuji tanpa database
 * sungguhan. Tanpa penyuntikan, perilakunya persis seperti dijalankan dari
 * baris perintah.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    env = process.env,
    cwd = process.cwd(),
    createClient = (config) => new pg.Client(config),
    out = (...args) => console.log(...args),
    err = (...args) => console.error(...args),
  } = deps;

  if (argv.includes('--help') || argv.includes('-h')) {
    out(HELP);
    return 0;
  }

  const fileOptions = readOptions(argv, '--file', '-f');
  const envFile = env.DB_TEST_FILE;
  const testFiles = fileOptions.length > 0 ? fileOptions : envFile ? [envFile] : DEFAULT_TEST_FILES;

  // Semua berkas dibaca dan diperiksa lebih dulu: kesalahan penulisan direktif
  // dan literal yang pasti ditolak PostgreSQL harus ketahuan sebelum satu
  // transaksi pun dibuka di database. Pemeriksaan statis berjalan paling awal
  // karena tidak butuh kredensial sama sekali — jadi galat literal UUID tetap
  // dilaporkan pada mesin yang tidak punya `DATABASE_URL`.
  const migrations = await readMigrations();

  if (migrations.length === 0) {
    err(
      `[db:test] Folder migration tidak ditemukan (${path.relative(cwd, MIGRATIONS_DIR)}), sehingga pemeriksaan literal UUID tidak bisa dijalankan.`,
    );
    return 1;
  }

  const { problems, tests } = await collectStaticProblems(testFiles, cwd);

  // Literal yang diberikan ke parameter bertipe `uuid` pasti ditolak
  // PostgreSQL dengan SQLSTATE 22P02 saat pemanggilan — jadi galatnya sudah
  // bisa diketahui tanpa membuka koneksi sama sekali.
  const violations = checkTestFiles(migrations, tests);
  const uuidProblems = violations.map(
    (violation) =>
      `${violation.file}:${violation.line}:${violation.column} — parameter uuid ${violation.paramName} pada ${violation.functionName} menerima literal '${violation.literal}' yang bukan UUID.`,
  );

  const noticeProblems = [];
  for (const test of tests) {
    const notice = NOTICE_DIRECTIVE.exec(test.sql)?.[1];

    if (!notice) {
      noticeProblems.push(
        `Berkas uji ${test.path} tidak memuat direktif notice penanda lulus (contoh: "-- db:test notice: UJI ..."), sehingga keberhasilannya tidak dapat diverifikasi.`,
      );
      continue;
    }

    test.notice = notice;
  }

  const allProblems = [...problems, ...uuidProblems, ...noticeProblems];

  if (allProblems.length > 0) {
    err(`[db:test] Pemeriksaan statis menemukan ${allProblems.length} masalah:`);
    for (const problem of allProblems) err(`[db:test]   - ${problem}`);

    if (uuidProblems.length > 0) {
      err(
        '[db:test] PostgreSQL akan menolak literal itu dengan SQLSTATE 22P02 (invalid input syntax for type uuid) saat pemanggilan, sebelum badan fungsi dijalankan.',
      );
      err(
        "[db:test] Perbaiki nilainya menjadi literal UUID kanonis (8-4-4-4-12 heksadesimal), mis. 'a1111111-2222-4333-8444-555555555555'.",
      );
    }

    err(
      '[db:test] Tidak ada koneksi yang dibuka; perbaiki seluruh masalah di atas lalu jalankan ulang.',
    );
    return 1;
  }

  const connectionString = env.DATABASE_URL ?? env.SUPABASE_DB_URL;

  if (!connectionString) {
    err('[db:test] DATABASE_URL belum diatur.');
    err(
      '[db:test] Contoh (PowerShell): $env:DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"; npm run db:test',
    );
    err('[db:test] Contoh (Bash)      : DATABASE_URL="postgresql://..." npm run db:test');
    err(
      '[db:test] Simpan connection string di berkas .env.db (diabaikan Git, tidak dibaca Expo), jangan di .env/.env.local.',
    );
    return 1;
  }

  const { config: clientOptions, note: sslNote } = clientConfig(connectionString);

  out(`[db:test] Target : ${describeTarget(connectionString)}`);
  out(`[db:test] Berkas : ${tests.map((test) => test.path).join(', ')}`);
  out('[db:test] Kredensial dibaca dari environment dan tidak ditampilkan di sini.');
  if (sslNote) out(`[db:test] TLS    : ${sslNote}`);

  const client = createClient(clientOptions);

  try {
    const results = await runTestFiles({ tests, client, out, err });

    printSummary(results, out, err);

    const failed = results.filter((result) => result.status !== 'passed');

    if (failed.length > 0) {
      err(
        `[db:test] ${failed.length} berkas uji tidak lulus. Semua kegagalan sudah dicetak di atas; perbaiki satu per satu lalu jalankan ulang.`,
      );
      return 1;
    }

    out(
      `[db:test] LULUS: ${results.length} berkas uji RLS berjalan dan seluruh notice penanda diterima.`,
    );
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * True kalau berkas ini dijalankan langsung sebagai perintah (`node scripts/db-test.mjs`),
 * bukan di-`import` oleh test atau script lain.
 */
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;

  try {
    const script = path.resolve(entry);
    const self = path.resolve(fileURLToPath(import.meta.url));

    // Windows tidak membedakan huruf besar/kecil pada nama berkas.
    return process.platform === 'win32'
      ? script.toLowerCase() === self.toLowerCase()
      : script === self;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exitCode = await main();
}
