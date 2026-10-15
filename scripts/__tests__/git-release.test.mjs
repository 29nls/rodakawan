/**
 * Test untuk `scripts/lib/git-release.mjs`: pembacaan argumen rentang dan
 * pencarian tag rilis sebelumnya (`resolvePreviousTag`) — dasar batas bawah
 * catatan rilis dan gate `should-release.mjs`.
 *
 * `resolvePreviousTag` membaca repository lewat `process.cwd()`, jadi setiap
 * pemanggilannya dijalankan di dalam proses Node terpisah dengan cwd repo
 * sementara (lihat `evalInRepo`): tidak ada `process.chdir`, sehingga test tetap
 * aman bila kelak dijalankan paralel.
 *
 * Jalur galat `parseRangeArgs` (yang memanggil `process.exit`) diuji lewat CLI
 * `release-notes.mjs` di `release-notes.test.mjs`, bukan di sini — memanggilnya
 * langsung akan menghentikan proses test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseRangeArgs } from '../lib/git-release.mjs';
import { createRepo, evalInRepo, scriptUrl } from './support/git-repo.mjs';

const LIB = scriptUrl('lib/git-release.mjs');
const USAGE = 'Pemakaian: uji';

/** Menjalankan `resolvePreviousTag` di dalam repo itu dan mengembalikan nilainya. */
function previousTag(repo, to, excludes = []) {
  const result = evalInRepo(
    repo.dir,
    `import { resolvePreviousTag } from ${JSON.stringify(LIB)};\n` +
      `process.stdout.write(String(resolvePreviousTag(${JSON.stringify(to)}, ${JSON.stringify(excludes)})));`,
  );

  assert.equal(result.code, 0, result.stderr);
  assert.notEqual(result.stdout, 'undefined', result.stdout);
  return result.stdout === 'null' ? null : result.stdout;
}

describe('parseRangeArgs', () => {
  it('memakai default saat tidak ada opsi', () => {
    assert.deepEqual(parseRangeArgs([], USAGE), { from: null, to: 'HEAD', tagExcludes: [] });
  });

  it('membaca --from dan --to', () => {
    assert.deepEqual(parseRangeArgs(['--from', 'v1.0.0', '--to', 'v1.1.0'], USAGE), {
      from: 'v1.0.0',
      to: 'v1.1.0',
      tagExcludes: [],
    });
  });

  it('hanya mengganti opsi yang disebut', () => {
    assert.deepEqual(parseRangeArgs(['--to', 'main'], USAGE), {
      from: null,
      to: 'main',
      tagExcludes: [],
    });
    assert.deepEqual(parseRangeArgs(['--from', 'v1.0.0'], USAGE), {
      from: 'v1.0.0',
      to: 'HEAD',
      tagExcludes: [],
    });
  });

  it('mengumpulkan --tag-exclude yang diulang, dalam urutan pemakaian', () => {
    assert.deepEqual(
      parseRangeArgs(['--tag-exclude', 'v*-build*', '--to', 'HEAD', '--tag-exclude', 'v0.*'], USAGE)
        .tagExcludes,
      ['v*-build*', 'v0.*'],
    );
  });

  it('nilai yang mirip nama opsi tetap dianggap nilai', () => {
    const options = parseRangeArgs(['--tag-exclude', 'v*'], USAGE);
    assert.deepEqual(options.tagExcludes, ['v*']);
    assert.equal(options.to, 'HEAD');
  });
});

describe('resolvePreviousTag', () => {
  /**
   * Repo: `v0.9.0` → `v1.0.0-build1` → satu commit tanpa tag (HEAD).
   * Urutannya sengaja meniru riwayat nyata proyek ini: tag produksi lebih tua,
   * tag build preview lebih dekat ke HEAD.
   */
  function createTaggedRepo(t) {
    const repo = createRepo(t);
    repo.commit('feat: awal');
    repo.tag('v0.9.0');
    repo.commit('feat: berikutnya');
    repo.tag('v1.0.0-build1');
    repo.commit('fix: terbaru');
    return repo;
  }

  it('mengembalikan tag terdekat di riwayat', (t) => {
    const repo = createTaggedRepo(t);
    assert.equal(previousTag(repo, 'HEAD'), 'v1.0.0-build1');
  });

  it('melewati pola yang dikecualikan sehingga tag produksi terpilih', (t) => {
    const repo = createTaggedRepo(t);
    assert.equal(previousTag(repo, 'HEAD', ['v*-build*']), 'v0.9.0');
  });

  it('menggabungkan beberapa pola pengecualian', (t) => {
    const repo = createTaggedRepo(t);
    assert.equal(previousTag(repo, 'HEAD', ['v1.0.0-build1', 'v0.9.0']), null);
  });

  it('melewati tag yang menempel di commit batas itu sendiri', (t) => {
    const repo = createTaggedRepo(t);
    // Tag `v1.0.0-build1` ada di HEAD^; dipakai sebagai batas, tag itu harus
    // dilewati sehingga yang terpilih adalah rilis sebelumnya.
    assert.equal(previousTag(repo, 'v1.0.0-build1'), 'v0.9.0');
  });

  it('mengembalikan null bila belum ada tag rilis sama sekali', (t) => {
    const repo = createRepo(t);
    repo.commit('feat: pertama');
    assert.equal(previousTag(repo, 'HEAD'), null);
  });

  it('mengabaikan tag yang bukan berawalan v', (t) => {
    const repo = createRepo(t);
    repo.commit('feat: pertama');
    repo.tag('catatan-rilis-2026');
    assert.equal(previousTag(repo, 'HEAD'), null);
  });

  it('mengembalikan null untuk ref yang tidak ada', (t) => {
    const repo = createTaggedRepo(t);
    assert.equal(previousTag(repo, 'ref-tidak-ada'), null);
  });
});
