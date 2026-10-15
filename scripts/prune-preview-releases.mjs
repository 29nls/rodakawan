#!/usr/bin/env node
/**
 * Memangkas rilis preview lama beserta tag-nya, supaya halaman Releases tidak
 * penuh oleh satu rilis untuk setiap push ke `main`.
 *
 * Rilis preview dibuat `.github/workflows/release-on-push.yml` dengan tag
 * `v<versi>-build<N>` (`N` = `github.run_number`) dan ditandai *prerelease*. Itu
 * memang yang diinginkan — setiap push ke `main` layak dicoba — tetapi halaman
 * Releases menampilkan semuanya, dan setelah beberapa puluh build versi produksi
 * yang benar-benar dipasang pengguna tenggelam di bawahnya.
 *
 * Riwayatnya **tidak hilang** karena pemangkasan ini: setiap rilis preview sudah
 * dicatat `CHANGELOG.md` (diringkas di dalam blok terlipat) oleh job `changelog`
 * pada run yang membuatnya, dan yang dipangkas di sini selalu sepuluh build di
 * belakang rilis terbaru — entrinya sudah ditulis jauh sebelumnya, bukan ditulis
 * oleh script ini. Satu pengecualian yang tidak disembunyikan: entri itu ada hanya
 * bila job `changelog` run tersebut berhasil, sehingga build yang pencatatannya
 * gagal kehilangan satu-satunya jejaknya saat dipangkas. Rilis produksi tidak
 * pernah disentuh script ini, dan yang hilang hanyalah berkas APK-nya — artefak
 * yang memang tidak dijanjikan bertahan lama.
 *
 * Yang **tidak pernah** disentuh, betapa pun lamanya:
 *
 *   - rilis produksi (bukan prerelease), termasuk tag `v<versi>`;
 *   - tag yang tidak berbentuk `v<versi>-build<N>` — mis. rilis kandidat
 *     `v1.0.0-rc1` yang dibuat manusia;
 *   - tag berbentuk itu tetapi rilisnya *bukan* prerelease.
 *
 * Tiga pengecualian terakhir membuat script ini gagal-tertutup: pola yang tidak
 * dikenali dipertahankan, bukan dihapus.
 *
 * Jumlah yang disimpan (`--keep`, default 10) tidak boleh nol. Rilis preview
 * berikutnya memakai tag rilis **terakhir** sebagai batas bawah catatan rilisnya
 * (`scripts/release-notes.mjs` tanpa `--tag-exclude`), jadi memangkas sampai habis
 * akan membuat catatan rilis berikutnya memuat seluruh perubahan sejak rilis
 * produksi terakhir — daftar yang sudah pernah dibaca semua orang.
 *
 * Pemakaian:
 *   node scripts/prune-preview-releases.mjs                # simpan 10 terbaru
 *   node scripts/prune-preview-releases.mjs --keep 20
 *   node scripts/prune-preview-releases.mjs --dry-run      # tampilkan saja
 *   node scripts/prune-preview-releases.mjs --limit 300    # jendela daftar lebih lebar
 *
 * Keluar dengan kode 0 bila seluruh pemangkasan berhasil (termasuk saat tidak ada
 * yang perlu dipangkas); selain itu kode 1 dengan pesan `::error::`. Script ini
 * idempoten: menjalankannya dua kali tidak menghapus apa pun pada kali kedua.
 */

import { pathToFileURL } from 'node:url';

import { fail, parseOptions } from './lib/cli.mjs';
import { runGh } from './lib/gh.mjs';

const USAGE =
  'Pemakaian: node scripts/prune-preview-releases.mjs [--keep <jumlah>] [--limit <jumlah>] ' +
  '[--dry-run]';

/** Rilis preview yang disimpan bila `--keep` tidak disebut. */
const DEFAULT_KEEP = 10;

/**
 * Jendela daftar rilis yang dibaca dari GitHub. Cukup lebar untuk repository ini
 * (satu rilis per push ke `main`), dan bila pernah terlampaui script memperingatkan
 * supaya angkanya dinaikkan — lebih baik daripada menghapus berdasarkan daftar
 * yang belum tentu lengkap.
 */
const DEFAULT_LIMIT = 200;

/**
 * Bentuk tag rilis preview: `v<versi>-build<N>`, persis yang dibuat
 * `.github/workflows/release-on-push.yml`. Apa pun yang tidak cocok dianggap milik
 * manusia dan tidak disentuh.
 */
export const PREVIEW_TAG = /^v\d+\.\d+\.\d+-build\d+$/;

/** `true` bila rilis ini boleh dipangkas: prerelease **dan** bertag preview. */
export function isPreviewRelease(release) {
  return (
    release !== null &&
    typeof release === 'object' &&
    release.isPrerelease === true &&
    typeof release.tagName === 'string' &&
    PREVIEW_TAG.test(release.tagName)
  );
}

/**
 * Membagi daftar rilis menjadi yang disimpan (`kept`), yang dipangkas (`pruned`),
 * dan yang tidak pernah disentuh (`protected`).
 *
 * Urutan masukan tidak dipercaya: rilis diurutkan sendiri dari yang terbaru, karena
 * "simpan N terbaru" hanya punya arti bila urutannya benar — dan salah urutan di
 * sini berarti menghapus build yang seharusnya disimpan.
 */
export function selectReleasesToPrune(releases, { keep }) {
  const urutan = [...releases].sort((a, b) => {
    const waktu = String(b?.createdAt ?? '').localeCompare(String(a?.createdAt ?? ''));
    if (waktu !== 0) return waktu;
    // Waktu yang sama (atau kosong) dipecah dari nomor build-nya, supaya hasilnya
    // tetap pasti dan `build12` tidak dianggap lebih tua daripada `build9`.
    return String(b?.tagName ?? '').localeCompare(String(a?.tagName ?? ''), undefined, {
      numeric: true,
    });
  });

  const previews = urutan.filter(isPreviewRelease);

  return {
    kept: previews.slice(0, keep),
    pruned: previews.slice(keep),
    protected: urutan.filter((release) => !isPreviewRelease(release)),
  };
}

/** Membaca sebuah opsi angka; nilai yang tidak masuk akal menghentikan script. */
function parseCount(raw, fallback, name) {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) {
    return fail(`Nilai ${name} tidak dikenali: ${raw}. Isinya bilangan bulat, mis. ${fallback}.`, [
      USAGE,
    ]);
  }
  return value;
}

function main() {
  const options = parseOptions(process.argv.slice(2), {
    usage: USAGE,
    values: {
      '--keep': 'jumlah rilis preview yang disimpan',
      '--limit': 'jumlah rilis yang dibaca dari GitHub',
    },
    flags: ['--dry-run'],
  });

  const keep = parseCount(options['--keep'], DEFAULT_KEEP, '--keep');
  const limit = parseCount(options['--limit'], DEFAULT_LIMIT, '--limit');
  const dryRun = options['--dry-run'] === true;

  if (keep < 1) {
    return fail(
      'Opsi --keep minimal 1: catatan rilis build berikutnya memakai tag rilis terakhir sebagai batas bawah, jadi minimal satu rilis preview harus tetap ada.',
      [USAGE],
    );
  }
  if (limit < 1) {
    return fail(`Opsi --limit minimal 1: tidak ada rilis yang bisa dibaca dengan nilai ${limit}.`, [
      USAGE,
    ]);
  }

  const listed = runGh([
    'release',
    'list',
    '--limit',
    String(limit),
    '--json',
    'tagName,isPrerelease,createdAt',
  ]);

  let releases;
  try {
    releases = JSON.parse(listed.stdout);
  } catch {
    return fail('Keluaran `gh release list` bukan JSON yang bisa dibaca.', [
      ...listed.stdout
        .split('\n')
        .filter((line) => line.trim() !== '')
        .slice(-5),
    ]);
  }
  if (!Array.isArray(releases)) {
    return fail('Keluaran `gh release list` bukan daftar rilis.');
  }

  const { kept, pruned, protected: dipertahankan } = selectReleasesToPrune(releases, { keep });

  console.error(
    `::notice::${releases.length} rilis terbaca — penyimpanan: ${kept.length} preview terbaru` +
      `, pemangkasan: ${pruned.length} preview lama, tidak disentuh: ${dipertahankan.length}.`,
  );
  if (releases.length >= limit) {
    console.error(
      `::warning::Daftar dibatasi --limit ${limit}; rilis yang lebih lama dari jendela itu tidak diperiksa. Naikkan nilainya bila perlu.`,
    );
  }

  const gagal = [];
  for (const release of pruned) {
    if (dryRun) {
      console.error(
        `::notice::[dry-run] akan dihapus: ${release.tagName} (${release.createdAt ?? 'tanpa tanggal'}) beserta tag-nya.`,
      );
      continue;
    }

    // `--cleanup-tag` menghapus tag git-nya sekaligus; tanpa itu tag lama tetap
    // mengotori `git tag` dan checkout penuh di workflow lain.
    const deleted = runGh(
      ['release', 'delete', String(release.tagName), '--yes', '--cleanup-tag'],
      { allowFailure: true },
    );
    if (deleted.ok) {
      console.error(`::notice::Dihapus: ${release.tagName} beserta tag-nya.`);
    } else {
      const sebab = `${deleted.stderr}\n${deleted.stdout}`
        .split('\n')
        .filter((line) => line.trim() !== '')
        .slice(-2)
        .join(' ');
      gagal.push(`${release.tagName}: ${sebab}`);
    }
  }

  if (gagal.length > 0) {
    return fail(
      `${gagal.length} rilis preview gagal dihapus; sisa pohon rilis dibiarkan apa adanya.`,
      gagal.map((line) => `- ${line}`),
    );
  }

  if (dryRun) {
    console.error(`::notice::Dry-run selesai: ${pruned.length} rilis akan dipangkas, nol dihapus.`);
  } else if (pruned.length === 0) {
    console.error('::notice::Tidak ada rilis preview yang perlu dipangkas.');
  }

  process.stdout.write(
    `disimpan=${kept.length}\ndipangkas=${pruned.length}\ntidak_disentuh=${dipertahankan.length}\n`,
  );
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung. Fungsi di atas murni
// dan dipakai test; tanpa penjagaan ini `import` akan ikut memanggil `gh`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
