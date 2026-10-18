#!/usr/bin/env node
/**
 * Memastikan editor memakai TypeScript yang **sama persis** dengan yang dipakai
 * `npm run typecheck` (dan karena itu, dengan CI).
 *
 * Kenapa ada script ini: VS Code membawa versi TypeScript bawaannya sendiri untuk
 * IntelliSense, dan versi itu hanya berubah saat VS Code diperbarui — bukan saat
 * `npm install` berjalan. Tanpa pengaturan, editor bisa melaporkan galat untuk kode
 * yang lolos `tsc`, atau (lebih berbahaya) tidak melaporkan galat yang akan
 * menggagalkan CI. `.vscode/settings.json` menutup celah itu dengan menunjuk
 * `node_modules/typescript/lib`; script ini menjaga pengaturan tersebut tidak
 * menyimpang diam-diam: path-nya harus menunjuk instalasi di dalam repository ini,
 * dan versi yang terpasang harus cocok dengan `package.json` **dan** lockfile.
 *
 * Dua kunci pengaturan yang dipakai adalah nama baru VS Code (namespace `js/ts.*`);
 * `typescript.tsdk` dan `typescript.enablePromptUseWorkspaceTsdk` sudah deprecated.
 * `js/ts.tsdk.path` hanya menyatakan bahwa versi workspace *ada* — VS Code tetap
 * perlu dipilih sekali lewat status bar atau prompt yang dinyalakan kunci kedua.
 * Itu batas yang tidak bisa dipaksa dari berkas (pilihan editor disimpan di state
 * workspace, bukan di repo), jadi yang dijaga di sini adalah sisi repo-nya:
 * pengaturan yang benar, path yang benar, dan versi yang tidak berbeda dari CI.
 *
 * Pemeriksaan:
 *   1. `.vscode/settings.json` ada dan memuat `js/ts.tsdk.path` yang benar;
 *   2. prompt pemakaian versi workspace menyala;
 *   3. path menunjuk `<repo>/node_modules/typescript/lib` (bukan path global) dan
 *      berisi `tsserver.js`;
 *   4. versi TypeScript terpasang memenuhi rentang di `devDependencies`;
 *   5. versi terpasang sama dengan versi di `package-lock.json` — yang dipakai
 *      `npm ci` di CI.
 *
 * Pemakaian:
 *   node scripts/check-editor-ts.mjs
 *
 * Dijalankan otomatis lewat `npm run deps:check` (pretest), jadi `npm test` di
 * mesin lokal maupun CI gagal bila pengaturan editor dan dependency menyimpang.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { fail } from './lib/cli.mjs';

/** Kunci pengaturan VS Code: direktori yang memuat `tsserver.js`. */
export const TSDK_KEY = 'js/ts.tsdk.path';

/** Kunci pengaturan VS Code: tampilkan prompt untuk memakai versi workspace. */
export const PROMPT_KEY = 'js/ts.tsdk.promptToUseWorkspaceVersion';

/** Nilai yang diharapkan untuk `TSDK_KEY`, relatif terhadap akar repository. */
export const WORKSPACE_TSDK = 'node_modules/typescript/lib';

/** Panduan singkat yang ikut dicetak pada setiap kegagalan pengaturan. */
const EDITOR_HINT = [
  'Buka berkas .ts, klik nomor versi TypeScript di status bar, lalu pilih "Use Workspace Version".',
  `Pengaturan yang diharapkan ada di .vscode/settings.json: "${TSDK_KEY}": "${WORKSPACE_TSDK}" dan "${PROMPT_KEY}": true.`,
];

/** Membaca JSON; `null` bila berkasnya tidak ada atau tidak terbaca. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Path sebenarnya bila ada (mengikuti symlink), atau path absolut apa adanya. */
function realOrResolved(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/** `{ numbers: [major, minor, patch], pre }` dari `1.2.3` / `1.2.3-beta.1`, atau `null`. */
export function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text ?? '').trim());
  if (match === null) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? null,
  };
}

/** Perbandingan tiga angka versi: negatif bila `a` lebih tua. */
function compareTriples(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * Apakah `version` memenuhi `range` (`~`, `^`, atau versi persis) seperti npm.
 *
 * Rentang yang tidak didukung **melempar**, bukan mengembalikan `false` atau
 * `true`: pemeriksaan yang tidak paham bentuk pin-nya sendiri tidak boleh
 * melaporkan hasil yang terlihat meyakinkan. Versi pre-rilis hanya cocok bila
 * rentangnya menuliskan versi yang sama persis, seperti npm.
 */
export function satisfiesRange(version, range) {
  const installed = parseVersion(version);
  if (installed === null) throw new Error(`Versi TypeScript tidak terbaca: ${version}.`);

  const spec = String(range ?? '').trim();
  if (spec === String(version).trim()) return true;
  if (installed.pre !== null) return false;

  const lower = parseVersion(spec.replace(/^[\^~]/, ''));
  if (lower === null || lower.pre !== null) {
    throw new Error(`Rentang versi TypeScript tidak didukung: ${spec || '(kosong)'}.`);
  }

  const order = compareTriples(installed.numbers, lower.numbers);
  if (order < 0) return false;

  const [major, minor, patch] = installed.numbers;
  const [lowMajor, lowMinor, lowPatch] = lower.numbers;

  if (spec.startsWith('~')) return major === lowMajor && minor === lowMinor;
  if (spec.startsWith('^')) {
    if (lowMajor !== 0) return major === lowMajor;
    if (lowMinor !== 0) return major === 0 && minor === lowMinor;
    return major === 0 && minor === 0 && patch === lowPatch;
  }
  if (!/^\d+\.\d+\.\d+$/.test(spec)) {
    throw new Error(`Rentang versi TypeScript tidak didukung: ${spec}.`);
  }
  return order === 0;
}

/** Nilai `js/ts.tsdk.path` dari isi settings.json, atau `null` bila tidak diisi. */
export function tsdkFrom(settings) {
  const value = settings?.[TSDK_KEY];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Apakah prompt pemakaian versi workspace dinyalakan. */
export function promptEnabled(settings) {
  return settings?.[PROMPT_KEY] === true;
}

function main() {
  const rootDir = process.cwd();
  const settingsFile = path.relative(rootDir, path.join(rootDir, '.vscode', 'settings.json'));

  if (!fs.existsSync(path.join(rootDir, '.vscode', 'settings.json'))) {
    return fail(
      `Pengaturan editor (${settingsFile}) tidak ada, jadi VS Code akan memakai TypeScript bawaannya — bukan versi repo.`,
      EDITOR_HINT,
    );
  }

  const settings = readJson(path.join(rootDir, '.vscode', 'settings.json'));
  if (settings === null) {
    return fail(`${settingsFile} bukan JSON yang sah.`, EDITOR_HINT);
  }

  const tsdk = tsdkFrom(settings);
  if (tsdk === null) {
    return fail(`${settingsFile} tidak menyetel "${TSDK_KEY}".`, EDITOR_HINT);
  }
  if (!promptEnabled(settings)) {
    return fail(
      `${settingsFile} tidak menyetel "${PROMPT_KEY}": true, jadi VS Code tidak pernah menawarkan versi workspace.`,
      EDITOR_HINT,
    );
  }

  const expectedDir = path.join(rootDir, WORKSPACE_TSDK);
  const tsdkDir = path.resolve(rootDir, tsdk);
  if (realOrResolved(tsdkDir) !== realOrResolved(expectedDir)) {
    return fail(`Editor diarahkan ke ${tsdk}, bukan ${WORKSPACE_TSDK} di repository ini.`, [
      'Path global atau path mesin lain membuat editor memakai TypeScript yang tidak dipakai CI.',
      ...EDITOR_HINT,
    ]);
  }

  if (!fs.existsSync(path.join(tsdkDir, 'tsserver.js'))) {
    return fail(`TypeScript belum terpasang di ${WORKSPACE_TSDK} (tsserver.js tidak ada).`, [
      'Jalankan `npm ci` (atau `npm install`) lebih dulu, lalu ulangi pemeriksaan ini.',
    ]);
  }

  const installed = readJson(path.join(tsdkDir, '..', 'package.json'))?.version;
  if (typeof installed !== 'string' || installed === '') {
    return fail(
      `Versi TypeScript terpasang tidak terbaca dari ${WORKSPACE_TSDK}/../package.json.`,
      ['Jalankan `npm ci` untuk memasang ulang dependency.'],
    );
  }

  const pin = readJson(path.join(rootDir, 'package.json'))?.devDependencies?.typescript;
  if (typeof pin !== 'string' || pin === '') {
    return fail('package.json tidak memuat devDependencies.typescript.', [
      'Tanpa pin, versi editor dan tsc bisa berbeda tanpa ada yang menyadarinya.',
    ]);
  }

  let cocok;
  try {
    cocok = satisfiesRange(installed, pin);
  } catch (error) {
    return fail(error.message, [
      'Perbarui pemeriksaan ini untuk bentuk rentang yang baru, atau pakai rentang `~`, `^`, atau versi persis.',
    ]);
  }
  if (!cocok) {
    return fail(
      `TypeScript terpasang (${installed}) tidak memenuhi pin devDependencies (${pin}).`,
      ['Jalankan `npm ci` supaya node_modules sama dengan lockfile yang dipakai CI.'],
    );
  }

  const locked = readJson(path.join(rootDir, 'package-lock.json'))?.packages?.[
    'node_modules/typescript'
  ]?.version;
  if (typeof locked !== 'string' || locked === '') {
    return fail('package-lock.json tidak memuat versi node_modules/typescript.', [
      'CI memasang lewat `npm ci`, yang hanya percaya lockfile; tanpa entri itu versinya tidak pasti.',
    ]);
  }
  if (locked !== installed) {
    return fail(`TypeScript terpasang (${installed}) berbeda dari lockfile (${locked}).`, [
      'Editor akan memakai versi yang tidak dipakai CI. Jalankan `npm ci` untuk menyamakannya.',
    ]);
  }

  process.stdout.write(
    `Editor memakai TypeScript ${installed} dari ${WORKSPACE_TSDK}; sama dengan pin devDependencies (${pin}) dan lockfile yang dipakai CI.\n`,
  );
  process.stdout.write(
    `Kalau status bar editor masih menampilkan versi lain, pilih "Use Workspace Version" sekali; pilihannya disimpan editor, bukan di repo.\n`,
  );
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung; fungsi murni di atas
// dipakai test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
