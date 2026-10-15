#!/usr/bin/env node
/**
 * Menulis `.env.local` dari variabel lingkungan publik aplikasi, supaya build
 * Android lokal (dan `expo export`) memakai konfigurasi yang sama dengan yang dipakai
 * pengembang.
 *
 * Kenapa perlu: build APK dulu berjalan di EAS Cloud, dan nilai `EXPO_PUBLIC_*`
 * datang dari **environment milik EAS** yang dipilih profil `eas.json`
 * (`environment: production`/`preview`). Build lokal di runner tidak punya
 * lingkungan EAS itu, sehingga tanpa langkah ini APK-nya tetap terbangun — dan tetap
 * lolos uji nyala — tetapi tampil dengan banner "konfigurasi belum tersedia" dan
 * tidak menyentuh backend sama sekali. Kegagalan seperti itu tidak terlihat di CI,
 * hanya oleh orang yang memasangnya, jadi variabel yang hilang di sini dihentikan
 * lebih dulu, bukan dibiarkan lewat.
 *
 * Nilainya bukan rahasia: semuanya dikirim ke dalam bundel aplikasi dan ikut
 * terpasang di perangkat siapa pun yang memegang APK-nya. Karena itu ia dibaca dari
 * *variables* repository, bukan dari secrets — agar bisa diperiksa tanpa membuka
 * nilai rahasia dan tanpa pernah dicetak ke log.
 *
 * Pemakaian:
 *   node scripts/write-app-env.mjs                # tulis .env.local
 *   node scripts/write-app-env.mjs --out .env.local
 *
 * Keluar dengan kode 0 bila berkasnya tertulis; selain itu kode 1 dengan pesan
 * `::error::…`. Isi variabelnya tidak pernah ditampilkan.
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { fail, parseOptions } from './lib/cli.mjs';

const USAGE = 'Pemakaian: node scripts/write-app-env.mjs [--out <berkas>]';

/**
 * Variabel yang wajib ada. Daftarnya sengaja tetap (bukan semua `EXPO_PUBLIC_*` yang
 * kebetulan ada di lingkungan): yang ditulis ke `.env.local` harus persis kebutuhan
 * aplikasi, bukan apa pun yang dibawa proses pemanggil — termasuk rahasia CI yang
 * tidak ada hubungannya dengan bundel.
 *
 * Nama dan urutannya mengikuti `.env.example`, satu-satunya daftar konfigurasi
 * publik yang boleh dipakai.
 */
export const APP_ENV_VARS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_MAP_STYLE_URL',
];

/** Isi `.env.local` untuk nilai yang sudah lengkap. */
export function appEnvFile(values) {
  const header = [
    '# Dibuat scripts/write-app-env.mjs — jangan di-commit.',
    '# Nilai berprefix EXPO_PUBLIC_ ikut masuk ke bundel aplikasi, jadi isinya harus',
    '# aman untuk publik (lihat .env.example).',
    '',
  ];
  const baris = APP_ENV_VARS.map((nama) => `${nama}=${values[nama]}`);
  return `${[...header, ...baris].join('\n')}\n`;
}

/**
 * Memeriksa nilai yang datang dari lingkungan. Ruang kosong dianggap belum diisi:
 * secret yang salah tempel menjadi spasi tetap harus menghentikan rilis, bukan
 * menghasilkan bundel tanpa backend.
 */
export function collectAppEnv(env) {
  const kosong = APP_ENV_VARS.filter(
    (nama) => typeof env[nama] !== 'string' || env[nama].trim() === '',
  );
  if (kosong.length > 0) {
    return fail(`Konfigurasi publik aplikasi belum lengkap: ${kosong.join(', ')} belum diisi.`, [
      'Atur sebagai *variables* repository — Settings → Secrets and variables → Actions → Variables — dengan nama persis seperti di atas.',
      'Bila dibiarkan kosong, APK-nya tetap terbangun dan tetap lolos uji nyala, tetapi tampil dengan banner "konfigurasi belum tersedia" dan tidak menyentuh backend sama sekali.',
      'Nilai contoh beserta penjelasannya: .env.example dan docs/SETUP_GUIDE.md bagian 5.3.',
    ]);
  }
  return Object.fromEntries(APP_ENV_VARS.map((nama) => [nama, env[nama]]));
}

function main() {
  const options = parseOptions(process.argv.slice(2), {
    usage: USAGE,
    values: { '--out': 'berkas tujuan' },
  });

  const out = options['--out'] ?? '.env.local';
  const values = collectAppEnv(process.env);

  fs.writeFileSync(out, appEnvFile(values), { mode: 0o600 });

  console.error(
    `::notice::Konfigurasi publik aplikasi ditulis ke ${out} (${APP_ENV_VARS.length} variabel; nilainya tidak dicetak).`,
  );
  process.stdout.write(`variabel=${APP_ENV_VARS.length}\nberkas=${out}\n`);
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung; fungsi di atas murni dan
// dipakai test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
