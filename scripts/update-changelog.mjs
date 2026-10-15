#!/usr/bin/env node
/**
 * Menyisipkan catatan rilis ke `CHANGELOG.md` supaya setiap rilis meninggalkan
 * jejak permanen di repository, bukan hanya di halaman Releases GitHub.
 *
 * Bagian baru ditaruh **paling atas**, tepat di bawah judul berkas, sehingga
 * urutannya selalu terbaru → terlama. Rilis produksi ditulis sebagai bagian
 * penuh; rilis preview (`v<versi>-build<N>`) diringkas di dalam blok `<details>`
 * yang bisa dibuka, karena build preview dibuat pada setiap push ke `main` dan
 * akan menenggelamkan versi produksi bila ditulis sama panjang.
 *
 * Idempoten dengan sengaja: bila tag-nya sudah ada di berkas, script tidak
 * mengubah apa pun (dan tetap keluar dengan status 0). Job yang memakainya
 * mencoba ulang setelah `git reset --hard origin/main`, jadi pencatatan ulang
 * yang aman adalah syarat, bukan kemewahan.
 *
 * Judul di dalam catatan diturunkan satu tingkat (`## Fitur` → `### Fitur`)
 * supaya judul versi menjadi satu-satunya tingkat dua di berkas ini.
 *
 * Pemakaian:
 *   node scripts/update-changelog.mjs --tag v0.2.0 --notes catatan.md
 *   node scripts/update-changelog.mjs --tag v0.2.0 --notes catatan.md --preview
 *   node scripts/update-changelog.mjs --tag v0.2.0 --notes catatan.md --date 2026-10-14
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { fail, parseOptions } from './lib/cli.mjs';

const USAGE =
  'Pemakaian: node scripts/update-changelog.mjs --tag <tag> --notes <berkas> ' +
  '[--date <YYYY-MM-DD>] [--path <berkas>] [--preview]';

const DEFAULT_PATH = 'CHANGELOG.md';

const PREVIEW_SUMMARY = 'Catatan rilis pratinjau';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Judul berkas untuk CHANGELOG.md yang belum ada. Menyebut aturan mainnya
 * (dibuat otomatis, terbaru di atas, jangan menyunting entri lama) supaya
 * penyuntingan manual tidak membuat berkas berikutnya berantakan.
 */
export const HEADER = `# Changelog

Seluruh rilis APK RodaKawan, terbaru di atas. Bagian di bawah dibuat otomatis oleh
\`.github/workflows/release-on-push.yml\` dan \`.github/workflows/android-release.yml\` dari catatan
rilis yang sama dengan halaman Releases (\`scripts/release-notes.mjs\`); jangan menyunting entri yang
sudah ada — entri berikutnya disisipkan di atasnya. Rilis produksi tampil sebagai bagian penuh,
sedangkan build preview (\`v<versi>-build<N>\`) diringkas di dalam blok yang bisa dibuka.

`;

/** Tanggal UTC hari ini, bentuk `YYYY-MM-DD`. */
export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Menurunkan setiap judul satu tingkat: `## Fitur` → `### Fitur`. */
export function demoteHeadings(markdown) {
  return markdown.replace(/^(#+) /gm, '#$1 ');
}

/** `true` bila tag itu sudah punya bagian di berkas ini. */
export function hasSection(content, tag) {
  return content.split('\n').some((line) => line.startsWith(`## ${tag} —`));
}

/** Satu bagian catatan rilis, siap disisipkan. */
export function sectionFor({ tag, date, notes, preview = false }) {
  const title = preview ? `## ${tag} — ${date} · pratinjau` : `## ${tag} — ${date}`;
  const body = demoteHeadings(notes.trim());

  if (!preview) return `${title}\n\n${body}`;

  return [
    title,
    '',
    '<details>',
    `<summary>${PREVIEW_SUMMARY}</summary>`,
    '',
    body,
    '',
    '</details>',
  ].join('\n');
}

/**
 * Menyisipkan `section` tepat sebelum bagian terlama, yaitu di bawah judul
 * berkas. Bagian yang sudah ada tidak pernah diubah isinya.
 */
export function insertSection(content, section) {
  const lines = content.replace(/\s+$/, '').split('\n');
  const firstSection = lines.findIndex((line) => line.startsWith('## '));
  const header = (firstSection === -1 ? lines : lines.slice(0, firstSection)).join('\n').trim();
  const existing = (firstSection === -1 ? [] : lines.slice(firstSection)).join('\n').trim();

  return `${[header, section.trim(), existing].filter((part) => part !== '').join('\n\n')}\n`;
}

/** Membaca catatan rilis; berkas kosong ditolak karena akan jadi bagian kosong. */
function readNotes(file) {
  let notes;
  try {
    notes = fs.readFileSync(file, 'utf8');
  } catch {
    return fail(`Berkas catatan rilis tidak bisa dibaca: ${file}`);
  }

  if (notes.trim() === '') {
    return fail(`Berkas catatan rilis kosong: ${file}. Tidak ada yang dicatat ke CHANGELOG.md.`);
  }

  return notes;
}

function main() {
  const options = parseOptions(process.argv.slice(2), {
    usage: USAGE,
    values: {
      '--tag': 'sebuah tag rilis',
      '--notes': 'sebuah berkas catatan rilis',
      '--date': 'sebuah tanggal YYYY-MM-DD',
      '--path': 'sebuah berkas CHANGELOG',
    },
    flags: ['--preview'],
    required: ['--tag', '--notes'],
  });

  const tag = options['--tag'];
  const notesFile = options['--notes'];
  const target = options['--path'] ?? DEFAULT_PATH;
  const preview = options['--preview'] === true;
  const date = options['--date'] ?? todayUtc();

  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) {
    return fail(`Tanggal tidak dikenali: ${date}. Bentuk yang benar: 2026-10-14 (UTC).`, [USAGE]);
  }

  const notes = readNotes(notesFile);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : HEADER;

  if (hasSection(existing, tag)) {
    console.error(`::notice::${target} sudah memuat bagian ${tag}; tidak ada yang diubah.`);
    return;
  }

  const updated = insertSection(existing, sectionFor({ tag, date, notes, preview }));
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, updated);

  const kind = preview ? 'preview (diringkas)' : 'produksi';
  console.error(
    `::notice::Bagian ${tag} (${kind}, ${date}) disisipkan di atas ${target} — ` +
      `berkas kini ${updated.split('\n').length} baris.`,
  );
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung. Fungsi di atas murni
// dan dipakai test; tanpa penjagaan ini `import` akan ikut menulis berkas.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
