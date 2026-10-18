/**
 * Test untuk `scripts/check-editor-ts.mjs`: pemeriksa kesamaan TypeScript editor
 * dengan yang dipakai `npm run typecheck`/CI.
 *
 * Dua lapis, sama seperti test script lain:
 * - fungsi murni (parsing versi, kecocokan rentang, pembacaan pengaturan) diuji
 *   langsung, karena aturan `~`/`^` adalah bagian yang paling mudah salah dan
 *   salahnya tidak kelihatan sampai editor dan CI berbeda pendapat;
 * - CLI-nya dijalankan sungguhan terhadap repository tiruan, karena yang menentukan
 *   adalah berkas-berkas yang benar-benar dibaca (`settings.json`, `package.json`,
 *   `package-lock.json`, `node_modules/typescript`).
 *
 * Test terakhir menjalankan pemeriksaan ini terhadap repository ini sendiri,
 * supaya `.vscode/settings.json` yang di-commit tidak bisa menyimpang diam-diam.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  PROMPT_KEY,
  TSDK_KEY,
  WORKSPACE_TSDK,
  parseVersion,
  promptEnabled,
  satisfiesRange,
  tsdkFrom,
} from '../check-editor-ts.mjs';
import { runScript } from './support/git-repo.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Pengaturan editor yang benar, dipakai sebagai titik awal tiap fixture. */
const SETTINGS = {
  [TSDK_KEY]: WORKSPACE_TSDK,
  [PROMPT_KEY]: true,
};

/**
 * Repository tiruan dengan TypeScript terpasang. Setiap bagian bisa dirusak satu
 * per satu supaya test menunjuk ke aturan yang gagal, bukan ke pemeriksaan umum.
 */
function fixture(t, options = {}) {
  const {
    settings = SETTINGS,
    tsVersion = '6.0.3',
    pin = '~6.0.3',
    lockVersion = tsVersion,
    lockEntry = true,
    tsserver = true,
  } = options;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-ts-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sisa direktori temp tidak memengaruhi hasil test.
    }
  });

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'fixture', devDependencies: { typescript: pin } }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          '': {},
          ...(lockEntry ? { 'node_modules/typescript': { version: lockVersion } } : {}),
        },
      },
      null,
      2,
    )}\n`,
  );

  const tsDir = path.join(dir, 'node_modules', 'typescript');
  fs.mkdirSync(path.join(tsDir, 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(tsDir, 'package.json'),
    `${JSON.stringify({ name: 'typescript', version: tsVersion }, null, 2)}\n`,
  );
  if (tsserver) fs.writeFileSync(path.join(tsDir, 'lib', 'tsserver.js'), '// tsserver\n');

  if (settings !== null) {
    fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.vscode', 'settings.json'),
      `${JSON.stringify(settings, null, 2)}\n`,
    );
  }

  return {
    dir,
    run: () => runScript(dir, 'check-editor-ts.mjs'),
    /** Menulis ulang settings.json setelah fixture dibuat. */
    setSettings(value) {
      fs.writeFileSync(
        path.join(dir, '.vscode', 'settings.json'),
        `${JSON.stringify(value, null, 2)}\n`,
      );
    },
  };
}

describe('parseVersion', () => {
  it('membaca versi stabil dan pre-rilis', () => {
    assert.deepEqual(parseVersion('6.0.3'), { numbers: [6, 0, 3], pre: null });
    assert.deepEqual(parseVersion(' 6.0.3 '), { numbers: [6, 0, 3], pre: null });
    assert.deepEqual(parseVersion('6.0.3-beta.1'), { numbers: [6, 0, 3], pre: 'beta.1' });
  });

  it('menolak bentuk yang tidak lengkap', () => {
    assert.equal(parseVersion('6.0'), null);
    assert.equal(parseVersion('^6.0.3'), null);
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion(undefined), null);
  });
});

describe('satisfiesRange', () => {
  it('memakai aturan tilde seperti npm', () => {
    assert.equal(satisfiesRange('6.0.3', '~6.0.3'), true);
    assert.equal(satisfiesRange('6.0.9', '~6.0.3'), true);
    assert.equal(satisfiesRange('6.0.2', '~6.0.3'), false);
    assert.equal(satisfiesRange('6.1.0', '~6.0.3'), false);
    assert.equal(satisfiesRange('7.0.0', '~6.0.3'), false);
  });

  it('memakai aturan caret seperti npm, termasuk untuk 0.x', () => {
    assert.equal(satisfiesRange('6.9.0', '^6.0.3'), true);
    assert.equal(satisfiesRange('7.0.0', '^6.0.3'), false);
    assert.equal(satisfiesRange('0.2.5', '^0.2.3'), true);
    assert.equal(satisfiesRange('0.3.0', '^0.2.3'), false);
    assert.equal(satisfiesRange('0.0.3', '^0.0.3'), true);
    assert.equal(satisfiesRange('0.0.4', '^0.0.3'), false);
  });

  it('menerima versi persis dan menolak tetangganya', () => {
    assert.equal(satisfiesRange('6.0.3', '6.0.3'), true);
    assert.equal(satisfiesRange('6.0.4', '6.0.3'), false);
  });

  it('tidak mencocokkan pre-rilis dengan rentang stabil', () => {
    assert.equal(satisfiesRange('6.0.3-beta.1', '~6.0.3'), false);
    assert.equal(satisfiesRange('6.0.3-beta.1', '6.0.3-beta.1'), true);
  });

  it('melempar untuk rentang yang tidak dipahami, bukan menebak', () => {
    assert.throws(() => satisfiesRange('6.0.3', '>=6'), /tidak didukung/);
    assert.throws(() => satisfiesRange('6.0.3', '6.x'), /tidak didukung/);
    assert.throws(() => satisfiesRange('6.0.3', ''), /tidak didukung/);
    assert.throws(() => satisfiesRange('enam', '~6.0.3'), /tidak terbaca/);
  });
});

describe('pembacaan pengaturan editor', () => {
  it('mengambil path tsdk hanya bila berupa teks yang tidak kosong', () => {
    assert.equal(
      tsdkFrom({ [TSDK_KEY]: 'node_modules/typescript/lib' }),
      'node_modules/typescript/lib',
    );
    assert.equal(
      tsdkFrom({ [TSDK_KEY]: '  node_modules/typescript/lib  ' }),
      'node_modules/typescript/lib',
    );
    assert.equal(tsdkFrom({ [TSDK_KEY]: '   ' }), null);
    assert.equal(tsdkFrom({ [TSDK_KEY]: 42 }), null);
    assert.equal(tsdkFrom({ typescript: { tsdk: 'node_modules/typescript/lib' } }), null);
    assert.equal(tsdkFrom(null), null);
  });

  it('mewajibkan prompt bernilai true', () => {
    assert.equal(promptEnabled({ [PROMPT_KEY]: true }), true);
    assert.equal(promptEnabled({ [PROMPT_KEY]: 'true' }), false);
    assert.equal(promptEnabled({}), false);
  });
});

describe('CLI check-editor-ts.mjs', () => {
  it('lulus bila pengaturan, path, pin, dan lockfile sepakat', (t) => {
    const h = fixture(t);
    const run = h.run();

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /Editor memakai TypeScript 6\.0\.3/);
    assert.match(run.stdout, /lockfile/);
  });

  it('lulus pada repository ini: pengaturan yang di-commit menunjuk versi workspace', () => {
    const run = runScript(REPO_ROOT, 'check-editor-ts.mjs');

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /Editor memakai TypeScript \d+\.\d+\.\d+/);
  });

  it('gagal bila pengaturan editor tidak ada sama sekali', (t) => {
    const h = fixture(t, { settings: null });
    const run = h.run();

    assert.equal(run.code, 1);
    assert.match(run.stderr, /settings\.json\) tidak ada/);
    assert.match(run.stderr, /Use Workspace Version/);
  });

  it('gagal bila path tsdk tidak disetel', (t) => {
    const h = fixture(t);
    h.setSettings({ [PROMPT_KEY]: true });
    const run = h.run();

    assert.equal(run.code, 1);
    assert.match(run.stderr, new RegExp(TSDK_KEY.replace(/[/.]/g, '\\$&')));
  });

  it('gagal bila prompt versi workspace dimatikan', (t) => {
    const h = fixture(t);
    h.setSettings({ [TSDK_KEY]: WORKSPACE_TSDK, [PROMPT_KEY]: false });
    const run = h.run();

    assert.equal(run.code, 1);
    assert.match(run.stderr, /tidak pernah menawarkan versi workspace/);
  });

  it('gagal bila path menunjuk salinan TypeScript di luar repository', (t) => {
    const h = fixture(t);
    fs.mkdirSync(path.join(h.dir, 'lib', 'node_modules', 'typescript', 'lib'), { recursive: true });
    h.setSettings({ ...SETTINGS, [TSDK_KEY]: 'lib/node_modules/typescript/lib' });
    const run = h.run();

    assert.equal(run.code, 1);
    assert.match(run.stderr, /bukan node_modules\/typescript\/lib/);
  });

  it('gagal bila node_modules belum dipasang', (t) => {
    const h = fixture(t, { tsserver: false });
    const run = h.run();

    assert.equal(run.code, 1);
    assert.match(run.stderr, /tsserver\.js tidak ada/);
    assert.match(run.stderr, /npm ci/);
  });

  it('gagal bila versi terpasang tidak memenuhi pin devDependencies', (t) => {
    const h = fixture(t, { tsVersion: '6.1.0', pin: '~6.0.3', lockVersion: '6.1.0' });
    const run = h.run();

    assert.equal(run.code, 1);
    assert.match(run.stderr, /tidak memenuhi pin devDependencies/);
  });

  it('gagal bila node_modules berbeda dari lockfile yang dipakai CI', (t) => {
    const h = fixture(t, { tsVersion: '6.0.4', lockVersion: '6.0.3' });
    const run = h.run();

    assert.equal(run.code, 1);
    assert.match(run.stderr, /berbeda dari lockfile \(6\.0\.3\)/);
  });

  it('gagal bila lockfile tidak memuat entri TypeScript', (t) => {
    const h = fixture(t, { lockEntry: false });
    const run = h.run();

    assert.equal(run.code, 1);
    assert.match(run.stderr, /package-lock\.json tidak memuat versi/);
  });

  it('gagal bila settings.json bukan JSON yang sah', (t) => {
    const h = fixture(t);
    fs.writeFileSync(path.join(h.dir, '.vscode', 'settings.json'), '{ bukan json }\n');
    const run = h.run();

    assert.equal(run.code, 1);
    assert.match(run.stderr, /bukan JSON yang sah/);
  });
});
