#!/usr/bin/env node
/**
 * Membuat catatan rilis (changelog) dari commit sejak tag rilis sebelumnya,
 * dikelompokkan menjadi Perubahan yang Merusak / Fitur / Perbaikan / Perubahan lain.
 *
 * Perubahan yang merusak kompatibilitas ditaruh paling atas dengan judul yang
 * mencolok, karena itu satu-satunya bagian yang menuntut tindakan pembaca.
 * Sebuah commit dihitung merusak bila headernya memakai tanda `!` (`feat!:`,
 * `fix(api)!:`) atau ada baris `BREAKING CHANGE:` / `BREAKING-CHANGE:` di
 * pesannya — dua cara yang dikenal Conventional Commits. Commit seperti itu hanya
 * muncul di bagian tersebut (tipe dan lingkupnya tetap disebut), bukan diulang di
 * kelompok Fitur/Perbaikan, supaya pembaca tidak perlu menggabungkan dua daftar
 * untuk tahu apa yang harus disesuaikan.
 *
 * Sisa commit dikelompokkan dari awalan Conventional Commits pada subjek:
 * `feat` → Fitur, `fix` → Perbaikan, selain itu → Perubahan lain. Subjek tanpa
 * awalan (mis. "first commit") masuk Perubahan lain apa adanya.
 *
 * Commit pembukuan — yang mencatat rilis sebelumnya ke `CHANGELOG.md` — dilewati.
 * Commit itu ditandai `[skip ci]` oleh workflow rilis, dan tanpa penyaringan ini
 * setiap rilis bercerita tentang pencatatan rilis di depannya sehingga daftar
 * perubahan yang dibaca pengguna perlahan dipenuhi baris yang tak berarti bagi
 * mereka.
 *
 * Pemakaian:
 *   node scripts/release-notes.mjs                      # tag rilis terakhir..HEAD
 *   node scripts/release-notes.mjs --from v1.0.0        # batas bawah eksplisit
 *   node scripts/release-notes.mjs --from v1.0.0 --to v1.1.0
 *   node scripts/release-notes.mjs --tag-exclude 'v*-build*'
 *
 * `--tag-exclude` melewati tag yang cocok saat mencari batas bawah. Rilis produksi
 * memakainya untuk mengabaikan tag build preview (`v<versi>-build<N>`), karena
 * catatan rilis versi Play Store harus memuat seluruh perubahan sejak rilis
 * produksi sebelumnya, bukan sejak build preview terakhir.
 *
 * Hasil ditulis ke stdout sebagai Markdown, siap dipakai sebagai `body_path`
 * (`release-on-push.yml`) atau `--notes-file` (`android-release.yml`) pada step
 * GitHub Release. Diagnostik memakai `::notice::`/`::error::`.
 */

import { pathToFileURL } from 'node:url';

import { git, parseRangeArgs, resolvePreviousTag } from './lib/git-release.mjs';

const SECTION_ORDER = ['feature', 'fix', 'other'];

const SECTION_TITLES = {
  feature: 'Fitur',
  fix: 'Perbaikan',
  other: 'Perubahan lain',
};

const BREAKING_TITLE = '## ⚠️ Perubahan yang Merusak (Breaking Changes)';

const BREAKING_NOTE = '_Tindakan diperlukan sebelum memperbarui ke rilis ini._';

/** `feat(scope)!: deskripsi` → type, scope, breaking, deskripsi. */
const CONVENTIONAL_COMMIT = /^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

/**
 * Footer penanda perubahan merusak. Dicocokkan di awal baris, di mana pun di
 * dalam pesan — sama longgarnya dengan alat sejenis (standard-version,
 * semantic-release), supaya footer yang tidak berada di paragraf terakhir tidak
 * diam-diam terlewat, dan header yang seluruhnya berbunyi `BREAKING CHANGE: …`
 * (bentuk tak lazim, tetapi jelas disengaja) tetap terhitung. Konsekuensinya: baris
 * yang hanya *menyebut* frasa itu di awal baris ikut terhitung merusak.
 */
const BREAKING_FOOTER = /^[ \t]*BREAKING[ -]CHANGE[ \t]*:/m;

const USAGE =
  'Pemakaian: node scripts/release-notes.mjs [--from <ref>] [--to <ref>] [--tag-exclude <glob>]';

/**
 * Penanda "jangan jalankan CI" pada subjek commit — himpunan yang sama dengan
 * yang dikenali GitHub, karena penanda ini dipakai justru supaya tidak ada
 * workflow yang berjalan. Commit seperti itu adalah pembukuan rilis, bukan
 * perubahan yang dibaca pengguna.
 *
 * Dicocokkan di mana pun di dalam subjek dan tanpa membedakan huruf besar/kecil,
 * sama seperti GitHub memperlakukannya sebagai teks biasa. Konsekuensinya: subjek
 * yang hanya *menyebut* penanda itu ikut dilewati.
 */
const BOOKKEEPING_MARKER = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i;

/**
 * Pemisah antar catatan commit. NUL dipilih karena tidak mungkin ada di dalam
 * pesan commit, sehingga badan commit yang berisi baris baru tidak bisa
 * tertukar dengan commit berikutnya (`--format` biasa memisahkan dengan baris
 * baru).
 */
const RECORD_SEPARATOR = '\0';

/** Pemisah kolom (sha, subjek, badan) di dalam satu catatan. */
const FIELD_SEPARATOR = '\t';

function readCommits({ from, to }) {
  const range = from === null ? to : `${from}..${to}`;
  const output = git(['log', '--no-merges', '-z', '--format=%h%x09%s%x09%b', range]);

  return output
    .split(RECORD_SEPARATOR)
    .map((record) => {
      const [sha = '', subject = '', ...rest] = record.split(FIELD_SEPARATOR);
      return { sha: sha.trim(), subject: subject.trim(), body: rest.join(FIELD_SEPARATOR) };
    })
    .filter(({ sha }) => sha !== '');
}

/** `true` bila subjek commit menandai dirinya sebagai pembukuan rilis. */
export function isBookkeeping(subject) {
  return BOOKKEEPING_MARKER.test(subject);
}

/** `true` bila pesan commit menandai perubahan yang merusak kompatibilitas. */
export function isBreakingChange(subject, body = '') {
  const match = CONVENTIONAL_COMMIT.exec(subject);
  if (match !== null && match[3] === '!') return true;
  return BREAKING_FOOTER.test(`${subject}\n${body}`);
}

/** Mengembalikan kelompok, teks tampil, tipe, dan sifat merusak sebuah commit. */
export function classifyCommit(subject, body = '') {
  const breaking = isBreakingChange(subject, body);
  const match = CONVENTIONAL_COMMIT.exec(subject);
  if (match === null) {
    return { section: 'other', text: subject, breaking, type: null };
  }

  const type = match[1].toLowerCase();
  const scope = match[2];
  const description = match[4].trim();
  const section = type === 'feat' ? 'feature' : type === 'fix' ? 'fix' : 'other';

  return {
    section,
    text: scope === undefined ? description : `${scope}: ${description}`,
    breaking,
    type,
  };
}

export function renderReleaseNotes(commits) {
  if (commits.length === 0) {
    return '_Tidak ada perubahan tercatat sejak rilis sebelumnya._\n';
  }

  const groups = { breaking: [], feature: [], fix: [], other: [] };
  for (const { sha, subject, body = '' } of commits) {
    const { section, text, breaking, type } = classifyCommit(subject, body);
    if (breaking) {
      // Tipe ikut disebut karena bagian ini menggantikan kemunculan commit
      // tersebut di kelompok Fitur/Perbaikan.
      const label = type === null ? text : `${type}: ${text}`;
      groups.breaking.push(`- **${label}** (\`${sha}\`)`);
      continue;
    }
    groups[section].push(`- ${text} (\`${sha}\`)`);
  }

  const lines = [];
  if (groups.breaking.length > 0) {
    lines.push(BREAKING_TITLE, '', BREAKING_NOTE, '', ...groups.breaking, '');
  }
  for (const section of SECTION_ORDER) {
    if (groups[section].length === 0) continue;
    lines.push(`## ${SECTION_TITLES[section]}`, '', ...groups[section], '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function main() {
  const { from: explicitFrom, to, tagExcludes } = parseRangeArgs(process.argv.slice(2), USAGE);
  const from = explicitFrom === null ? resolvePreviousTag(to, tagExcludes) : explicitFrom;
  const semua = readCommits({ from, to });
  const commits = semua.filter(({ subject }) => !isBookkeeping(subject));
  const bookkeeping = semua.length - commits.length;
  const breaking = commits.filter(({ subject, body }) => isBreakingChange(subject, body)).length;

  console.error(
    `::notice::Catatan rilis ${from ?? '(awal riwayat)'}..${to} — ${commits.length} commit tanpa merge` +
      (breaking > 0 ? `, ${breaking} di antaranya merusak kompatibilitas` : '') +
      (bookkeeping > 0 ? `; ${bookkeeping} commit pembukuan ([skip ci]) dilewati` : '') +
      '.',
  );
  process.stdout.write(renderReleaseNotes(commits));
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung. Ekspor di atas murni
// dan dipakai test; tanpa penjagaan ini `import` akan ikut memanggil git.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
