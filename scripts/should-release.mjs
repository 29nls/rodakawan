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
 *
 * Setiap pengecualian harus spesifik dan bisa dipertanggungjawabkan: berkas yang
 * tidak dikenali tetap dihitung "perlu build" (lihat `needsBuild`). Karena itu
 * `supabase/tests/**` dan `supabase/migrations/**` disebut eksplisit — keduanya
 * berjalan di server dan tidak pernah masuk bundel aplikasi — bukan lewat pola
 * longgar seperti "semua isi supabase" atau "semua yang mengandung kata test".
 *
 * `src/lib/supabase/database.generated.ts` sengaja **tidak** ada di sini walau
 * dihasilkan mesin: berkas itu berada di `src/` dan diimpor kode aplikasi, jadi
 * perubahannya tetap dinilai lewat jalur sebenarnya, bukan diabaikan karena
 * "generated".
 */
const IGNORABLE = [
  { reason: 'dokumentasi', pattern: /^docs\// },
  { reason: 'markdown', pattern: /\.md$/i },
  { reason: 'test', pattern: /(^|\/)__tests__\// },
  { reason: 'test', pattern: /\.test\.tsx?$/ },
  // Uji SQL berjalan terhadap database development, bukan bagian dari APK.
  { reason: 'uji SQL', pattern: /^supabase\/tests\// },
  // Migration mengubah isi database, dan APK tidak membawa berkas migration.
  { reason: 'migrasi database', pattern: /^supabase\/migrations\// },
  { reason: 'draf SQL', pattern: /^supabase\/drafts\// },
  // Edge Function berjalan di server Supabase; APK hanya memanggilnya.
  { reason: 'Edge Function', pattern: /^supabase\/functions\// },
  // Halaman web publik (privasi/hapus akun) bukan bagian dari bundel Expo.
  { reason: 'halaman web publik', pattern: /^web\// },
  // Tooling repo: dipanggil `npm run …` atau workflow, tidak pernah diimpor kode
  // aplikasi. Skrip yang justru menjadi **input** build disebut terpisah di
  // `BUILD_INPUT_SCRIPTS`, yang diperiksa lebih dulu.
  { reason: 'tooling repo', pattern: /^scripts\// },
  { reason: 'CI', pattern: /^\.github\// },
  { reason: 'konfigurasi test', pattern: /^jest\.config\.js$/ },
];

/**
 * Skrip di `scripts/` yang ikut menentukan isi atau berkas APK. Seluruh skrip
 * lain di direktori itu hanya alat bantu (rilis, uji, database), tetapi tiga ini
 * dijalankan **di dalam** build: perubahannya harus tetap memicu build.
 */
const BUILD_INPUT_SCRIPTS = [
  // Menulis `EXPO_PUBLIC_*` ke `.env.local`; nilainya masuk bundel aplikasi.
  /^scripts\/write-app-env\.mjs$/,
  // Menetapkan signingConfig rilis, versionCode, dan versionName APK.
  /^scripts\/configure-android-release\.mjs$/,
  // Sumber aset yang dipaketkan (ikon, adaptive icon, splash).
  /^scripts\/generate-assets\.mjs$/,
];

/** Alasan sebuah berkas diabaikan, atau `null` bila berkas itu memengaruhi aplikasi. */
export function ignorableReason(file) {
  if (BUILD_INPUT_SCRIPTS.some((pattern) => pattern.test(file))) {
    return null;
  }
  const match = IGNORABLE.find((entry) => entry.pattern.test(file));
  return match === undefined ? null : match.reason;
}

/** Ringkas alasan pengecualian menjadi mis. `uji SQL (2), migrasi database (1)`. */
export function summarizeReasons(files) {
  const counts = new Map();
  for (const file of files) {
    const reason = ignorableReason(file);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, count]) => `${reason} (${count})`).join(', ');
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
    console.error(
      `::notice::Dilewati karena tidak ada berkas yang mengubah isi aplikasi: ${summarizeReasons(ignored)} — ${describe(ignored)}`,
    );
  }

  process.stdout.write(`${build ? 'true' : 'false'}\n`);
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung. Ekspor di atas murni
// dan dipakai test; tanpa penjagaan ini `import` akan ikut memanggil git.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
