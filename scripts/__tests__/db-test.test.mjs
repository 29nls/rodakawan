/**
 * Test untuk `scripts/db-test.mjs`: runner uji RLS.
 *
 * Yang dibuktikan di sini adalah sifat yang menentukan apakah CI bisa dipercaya,
 * bukan isi berkas SQL-nya (itu urusan `npm run db:test` terhadap database
 * development):
 * - berkas uji tanpa direktif notice **ditolak sebelum** satu koneksi pun dibuka,
 *   sehingga berkas yang tidak bisa diverifikasi keberhasilannya tidak pernah
 *   dijalankan;
 * - literal non-UUID yang diberikan ke parameter bertipe `uuid` juga ditolak
 *   lebih dulu — PostgreSQL akan menolaknya dengan SQLSTATE 22P02, jadi kelas
 *   galat itu bisa diketahui tanpa database sama sekali;
 * - daftar berkas default benar-benar ada, dan setiap berkas menyatakan notice yang
 *   juga benar-benar di-`raise notice` di dalamnya (kalau tidak, uji itu selalu
 *   gagal di CI — atau lebih buruk, lulus karena notice berkas lain);
 * - setiap notice itu juga dicari oleh workflow `database-rls.yml`;
 * - **satu berkas yang gagal tidak menghentikan berkas lain**: seluruh berkas
 *   tetap dijalankan dan semua kegagalan diringkas sekaligus, jadi satu putaran
 *   uji menunjukkan semua masalah — bukan hanya yang pertama.
 *
 * Test tidak menyentuh jaringan: kasus "tanpa DATABASE_URL" tidak pernah membuka
 * koneksi, kasus "berkas tanpa direktif" berhenti sebelum mencetak target
 * koneksi, dan perilaku "lanjut setelah gagal" diuji dengan client pg tiruan
 * (`support/fake-pg-client.mjs`).
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { main as runDbTest } from '../db-test.mjs';
import { createFakePgClient } from './support/fake-pg-client.mjs';
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

/**
 * Isi berkas uji palsu: memuat direktif notice (wajib, kalau tidak berkas
 * ditolak pada pemeriksaan statis) plus satu penanda unik yang dipakai tiruan
 * client pg untuk mengenali berkas mana yang sedang dijalankan.
 */
function sqlWithMarker(label, marker) {
  return [`-- db:test notice: UJI ${label} LULUS`, `-- ${marker}`, 'select 1;', ''].join('\n');
}

/**
 * Jalankan runner dengan client pg tiruan dan tangkap keluarannya.
 *
 * `createClient` sengaja disuntikkan supaya test bisa memastikan apakah koneksi
 * pernah dibuka — dan tidak perlu database sungguhan.
 */
async function runWithFakeClient(args, client) {
  const out = [];
  const err = [];
  const opened = [];

  const code = await runDbTest(args, {
    env: { DATABASE_URL: DATABASE_URL_PALSU },
    cwd: ROOT,
    createClient: (config) => {
      opened.push(config);
      return client;
    },
    out: (...lines) => out.push(lines.join(' ')),
    err: (...lines) => err.push(lines.join(' ')),
  });

  return {
    code,
    out: out.join('\n'),
    err: err.join('\n'),
    opened,
  };
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

  it('menolak literal non-UUID pada parameter uuid sebelum membuka koneksi', (t) => {
    // `create_hazard` punya parameter `p_client_report_id uuid` di migration.
    // Nilainya di sini bukan UUID — PostgreSQL akan menolaknya dengan SQLSTATE
    // 22P02, jadi runner harus menangkapnya sebelum membuka koneksi.
    const file = tempFile(
      t,
      'literal-salah.sql',
      [
        '-- db:test notice: UJI PALSU',
        'do $$',
        'declare',
        '  v_h integer;',
        'begin',
        "  v_h := public.create_hazard('pothole','moderate',-6.2,106.8,'Lubang',null,'a-client-001');",
        'end;',
        '$$;',
        '',
      ].join('\n'),
    );

    const result = runScript(ROOT, RUNNER, ['--file', file], {
      env: { DATABASE_URL: DATABASE_URL_PALSU, SUPABASE_DB_URL: '' },
      unset: ['SUPABASE_DB_URL'],
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /p_client_report_id/);
    assert.match(result.stderr, /a-client-001/);
    assert.match(result.stderr, /22P02/);
    // Pesan harus menyebut berkas uji yang bermasalah. Tanpa ini, nama berkas
    // bisa hilang (jadi "undefined:12:3") tanpa test apa pun gagal.
    assert.match(result.stderr, /literal-salah\.sql:\d+:\d+/);
    assert.doesNotMatch(result.stderr, /undefined:/);
    assert.doesNotMatch(result.stdout, /Target :/, 'pemeriksaan statis harus mendahului koneksi');
    assert.doesNotMatch(result.stderr, /GAGAL \[/, 'tidak boleh ada kegagalan database');
  });

  it('memeriksa literal UUID bahkan tanpa DATABASE_URL', (t) => {
    // Pemeriksaan statis tidak butuh kredensial, jadi galatnya harus tetap
    // dilaporkan pada mesin yang tidak punya `DATABASE_URL`.
    const file = tempFile(
      t,
      'literal-salah-tanpa-kredensial.sql',
      [
        '-- db:test notice: UJI PALSU',
        "select public.create_hazard('pothole','moderate',-6.2,106.8,'Lubang',null,'a-client-001');",
        '',
      ].join('\n'),
    );

    const result = runScript(ROOT, RUNNER, ['--file', file], {
      unset: ['DATABASE_URL', 'SUPABASE_DB_URL'],
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /a-client-001/);
    assert.doesNotMatch(result.stderr, /DATABASE_URL belum diatur/, 'galat literal lebih dulu');
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

  it('melanjutkan berkas uji lain setelah satu berkas gagal', async (t) => {
    const fileA = tempFile(t, 'berkas-a.sql', sqlWithMarker('A', 'BERKAS_A'));
    const fileB = tempFile(t, 'berkas-b.sql', sqlWithMarker('B', 'BERKAS_B'));

    const client = createFakePgClient([
      { match: 'BERKAS_A', error: { code: 'P0001', message: 'asersi gagal' } },
      { match: 'BERKAS_B', notice: 'UJI B LULUS' },
    ]);

    const result = await runWithFakeClient(['--file', fileA, '--file', fileB], client);

    // Ada berkas yang gagal, jadi keluarannya harus non-nol.
    assert.equal(result.code, 1);

    // Berkas kedua tetap dijalankan meski berkas pertama gagal.
    const indexA = client.queries.findIndex((sql) => sql.includes('BERKAS_A'));
    const indexB = client.queries.findIndex((sql) => sql.includes('BERKAS_B'));
    assert.ok(indexA >= 0, 'berkas pertama harus dijalankan');
    assert.ok(indexB > indexA, 'berkas kedua harus dijalankan setelah berkas pertama gagal');
    assert.match(result.out, /LULUS: .*berkas-b\.sql/);

    // Kegagalan berkas pertama dilaporkan.
    assert.match(result.err, /berkas-a\.sql/);
    assert.match(result.err, /asersi gagal/);

    // Ringkasan menyebut semuanya sekaligus.
    assert.match(result.out, /Ringkasan: 2 berkas uji — 1 lulus, 1 gagal, 0 tidak dijalankan/);
  });

  it('membersihkan transaksi dengan ROLLBACK sebelum menjalankan berkas berikutnya', async (t) => {
    // Tanpa ROLLBACK, PostgreSQL membatalkan transaksi yang gagal dan menolak
    // perintah berikutnya dengan "current transaction is aborted" — berkas
    // berikutnya tidak akan pernah bisa dijalankan.
    const fileA = tempFile(t, 'berkas-a.sql', sqlWithMarker('A', 'BERKAS_A'));
    const fileB = tempFile(t, 'berkas-b.sql', sqlWithMarker('B', 'BERKAS_B'));

    const client = createFakePgClient([
      { match: 'BERKAS_A', error: { code: 'P0001', message: 'asersi gagal' } },
      { match: 'BERKAS_B', notice: 'UJI B LULUS' },
    ]);

    await runWithFakeClient(['--file', fileA, '--file', fileB], client);

    const indexA = client.queries.findIndex((sql) => sql.includes('BERKAS_A'));
    const indexB = client.queries.findIndex((sql) => sql.includes('BERKAS_B'));
    const between = client.queries.slice(indexA + 1, indexB);

    assert.ok(
      between.some((sql) => /rollback/i.test(sql)),
      'koneksi harus dibersihkan dengan ROLLBACK sebelum berkas berikutnya dijalankan',
    );
  });

  it('melaporkan seluruh kegagalan sekaligus, bukan hanya yang pertama', async (t) => {
    const fileA = tempFile(t, 'berkas-a.sql', sqlWithMarker('A', 'BERKAS_A'));
    const fileB = tempFile(t, 'berkas-b.sql', sqlWithMarker('B', 'BERKAS_B'));
    const fileC = tempFile(t, 'berkas-c.sql', sqlWithMarker('C', 'BERKAS_C'));

    const client = createFakePgClient([
      { match: 'BERKAS_A', error: { code: 'P0001', message: 'gagal pertama' } },
      { match: 'BERKAS_B', error: { code: 'P0001', message: 'gagal kedua' } },
      { match: 'BERKAS_C', notice: 'UJI C LULUS' },
    ]);

    const result = await runWithFakeClient(
      ['--file', fileA, '--file', fileB, '--file', fileC],
      client,
    );

    assert.equal(result.code, 1);
    assert.match(result.err, /gagal pertama/);
    assert.match(result.err, /gagal kedua/);
    assert.match(result.err, /berkas-a\.sql/);
    assert.match(result.err, /berkas-b\.sql/);
    // Berkas ketiga tetap dijalankan dan tetap dihitung lulus.
    assert.match(result.out, /LULUS: .*berkas-c\.sql/);
    assert.match(result.out, /Ringkasan: 3 berkas uji — 1 lulus, 2 gagal, 0 tidak dijalankan/);
  });

  it('menandai sisa berkas sebagai tidak dijalankan ketika koneksi terputus', async (t) => {
    const fileA = tempFile(t, 'berkas-a.sql', sqlWithMarker('A', 'BERKAS_A'));
    const fileB = tempFile(t, 'berkas-b.sql', sqlWithMarker('B', 'BERKAS_B'));

    const client = createFakePgClient([
      {
        match: 'BERKAS_A',
        error: { code: 'ECONNRESET', message: 'Connection terminated unexpectedly' },
      },
      { match: 'BERKAS_B', notice: 'UJI B LULUS' },
    ]);

    const result = await runWithFakeClient(['--file', fileA, '--file', fileB], client);

    assert.equal(result.code, 1);
    // Berkas kedua memang tidak pernah diuji, jadi tidak boleh diklaim lulus.
    assert.ok(
      !client.queries.some((sql) => sql.includes('BERKAS_B')),
      'berkas kedua tidak boleh dijalankan setelah koneksi terputus',
    );
    assert.match(result.out, /Ringkasan: 2 berkas uji — 0 lulus, 0 gagal, 2 tidak dijalankan/);
    assert.match(result.err, /Berkas uji yang tidak dijalankan/);
    assert.match(result.err, /berkas-b\.sql/);
  });

  it('melaporkan seluruh masalah statis sekaligus tanpa membuka koneksi', async (t) => {
    const missing = path.join(os.tmpdir(), 'berkas-yang-tidak-ada-12345.sql');
    const withoutNotice = tempFile(t, 'tanpa-notice.sql', 'select 1;\n');
    const badUuid = tempFile(
      t,
      'literal-salah.sql',
      [
        '-- db:test notice: UJI PALSU',
        "select public.create_hazard('pothole','moderate',-6.2,106.8,'Lubang',null,'a-client-001');",
        '',
      ].join('\n'),
    );

    const client = createFakePgClient([]);
    const result = await runWithFakeClient(
      ['--file', missing, '--file', withoutNotice, '--file', badUuid],
      client,
    );

    assert.equal(result.code, 1);
    assert.match(result.err, /Pemeriksaan statis menemukan 3 masalah/);
    assert.match(result.err, /Berkas uji tidak ditemukan/);
    assert.match(result.err, /tidak memuat direktif notice penanda lulus/);
    assert.match(result.err, /a-client-001/);
    assert.match(result.err, /22P02/);
    // Tidak ada koneksi yang boleh dibuka selama pemeriksaan statis gagal.
    assert.equal(result.opened.length, 0, 'koneksi tidak boleh dibuka');
    assert.doesNotMatch(result.out, /Target :/);
  });
});
