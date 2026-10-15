#!/usr/bin/env node
/**
 * Menentukan apakah perubahan sejak rilis terakhir perlu build APK baru.
 *
 * Dipakai `.github/workflows/release-on-push.yml` untuk melewati build EAS saat
 * push hanya menyentuh dokumentasi, test, atau berkas CI — perubahan seperti itu
 * tidak mengubah isi aplikasi, jadi build hanya membuang menit build EAS.
 *
 * Sengaja konservatif: berkas yang tidak dikenali SELALU dihitung "perlu build".
 * Daftar pola di bawah pendek dan aman untuk ditambah, bukan dikurangi.
 *
 * Pemakaian:
 *   node scripts/should-release.mjs                      # sejak tag rilis terakhir
 *   node scripts/should-release.mjs --from v1.0.0 --to HEAD
 *
 * Keluaran: satu kata di stdout — `true` (perlu build) atau `false` (boleh
 * dilewati). Diagnostik ditulis ke stderr memakai anotasi `::notice::`.
 */

import { pathToFileURL } from 'node:url';

import { git, parseRangeArgs, resolvePreviousTag } from './lib/git-release.mjs';

const USAGE = 'Pemakaian: node scripts/should-release.mjs [--from <ref>] [--to <ref>]';

/**
 * Berkas yang tidak mengubah isi aplikasi. Urutan tidak penting; yang pertama
 * cocok dipakai sebagai alasan di log.
 */
const IGNORABLE = [
  { reason: 'dokumentasi', pattern: /^docs\// },
  { reason: 'markdown', pattern: /\.md$/i },
  { reason: 'test', pattern: /(^|\/)__tests__\// },
  { reason: 'test', pattern: /\.test\.tsx?$/ },
  { reason: 'CI', pattern: /^\.github\// },
  { reason: 'konfigurasi test', pattern: /^jest\.config\.js$/ },
];

function ignorableReason(file) {
  const match = IGNORABLE.find((entry) => entry.pattern.test(file));
  return match === undefined ? null : match.reason;
}

/** `true` bila ada minimal satu berkas yang benar-benar memengaruhi aplikasi. */
export function needsBuild(changedFiles) {
  return changedFiles.some((file) => ignorableReason(file) === null);
}

function readChangedFiles(from, to) {
  return git(['diff', '--name-only', `${from}..${to}`])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function describe(files) {
  const shown = files.slice(0, 10).join(', ');
  return files.length > 10 ? `${shown}, …` : shown;
}

function main() {
  const { from: explicitFrom, to } = parseRangeArgs(process.argv.slice(2), USAGE);
  const from = explicitFrom === null ? resolvePreviousTag(to) : explicitFrom;

  if (from === null) {
    console.error('::notice::Belum ada tag rilis sebelumnya — perubahan dihitung perlu build.');
    process.stdout.write('true\n');
    return;
  }

  const files = readChangedFiles(from, to);
  const build = needsBuild(files);
  const ignored = files.filter((file) => ignorableReason(file) !== null);
  const decisive = files.filter((file) => ignorableReason(file) === null);

  console.error(
    `::notice::${from}..${to}: ${files.length} berkas berubah (${ignored.length} tidak memengaruhi aplikasi) — keputusan: ${build ? 'build APK' : 'lewati build APK'}.`,
  );
  if (build) {
    console.error(`::notice::Berkas yang memicu build: ${describe(decisive)}`);
  } else if (files.length > 0) {
    console.error(`::notice::Dilewati karena hanya dokumentasi/test/CI: ${describe(ignored)}`);
  }

  process.stdout.write(`${build ? 'true' : 'false'}\n`);
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung. Ekspor di atas murni
// dan dipakai test; tanpa penjagaan ini `import` akan ikut memanggil git.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
