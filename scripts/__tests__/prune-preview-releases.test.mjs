/**
 * Test untuk `scripts/prune-preview-releases.mjs`: pemangkasan rilis preview lama.
 *
 * Dua lapis, sama seperti test script rilis lain:
 * - fungsi murni (`isPreviewRelease`, `selectReleasesToPrune`) diuji langsung,
 *   karena keputusan "hapus atau pertahankan" itulah inti keamanan script ini;
 * - CLI-nya dijalankan sungguhan dengan `gh` tiruan (`support/fake-gh.mjs`), karena
 *   yang menentukan bukan keputusannya saja melainkan perintah yang benar-benar
 *   dikirim ke GitHub — rilis mana yang dihapus, dan rilis mana yang tidak pernah
 *   tersentuh.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { isPreviewRelease, selectReleasesToPrune } from '../prune-preview-releases.mjs';
import { runScript } from './support/git-repo.mjs';

/** Rilis preview `v0.1.0-build<n>` dengan waktu naik seiring nomor build. */
function preview(build, { tagName = `v0.1.0-build${build}`, isPrerelease = true } = {}) {
  return {
    tagName,
    isPrerelease,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, build)).toISOString(),
  };
}

const PRODUKSI = { tagName: 'v0.2.0', isPrerelease: false, createdAt: '2026-10-05T00:00:00Z' };
const KANDIDAT = { tagName: 'v1.0.0-rc1', isPrerelease: true, createdAt: '2026-10-06T00:00:00Z' };

/** Direktori kerja sementara plus skenario untuk gh tiruan. */
function harness(t, scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pangkas-rilis-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sisa direktori temp tidak memengaruhi hasil test.
    }
  });

  const scenarioFile = path.join(dir, 'skenario.json');
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
  const logFile = path.join(dir, 'gh.log');
  fs.writeFileSync(logFile, '');

  return {
    dir,
    /** Setiap pemanggilan gh, berurutan, dalam bentuk argv. */
    commands: () =>
      fs
        .readFileSync(logFile, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line)),
    run: (args) =>
      runScript(dir, 'prune-preview-releases.mjs', args, {
        env: {
          GH_CMD: JSON.stringify([
            process.execPath,
            path.resolve(import.meta.dirname, 'support', 'fake-gh.mjs'),
          ]),
          SMOKE_FAKE_GH_SCENARIO: scenarioFile,
          SMOKE_FAKE_GH_LOG: logFile,
        },
      }),
  };
}

/** Tag yang benar-benar dihapus, menurut catatan pemanggilan gh. */
const deletedTags = (commands) =>
  commands
    .filter((argv) => argv[1] === 'delete')
    .map((argv) => argv[2])
    .sort();

describe('isPreviewRelease', () => {
  it('hanya menerima prerelease bertag build preview', () => {
    assert.equal(isPreviewRelease(preview(3)), true);
    assert.equal(isPreviewRelease(PRODUKSI), false);
    // Tag berbentuk preview tetapi rilisnya bukan prerelease: dipertahankan.
    assert.equal(isPreviewRelease({ ...preview(3), isPrerelease: false }), false);
    // Kandidat rilis buatan manusia: dipertahankan.
    assert.equal(isPreviewRelease(KANDIDAT), false);
    assert.equal(isPreviewRelease({ tagName: 'v0.1.0-build', isPrerelease: true }), false);
    assert.equal(isPreviewRelease({ tagName: 'v0.1.0-build3x', isPrerelease: true }), false);
    assert.equal(isPreviewRelease({ tagName: 'release-2026-10-14', isPrerelease: true }), false);
    assert.equal(isPreviewRelease(null), false);
    assert.equal(isPreviewRelease({}), false);
  });
});

describe('selectReleasesToPrune', () => {
  const sepuluh = Array.from({ length: 10 }, (_, index) => preview(index + 1));

  it('menyimpan yang terbaru dan memangkas sisanya', () => {
    const hasil = selectReleasesToPrune([...sepuluh, preview(11), preview(12)], { keep: 10 });
    assert.deepEqual(
      hasil.kept.map((release) => release.tagName),
      [12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map((build) => `v0.1.0-build${build}`),
    );
    assert.deepEqual(
      hasil.pruned.map((release) => release.tagName),
      ['v0.1.0-build2', 'v0.1.0-build1'],
    );
  });

  it('mengurutkan sendiri, tidak mempercayai urutan masukan', () => {
    // Urutan terbalik (terlama dulu) — bila dipercaya apa adanya, yang terhapus
    // justru build terbaru.
    const hasil = selectReleasesToPrune([preview(1), preview(2), preview(3)], { keep: 1 });
    assert.deepEqual(
      hasil.kept.map((release) => release.tagName),
      ['v0.1.0-build3'],
    );
    assert.deepEqual(
      hasil.pruned.map((release) => release.tagName),
      ['v0.1.0-build2', 'v0.1.0-build1'],
    );
  });

  it('memecah waktu yang sama dengan nomor build, bukan urutan teks', () => {
    const sama = ['v0.1.0-build9', 'v0.1.0-build12'].map((tagName) => ({
      tagName,
      isPrerelease: true,
      createdAt: '2026-10-07T00:00:00Z',
    }));
    const hasil = selectReleasesToPrune(sama, { keep: 1 });
    assert.deepEqual(
      hasil.kept.map((release) => release.tagName),
      ['v0.1.0-build12'],
    );
  });

  it('tidak menyentuh rilis produksi maupun tag yang tidak dikenal', () => {
    const hasil = selectReleasesToPrune([PRODUKSI, KANDIDAT, ...sepuluh, preview(11)], {
      keep: 10,
    });
    assert.deepEqual(hasil.protected.map((release) => release.tagName).sort(), [
      'v0.2.0',
      'v1.0.0-rc1',
    ]);
    assert.equal(
      hasil.pruned.some((release) => release.tagName === 'v0.2.0'),
      false,
    );
  });

  it('tidak memangkas apa pun bila jumlahnya belum melebihi batas', () => {
    const hasil = selectReleasesToPrune([preview(1), preview(2)], { keep: 10 });
    assert.equal(hasil.pruned.length, 0);
    assert.equal(hasil.kept.length, 2);
  });
});

describe('CLI prune-preview-releases.mjs', () => {
  const duaBelasPreview = Array.from({ length: 12 }, (_, index) => preview(index + 1));

  it('menghapus hanya preview lama, beserta tag-nya', (t) => {
    const { run, commands } = harness(t, { releases: [...duaBelasPreview, PRODUKSI, KANDIDAT] });
    const { stdout, stderr, code } = run(['--keep', '10']);

    assert.equal(code, 0, stderr);
    assert.deepEqual(deletedTags(commands()), ['v0.1.0-build1', 'v0.1.0-build2']);
    assert.equal(stdout, 'disimpan=10\ndipangkas=2\ntidak_disentuh=2\n');
    assert.ok(stderr.includes('pemangkasan: 2 preview lama'), stderr);

    // Setiap penghapusan memakai `--yes --cleanup-tag`: tanpa itu perintahnya
    // berhenti menunggu konfirmasi, dan tag git-nya tertinggal.
    const hapus = commands().filter((argv) => argv[1] === 'delete');
    assert.equal(hapus.length, 2);
    for (const argv of hapus) {
      assert.deepEqual(argv.slice(3), ['--yes', '--cleanup-tag']);
    }
    // Daftarnya dibaca dengan jendela default dan kolom yang dibutuhkan saja.
    const list = commands()[0];
    assert.deepEqual(list.slice(0, 2), ['release', 'list']);
    assert.ok(list.includes('tagName,isPrerelease,createdAt'), list.join(' '));
  });

  it('tidak menyentuh rilis produksi walau usianya paling tua', (t) => {
    const tua = { tagName: 'v0.1.0', isPrerelease: false, createdAt: '2020-01-01T00:00:00Z' };
    const { run, commands } = harness(t, { releases: [...duaBelasPreview, tua] });
    const { code } = run(['--keep', '1']);

    assert.equal(code, 0);
    assert.equal(
      deletedTags(commands()).includes('v0.1.0'),
      false,
      'rilis produksi tidak boleh ikut dihapus',
    );
    assert.equal(deletedTags(commands()).length, 11);
  });

  it('idempoten: pemangkasan kedua tidak menghapus apa pun lagi', (t) => {
    // Job `prune` berjalan pada setiap push ke `main`, jadi keadaan setelah
    // pemangkasan pertama harus sudah final. gh tiruan menghapus rilis yang
    // berhasil dihapus dari daftarnya, sama seperti GitHub sungguhan.
    const { run, commands } = harness(t, { releases: [...duaBelasPreview, PRODUKSI] });

    const pertama = run(['--keep', '10']);
    assert.equal(pertama.code, 0, pertama.stderr);
    const setelahPertama = deletedTags(commands());
    assert.deepEqual(setelahPertama, ['v0.1.0-build1', 'v0.1.0-build2']);

    const kedua = run(['--keep', '10']);
    assert.equal(kedua.code, 0, kedua.stderr);
    assert.deepEqual(
      deletedTags(commands()),
      setelahPertama,
      'pemangkasan kedua tidak boleh menghapus rilis apa pun lagi',
    );
    assert.equal(kedua.stdout, 'disimpan=10\ndipangkas=0\ntidak_disentuh=1\n');
  });

  it('--dry-run melaporkan tanpa menghapus apa pun', (t) => {
    const { run, commands } = harness(t, { releases: duaBelasPreview });
    const { stdout, stderr, code } = run(['--keep', '10', '--dry-run']);

    assert.equal(code, 0, stderr);
    assert.equal(commands().filter((argv) => argv[1] === 'delete').length, 0);
    assert.ok(stderr.includes('[dry-run] akan dihapus: v0.1.0-build2'), stderr);
    assert.ok(stdout.includes('dipangkas=2'), stdout);
  });

  it('tidak melakukan apa-apa bila semuanya masih di bawah batas', (t) => {
    const { run, commands } = harness(t, { releases: [preview(1), preview(2), PRODUKSI] });
    const { stdout, stderr, code } = run([]);

    assert.equal(code, 0, stderr);
    assert.equal(commands().filter((argv) => argv[1] === 'delete').length, 0);
    assert.ok(stderr.includes('Tidak ada rilis preview yang perlu dipangkas.'), stderr);
    assert.equal(stdout, 'disimpan=2\ndipangkas=0\ntidak_disentuh=1\n');
  });

  it('memperingatkan bila jendela daftarnya tersentuh batas', (t) => {
    const { run } = harness(t, { releases: duaBelasPreview });
    const { stderr, code } = run(['--keep', '11', '--limit', '12']);

    assert.equal(code, 0, stderr);
    assert.ok(stderr.includes('Daftar dibatasi --limit 12'), stderr);
  });

  it('menolak --keep 0: catatan rilis build berikutnya butuh tag terakhir', (t) => {
    const { run, commands } = harness(t, { releases: duaBelasPreview });
    const { stderr, code } = run(['--keep', '0']);

    assert.equal(code, 1);
    assert.ok(stderr.includes('Opsi --keep minimal 1'), stderr);
    assert.equal(commands().length, 0, 'tidak boleh menghubungi GitHub sama sekali');
  });

  it('gagal dengan jelas bila gh tidak bisa membaca daftar rilis', (t) => {
    const { run } = harness(t, { listFails: true });
    const { stderr, code } = run([]);

    assert.equal(code, 1);
    assert.ok(stderr.includes('Perintah gh gagal'), stderr);
    assert.ok(stderr.includes('Bad credentials'), stderr);
  });

  it('gagal dengan jelas bila keluarannya bukan JSON', (t) => {
    const { run } = harness(t, { listOutput: 'bukan json sama sekali\n' });
    const { stderr, code } = run([]);

    assert.equal(code, 1);
    assert.ok(stderr.includes('bukan JSON yang bisa dibaca'), stderr);
  });

  it('melanjutkan penghapusan lain lalu gagal bila ada yang ditolak', (t) => {
    const { run, commands } = harness(t, {
      releases: duaBelasPreview,
      deleteFailures: ['v0.1.0-build1'],
    });
    const { stderr, code } = run(['--keep', '10']);

    assert.equal(code, 1);
    assert.deepEqual(deletedTags(commands()), ['v0.1.0-build1', 'v0.1.0-build2']);
    assert.ok(stderr.includes('1 rilis preview gagal dihapus'), stderr);
    assert.ok(stderr.includes('v0.1.0-build1'), stderr);
  });

  it('menolak pemakaian yang tidak lengkap atau keliru', (t) => {
    const { run } = harness(t, { releases: duaBelasPreview });

    const opsiAsing = run(['--keepnya', '10']);
    assert.equal(opsiAsing.code, 1);
    assert.ok(opsiAsing.stderr.includes('Argumen tidak dikenal'), opsiAsing.stderr);

    const angkaSalah = run(['--keep', 'banyak']);
    assert.equal(angkaSalah.code, 1);
    assert.ok(angkaSalah.stderr.includes('Nilai --keep tidak dikenali'), angkaSalah.stderr);
  });
});
