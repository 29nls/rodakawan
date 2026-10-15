/**
 * Test untuk `scripts/release-notes.mjs`: pengelompokan commit (feat/fix/selain
 * itu), penandaan perubahan merusak, dan pemilihan rentang commit.
 *
 * Dua lapis:
 * - fungsi murni (`classifyCommit`, `isBreakingChange`, `renderReleaseNotes`)
 *   diuji langsung, sehingga kegagalannya menunjuk ke satu aturan;
 * - CLI-nya dijalankan di repository git sementara, karena parsing keluaran
 *   `git log` (pemisah NUL, badan commit multi-baris) hanya terbukti benar
 *   terhadap git sungguhan.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyCommit,
  isBookkeeping,
  isBreakingChange,
  renderReleaseNotes,
} from '../release-notes.mjs';
import { createRepo, runScript } from './support/git-repo.mjs';

const BREAKING_TITLE = '## ⚠️ Perubahan yang Merusak (Breaking Changes)';

/** Entri daftar di dalam satu bagian, atau `null` bila bagiannya tidak ada. */
function entriesOf(stdout, heading) {
  const lines = stdout.split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.startsWith('- '));
}

describe('classifyCommit', () => {
  const cases = [
    // subject, body, hasil yang diharapkan
    [
      'feat: tombol baru',
      '',
      { section: 'feature', text: 'tombol baru', breaking: false, type: 'feat' },
    ],
    [
      'feat(ui): kartu baru',
      '',
      { section: 'feature', text: 'ui: kartu baru', breaking: false, type: 'feat' },
    ],
    [
      'FEAT: huruf besar',
      '',
      { section: 'feature', text: 'huruf besar', breaking: false, type: 'feat' },
    ],
    [
      'fix: perbaiki crash',
      '',
      { section: 'fix', text: 'perbaiki crash', breaking: false, type: 'fix' },
    ],
    [
      'chore: bersih-bersih',
      '',
      { section: 'other', text: 'bersih-bersih', breaking: false, type: 'chore' },
    ],
    ['docs: catatan', '', { section: 'other', text: 'catatan', breaking: false, type: 'docs' }],
    [
      'perf(cache): kurangi alokasi',
      '',
      { section: 'other', text: 'cache: kurangi alokasi', breaking: false, type: 'perf' },
    ],
    ['pertama', '', { section: 'other', text: 'pertama', breaking: false, type: null }],
    // Tanda `!` sebelum titik dua menandai perubahan merusak.
    [
      'feat!: hapus API lama',
      '',
      { section: 'feature', text: 'hapus API lama', breaking: true, type: 'feat' },
    ],
    [
      'fix(api)!: ubah bentuk respons',
      '',
      { section: 'fix', text: 'api: ubah bentuk respons', breaking: true, type: 'fix' },
    ],
    [
      'chore!: buang skrip',
      '',
      { section: 'other', text: 'buang skrip', breaking: true, type: 'chore' },
    ],
    // Tanda seru yang bukan penanda tidak dihitung.
    [
      'fix: tangani tanda seru ! di teks',
      '',
      { section: 'fix', text: 'tangani tanda seru ! di teks', breaking: false, type: 'fix' },
    ],
    // Footer penanda, di mana pun di dalam pesan.
    [
      'feat: tombol',
      'BREAKING CHANGE: tombol pindah',
      { section: 'feature', text: 'tombol', breaking: true, type: 'feat' },
    ],
    [
      'feat: tombol',
      'BREAKING-CHANGE: tombol pindah',
      { section: 'feature', text: 'tombol', breaking: true, type: 'feat' },
    ],
    [
      'feat: tombol',
      'Konteks.\n\n  BREAKING CHANGE: tombol pindah',
      { section: 'feature', text: 'tombol', breaking: true, type: 'feat' },
    ],
    [
      'BREAKING CHANGE: hapus endpoint',
      '',
      { section: 'other', text: 'BREAKING CHANGE: hapus endpoint', breaking: true, type: null },
    ],
    // Frasa yang hanya disebut di tengah baris bukan footer.
    [
      'feat: tombol',
      'lihat BREAKING CHANGE: di atas',
      { section: 'feature', text: 'tombol', breaking: false, type: 'feat' },
    ],
  ];

  for (const [subject, body, expected] of cases) {
    it(`${JSON.stringify(subject)}${body === '' ? '' : ' + badan'}`, () => {
      assert.deepEqual(classifyCommit(subject, body), expected);
    });
  }

  it('badan commit bersifat opsional', () => {
    assert.equal(classifyCommit('feat: tombol').breaking, false);
  });
});

describe('isBreakingChange', () => {
  it('menerima kedua bentuk penanda dan menolak sebutan biasa', () => {
    assert.equal(isBreakingChange('feat!: x'), true);
    assert.equal(isBreakingChange('feat(api)!: x'), true);
    assert.equal(isBreakingChange('feat: x', 'BREAKING CHANGE: y'), true);
    assert.equal(isBreakingChange('feat: x', 'BREAKING-CHANGE: y'), true);
    assert.equal(isBreakingChange('feat: x'), false);
    assert.equal(isBreakingChange('feat: x', 'lihat BREAKING CHANGE: y'), false);
    // Tanpa header konvensional, `!` di judul bukan penanda.
    assert.equal(isBreakingChange('hapus API!'), false);
  });
});

describe('isBookkeeping', () => {
  it('mengenali penanda [skip ci] yang dipakai workflow rilis', () => {
    assert.equal(isBookkeeping('docs: catat rilis v0.2.0 di CHANGELOG.md [skip ci]'), true);
    // Himpunan yang dikenali GitHub, tanpa membedakan huruf besar/kecil.
    assert.equal(isBookkeeping('chore: [CI SKIP] rapikan templat'), true);
    assert.equal(isBookkeeping('chore: [no ci] rapikan templat'), true);
    assert.equal(isBookkeeping('chore: [skip actions] rapikan templat'), true);
    assert.equal(isBookkeeping('chore: [actions skip] rapikan templat'), true);
  });

  it('tidak membuang commit biasa', () => {
    assert.equal(isBookkeeping('feat: tombol baru'), false);
    assert.equal(isBookkeeping('docs: tulis cara melewati CI'), false);
    assert.equal(isBookkeeping('fix: skip ci tanpa tanda kurung'), false);
    assert.equal(isBookkeeping('pertama'), false);
  });

  it('ikut melewati subjek yang hanya menyebut penandanya', () => {
    // Sama seperti GitHub yang mencocokkannya sebagai teks biasa: commit ini
    // memang tidak akan menjalankan CI, jadi tidak masuk catatan rilis.
    assert.equal(isBookkeeping('fix: hilangkan [skip ci] dari templat'), true);
  });
});

describe('renderReleaseNotes', () => {
  it('memakai pesan khusus saat tidak ada commit', () => {
    assert.equal(
      renderReleaseNotes([]),
      '_Tidak ada perubahan tercatat sejak rilis sebelumnya._\n',
    );
  });

  it('menaruh bagian merusak paling atas dan tidak mengulanginya di kelompok lain', () => {
    const notes = renderReleaseNotes([
      { sha: 'aaaaaaa', subject: 'feat: tombol baru' },
      { sha: 'bbbbbbb', subject: 'fix(api)!: ubah bentuk respons', body: '' },
      { sha: 'ccccccc', subject: 'Rombak skema', body: 'BREAKING CHANGE: tabel berubah' },
      { sha: 'ddddddd', subject: 'chore: bersih-bersih' },
    ]);

    assert.equal(notes.indexOf(BREAKING_TITLE), 0, 'bagian merusak harus paling atas');
    assert.ok(notes.indexOf(BREAKING_TITLE) < notes.indexOf('## Fitur'));
    assert.deepEqual(entriesOf(notes, BREAKING_TITLE), [
      '- **fix: api: ubah bentuk respons** (`bbbbbbb`)',
      // Subject tanpa awalan konvensional tidak punya tipe untuk disebut.
      '- **Rombak skema** (`ccccccc`)',
    ]);
    assert.deepEqual(entriesOf(notes, '## Fitur'), ['- tombol baru (`aaaaaaa`)']);
    assert.deepEqual(entriesOf(notes, '## Perubahan lain'), ['- bersih-bersih (`ddddddd`)']);
    assert.equal(entriesOf(notes, '## Perbaikan'), null, 'fix merusak tidak diulang di Perbaikan');
  });

  it('tidak membocorkan badan commit ke entri', () => {
    const notes = renderReleaseNotes([
      { sha: 'aaaaaaa', subject: 'feat: satu', body: 'Rincian:\n\t- pertama\n\t- kedua' },
      { sha: 'bbbbbbb', subject: 'fix: dua' },
    ]);

    assert.deepEqual(entriesOf(notes, '## Fitur'), ['- satu (`aaaaaaa`)']);
    assert.deepEqual(entriesOf(notes, '## Perbaikan'), ['- dua (`bbbbbbb`)']);
    assert.ok(!notes.includes('Rincian'));
    assert.ok(!notes.includes('pertama'));
  });

  it('hanya mencetak bagian yang berisi', () => {
    const notes = renderReleaseNotes([{ sha: 'aaaaaaa', subject: 'fix: hanya perbaikan' }]);
    assert.deepEqual(entriesOf(notes, '## Perbaikan'), ['- hanya perbaikan (`aaaaaaa`)']);
    assert.equal(entriesOf(notes, '## Fitur'), null);
    assert.equal(entriesOf(notes, BREAKING_TITLE), null);
  });
});

describe('CLI release-notes.mjs', () => {
  /** Repo dengan tag `v1.0.0` lalu sepuluh commit: empat di antaranya merusak. */
  function createRepoWithHistory(t) {
    const repo = createRepo(t);
    repo.commit('feat: lama sekali');
    repo.tag('v1.0.0');

    const shas = {
      a: repo.commit('feat: tombol baru'),
      b: repo.commit(
        'fix(api)!: ubah bentuk respons\n\nPenjelasan singkat.\n\nBREAKING CHANGE: respons kini array',
      ),
      c: repo.commit('chore: bersih-bersih'),
      d: repo.commit('feat(ui): kartu baru'),
      e: repo.commit('Rombak skema kendaraan\n\nBREAKING-CHANGE: tabel vehicles berubah'),
      f: repo.commit(
        'docs: sebut frasa penanda di prosa\n\nlihat penjelasan BREAKING CHANGE: di atas',
      ),
      g: repo.commit('fix: tangani tanda seru ! di teks'),
      h: repo.commit('feat!: hapus API lama\n\nRincian:\n\t- satu\n\t- dua'),
      i: repo.commit('perf(cache): kurangi alokasi'),
      j: repo.commit('BREAKING CHANGE: header berbentuk footer'),
    };

    return { repo, shas };
  }

  it('mengelompokkan commit sejak tag rilis terakhir', (t) => {
    const { repo, shas } = createRepoWithHistory(t);
    const { stdout, stderr, code } = runScript(repo.dir, 'release-notes.mjs');

    assert.equal(code, 0, stderr);
    assert.deepEqual(entriesOf(stdout, BREAKING_TITLE), [
      `- **BREAKING CHANGE: header berbentuk footer** (\`${shas.j}\`)`,
      `- **feat: hapus API lama** (\`${shas.h}\`)`,
      `- **Rombak skema kendaraan** (\`${shas.e}\`)`,
      `- **fix: api: ubah bentuk respons** (\`${shas.b}\`)`,
    ]);
    assert.deepEqual(entriesOf(stdout, '## Fitur'), [
      `- ui: kartu baru (\`${shas.d}\`)`,
      `- tombol baru (\`${shas.a}\`)`,
    ]);
    assert.deepEqual(entriesOf(stdout, '## Perbaikan'), [
      `- tangani tanda seru ! di teks (\`${shas.g}\`)`,
    ]);
    assert.deepEqual(entriesOf(stdout, '## Perubahan lain'), [
      `- cache: kurangi alokasi (\`${shas.i}\`)`,
      `- sebut frasa penanda di prosa (\`${shas.f}\`)`,
      `- bersih-bersih (\`${shas.c}\`)`,
    ]);
    assert.ok(!stdout.includes('lama sekali'), 'commit sebelum tag tidak ikut');
    assert.ok(
      stderr.includes(
        'Catatan rilis v1.0.0..HEAD — 10 commit tanpa merge, 4 di antaranya merusak kompatibilitas.',
      ),
      stderr,
    );
  });

  it('badan multi-baris dengan tab tidak merusak entri sekitarnya', (t) => {
    const { repo, shas } = createRepoWithHistory(t);
    const { stdout } = runScript(repo.dir, 'release-notes.mjs');
    const entries = [
      ...(entriesOf(stdout, BREAKING_TITLE) ?? []),
      ...(entriesOf(stdout, '## Fitur') ?? []),
      ...(entriesOf(stdout, '## Perbaikan') ?? []),
      ...(entriesOf(stdout, '## Perubahan lain') ?? []),
    ];

    assert.equal(entries.length, 10);
    assert.equal(new Set(entries).size, 10, 'tidak ada entri ganda');
    assert.ok(
      entries.every((entry) => / \(`[0-9a-f]{7,}`\)$/.test(entry)),
      JSON.stringify(entries),
    );
    assert.ok(
      !entries.some((entry) => /Rincian|satu|dua|Penjelasan|vehicles/.test(entry)),
      JSON.stringify(entries),
    );
    assert.deepEqual(
      entriesOf(stdout, '## Perubahan lain')[0],
      `- cache: kurangi alokasi (\`${shas.i}\`)`,
    );
  });

  it('memakai seluruh riwayat bila belum ada tag rilis', (t) => {
    const repo = createRepo(t);
    repo.commit('feat!: rilis pertama sudah merusak');

    const { stdout, stderr, code } = runScript(repo.dir, 'release-notes.mjs');

    assert.equal(code, 0, stderr);
    assert.ok(stdout.startsWith(BREAKING_TITLE));
    assert.deepEqual(entriesOf(stdout, BREAKING_TITLE), [
      '- **feat: rilis pertama sudah merusak** (`' +
        repo.git('rev-parse', '--short', 'HEAD') +
        '`)',
    ]);
    assert.ok(stderr.includes('Catatan rilis (awal riwayat)..HEAD — 1 commit tanpa merge'));
  });

  it('menghormati rentang eksplisit --from/--to', (t) => {
    const { repo, shas } = createRepoWithHistory(t);
    const { stdout, stderr, code } = runScript(repo.dir, 'release-notes.mjs', [
      '--from',
      'v1.0.0',
      '--to',
      shas.a,
    ]);

    assert.equal(code, 0, stderr);
    assert.deepEqual(entriesOf(stdout, '## Fitur'), [`- tombol baru (\`${shas.a}\`)`]);
    assert.equal(entriesOf(stdout, BREAKING_TITLE), null);
    assert.ok(stderr.includes(`Catatan rilis v1.0.0..${shas.a} — 1 commit tanpa merge.`), stderr);
  });

  it('mencetak pesan khusus untuk rentang kosong', (t) => {
    const { repo } = createRepoWithHistory(t);
    const { stdout, code } = runScript(repo.dir, 'release-notes.mjs', [
      '--from',
      'HEAD',
      '--to',
      'HEAD',
    ]);

    assert.equal(code, 0);
    assert.equal(stdout, '_Tidak ada perubahan tercatat sejak rilis sebelumnya._\n');
  });

  it('melewati commit pembukuan CHANGELOG, bukan melaporkannya sebagai perubahan', (t) => {
    const repo = createRepo(t);
    repo.commit('feat: awal');
    repo.tag('v1.0.0');
    const fitur = repo.commit('feat: tombol baru');
    repo.commit('docs: catat rilis v0.1.0 di CHANGELOG.md [skip ci]');
    const perbaikan = repo.commit('fix: perbaiki crash');
    repo.commit('chore: [ci skip] rapikan templat');

    const { stdout, stderr, code } = runScript(repo.dir, 'release-notes.mjs');

    assert.equal(code, 0, stderr);
    assert.deepEqual(entriesOf(stdout, '## Fitur'), [`- tombol baru (\`${fitur}\`)`]);
    assert.deepEqual(entriesOf(stdout, '## Perbaikan'), [`- perbaiki crash (\`${perbaikan}\`)`]);
    assert.equal(entriesOf(stdout, '## Perubahan lain'), null);
    assert.ok(!stdout.includes('CHANGELOG'), stdout);
    // Jumlah yang dilewati tetap disebut di log supaya commit yang tidak muncul
    // bisa ditelusuri; angka pertama hanya menghitung yang benar-benar dicatat.
    assert.ok(
      stderr.includes(
        'Catatan rilis v1.0.0..HEAD — 2 commit tanpa merge; 2 commit pembukuan ([skip ci]) dilewati.',
      ),
      stderr,
    );
  });

  it('menggabungkan laporan perubahan merusak dengan jumlah pembukuan yang dilewati', (t) => {
    const repo = createRepo(t);
    repo.commit('feat: awal');
    repo.tag('v1.0.0');
    repo.commit('feat!: hapus API lama');
    repo.commit('docs: catat rilis v0.1.0 di CHANGELOG.md [skip ci]');

    const { stderr, code } = runScript(repo.dir, 'release-notes.mjs');

    assert.equal(code, 0, stderr);
    assert.ok(
      stderr.includes(
        'Catatan rilis v1.0.0..HEAD — 1 commit tanpa merge, 1 di antaranya merusak kompatibilitas; ' +
          '1 commit pembukuan ([skip ci]) dilewati.',
      ),
      stderr,
    );
  });

  it('menolak argumen yang tidak dikenal dan opsi tanpa nilai', (t) => {
    const { repo } = createRepoWithHistory(t);

    const unknown = runScript(repo.dir, 'release-notes.mjs', ['--tag-excludes', 'v*']);
    assert.equal(unknown.code, 1);
    assert.ok(unknown.stderr.includes('Argumen tidak dikenal: --tag-excludes'), unknown.stderr);

    const missing = runScript(repo.dir, 'release-notes.mjs', ['--to']);
    assert.equal(missing.code, 1);
    assert.ok(missing.stderr.includes('Opsi --to membutuhkan sebuah ref.'), missing.stderr);

    const missingGlob = runScript(repo.dir, 'release-notes.mjs', ['--tag-exclude']);
    assert.equal(missingGlob.code, 1);
    assert.ok(
      missingGlob.stderr.includes('Opsi --tag-exclude membutuhkan sebuah pola glob.'),
      missingGlob.stderr,
    );
  });

  it('gagal dengan jelas bila ref-nya tidak ada', (t) => {
    const { repo } = createRepoWithHistory(t);
    const { code, stderr } = runScript(repo.dir, 'release-notes.mjs', ['--to', 'ref-tidak-ada']);

    assert.equal(code, 1);
    assert.ok(stderr.includes('Perintah git gagal: git log'), stderr);
  });

  describe('batas bawah rentang', () => {
    /** Rilis produksi `v1.0.0`, dua build preview, lalu satu commit baru. */
    function createRepoWithPreviewTags(t) {
      const repo = createRepo(t);
      repo.commit('feat: awal');
      repo.tag('v1.0.0');
      const satu = repo.commit('fix: satu');
      repo.commit('feat!: dua');
      repo.tag('v1.0.0-build1');
      repo.commit('docs: tiga');
      repo.commit('feat: empat');
      repo.tag('v1.0.0-build2');
      const lima = repo.commit('fix: lima');

      return { repo, satu, lima };
    }

    it('melewati tag build preview di jalur rilis produksi', (t) => {
      const { repo, satu, lima } = createRepoWithPreviewTags(t);
      const { stdout, stderr, code } = runScript(repo.dir, 'release-notes.mjs', [
        '--tag-exclude',
        'v*-build*',
      ]);

      assert.equal(code, 0, stderr);
      assert.ok(
        stderr.includes(
          'Catatan rilis v1.0.0..HEAD — 5 commit tanpa merge, 1 di antaranya merusak kompatibilitas.',
        ),
        stderr,
      );
      assert.deepEqual(entriesOf(stdout, BREAKING_TITLE), [
        '- **feat: dua** (`' + repo.git('rev-parse', '--short', 'v1.0.0-build1') + '`)',
      ]);
      assert.deepEqual(entriesOf(stdout, '## Perbaikan'), [
        `- lima (\`${lima}\`)`,
        `- satu (\`${satu}\`)`,
      ]);
      assert.ok(!stdout.includes('awal'), 'commit sebelum rilis produksi tidak ikut');
    });

    it('tanpa pengecualian, batas bawahnya rilis terakhir jenis apa pun', (t) => {
      const { repo, lima } = createRepoWithPreviewTags(t);
      const { stdout, stderr, code } = runScript(repo.dir, 'release-notes.mjs');

      assert.equal(code, 0, stderr);
      assert.ok(
        stderr.includes('Catatan rilis v1.0.0-build2..HEAD — 1 commit tanpa merge.'),
        stderr,
      );
      assert.deepEqual(entriesOf(stdout, '## Perbaikan'), [`- lima (\`${lima}\`)`]);
    });

    it('menggabungkan beberapa pola pengecualian', (t) => {
      const { repo } = createRepoWithPreviewTags(t);
      const { stderr, code } = runScript(repo.dir, 'release-notes.mjs', [
        '--tag-exclude',
        'v*-build*',
        '--tag-exclude',
        'v1.0.0',
      ]);

      assert.equal(code, 0, stderr);
      assert.ok(
        stderr.includes('Catatan rilis (awal riwayat)..HEAD — 6 commit tanpa merge'),
        stderr,
      );
    });

    it('--from eksplisit mengabaikan pengecualian tag', (t) => {
      const { repo } = createRepoWithPreviewTags(t);
      const { stderr, code } = runScript(repo.dir, 'release-notes.mjs', [
        '--from',
        'v1.0.0-build2',
        '--tag-exclude',
        'v*-build*',
      ]);

      assert.equal(code, 0, stderr);
      assert.ok(
        stderr.includes('Catatan rilis v1.0.0-build2..HEAD — 1 commit tanpa merge.'),
        stderr,
      );
    });
  });
});
