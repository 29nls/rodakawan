/**
 * Test untuk `scripts/db-test.mjs`: runner uji RLS.
 *
 * Yang dibuktikan di sini adalah sifat yang menentukan apakah CI bisa dipercaya,
 * bukan isi berkas SQL-nya (itu urusan `npm run db:test` terhadap database
 * development):
 * - berkas uji tanpa direktif notice **ditolak sebelum** satu koneksi pun dibuka,
 *   sehingga berkas yang tidak bisa diverifikasi keberhasilannya tidak pernah
 *   dijalankan;
 * - daftar berkas default benar-benar ada, dan setiap berkas menyatakan notice yang
 *   juga benar-benar di-`raise notice` di dalamnya (kalau tidak, uji itu selalu
 *   gagal di CI — atau lebih buruk, lulus karena notice berkas lain);
 * - setiap notice itu juga dicari oleh workflow `database-rls.yml`.
 *
 * Test tidak menyentuh jaringan: kasus "tanpa DATABASE_URL" tidak pernah membuka
 * koneksi, dan kasus "berkas tanpa direktif" berhenti sebelum mencetak target
 * koneksi. Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { runScript } from './support/git-repo.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** `runScript` menerima path relatif terhadap folder `scripts/`. */
const RUNNER = 'db-test.mjs';
/** Path relatif terhadap root repo, untuk membaca berkas dan menyusun pesan. */
const RUNNER_REPO = 'scripts/db-test.mjs';
const WORKFLOW = '.github/workflows/database-rls.yml';

/** URL palsu: tidak pernah dipakai karena validasi berkas gagal lebih dulu. */
const DATABASE_URL_PALSU =
  'postgresql://postgres.contoh:rahasia@aws-0-contoh.pooler.supabase.com:5432/postgres?sslmode=require';

function tempFile(t, name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sisa direktori temp tidak memengaruhi hasil test.
    }
  });

  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

/** Daftar berkas uji default, dibaca dari runner supaya test dan runner tidak bisa menyimpang. */
function defaultTestFiles() {
  const source = fs.readFileSync(path.join(ROOT, RUNNER_REPO), 'utf8');
  const block = /const DEFAULT_TEST_FILES = \[([\s\S]*?)\];/.exec(source);
  assert.ok(block, 'DEFAULT_TEST_FILES tidak ditemukan di scripts/db-test.mjs');

  return [...block[1].matchAll(/'([^']+\.sql)'/g)].map((match) => match[1]);
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').split('\r\n').join('\n');
}

describe('db-test.mjs', () => {
  it('--help menyebut seluruh berkas uji default dan konvensi direktif notice', () => {
    const result = runScript(ROOT, RUNNER, ['--help']);

    assert.equal(result.code, 0);
    for (const file of defaultTestFiles()) {
      assert.match(
        result.stdout,
        new RegExp(file.replaceAll('/', '\\/')),
        `help tidak menyebut ${file}`,
      );
    }
    assert.match(result.stdout, /db:test notice:/);
  });

  it('menolak berjalan tanpa DATABASE_URL tanpa membuka koneksi apa pun', () => {
    const result = runScript(ROOT, RUNNER, [], {
      unset: ['DATABASE_URL', 'SUPABASE_DB_URL'],
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /DATABASE_URL belum diatur/);
    assert.doesNotMatch(result.stdout, /Target :/, 'tidak boleh sampai mencetak target koneksi');
  });

  it('menolak berkas uji tanpa direktif notice sebelum menyentuh database', (t) => {
    const file = tempFile(t, 'tanpa-direktif.sql', 'select 1;\n');

    const result = runScript(ROOT, RUNNER, ['--file', file], {
      env: { DATABASE_URL: DATABASE_URL_PALSU, SUPABASE_DB_URL: '' },
      unset: ['SUPABASE_DB_URL'],
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /tidak memuat direktif notice penanda lulus/);
    assert.doesNotMatch(result.stdout, /Target :/, 'validasi berkas harus mendahului koneksi');
    assert.doesNotMatch(result.stderr, /GAGAL \[/, 'tidak boleh ada kegagalan database');
  });

  it('setiap berkas uji default ada, mencantumkan notice, dan benar-benar me-raise notice itu', () => {
    const files = defaultTestFiles();
    assert.ok(files.length >= 2, 'kedua berkas uji RLS harus terdaftar di DEFAULT_TEST_FILES');

    for (const file of files) {
      const sql = readRepoFile(file);
      const directive = /^\s*--\s*db:test notice:\s*(.+?)\s*$/m.exec(sql);

      assert.ok(directive, `${file} tidak memuat direktif "-- db:test notice:"`);
      const notice = directive[1];

      assert.match(
        sql,
        new RegExp(`raise notice '${notice}`),
        `${file} menyatakan notice "${notice}" tetapi tidak pernah me-raise-nya`,
      );
      assert.match(sql, /rollback;/i, `${file} harus mengakhiri diri dengan ROLLBACK`);
    }
  });

  it('workflow database-rls memeriksa setiap notice yang dinyatakan berkas uji', () => {
    const workflow = readRepoFile(WORKFLOW);

    for (const file of defaultTestFiles()) {
      const directive = /^\s*--\s*db:test notice:\s*(.+?)\s*$/m.exec(readRepoFile(file));
      assert.ok(directive, `${file} tidak memuat direktif notice`);

      assert.match(
        workflow,
        new RegExp(directive[1].replaceAll('/', '\\/')),
        `workflow tidak memeriksa notice "${directive[1]}" dari ${file}`,
      );
    }
  });
});
