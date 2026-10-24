/**
 * Test untuk `scripts/check-expo-deps.mjs`: pemeriksaan versi dependency terhadap
 * Expo SDK yang terpasang.
 *
 * Dua lapis, sama seperti test script rilis lain:
 * - fungsi murni (`checkOutcome`, `usefulLines`, `installedExpoVersion`) diuji
 *   langsung, sehingga kegagalannya menunjuk ke satu aturan;
 * - CLI-nya dijalankan sungguhan dengan CLI Expo tiruan
 *   (`support/fake-expo-cli.mjs`), karena yang paling mudah rusak diam-diam adalah
 *   **pembacaan hasilnya**: exit 0 yang tidak berarti apa-apa saat offline, exit
 *   bukan-nol tanpa keluaran, dan pemeriksaan yang tidak boleh mengubah berkas.
 *
 * Tidak ada test yang menyentuh jaringan: CLI sungguhan tidak pernah dijalankan.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  checkOutcome,
  installedExpoVersion,
  OFFLINE_MARKER,
  usefulLines,
} from '../check-expo-deps.mjs';
import { runScript } from './support/git-repo.mjs';

const FAKE_CLI = path.resolve(import.meta.dirname, 'support', 'fake-expo-cli.mjs');

/**
 * Direktori kerja sementara sebagai "proyek": CLI tiruan dipanggil lewat `EXPO_CLI`,
 * dan `node_modules/expo/package.json` boleh ada untuk menguji label versi SDK.
 */
function harness(t, { expoVersion = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cek-deps-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sisa direktori temp tidak memengaruhi hasil test.
    }
  });

  if (expoVersion !== null) {
    const pkgDir = path.join(dir, 'node_modules', 'expo');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'expo', version: expoVersion }),
    );
  }

  return {
    dir,
    run: (env = {}) =>
      runScript(dir, 'check-expo-deps.mjs', [], {
        env: { EXPO_CLI: FAKE_CLI, ...env },
      }),
  };
}

describe('checkOutcome', () => {
  it('menganggap exit 0 tanpa peringatan offline sebagai lulus', () => {
    assert.equal(
      checkOutcome({ status: 0, stdout: 'Dependencies are up to date\n', stderr: '' }),
      'ok',
    );
  });

  it('menganggap exit bukan-nol sebagai drift, apa pun keluarannya', () => {
    assert.equal(
      checkOutcome({ status: 1, stdout: '', stderr: 'Found outdated dependencies' }),
      'drift',
    );
    assert.equal(checkOutcome({ status: 2, stdout: '', stderr: '' }), 'drift');
  });

  it('tidak menyatakan lulus ketika CLI memperingatkan validasinya tidak bisa dipercaya', () => {
    // Bentuk nyata saat offline: stdout "up to date", peringatan di stderr, exit 0.
    assert.equal(
      checkOutcome({
        status: 0,
        stdout: 'Dependencies are up to date\n',
        stderr: 'Dependency validation is unreliable in offline-mode\n',
      }),
      'unverified',
    );
  });

  it('mengenali peringatan itu tanpa bergantung besar-kecil huruf dan letaknya', () => {
    assert.equal(
      checkOutcome({ status: 0, stdout: OFFLINE_MARKER.toUpperCase(), stderr: '' }),
      'unverified',
    );
  });

  it('tidak menyebut drift ketika proxy menolak daftar versi dengan HTTP 403', () => {
    // Bentuk nyata `getVersionsAsync`: exit 1 + statusText server, tanpa daftar paket.
    assert.equal(
      checkOutcome({
        status: 1,
        stdout: '',
        stderr:
          'CommandError: Unexpected response when fetching version info from Expo servers: Forbidden.\n',
      }),
      'unverified',
    );
  });

  it('mengenali kegagalan jaringan lain sebagai tidak bisa dipastikan', () => {
    assert.equal(
      checkOutcome({
        status: 1,
        stdout: '',
        stderr: 'FetchError: request failed, reason: ECONNREFUSED',
      }),
      'unverified',
    );
  });

  it('tetap melaporkan drift bila paket yang usang memang tercantum', () => {
    // Pesan jaringan tidak boleh menurunkan drift nyata menjadi sekadar peringatan.
    assert.equal(
      checkOutcome({
        status: 1,
        stdout: 'expo@57.0.29 - expected version: ~57.0.30\nFound outdated dependencies',
        stderr: 'proxy: HTTP 403',
      }),
      'drift',
    );
  });
});

describe('usefulLines', () => {
  it('membuang baris kosong dan echo variabel lingkungan, bukan isi pesannya', () => {
    const output = [
      'env: load .env.local',
      'env: export EXPO_PUBLIC_SUPABASE_URL',
      '',
      'expo@57.0.29 - expected version: ~57.0.30',
      '   ',
    ].join('\n');

    assert.deepEqual(usefulLines(output), ['expo@57.0.29 - expected version: ~57.0.30']);
  });
});

describe('installedExpoVersion', () => {
  it('membaca versi expo yang terpasang', (t) => {
    const h = harness(t, { expoVersion: '57.0.30' });

    assert.equal(installedExpoVersion(h.dir), '57.0.30');
  });

  it('mengembalikan null bila expo tidak ada atau berkasnya rusak', (t) => {
    const kosong = harness(t);
    assert.equal(installedExpoVersion(kosong.dir), null);

    const rusak = harness(t);
    fs.mkdirSync(path.join(rusak.dir, 'node_modules', 'expo'), { recursive: true });
    fs.writeFileSync(path.join(rusak.dir, 'node_modules', 'expo', 'package.json'), '{bukan json');
    assert.equal(installedExpoVersion(rusak.dir), null);
  });
});

describe('CLI check-expo-deps.mjs', () => {
  it('lulus dan menyebut versi SDK yang terpasang ketika semuanya cocok', (t) => {
    const h = harness(t, { expoVersion: '57.0.30' });

    const hasil = h.run({ FAKE_EXPO_MODE: 'ok' });

    assert.equal(hasil.code, 0);
    assert.match(hasil.stdout, /cocok dengan Expo SDK 57\.0\.30/);
    assert.equal(hasil.stderr, '');
  });

  it('tetap lulus tanpa menyebut versi bila package.json expo tidak terbaca', (t) => {
    const h = harness(t);

    const hasil = h.run({ FAKE_EXPO_MODE: 'ok' });

    assert.equal(hasil.code, 0);
    assert.match(hasil.stdout, /cocok dengan Expo SDK yang terpasang/);
  });

  it('gagal dengan anotasi error dan daftar paketnya saat ada drift', (t) => {
    const h = harness(t, { expoVersion: '57.0.30' });

    const hasil = h.run({ FAKE_EXPO_MODE: 'drift' });

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /::error::Versi dependency tidak cocok dengan Expo SDK 57\.0\.30/);
    // Dua paket yang pernah benar-benar membuat gerbang rilis mati (ADR-053).
    assert.match(hasil.stderr, /expo@57\.0\.29 - expected version: ~57\.0\.30/);
    assert.match(hasil.stderr, /expo-router@57\.0\.27 - expected version: ~57\.0\.28/);
    assert.match(hasil.stderr, /npx expo install --fix/);
  });

  it('gagal dengan pesan yang tetap berguna walau CLI tidak mengeluarkan apa pun', (t) => {
    const h = harness(t);

    const hasil = h.run({ FAKE_EXPO_MODE: 'crash' });

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /::error::Versi dependency tidak cocok/);
    assert.match(hasil.stderr, /npx expo install --fix/);
  });

  it('memberi peringatan, bukan error, saat proxy menolak daftar versi (HTTP 403)', (t) => {
    const h = harness(t, { expoVersion: '57.0.30' });

    const hasil = h.run({ FAKE_EXPO_MODE: 'proxy' });

    // Exit 1 dari CLI bukan berarti versi salah: tidak ada paket yang dibandingkan.
    assert.equal(hasil.code, 0);
    assert.equal(hasil.stdout.includes('cocok dengan'), false);
    assert.match(hasil.stderr, /::warning::Versi dependency tidak bisa dipastikan/);
    assert.doesNotMatch(hasil.stderr, /::error::/);
    assert.match(hasil.stderr, /Forbidden/);
  });

  it('tidak menyatakan lulus maupun gagal saat validasinya tidak bisa dipercaya', (t) => {
    const h = harness(t, { expoVersion: '57.0.30' });

    const hasil = h.run({ FAKE_EXPO_MODE: 'offline' });

    // Tidak menggagalkan pekerjaan orang yang sedang tanpa internet...
    assert.equal(hasil.code, 0);
    // ...tetapi juga tidak boleh mengklaim cocok: itu justru kesalahan yang dicegah
    // pemeriksaan ini.
    assert.equal(hasil.stdout.includes('cocok dengan'), false);
    assert.match(hasil.stderr, /::warning::Versi dependency tidak bisa dipastikan/);
    assert.match(hasil.stderr, new RegExp(OFFLINE_MARKER, 'i'));
  });

  it('berhenti dengan pesan yang jelas bila CLI Expo tidak terpasang', (t) => {
    const h = harness(t);

    const hasil = h.run({ EXPO_CLI: path.join(h.dir, 'tidak-ada', 'cli') });

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /::error::CLI Expo tidak ditemukan/);
    assert.match(hasil.stderr, /npm ci/);
  });

  it('memakai CLI bawaan proyek bila EXPO_CLI tidak diatur', (t) => {
    const h = harness(t);

    // Tanpa `EXPO_CLI`, script menunjuk `node_modules/expo/bin/cli` relatif ke cwd —
    // di direktori sementara ini berkasnya tidak ada, dan pesannya harus menyebut
    // jalan itu, bukan gagal diam-diam.
    const hasil = runScript(h.dir, 'check-expo-deps.mjs', [], { unset: ['EXPO_CLI'] });

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /node_modules[\\/]expo[\\/]bin[\\/]cli/);
  });
});
