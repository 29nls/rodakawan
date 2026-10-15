#!/usr/bin/env node
/**
 * Helper CLI bersama untuk script di `scripts/`: pesan galat yang konsisten
 * (anotasi `::error::` milik GitHub Actions + exit 1) dan pembacaan opsi
 * `--nama <nilai>` / flag tanpa nilai.
 *
 * Dipisah dari `git-release.mjs` supaya script yang tidak menyentuh git (mis.
 * `update-changelog.mjs`) tidak ikut mengimpor helper git hanya untuk `fail`.
 */

/** Menghentikan script dengan anotasi `::error::` milik GitHub Actions. */
export function fail(message, extraLines = []) {
  console.error(`::error::${message}`);
  for (const line of extraLines) console.error(line);
  process.exit(1);
}

/**
 * Membaca opsi dari `argv`.
 *
 * `values` memetakan nama opsi ke jenis nilainya (dipakai di pesan galat),
 * `flags` adalah opsi tanpa nilai, dan `required` adalah opsi yang wajib ada.
 * Argumen yang tidak dikenal dihentikan, bukan diabaikan, supaya salah ketik
 * tidak membuat script berjalan dengan nilai default yang salah.
 *
 * `Object.hasOwn` dipakai saat mencocokkan nama opsi agar argumen seperti
 * `toString` tidak disalahartikan sebagai opsi lewat properti bawaan objek.
 */
export function parseOptions(argv, { usage, values, flags = [], required = [] }) {
  const options = {};
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (flags.includes(arg)) {
      options[arg] = true;
      continue;
    }

    if (!Object.hasOwn(values, arg)) {
      fail(`Argumen tidak dikenal: ${arg}`, [usage]);
    }

    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) {
      fail(`Opsi ${arg} membutuhkan ${values[arg]}.`, [usage]);
    }

    options[arg] = value;
    seen.add(arg);
    index += 1;
  }

  for (const key of required) {
    if (!seen.has(key)) fail(`Opsi ${key} wajib diisi.`, [usage]);
  }

  return options;
}
