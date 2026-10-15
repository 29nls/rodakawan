/**
 * Test untuk `scripts/update-changelog.mjs`: penyisipan catatan rilis ke
 * `CHANGELOG.md`.
 *
 * Yang dijaga di sini adalah sifat yang membuat job CI-nya aman diulang:
 * entri terbaru selalu di atas, isi lama tidak pernah berubah, rilis preview
 * diringkas, dan tag yang sudah tercatat tidak ditulis dua kali (job-nya
 * mencoba ulang setelah `git reset --hard origin/main`).
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  HEADER,
  demoteHeadings,
  hasSection,
  insertSection,
  sectionFor,
  todayUtc,
} from '../update-changelog.mjs';
import { createRepo, runScript } from './support/git-repo.mjs';

const NOTES =
  '## Fitur\n\n- tombol baru (`abc1234`)\n\n## Perbaikan\n\n- crash ditutup (`def5678`)\n';

/** Direktori kerja sementara dengan berkas catatan rilis di dalamnya. */
function workdir(t, notes = NOTES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sisa direktori temp tidak memengaruhi hasil test.
    }
  });

  fs.writeFileSync(path.join(dir, 'catatan.md'), notes);
  return dir;
}

const read = (dir, file = 'CHANGELOG.md') => fs.readFileSync(path.join(dir, file), 'utf8');
const update = (dir, args) => runScript(dir, 'update-changelog.mjs', args);

describe('fungsi pembentuk bagian', () => {
  it('menurunkan judul satu tingkat tanpa mengubah isi lain', () => {
    assert.equal(
      demoteHeadings(NOTES),
      '### Fitur\n\n- tombol baru (`abc1234`)\n\n### Perbaikan\n\n- crash ditutup (`def5678`)\n',
    );
    assert.equal(demoteHeadings('# A\n## B\n### C'), '## A\n### B\n#### C');
    assert.equal(demoteHeadings('- bukan judul'), '- bukan judul');
  });

  it('mengenali tag yang sudah punya bagian', () => {
    const content = '# Changelog\n\n## v1.0.0 — 2026-01-01\n\n- sesuatu\n';
    assert.equal(hasSection(content, 'v1.0.0'), true);
    assert.equal(hasSection(content, 'v1.0.1'), false);
    // Awalan yang mirip tidak dianggap sama.
    assert.equal(hasSection(content, 'v1.0'), false);
  });

  it('menyusun bagian produksi tanpa blok terlipat', () => {
    const section = sectionFor({ tag: 'v1.0.0', date: '2026-10-14', notes: NOTES });
    assert.ok(section.startsWith('## v1.0.0 — 2026-10-14\n\n### Fitur'));
    assert.ok(!section.includes('<details>'));
  });

  it('menyusun bagian preview di dalam blok terlipat', () => {
    const section = sectionFor({
      tag: 'v1.0.0-build2',
      date: '2026-10-14',
      notes: NOTES,
      preview: true,
    });
    assert.ok(section.startsWith('## v1.0.0-build2 — 2026-10-14 · pratinjau\n\n<details>\n'));
    assert.ok(section.includes('<summary>Catatan rilis pratinjau</summary>'));
    assert.ok(section.includes('### Fitur'));
    assert.ok(section.endsWith('</details>'));
  });

  it('menyisipkan bagian baru di bawah judul, bukan di akhir berkas', () => {
    const lama = '# Changelog\n\n## v1.0.0 — 2026-01-01\n\n- lama\n';
    const hasil = insertSection(
      lama,
      sectionFor({ tag: 'v1.1.0', date: '2026-10-14', notes: NOTES }),
    );

    assert.ok(hasil.startsWith('# Changelog\n\n## v1.1.0 — 2026-10-14\n'));
    assert.ok(hasil.endsWith('## v1.0.0 — 2026-01-01\n\n- lama\n'));
    assert.equal(hasil.split('\n').filter((line) => line === '# Changelog').length, 1);
  });

  it('tetap menambahkan bagian saat berkas belum punya judul', () => {
    const hasil = insertSection(
      '',
      sectionFor({ tag: 'v1.0.0', date: '2026-10-14', notes: NOTES }),
    );
    assert.ok(hasil.startsWith('## v1.0.0 — 2026-10-14\n'));
    assert.ok(hasil.endsWith('\n'));
  });

  it('memakai tanggal UTC hari ini sebagai default', () => {
    assert.equal(todayUtc(new Date('2026-10-14T23:59:59Z')), '2026-10-14');
    assert.equal(todayUtc(new Date('2026-10-15T00:00:01Z')), '2026-10-15');
    assert.match(todayUtc(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('berkas di repository', () => {
  it('CHANGELOG.md yang di-commit dimulai dengan judul dari script', () => {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    const content = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');

    // Judulnya harus sama dengan yang ditulis script, supaya berkas hasil rilis
    // pertama tidak berbeda bentuk dari berkas yang sudah di-commit.
    assert.ok(content.startsWith(HEADER), 'judul CHANGELOG.md tidak sama dengan HEADER di script');
  });
});

describe('CLI update-changelog.mjs', () => {
  it('membuat CHANGELOG.md lengkap dengan judul saat berkasnya belum ada', (t) => {
    const dir = workdir(t);
    const { stderr, code } = update(dir, [
      '--tag',
      'v0.1.0',
      '--notes',
      'catatan.md',
      '--date',
      '2026-10-14',
    ]);

    assert.equal(code, 0, stderr);
    const content = read(dir);
    assert.ok(content.startsWith('# Changelog\n'));
    assert.ok(content.includes('## v0.1.0 — 2026-10-14\n\n### Fitur\n'));
    assert.ok(content.endsWith('\n'));
    assert.ok(stderr.includes('Bagian v0.1.0 (produksi, 2026-10-14) disisipkan'), stderr);
  });

  it('menaruh rilis berikutnya di atas, tanpa mengubah bagian lama', (t) => {
    const dir = workdir(t);
    update(dir, [
      '--tag',
      'v0.1.0-build1',
      '--notes',
      'catatan.md',
      '--date',
      '2026-10-13',
      '--preview',
    ]);
    const setelahPreview = read(dir);

    update(dir, ['--tag', 'v0.1.0', '--notes', 'catatan.md', '--date', '2026-10-14']);

    const content = read(dir);
    assert.ok(
      content.indexOf('## v0.1.0 — 2026-10-14') <
        content.indexOf('## v0.1.0-build1 — 2026-10-13 · pratinjau'),
      'rilis produksi harus di atas build preview',
    );
    // Bagian lama tetap byte-per-byte sama.
    assert.ok(content.includes(setelahPreview.slice(setelahPreview.indexOf('## v0.1.0-build1'))));
  });

  it('tidak menulis dua kali untuk tag yang sama (idempoten)', (t) => {
    const dir = workdir(t);
    const args = [
      '--tag',
      'v0.1.0-build7',
      '--notes',
      'catatan.md',
      '--date',
      '2026-10-14',
      '--preview',
    ];
    update(dir, args);
    const pertama = read(dir);

    // Konten berbeda untuk tag yang sama: tetap tidak boleh mengubah berkas,
    // karena job-nya bisa mencoba ulang setelah reset ke origin/main.
    fs.writeFileSync(path.join(dir, 'catatan.md'), '## Fitur\n\n- isi lain (`9999999`)\n');
    const kedua = update(dir, args);

    assert.equal(kedua.code, 0, kedua.stderr);
    assert.equal(read(dir), pertama);
    assert.ok(kedua.stderr.includes('sudah memuat bagian v0.1.0-build7'), kedua.stderr);
    assert.equal(pertama.includes('9999999'), false);
  });

  it('membedakan tag yang mirip', (t) => {
    const dir = workdir(t);
    update(dir, [
      '--tag',
      'v0.1.0-build1',
      '--notes',
      'catatan.md',
      '--date',
      '2026-10-14',
      '--preview',
    ]);
    update(dir, [
      '--tag',
      'v0.1.0-build12',
      '--notes',
      'catatan.md',
      '--date',
      '2026-10-14',
      '--preview',
    ]);

    const content = read(dir);
    assert.equal(content.split('\n').filter((line) => line.startsWith('## ')).length, 2);
    assert.ok(content.includes('## v0.1.0-build12 — 2026-10-14 · pratinjau'));
  });

  it('percobaan ulang meninggalkan pohon yang bersih (guard git diff job changelog)', (t) => {
    const repo = createRepo(t);
    repo.commit('feat: awal');
    fs.writeFileSync(path.join(repo.dir, 'CHANGELOG.md'), '# Changelog\n\n');
    repo.git('add', 'CHANGELOG.md');
    repo.git('commit', '-q', '-m', 'docs: changelog awal');
    fs.writeFileSync(path.join(repo.dir, 'catatan.md'), NOTES);

    const args = ['--tag', 'v1.0.0', '--notes', 'catatan.md', '--date', '2026-10-14'];
    const pertama = update(repo.dir, args);
    assert.equal(pertama.code, 0, pertama.stderr);

    // Job men-commit hasilnya; setelah itu main bisa bergerak, sehingga job
    // mengulang dari origin/main. Pada percobaan ulang itu, `git diff --quiet
    // -- CHANGELOG.md` harus bersih — kalau tidak, setiap percobaan ulang akan
    // membuat commit kosong yang mengotori riwayat.
    repo.git('add', 'CHANGELOG.md');
    repo.git('commit', '-q', '-m', 'docs: catat rilis v1.0.0 di CHANGELOG.md [skip ci]');

    const ulang = update(repo.dir, args);
    assert.equal(ulang.code, 0, ulang.stderr);
    // Guard-nya sengaja dibatasi ke satu berkas: berkas catatan rilis diunduh ke
    // workspace dan tetap untracked, jadi `git status` tanpa cakupan memang tidak
    // pernah bersih.
    assert.equal(
      repo.git('status', '--porcelain', '--', 'CHANGELOG.md'),
      '',
      'CHANGELOG.md tidak boleh berubah',
    );
    assert.doesNotThrow(() => repo.git('diff', '--quiet', '--', 'CHANGELOG.md'));
    assert.equal(
      repo.git('diff', '--cached', '--name-only'),
      '',
      'tidak ada berkas yang ter-stage',
    );
  });

  it('commit job hanya menyentuh CHANGELOG.md, bukan berkas catatan', (t) => {
    const repo = createRepo(t);
    repo.commit('feat: awal');
    fs.writeFileSync(path.join(repo.dir, 'catatan.md'), NOTES);

    assert.equal(
      update(repo.dir, ['--tag', 'v1.0.0', '--notes', 'catatan.md', '--date', '2026-10-14']).code,
      0,
    );
    repo.git('add', 'CHANGELOG.md');
    repo.git('commit', '-q', '-m', 'docs: catat rilis v1.0.0 di CHANGELOG.md [skip ci]');

    assert.deepEqual(repo.git('show', '--name-only', '--format=', 'HEAD').split('\n'), [
      'CHANGELOG.md',
    ]);
    assert.equal(repo.git('status', '--porcelain', '--', 'catatan.md'), '?? catatan.md');
  });

  it('menghormati --path lain', (t) => {
    const dir = workdir(t);
    const { code } = update(dir, [
      '--tag',
      'v1.0.0',
      '--notes',
      'catatan.md',
      '--path',
      'docs/CATATAN.md',
    ]);

    assert.equal(code, 0);
    assert.ok(read(dir, 'docs/CATATAN.md').includes('## v1.0.0 — '));
    assert.equal(fs.existsSync(path.join(dir, 'CHANGELOG.md')), false);
  });

  it('menolak pemakaian yang tidak lengkap atau keliru', (t) => {
    const dir = workdir(t);
    fs.writeFileSync(path.join(dir, 'kosong.md'), '   \n');

    const tanpaTag = update(dir, ['--notes', 'catatan.md']);
    assert.equal(tanpaTag.code, 1);
    assert.ok(tanpaTag.stderr.includes('Opsi --tag wajib diisi.'), tanpaTag.stderr);

    const tanpaNotes = update(dir, ['--tag', 'v1.0.0']);
    assert.equal(tanpaNotes.code, 1);
    assert.ok(tanpaNotes.stderr.includes('Opsi --notes wajib diisi.'), tanpaNotes.stderr);

    const nilaiHilang = update(dir, ['--tag', 'v1.0.0', '--notes']);
    assert.equal(nilaiHilang.code, 1);
    assert.ok(
      nilaiHilang.stderr.includes('Opsi --notes membutuhkan sebuah berkas catatan rilis.'),
      nilaiHilang.stderr,
    );

    const tidakDikenal = update(dir, ['--tag', 'v1.0.0', '--notes', 'catatan.md', '--previews']);
    assert.equal(tidakDikenal.code, 1);
    assert.ok(
      tidakDikenal.stderr.includes('Argumen tidak dikenal: --previews'),
      tidakDikenal.stderr,
    );

    const tanggalSalah = update(dir, [
      '--tag',
      'v1.0.0',
      '--notes',
      'catatan.md',
      '--date',
      '14-10-2026',
    ]);
    assert.equal(tanggalSalah.code, 1);
    assert.ok(
      tanggalSalah.stderr.includes('Tanggal tidak dikenali: 14-10-2026'),
      tanggalSalah.stderr,
    );

    const berkasHilang = update(dir, ['--tag', 'v1.0.0', '--notes', 'tidak-ada.md']);
    assert.equal(berkasHilang.code, 1);
    assert.ok(
      berkasHilang.stderr.includes('Berkas catatan rilis tidak bisa dibaca: tidak-ada.md'),
      berkasHilang.stderr,
    );

    const catatanKosong = update(dir, ['--tag', 'v1.0.0', '--notes', 'kosong.md']);
    assert.equal(catatanKosong.code, 1);
    assert.ok(
      catatanKosong.stderr.includes('Berkas catatan rilis kosong: kosong.md'),
      catatanKosong.stderr,
    );

    // Tidak satu pun percobaan di atas boleh meninggalkan berkas setengah jadi.
    assert.equal(fs.existsSync(path.join(dir, 'CHANGELOG.md')), false);
  });

  it('menangani catatan berisi hanya pesan kosong', (t) => {
    const dir = workdir(t, '_Tidak ada perubahan tercatat sejak rilis sebelumnya._\n');
    const { code, stderr } = update(dir, [
      '--tag',
      'v1.0.0-build1',
      '--notes',
      'catatan.md',
      '--date',
      '2026-10-14',
      '--preview',
    ]);

    assert.equal(code, 0, stderr);
    assert.ok(read(dir).includes('_Tidak ada perubahan tercatat sejak rilis sebelumnya._'));
  });
});
