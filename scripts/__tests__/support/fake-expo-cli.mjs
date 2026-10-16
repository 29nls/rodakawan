#!/usr/bin/env node
/**
 * CLI Expo tiruan untuk test `scripts/check-expo-deps.mjs`.
 *
 * Yang diuji bukan Expo-nya, melainkan **cara script membaca hasilnya**: exit code
 * saja tidak cukup, karena CLI sungguhan tetap mencetak `Dependencies are up to
 * date` sambil memperingatkan bahwa validasinya tidak bisa dipercaya saat offline.
 * Tiruan ini karena itu bisa memainkan keempat bentuk keluaran itu secara persis,
 * termasuk kombinasi yang tidak boleh dianggap lulus.
 *
 * Argumen yang dipanggil script ini juga diperiksa: `install --check` — bukan
 * `install --fix` — supaya pemeriksaan tidak pernah mengubah `package.json`.
 *
 * Mode dari `FAKE_EXPO_MODE`: `ok` (bawaan) | `offline` | `drift` | `crash`.
 */
const args = process.argv.slice(2);

if (args.join(' ') !== 'install --check') {
  process.stderr.write(`argumen tak terduga: ${args.join(' ')}\n`);
  process.exit(9);
}

const mode = process.env.FAKE_EXPO_MODE ?? 'ok';

switch (mode) {
  case 'ok':
    process.stdout.write('Dependencies are up to date\n');
    break;

  // Bentuk yang paling menipu: stdout menyatakan sesuai, stderr menyatakan bahwa
  // pemeriksaannya tidak bisa dipercaya. Tidak boleh dilaporkan sebagai lulus.
  case 'offline':
    process.stdout.write('Dependencies are up to date\n');
    process.stderr.write('Dependency validation is unreliable in offline-mode\n');
    break;

  case 'drift':
    process.stderr.write(
      [
        'The following packages should be updated for best compatibility with the installed expo version:',
        '  expo@57.0.29 - expected version: ~57.0.30',
        '  expo-router@57.0.27 - expected version: ~57.0.28',
        'Your project may not work correctly until you install the expected versions of the packages.',
        'Found outdated dependencies',
        '',
      ].join('\n'),
    );
    process.exit(1);
    break;

  // Kegagalan tanpa keluaran sama sekali: script harus tetap gagal dengan pesan
  // yang berguna, bukan dengan daftar kosong yang membingungkan.
  case 'crash':
    process.exit(2);
    break;

  default:
    process.stderr.write(`mode tiruan tidak dikenal: ${mode}\n`);
    process.exit(9);
}
