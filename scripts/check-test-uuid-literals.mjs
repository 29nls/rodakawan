#!/usr/bin/env node
/**
 * Memeriksa berkas uji SQL untuk literal teks yang diberikan ke parameter
 * bertipe `uuid`.
 *
 * Pemeriksaan ini statis dan murni: ia hanya membaca berkas di repository, jadi
 * bisa dijalankan di pull request **tanpa** secret database dan tanpa membuka
 * koneksi apa pun. Runner `npm run db:test` menjalankan pemeriksaan yang sama
 * sebagai pra-syarat, sehingga galat jenis ini ketahuan sebelum satu
 * transaksi pun dibuka.
 *
 * Yang dicari: pemanggilan fungsi yang parameter bertipe `uuid` diberi literal
 * teks yang bukan UUID. PostgreSQL akan menolaknya dengan SQLSTATE `22P02`
 * ("invalid input syntax for type uuid") tepat saat pemanggilan, sebelum badan
 * fungsi dijalankan — jadi satu literal salah menghentikan seluruh berkas uji.
 *
 * Contoh yang pernah terjadi: `public.create_hazard(…, 'a-client-001')` pada
 * fungsi yang parameter ketujuhnya `uuid`. Aplikasi sendiri sudah benar
 * (`Crypto.randomUUID()`), jadi yang diperbaiki adalah nilainya di berkas uji.
 *
 * Pemakaian:
 *   node scripts/check-test-uuid-literals.mjs            periksa seluruh berkas uji
 *   node scripts/check-test-uuid-literals.mjs --file <berkas.sql>
 *
 * Keluarannya memakai anotasi `::error file=…,line=…::` milik GitHub Actions
 * supaya pelanggaran ditandai langsung di diff pull request.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { checkTestFiles } from './lib/sql-uuid-literals.mjs';
import { parseOptions } from './lib/cli.mjs';

/** Akar repository bawaan: induk folder `scripts/`. */
const DEFAULT_ROOT = path.resolve(import.meta.dirname, '..');

/** Sufiks berkas yang dianggap berkas uji. */
const TEST_FILE_PATTERN = /\.sql$/i;

const USAGE = `Pemeriksaan literal UUID pada berkas uji SQL (statis, tanpa database).

Pemakaian:
  node scripts/check-test-uuid-literals.mjs              periksa seluruh supabase/tests/*.sql
  node scripts/check-test-uuid-literals.mjs --file <berkas.sql>   periksa satu berkas
  node scripts/check-test-uuid-literals.mjs --root <folder>       periksa repository lain

Berkas yang diperiksa:
  - supabase/migrations/*.sql   sumber tanda tangan fungsi (siapa parameter bertipe uuid)
  - supabase/tests/*.sql        berkas uji yang diperiksa

Keluarannya 0 bila tidak ada pelanggaran, 1 bila ada.
`;

const OPTIONS = {
  usage: USAGE,
  values: {
    '--file': 'berkas .sql yang diperiksa',
    '--root': 'akar repository yang diperiksa (bawaan: akar repository ini)',
  },
  flags: ['--help', '-h'],
};

/** Membaca seluruh berkas SQL di satu folder, urut menurut nama berkas. */
async function readSqlFiles(dir, root) {
  let entries;

  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const files = [];

  for (const entry of entries.sort()) {
    if (!TEST_FILE_PATTERN.test(entry)) continue;

    const fullPath = path.join(dir, entry);
    const sql = await readFile(fullPath, 'utf8');
    files.push({ path: relativeTo(root, fullPath), sql });
  }

  return files;
}

/** Path relatif terhadap akar repository, dengan pemisah `/`. */
function relativeTo(root, fullPath) {
  return path.relative(root, fullPath).split(path.sep).join('/');
}

/** Membaca satu berkas SQL dan mengembalikan `{ path, sql }`. */
async function readSqlFile(file, root) {
  const fullPath = path.resolve(file);
  const sql = await readFile(fullPath, 'utf8');
  return { path: relativeTo(root, fullPath), sql };
}

/** Pesan pelanggaran dalam satu baris, plus petunjuk perbaikannya. */
function describe(finding) {
  return (
    `${finding.file}:${finding.line}:${finding.column} — parameter uuid ` +
    `${finding.paramName} pada ${finding.functionName} menerima literal ` +
    `'${finding.literal}' yang bukan UUID. PostgreSQL akan menolaknya dengan ` +
    `SQLSTATE 22P02 (invalid input syntax for type uuid) saat pemanggilan, ` +
    `sebelum badan fungsi dijalankan.`
  );
}

/** Petunjuk perbaikan: bentuk UUID yang sah dan asal nilainya. */
const HINT = [
  'Gunakan literal UUID kanonis (8-4-4-4-12 heksadesimal), mis. ' +
    "'a1111111-2222-4333-8444-555555555555'.",
  'Nilai idempotensi di aplikasi dibuat dengan Crypto.randomUUID(); di berkas uji ' +
    'pakai UUID tetap (bukan acak) supaya uji idempotensi bisa mengulang nilai yang sama.',
];

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }

  const options = parseOptions(argv, OPTIONS);
  const singleFile = options['--file'];
  const root = options['--root'] ? path.resolve(options['--root']) : DEFAULT_ROOT;

  const migrationsDir = path.join(root, 'supabase', 'migrations');
  const testsDir = path.join(root, 'supabase', 'tests');

  const migrations = await readSqlFiles(migrationsDir, root);

  if (migrations.length === 0) {
    console.error(
      `Tidak ada migration di ${relativeTo(root, migrationsDir)} — tanda tangan fungsi tidak bisa diketahui, jadi pemeriksaan dilewati.`,
    );
    return 1;
  }

  const tests = singleFile
    ? [await readSqlFile(singleFile, root)]
    : await readSqlFiles(testsDir, root);

  if (tests.length === 0) {
    console.error('Tidak ada berkas uji SQL yang diperiksa.');
    return 1;
  }

  const findings = checkTestFiles(migrations, tests);

  process.stdout.write(
    `[db:test:lint] ${tests.length} berkas uji diperiksa terhadap ${migrations.length} migration.\n`,
  );

  if (findings.length === 0) {
    process.stdout.write(
      '[db:test:lint] LULUS: tidak ada literal non-UUID yang diberikan ke parameter bertipe uuid.\n',
    );
    return 0;
  }

  for (const finding of findings) {
    console.error(
      `::error file=${finding.file},line=${finding.line},col=${finding.column}::${describe(finding)}`,
    );
    for (const line of HINT) console.error(line);
  }

  console.error(
    `[db:test:lint] GAGAL: ${findings.length} pelanggaran pada ${new Set(findings.map((finding) => finding.file)).size} berkas uji.`,
  );
  return 1;
}

const exitCode = await main();
process.exitCode = exitCode;
