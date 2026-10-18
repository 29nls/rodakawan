/**
 * Test untuk `scripts/db-types.mjs`: generator tipe Supabase dan pemeriksa drift.
 *
 * Yang dibuktikan di sini bukan isi tipe itu sendiri (itu urusan `tsc`), melainkan
 * perilaku yang menentukan apakah CI bisa dipercaya:
 * - hasil generate ditulis lengkap dengan header,
 * - pemeriksaan melaporkan lulus saat berkas sama dan gagal saat berbeda,
 * - kegagalan koneksi tidak membocorkan connection string/password ke log Actions.
 *
 * CLI Supabase diganti program tiruan di PATH, sama seperti test script lain
 * mengganti `adb`/`git`. Jadi test tidak menyentuh jaringan dan tidak bergantung
 * pada database development.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { runScript } from './support/git-repo.mjs';

const PASSWORD = 'pw-rahasia-jangan-cetak';
const DATABASE_URL = `postgresql://postgres.contoh:${PASSWORD}@localhost:5432/postgres`;

const TIPE_CONTOH = 'export type Database = { public: { Tables: {} } }';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-types-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sisa direktori temp tidak memengaruhi hasil test.
    }
  });
  return dir;
}

/**
 * Membuat program `npx` tiruan lebih dulu di PATH.
 *
 * Windows menjalankan `npx.cmd` lewat shell; POSIX memakai berkas tanpa ekstensi.
 */
function fakeNpx(t, body) {
  const dir = tempDir(t);

  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'npx.cmd'), `@echo off\r\n${body}\r\n`);
  } else {
    const file = path.join(dir, 'npx');
    fs.writeFileSync(file, `#!/bin/sh\nset -e\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }

  return dir;
}

function envWith(fakeDir) {
  return {
    PATH: `${fakeDir}${path.delimiter}${process.env.PATH ?? ''}`,
    DATABASE_URL,
  };
}

function generatedFile(t) {
  return path.join(tempDir(t), 'database.generated.ts');
}

describe('CLI db-types.mjs', () => {
  it('menulis tipe hasil generate beserta header dan tidak mencetak kredensial', (t) => {
    const fake = fakeNpx(t, `echo ${TIPE_CONTOH}`);
    const out = generatedFile(t);

    const hasil = runScript(process.cwd(), 'db-types.mjs', ['--out', out], {
      env: envWith(fake),
    });

    assert.equal(hasil.code, 0, hasil.stderr);
    const isi = fs.readFileSync(out, 'utf8');
    assert.equal(isi.startsWith('// BERKAS INI DIHASILKAN OTOMATIS'), true);
    assert.equal(isi.includes('export type Database'), true);

    // Target boleh disebut, tetapi password tidak boleh masuk ke log.
    assert.equal(`${hasil.stdout}${hasil.stderr}`.includes(PASSWORD), false);
    assert.equal(`${hasil.stdout}${hasil.stderr}`.includes(DATABASE_URL), false);
    assert.match(hasil.stdout, /localhost:5432\/postgres/);
  });

  it('lulus bila berkas yang di-commit sama dengan hasil generate', (t) => {
    const fake = fakeNpx(t, `echo ${TIPE_CONTOH}`);
    const out = generatedFile(t);
    const env = envWith(fake);

    assert.equal(runScript(process.cwd(), 'db-types.mjs', ['--out', out], { env }).code, 0);

    const hasil = runScript(process.cwd(), 'db-types.mjs', ['--check', '--out', out], { env });

    assert.equal(hasil.code, 0, hasil.stderr);
    assert.match(hasil.stdout, /LULUS/);
  });

  it('gagal dan menunjukkan perbedaan pertama saat berkas tertinggal', (t) => {
    const fake = fakeNpx(t, `echo ${TIPE_CONTOH}`);
    const out = generatedFile(t);
    const env = envWith(fake);

    assert.equal(runScript(process.cwd(), 'db-types.mjs', ['--out', out], { env }).code, 0);
    fs.appendFileSync(out, '// diedit manual\n');

    const hasil = runScript(process.cwd(), 'db-types.mjs', ['--check', '--out', out], { env });

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /DRIFT/);
    assert.match(hasil.stderr, /Perbedaan pertama di baris/);
    assert.match(hasil.stderr, /diedit manual/);
  });

  it('menyunting connection string dari pesan error CLI', (t) => {
    const fake = fakeNpx(
      t,
      process.platform === 'win32'
        ? 'echo gagal konek ke %DATABASE_URL% 1>&2 & exit /b 1'
        : 'echo "gagal konek ke $DATABASE_URL" >&2; exit 1',
    );
    const out = generatedFile(t);

    const hasil = runScript(process.cwd(), 'db-types.mjs', ['--out', out], {
      env: envWith(fake),
    });

    assert.equal(hasil.code, 1);
    assert.equal(hasil.stderr.includes(PASSWORD), false);
    assert.equal(hasil.stderr.includes(DATABASE_URL), false);
    assert.match(hasil.stderr, /GAGAL menghasilkan tipe/);
  });

  it('berhenti dengan pesan jelas bila DATABASE_URL belum diatur', () => {
    const hasil = runScript(process.cwd(), 'db-types.mjs', ['--check'], {
      unset: ['DATABASE_URL', 'SUPABASE_DB_URL'],
    });

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /DATABASE_URL belum diatur/);
  });
});
