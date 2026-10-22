/**
 * Penjaga konfigurasi runner test script.
 *
 * `npm run test:scripts` memakai runner bawaan Node (`node --test`). Dua hal
 * menjaga hasil run-nya deterministik, dan keduanya bisa hilang tanpa terlihat:
 *
 *   1. `--test-concurrency=<n>` — berapa banyak berkas uji yang boleh berjalan
 *      bersamaan. Tanpa itu, hasilnya bergantung jumlah CPU mesin: berkas uji
 *      yang sama bisa melewati batas waktu di satu mesin dan tidak di mesin lain.
 *   2. `--test-timeout=<ms>` — batas waktu per test, supaya test yang
 *      menggantung menggagalkan run, bukan menggantungkan pipeline selamanya.
 *
 * Yang paling rapuh: **posisi flag**. Node mengabaikan opsi yang diletakkan
 * setelah argumen berkas, dan ia tidak memberi peringatan apa pun. Diam-diam,
 * `node --test "*.test.mjs" --test-timeout=1` tetap hijau — timeout-nya tidak
 * pernah dipakai. Karena itu berkas ini mengawasi: flag wajib ada, wajib
 * berada sebelum glob, dan CI wajib menjalankan perintah yang sama.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { CHILD_TIMEOUT_MS, createRepo, evalInRepo } from './support/git-repo.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PACKAGE = path.join(ROOT, 'package.json');
const CI_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ci.yml');

const read = (file) => fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(read(PACKAGE));
const testScripts = pkg.scripts['test:scripts'];

/** Posisi glob berkas uji di dalam perintah; semua flag harus berada di depannya. */
const globIndex = testScripts.indexOf('scripts/__tests__/*.test.mjs');

describe('Konfigurasi runner test script', () => {
  it('perintah test:scripts menjalankan runner bawaan Node', () => {
    assert.ok(
      testScripts.startsWith('node --test'),
      `test:scripts harus memakai runner bawaan Node, bukan: ${testScripts}`,
    );
    assert.ok(globIndex > 0, `test:scripts harus menunjuk glob berkas uji: ${testScripts}`);
  });

  it('konkurensi tetap (tetap), bukan mengikuti jumlah CPU mesin', () => {
    const flags = testScripts.slice(0, globIndex);
    const cocok = /--test-concurrency=(\d+)/.exec(flags);

    assert.ok(
      cocok,
      `test:scripts harus mengunci --test-concurrency, contoh: --test-concurrency=1 (perintah: ${testScripts})`,
    );

    const nilai = Number(cocok[1]);
    assert.ok(Number.isInteger(nilai) && nilai >= 1, `--test-concurrency tidak valid: ${cocok[1]}`);
    assert.equal(
      cocok[0],
      '--test-concurrency=1',
      'konkurensi harus tetap satu: berkas uji saling memengaruhi kalau jalan bersamaan',
    );
  });

  it('setiap test punya batas waktu', () => {
    const flags = testScripts.slice(0, globIndex);
    const cocok = /--test-timeout=(\d+)/.exec(flags);

    assert.ok(cocok, `test:scripts harus mengunci --test-timeout (perintah: ${testScripts})`);

    const nilai = Number(cocok[1]);
    assert.ok(Number.isInteger(nilai) && nilai > 0, `--test-timeout tidak valid: ${cocok[1]}`);
    // Berkas uji paling lambat diukur 59,8 detik (configure-android-release,
    // ADR-072), jadi batas di bawah 60 detik akan menggagalkan run yang sah
    // di mesin lambat.
    assert.ok(
      nilai >= 60_000,
      `--test-timeout=${nilai} terlalu kecil: berkas uji terlegal 59,8 detik di mesin devs`,
    );
  });

  it('tidak ada flag runner yang ditulis setelah glob berkas uji', () => {
    const setelah = testScripts.slice(globIndex);

    assert.equal(
      /--test-[a-z-]+/.test(setelah),
      false,
      `Node mengabaikan opsi setelah argumen berkas tanpa peringatan: ${testScripts}`,
    );
  });

  it('CI menjalankan perintah yang sama, sehingga runner-nya sama', () => {
    const workflow = read(CI_WORKFLOW);

    assert.match(
      workflow,
      /run:\s*npm run test:scripts\b/,
      'workflow CI harus menjalankan `npm run test:scripts` supaya flag runner yang sama terpakai',
    );
    assert.equal(
      /run:.*node --test/.test(workflow),
      false,
      'workflow CI tidak boleh memanggil `node --test` langsung: konfigurasi runner harus satu sumber kebenaran (package.json)',
    );
  });
});

describe('Batas waktu proses anak di helper test script', () => {
  it('helper mengekspor batas waktu yang masuk akal', () => {
    assert.equal(
      Number.isInteger(CHILD_TIMEOUT_MS) && CHILD_TIMEOUT_MS >= 60_000,
      true,
      `CHILD_TIMEOUT_MS tidak masuk akal: ${CHILD_TIMEOUT_MS}`,
    );
  });

  it('proses anak yang menggantung dibunuh, bukan menunggu selamanya', (t) => {
    const repo = createRepo(t);
    const mulai = Date.now();

    // `setTimeout` yang belum tiba membuat proses tetap hidup; tanpa batas
    // waktu, pemanggilan ini akan menggantung sampai batas job CI.
    const hasil = evalInRepo(repo.dir, 'setTimeout(() => {}, 600000);', { timeoutMs: 1500 });
    const durasi = Date.now() - mulai;

    assert.equal(hasil.timedOut, true, 'helper harus menandai proses yang melewati batas waktu');
    assert.equal(hasil.code, null, `proses yang dibunuh tidak punya kode keluar: ${hasil.code}`);
    assert.equal(
      hasil.signal,
      'SIGTERM',
      `proses yang dibunuh harus menerima SIGTERM: ${hasil.signal}`,
    );
    assert.ok(durasi < 30_000, `proses anak harus dibunuh pada batasnya, bukan ${durasi} ms`);
  });
});
