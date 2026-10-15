#!/usr/bin/env node
/**
 * Helper git bersama untuk script rilis (`release-notes.mjs`, `should-release.mjs`).
 * `fail` sendiri tinggal di `cli.mjs` supaya script non-git tidak ikut
 * mengimpor helper git.
 *
 * Semua fungsi di sini hanya membaca repository lewat git; tidak ada penulisan.
 * Kesalahan yang tidak terduga dihentikan dengan anotasi `::error::` dan exit 1
 * supaya masalah terlihat di log GitHub Actions, bukan lewat keluaran kosong.
 */

import { execFileSync } from 'node:child_process';

import { fail } from './cli.mjs';

const MAX_BUFFER = 10 * 1024 * 1024;

/** Menjalankan git dan mengembalikan stdout. Kegagalan menghentikan script. */
export function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER });
  } catch (error) {
    return fail(`Perintah git gagal: git ${args.join(' ')}`, [String(error?.message ?? error)]);
  }
}

/** Sama seperti `git`, tetapi mengembalikan `null` saat gagal (pencarian opsional). */
export function gitOrNull(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/**
 * Opsi yang dikenali `parseRangeArgs`, beserta jenis nilainya untuk pesan galat.
 * Objek ini juga dipakai sebagai daftar putih argumen (lewat `Object.hasOwn`),
 * supaya nama seperti `toString` tidak diam-diam diperlakukan sebagai opsi.
 */
const RANGE_OPTIONS = {
  '--from': 'sebuah ref',
  '--to': 'sebuah ref',
  '--tag-exclude': 'sebuah pola glob',
};

/**
 * Membaca `--from`/`--to`/`--tag-exclude`; `--to` default `HEAD`, `--from` default
 * `null`, `--tag-exclude` boleh diulang dan default kosong.
 */
export function parseRangeArgs(argv, usage) {
  const options = { from: null, to: 'HEAD', tagExcludes: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!Object.hasOwn(RANGE_OPTIONS, arg)) {
      fail(`Argumen tidak dikenal: ${arg}`, [usage]);
    }

    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) {
      fail(`Opsi ${arg} membutuhkan ${RANGE_OPTIONS[arg]}.`, [usage]);
    }

    if (arg === '--tag-exclude') {
      options.tagExcludes.push(value);
    } else {
      options[arg === '--from' ? 'from' : 'to'] = value;
    }
    index += 1;
  }

  return options;
}

/**
 * Tag rilis terakhir sebelum `to`, atau `null` bila belum ada tag sama sekali.
 *
 * Batasnya dicari dari `to^`, bukan `to`: kalau commit `to` sendiri sudah
 * ditandai tag rilis (workflow yang dipicu oleh tag), tag itu harus dilewati.
 * Hanya tag berawalan `v` yang dihitung, sesuai konvensi tag rilis proyek ini.
 *
 * `tagExcludes` berisi pola glob (format git) yang tidak boleh dipakai sebagai
 * batas bawah. Rilis produksi memakai `v*-build*` supaya tag build preview — yang
 * dibuat pada setiap push ke `main` — tidak memotong catatan rilisnya: tanpa itu
 * `git describe` memilih tag terdekat di riwayat, yaitu build preview terakhir,
 * sehingga catatan rilis versi Play Store hanya memuat satu-dua commit.
 */
export function resolvePreviousTag(to, tagExcludes = []) {
  const args = ['describe', '--tags', '--abbrev=0', '--match', 'v*'];
  for (const pattern of tagExcludes) args.push('--exclude', pattern);
  args.push(`${to}^`);

  const found = gitOrNull(args);
  const tag = found === null ? '' : found.trim();
  return tag === '' ? null : tag;
}
