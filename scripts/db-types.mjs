#!/usr/bin/env node
/**
 * Menghasilkan `src/lib/supabase/database.generated.ts` dari skema database Supabase.
 *
 * Kenapa berkas ini ada:
 * - Tipe database sebelumnya ditulis tangan, sehingga RPC/tabel baru bisa lolos tanpa
 *   tipe atau menyimpang dari skema tanpa ketahuan. Sekarang satu sumber kebenaran:
 *   hasil `supabase gen types`, dan berkas itu dibandingkan di CI.
 * - `npm run db:types` menulis ulang berkas. `npm run db:types:check` menghasilkan
 *   versi baru di memori dan gagal bila berbeda dengan yang di-commit, sehingga
 *   perubahan skema yang tidak diikuti regenerasi tipe langsung terlihat.
 *
 * Aturan keamanan yang dipegang (sama seperti `scripts/db-test.mjs`):
 * - Kredensial dibaca dari environment (`DATABASE_URL`, atau `SUPABASE_DB_URL`) dan
 *   tidak pernah dicetak; `npm run db:types` memuat `.env.db` secara otomatis. Jangan
 *   memakai `.env`/`.env.local` karena keduanya dibaca Expo.
 * - Satu pengecualian yang disengaja: `supabase gen types` hanya bisa diarahkan ke
 *   project lewat `--db-url`, jadi connection string ikut sebagai argumen proses anak
 *   (lihat catatan di `generateTypes`). Nilai itu tidak pernah dicetak, dan CI memakai
 *   runner sekali pakai.
 * - Nilai connection string tidak pernah dicetak; yang ditampilkan hanya
 *   `user@host:port/database` tanpa password. Keluaran error CLI juga disunting
 *   supaya URL yang mungkin muncul di pesan koneksi tidak ikut tercetak.
 * - CLI dipin ke versi tertentu agar keluaran tidak berubah karena rilis baru.
 *
 * Pemakaian:
 *   npm run db:types          tulis ulang berkas hasil generate
 *   npm run db:types:check    periksa drift (dipakai CI), tidak menulis berkas
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT_FILE = path.join(ROOT, 'src/lib/supabase/database.generated.ts');
const RELATIVE_OUTPUT = path.relative(ROOT, OUTPUT_FILE).split(path.sep).join('/');

/** Dipin supaya bentuk keluaran tidak berubah diam-diam saat CLI rilis baru. */
const SUPABASE_CLI_VERSION = '2.121.0';
const SCHEMA = 'public';

const HEADER = `// BERKAS INI DIHASILKAN OTOMATIS — JANGAN DIUBAH TANGAN.
//
// Sumber: skema \`public\` database Supabase (project development).
// Hasilkan ulang dengan \`npm run db:types\`; CI memeriksa drift lewat
// \`npm run db:types:check\`.
//
// Tipe yang dipakai aplikasi — union peran/status klub, bentuk baris RPC, dan
// tabel audit yang hanya boleh ditulis database — ada di ./database.types.ts,
// yang menurunkan serta mempersempit tipe dari berkas ini.
`;

const HELP = `Tipe database Supabase.

Pemakaian:
  npm run db:types          Generate ulang ${RELATIVE_OUTPUT}
  npm run db:types:check    Periksa apakah berkas itu masih sama dengan skema
  node scripts/db-types.mjs --help

Opsi:
  --check        Bandingkan tanpa menulis berkas (exit 1 bila berbeda).
  --out <berkas> Tulis/bandingkan ke berkas lain (dipakai pengujian).

Environment:
  DATABASE_URL (wajib)   Connection string PostgreSQL project development
                         (host session pooler, sslmode=require).
  SUPABASE_DB_URL        Dipakai bila DATABASE_URL tidak ada.

Berkas .env.db:
  Simpan connection string di .env.db (root repo, diabaikan Git dan tidak dibaca
  Expo) supaya tidak perlu diketik di baris perintah:
    DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require

Catatan:
  - Generate hanya membaca katalog skema; tidak ada data yang diubah.
  - Bila pemeriksaan gagal, jalankan \`npm run db:types\`, lalu tinjau diff-nya
    (tipe yang berubah berarti kontrak aplikasi ikut berubah).
`;

function connectionString() {
  return process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
}

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
function describeTarget(url) {
  try {
    const parsed = new URL(url);
    const user = parsed.username ? decodeURIComponent(parsed.username) : '(tanpa user)';
    const host = parsed.hostname || '(tanpa host)';
    const port = parsed.port || '5432';
    const database = parsed.pathname.replace(/^\//, '') || '(tanpa nama database)';

    return `${user}@${host}:${port}/${database}`;
  } catch {
    return '(connection string tidak dapat dibaca)';
  }
}

/** Menyunting URL koneksi (beserta password) dari teks apa pun sebelum dicetak. */
function redact(text) {
  let output = String(text ?? '');
  const url = connectionString();

  if (url) output = output.split(url).join('<DATABASE_URL>');

  return output.replace(/(?:postgres(?:ql)?|https?):\/\/[^\s"'`]+/gi, '<URL disunting>');
}

function normalize(text) {
  return `${text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/, '')}\n`;
}

/**
 * Mengutip satu argumen untuk `cmd.exe` (hanya argumen, bukan nama perintahnya).
 *
 * Jalur Windows menjalankan perintah lewat shell (`.cmd` tidak bisa dieksekusi
 * langsung oleh `execFile`), sehingga argumen mengandung spasi atau metakarakter
 * harus dibungkus tanda kutip agar tidak dipecah/ditafsirkan ulang — nilai
 * connection string memuat `?` dan `=`. Kutip di dalamnya digandakan.
 */
function quoteForCmd(argument) {
  return `"${argument.replaceAll('"', '""')}"`;
}

/**
 * Menjalankan CLI Supabase dan mengembalikan tipe hasil generate.
 *
 * Kenapa target dioper lewat `--db-url` (dan bukan mengandalkan `--linked`):
 * - `--linked` memakai access token Supabase yang tersimpan di **mesin** (keyring
 *   atau profile CLI). Di komputer pengembang token itu kebetulan ada, sehingga
 *   perintahnya tampak berhasil — sampai dijalankan di CI, yang tidak punya token
 *   sama sekali: CLI berhenti dengan "Must specify one of --local, --linked,
 *   --project-id, or --db-url" (insiden 18 Oktober 2026). Artinya keberhasilan
 *   pemeriksaan drift tergantung rahasia mesin yang tidak terdokumentasi.
 * - `--project-id` membutuhkan secret baru `SUPABASE_ACCESS_TOKEN` (PAT platform,
 *   cakupannya jauh lebih luas dari kredensial database yang sudah ada).
 * - `--db-url` memakai `DATABASE_URL` yang sama dengan uji RLS, jadi kedua
 *   pemeriksaan memastikan hal yang sama terhadap target yang sama. Workflow sudah
 *   memverifikasi connection string itu menunjuk project **development** sebelum
 *   langkah ini berjalan.
 * Harganya: nilai ikut sebagai argumen proses anak, jadi bisa dibaca lewat `ps`
 * oleh proses lain milik user yang sama. Nilai tidak pernah dicetak (lihat
 * `redact()`), CI memakai runner sekali pakai milik satu pekerjaan, dan nilai yang
 * sama sudah tersimpan sebagai `.env.db` di mesin pengembang.
 *
 * `shell` hanya dipakai di Windows karena `.cmd` tidak bisa dijalankan langsung
 * oleh `execFile`; seluruh argumen bersifat tetap dan diutip, tanpa masukan
 * pengguna.
 */
async function generateTypes(url) {
  const args = [
    '--yes',
    `supabase@${SUPABASE_CLI_VERSION}`,
    'gen',
    'types',
    'typescript',
    '--schema',
    SCHEMA,
    '--db-url',
    url,
  ];

  const options = {
    cwd: ROOT,
    env: {
      ...process.env,
      DO_NOT_TRACK: '1',
      // `npx` mencetak ulang baris perintahnya sebagai "npm notice", lengkap dengan
      // `--db-url`. Isinya tetap tidak pernah sampai ke log skrip ini (lihat `redact()`
      // dan uji "tidak mencetaknya ke log"), tetapi loglevel error menutup sumbernya
      // sejak di dalam proses anak — jadi connection string tidak pernah ikut tertangkap.
      npm_config_loglevel: 'error',
    },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  };

  try {
    // Di Windows `.cmd` tidak bisa dijalankan langsung tanpa shell. Argumennya
    // tetap statis (tanpa masukan pengguna) dan diutip, jadi penggabungan ini aman.
    const { stdout } =
      process.platform === 'win32'
        ? // `npx`-nya sengaja tidak diutip: `cmd.exe` tidak mencari PATH/PATHEXT untuk
          // token pertama yang berada di dalam tanda kutip.
          await execFileAsync(['npx', ...args.map(quoteForCmd)].join(' '), {
            ...options,
            shell: true,
          })
        : await execFileAsync('npx', args, options);

    if (!stdout.includes('export type Database')) {
      throw new Error('Keluaran CLI tidak memuat `export type Database`.');
    }

    return normalize(HEADER + stdout.replace(/^\uFEFF/, ''));
  } catch (error) {
    const detail = redact(error?.stderr || error?.message || error);
    console.error(`[db:types] GAGAL menghasilkan tipe: ${detail.trim()}`);
    console.error(
      '[db:types] Periksa koneksi ke database development, dan pastikan migrasi lokal sudah diterapkan (docs/SETUP_GUIDE.md bagian 4.3).',
    );
    process.exitCode = 1;
    return undefined;
  }
}

/** Ringkasan perbedaan pertama; cukup untuk menunjukkan penyebab drift. */
function describeDifference(expected, actual) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const total = Math.max(expectedLines.length, actualLines.length);

  let index = 0;
  while (index < total && expectedLines[index] === actualLines[index]) index += 1;

  const start = Math.max(0, index - 2);
  const end = Math.min(total, index + 3);
  const lines = [];

  for (let line = start; line < end; line += 1) {
    const expectedLine = expectedLines[line];
    const actualLine = actualLines[line];

    if (expectedLine === actualLine) {
      lines.push(`  ${String(line + 1).padStart(4)}   ${expectedLine ?? ''}`);
      continue;
    }

    if (expectedLine !== undefined) {
      lines.push(`- ${String(line + 1).padStart(4)}   ${expectedLine}`);
    }
    if (actualLine !== undefined) {
      lines.push(`+ ${String(line + 1).padStart(4)}   ${actualLine}`);
    }
  }

  return `Perbedaan pertama di baris ${index + 1}:\n${lines.join('\n')}`;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }

  const check = argv.includes('--check');
  const outputPath = path.resolve(ROOT, readOption(argv, '--out') ?? OUTPUT_FILE);
  const relativeOutput = path.relative(ROOT, outputPath).split(path.sep).join('/');
  const url = connectionString();

  if (!url) {
    console.error('[db:types] DATABASE_URL belum diatur.');
    console.error(
      '[db:types] Simpan connection string project development di .env.db, atau isi DATABASE_URL untuk satu perintah.',
    );
    return 1;
  }

  console.log(`[db:types] Target : ${describeTarget(url)} (kredensial tidak ditampilkan)`);
  console.log(`[db:types] Skema  : ${SCHEMA} · CLI supabase@${SUPABASE_CLI_VERSION}`);

  const generated = await generateTypes(url);
  if (!generated) return 1;

  if (!check) {
    await writeFile(outputPath, generated, 'utf8');
    console.log(
      `[db:types] Ditulis: ${relativeOutput} (${generated.split('\n').length - 1} baris)`,
    );
    return 0;
  }

  let committed;
  try {
    committed = await readFile(outputPath, 'utf8');
  } catch {
    console.error(`[db:types] Berkas ${relativeOutput} tidak ditemukan.`);
    console.error('[db:types] Jalankan `npm run db:types` lalu commit hasilnya.');
    return 1;
  }

  if (normalize(committed) === generated) {
    console.log(`[db:types] LULUS: ${relativeOutput} sama dengan skema database.`);
    return 0;
  }

  console.error(`[db:types] DRIFT: ${relativeOutput} tidak sama dengan skema database.`);
  console.error(describeDifference(normalize(committed), generated));
  console.error('[db:types] Jalankan `npm run db:types`, tinjau diff-nya, lalu commit.');
  return 1;
}

const exitCode = await main();
process.exitCode = exitCode;
