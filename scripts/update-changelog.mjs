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
 * Judul versi dibuat sebagai tautan ke halaman rilisnya di GitHub
 * (`## [v0.2.0](https://github.com/<owner>/<repo>/releases/tag/v0.2.0) — <tanggal>`), supaya
 * riwayat di berkas ini bisa dinavigasi langsung ke rilisnya. Repository-nya diambil berurutan
 * dari `--repo`, lalu `GITHUB_REPOSITORY` (otomatis ada di GitHub Actions), lalu remote `origin`.
 * Bila ketiganya tidak ada, judul tetap ditulis tanpa tautan dan sebuah `::warning::` dicatat —\ * pencatatan rilisnya sendiri tidak pernah digagalkan oleh tautan yang gagal dibuat.
 *
 * Pemakaian:
 *   node scripts/update-changelog.mjs --tag v0.2.0 --notes catatan.md
 *   node scripts/update-changelog.mjs --tag v0.2.0 --notes catatan.md --preview
 *   node scripts/update-changelog.mjs --tag v0.2.0 --notes catatan.md --date 2026-10-14
 *   node scripts/update-changelog.mjs --tag v0.2.0 --notes catatan.md --repo 29nls/rodakawan
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { fail, parseOptions } from './lib/cli.mjs';

const USAGE =
  'Pemakaian: node scripts/update-changelog.mjs --tag <tag> --notes <berkas> ' +
  '[--date <YYYY-MM-DD>] [--path <berkas>] [--repo <owner/repo>] [--preview]';

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
sedangkan build preview (\`v<versi>-build<N>\`) diringkas di dalam blok yang bisa dibuka. Judul tiap
versi adalah tautan ke halaman rilisnya di GitHub, sehingga riwayat ini bisa dinavigasi langsung
dari berkas.

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
  return content
    .split('\n')
    .some((line) => line.startsWith(`## ${tag} —`) || line.startsWith(`## [${tag}](`));
}

/** Bentuk \`owner/repo\` yang diterima sebagai sumber tautan rilis. */
const REPO_SHAPE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * `owner/repo` dari URL remote GitHub, atau `null` bila bukan GitHub.
 * Menerima bentuk https, scp-like (`git@github.com:…`), dan `ssh://git@…`;
 * akhiran `.git` dilepas sebelum dipisah supaya nama repository tidak ikut
 * mengandung ekstensinya.
 */
export function parseGitHubRepo(remoteUrl) {
  const normalized = remoteUrl.trim().replace(/\.git\/?$/, '');
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+)$/.exec(
      normalized,
    );
  return match ? `${match[1]}/${match[2]}` : null;
}

/** Halaman GitHub Release untuk sebuah tag. */
export function releaseUrl(repo, tag) {
  return `https://github.com/${repo}/releases/tag/${tag}`;
}

/**
 * Sumber `owner/repo` untuk tautan judul: `--repo` bila diisi (nilai salah =
 * gagal, karena itu input manusia yang salah ketik), lalu `GITHUB_REPOSITORY`,
 * lalu remote `origin` milik checkout yang sedang berjalan. Mengembalikan
 * `null` bila ketiganya tidak ada — bukan kegagalan, hanya judul tanpa tautan.
 */
function resolveRepo(optionValue) {
  if (optionValue !== undefined) {
    if (!REPO_SHAPE.test(optionValue)) {
      return fail(`Nilai --repo bukan bentuk owner/repo: ${optionValue}. Contoh: 29nls/rodakawan`, [
        USAGE,
      ]);
    }
    return optionValue;
  }

  const fromEnv = (process.env.GITHUB_REPOSITORY ?? '').trim();
  if (fromEnv !== '' && REPO_SHAPE.test(fromEnv)) return fromEnv;

  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parsed = parseGitHubRepo(remote);
    if (parsed !== null) return parsed;
  } catch {
    // Bukan repository git atau tanpa remote origin — lanjut ke fallback.
  }

  return null;
}

/** Satu bagian catatan rilis, siap disisipkan. */
export function sectionFor({ tag, date, notes, preview = false, repo = undefined }) {
  const label = repo === undefined ? `## ${tag}` : `## [${tag}](${releaseUrl(repo, tag)})`;
  const title = preview ? `${label} — ${date} · pratinjau` : `${label} — ${date}`;
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
      '--repo': 'sebuah repository GitHub berbentuk owner/repo',
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

  const repo = resolveRepo(options['--repo']);
  if (repo === null) {
    console.error(
      `::warning::Repository GitHub tidak dikenali (tanpa --repo, GITHUB_REPOSITORY, maupun ` +
        `remote origin); judul ${tag} ditulis tanpa tautan ke halaman rilisnya.`,
    );
  }

  const updated = insertSection(
    existing,
    sectionFor({ tag, date, notes, preview, repo: repo ?? undefined }),
  );
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
