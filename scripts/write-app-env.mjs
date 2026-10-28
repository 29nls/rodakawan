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
 * Nilai EXPO_PUBLIC bukan rahasia: semuanya masuk ke bundel aplikasi dan APK.
 * Untuk beta, sumbernya wajib GitHub Environment `beta` agar variables development
 * repository tidak menjadi fallback. Isi konfigurasi tidak pernah dicetak ke log.
 *
 * Pemakaian:
 *   node scripts/write-app-env.mjs                # tulis .env.local untuk development
 *   node scripts/write-app-env.mjs --environment beta --out .env.local
 *
 * Keluar dengan kode 0 bila berkasnya tertulis; selain itu kode 1 dengan pesan
 * `::error::…`. Isi variabelnya tidak pernah ditampilkan.
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { fail, parseOptions } from './lib/cli.mjs';
import { validateBetaProjectUrl } from './lib/shared-ride.mjs';

const USAGE =
  'Pemakaian: node scripts/write-app-env.mjs [--out <berkas>] [--environment <development|beta|production>]';

/**
 * Variabel yang wajib ada. Daftarnya sengaja tetap (bukan semua `EXPO_PUBLIC_*` yang
 * kebetulan ada di lingkungan): yang ditulis ke `.env.local` harus persis kebutuhan
 * aplikasi, bukan apa pun yang dibawa proses pemanggil — termasuk rahasia CI yang
 * tidak ada hubungannya dengan bundel.
 *
 * `EXPO_PUBLIC_MAP_STYLE_URL` opsional: bila tidak diisi, aplikasi tetap berjalan
 * tanpa peta custom (lihat `src/lib/env.ts` `describeBackendStatus`, tone `neutral`,
 * detail "Belum ada kredensial backend. Aplikasi berjalan tanpa Supabase dan tanpa
 * peta, jadi belum ada data yang dikirim keluar perangkat."). Variabel ini tidak ikut
 * menyebabkan gagal validasi konfigurasi.
 *
 * Nama dan urutannya mengikuti `.env.example`, satu-satunya daftar konfigurasi
 * publik yang boleh dipakai.
 */
export const APP_ENV_VARS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_MAP_STYLE_URL', // EXPO_PUBLIC_MAP_STYLE_URL: opsional, lihat aturan di collectAppEnv.
];

/**
 * Pasangan `nama=nilai` yang benar-benar ditulis ke berkas, urut sesuai
 * `APP_ENV_VARS`. Satu-satunya sumber kebenaran untuk isi berkas **dan** jumlah
 * variabel yang dilaporkan, supaya hitungannya tidak bisa menyimpang dari isinya
 * ketika variabel opsional (`EXPO_PUBLIC_MAP_STYLE_URL`) tidak diisi.
 */
export function writtenAppEnv(values) {
  return APP_ENV_VARS.filter((nama) => values[nama] !== undefined && values[nama] !== '').map(
    (nama) => `${nama}=${values[nama]}`,
  );
}

/** Isi `.env.local` untuk nilai yang sudah lengkap. */
export function appEnvFile(values) {
  const header = [
    '# Dibuat scripts/write-app-env.mjs — jangan di-commit.',
    '# Nilai berprefix EXPO_PUBLIC_ ikut masuk ke bundel aplikasi, jadi isinya harus',
    '# aman untuk publik (lihat .env.example).',
    '',
  ];
  return `${[...header, ...writtenAppEnv(values)].join('\n')}\n`;
}

/**
 * Memeriksa nilai yang datang dari lingkungan. Ruang kosong untuk
 * `EXPO_PUBLIC_MAP_STYLE_URL` dianggap bukan kegagalan (variabel opsional).
 * Hanya `EXPO_PUBLIC_SUPABASE_URL` dan `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
 * yang wajib diisi.
 */
export function collectAppEnv(env) {
  const kosongWajib = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].filter(
    (nama) => typeof env[nama] !== 'string' || env[nama].trim() === '',
  );
  if (kosongWajib.length > 0) {
    return fail(
      `Konfigurasi publik aplikasi belum lengkap: ${kosongWajib.join(', ')} belum diisi.`,
      [
        'Atur sebagai GitHub Actions variables pada environment build yang dipilih dengan nama persis seperti di atas; gunakan environment `beta` untuk build beta.',
        'Bila `EXPO_PUBLIC_MAP_STYLE_URL` dibiarkan kosong, APK-nya tetap berjalan tanpa peta custom.',
        'Nilai contoh beserta penjelasannya: .env.example dan docs/SETUP_GUIDE.md bagian 5.3.',
      ],
    );
  }
  // Filter hanya variabel wajib ke output; opsional lewat dengan undefined
  const result = {};
  for (const nama of APP_ENV_VARS) {
    if (nama === 'EXPO_PUBLIC_MAP_STYLE_URL') {
      // opsional: tulis bila ada, skip bila tidak
      if (typeof env[nama] === 'string' && env[nama].trim() !== '') {
        result[nama] = env[nama].trim();
      }
    } else {
      result[nama] = env[nama].trim();
    }
  }
  return result;
}

export function collectBuildAppEnv(env, environment) {
  const supportedEnvironments = ['development', 'beta', 'production'];
  if (!supportedEnvironments.includes(environment)) {
    return fail('Environment build tidak dikenal.', [USAGE]);
  }

  const values = collectAppEnv(env);
  if (values === null) return null;

  if (environment === 'beta') {
    const check = validateBetaProjectUrl(
      values.EXPO_PUBLIC_SUPABASE_URL,
      env.BETA_SUPABASE_PROJECT_REF,
    );
    if (!check.ok) return null;
  }

  return values;
}

function main() {
  const options = parseOptions(process.argv.slice(2), {
    usage: USAGE,
    values: {
      '--out': 'berkas tujuan',
      '--environment': 'development, beta, atau production',
    },
  });

  const environment = options['--environment'] ?? 'development';
  const out = options['--out'] ?? '.env.local';
  const values = collectBuildAppEnv(process.env, environment);
  if (!values) {
    if (environment === 'beta') {
      fail('Target beta tidak valid; build ditolak sebelum konfigurasi ditulis.', [
        'Atur BETA_SUPABASE_PROJECT_REF, EXPO_PUBLIC_SUPABASE_URL, dan EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY pada GitHub Environment beta.',
        'Pastikan URL menggunakan ref yang sama, berbeda dari project development, lalu jalankan ulang workflow beta.',
      ]);
    }
    return;
  }
  const written = writtenAppEnv(values);

  fs.writeFileSync(out, appEnvFile(values), { mode: 0o600 });

  // Dihitung dari variabel yang benar-benar ditulis, bukan panjang daftar tetap:
  // tanpa EXPO_PUBLIC_MAP_STYLE_URL isinya dua, dan log harus mengatakan dua.
  console.error(
    `::notice::Konfigurasi publik aplikasi ditulis ke ${out} (${written.length} variabel; nilainya tidak dicetak).`,
  );
  process.stdout.write(`variabel=${written.length}\nberkas=${out}\n`);
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung; fungsi di atas murni dan
// dipakai test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
