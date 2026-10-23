#!/usr/bin/env node
/**
 * Memeriksa apakah dependency yang terpasang masih cocok dengan versi yang diminta
 * Expo SDK — di laptop, dalam hitungan detik, bukan di CI saat rilis.
 *
 * Kenapa ada script ini: kecocokan versi sudah diperiksa `npm run doctor`, tetapi
 * doctor baru berbunyi di tempat yang mahal — langkah hampir terakhir job `quality`
 * pada CI, dan job `verify` pada kedua alur rilis. Drift-nya karena itu ketahuan
 * setelah menit CI terpakai, atau setelah rilis gagal fail-closed seperti yang
 * pernah terjadi (ADR-053: `expo` 57.0.29 vs `~57.0.30`). Pemeriksaan yang sama bisa
 * dijalankan kurang dari dua detik di laptop, jadi tempatnya memang di sini.
 *
 * Yang memeriksa bukan script ini, melainkan CLI Expo yang sudah terpasang
 * (`expo install --check`). Daftar versi yang benar tidak dihitung ulang di sini
 * karena satu paket kunci tidak ada di berkas lokal mana pun:
 * `node_modules/expo/bundledNativeModules.json` memuat paket library, tetapi
 * **tidak** memuat `expo` sendiri, sehingga versi `expo` yang benar hanya diketahui
 * dari endpoint resmi Expo untuk SDK yang terpasang. Aturan yang digandakan di sini
 * cepat atau lambat akan menyimpang dari doctor; karena itu hasil CLI-nya yang
 * dipakai apa adanya.
 *
 * Tiga kemungkinan hasil, dan sengaja tiga — bukan dua:
 *
 *   1. sesuai          → `::notice::` di stdout, exit 0
 *   2. ada drift       → `::error::` beserta daftar paketnya, exit 1
 *   3. tidak dipastikan → `::warning::` yang menyatakan tidak diperiksa, exit 0
 *
 * Hasil ketiga bukan basa-basi. Tanpa internet, CLI-nya tetap mencetak
 * `Dependencies are up to date` di stdout sambil memperingatkan di stderr bahwa
 * validasinya **tidak bisa dipercaya** (`Dependency validation is unreliable in
 * offline-mode`). Mengecek exit code saja akan melaporkan "sesuai" untuk pemeriksaan
 * yang tidak pernah terjadi — jadi tiga hasil itu dipisah, dan hasil ketiga dibiarkan
 * **tidak** menggagalkan pekerjaan: gerbang yang memblokir orang yang sedang tanpa
 * internet hanya akan dimatikan orang lain, seperti pemeriksaan `keytool` yang
 * dilewati dengan peringatan di `scripts/configure-android-release.mjs`.
 *
 * Kegagalan mengambil daftar versi juga bisa berbentuk exit bukan-nol, bukan hanya
 * mode offline: proxy yang menolak `exp.host` dengan HTTP 403 membuat CLI melempar
 * `Unexpected response when fetching version info from Expo servers: Forbidden.`
 * Tanpa pengenalan pola itu, script lama melaporkannya sebagai drift dan `::error::`
 * padahal tidak ada satu pun paket yang diperiksa. Keluaran yang memuat penanda
 * jaringan/HTTP karena itu diperlakukan sebagai hasil ketiga, bukan kegagalan versi.
 *
 * Pemakaian:
 *   node scripts/check-expo-deps.mjs
 *
 * `EXPO_CLI` boleh menunjuk berkas JavaScript lain untuk dijalankan dengan `node`
 * (dipakai test dengan CLI tiruan), sama seperti `KEYTOOL` di
 * `scripts/configure-android-release.mjs`. Test tidak pernah menyentuh jaringan.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { fail } from './lib/cli.mjs';

/** CLI Expo bawaan proyek; dijalankan dengan `node` supaya sama di Windows maupun Linux. */
export const DEFAULT_EXPO_CLI = path.join('node_modules', 'expo', 'bin', 'cli');

/**
 * Kalimat yang dicetak Expo CLI ketika daftar versi resminya tidak bisa diambil,
 * sehingga hasil "up to date"-nya tidak berarti apa-apa.
 */
export const OFFLINE_MARKER = 'unreliable in offline-mode';

/** Penanda keluaran yang membuktikan versi benar-benar dibandingkan. */
const DRIFT_MARKERS = [
  /expected version:/i,
  /found outdated dependencies/i,
  /should be updated for best compatibility/i,
];

/**
 * Penanda bahwa daftar versi resmi tidak terjangkau — offline, proxy, atau DNS.
 *
 * `Forbidden` dan `Unexpected response when fetching version info` adalah bentuk
 * nyata ketika proxy menolak `exp.host` dengan HTTP 403; errno dan pesan fetch
 * menangkap kasus jaringan lain. Semuanya berarti **tidak ada yang diperiksa**,
 * bukan paket yang versinya salah.
 */
const UNREACHABLE_MARKERS = [
  /unexpected response when fetching version info/i,
  /\bforbidden\b/i,
  /\bproxy\b/i,
  /\b(?:econnrefused|enotfound|eai_again|etimedout|ehostunreach|enetunreach|eproto)\b/i,
  /\bsocket hang up\b/i,
  /\b(?:fetch failed|network request failed|network error)\b/i,
  /\b(?:self[- ]signed certificate|certificate has expired|unable to verify the first certificate)\b/i,
];

/**
 * Menentukan hasil dari keluaran CLI: `ok`, `drift`, atau `unverified`.
 *
 * Keluaran drift diperiksa lebih dulu supaya daftar paket yang benar-benar usang
 * tidak pernah turun menjadi sekadar peringatan hanya karena pesannya menyebut
 * jaringan. Selebihnya, exit bukan-nol tanpa penanda drift berarti pemeriksaan
 * tidak pernah berhasil dijalankan (offline/proxy/DNS) atau CLI gagal secara tak
 * terduga; yang pertama tidak boleh menghukum orang yang sedang tanpa internet,
 * sedangkan yang kedua tetap fail-closed seperti sebelumnya.
 *
 * Dipisah dari `main()` supaya bisa diuji tanpa menjalankan CLI sungguhan.
 */
export function checkOutcome({ status, stdout = '', stderr = '' }) {
  const output = `${stdout}${stderr}`;

  if (DRIFT_MARKERS.some((marker) => marker.test(output))) return 'drift';

  if ((status ?? 1) === 0) {
    return output.toLowerCase().includes(OFFLINE_MARKER) ? 'unverified' : 'ok';
  }

  const unreachable =
    output.toLowerCase().includes(OFFLINE_MARKER) ||
    UNREACHABLE_MARKERS.some((marker) => marker.test(output));

  return unreachable ? 'unverified' : 'drift';
}

/** Baris keluaran CLI yang berguna dibaca manusia: tanpa baris kosong dan tanpa echo env. */
export function usefulLines(output) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !line.startsWith('env: '));
}

/** Versi `expo` yang benar-benar terpasang, atau `null` bila belum bisa dibaca. */
export function installedExpoVersion(rootDir = process.cwd()) {
  try {
    const file = path.join(rootDir, 'node_modules', 'expo', 'package.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : null;
  } catch {
    return null;
  }
}

function main() {
  const rootDir = process.cwd();
  const cliFile = path.resolve(rootDir, process.env.EXPO_CLI ?? DEFAULT_EXPO_CLI);

  if (!fs.existsSync(cliFile)) {
    return fail(
      `CLI Expo tidak ditemukan (${path.relative(rootDir, cliFile) || cliFile}), jadi versi dependency tidak bisa diperiksa.`,
      ['Jalankan `npm ci` lebih dulu, lalu ulangi pemeriksaan ini.'],
    );
  }

  const result = spawnSync(process.execPath, [cliFile, 'install', '--check'], {
    cwd: rootDir,
    encoding: 'utf8',
    // Tanpa stdin: `expo install` biasa menawarkan pilihan, dan pemeriksaan ini tidak
    // boleh berhenti menunggu jawaban.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    return fail(`CLI Expo tidak bisa dijalankan: ${result.error.message}`);
  }

  const version = installedExpoVersion(rootDir);
  const target = version === null ? 'Expo SDK yang terpasang' : `Expo SDK ${version}`;
  const details = usefulLines(`${result.stdout ?? ''}${result.stderr ?? ''}`);

  switch (checkOutcome(result)) {
    case 'drift':
      return fail(`Versi dependency tidak cocok dengan ${target}.`, [
        ...details,
        'Perbaiki dengan `npx expo install --fix`, lalu jalankan ulang pemeriksaan ini.',
        'Sumber pemeriksaan: `expo install --check` — daftar versi resmi Expo untuk SDK yang terpasang.',
      ]);
    case 'unverified':
      console.error(
        `::warning::Versi dependency tidak bisa dipastikan terhadap ${target}: daftar versi resmi Expo tidak terjangkau (jaringan, proxy, atau mode offline). Pemeriksaan ini tidak menyatakan lulus maupun gagal.`,
      );
      for (const line of details) console.error(line);
      return;
    default:
      process.stdout.write(`Versi dependency cocok dengan ${target}.\n`);
  }
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung; fungsi di atas murni dan
// dipakai test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
