/**
 * Test untuk `scripts/check-test-uuid-literals.mjs` dan pustaka
 * `scripts/lib/sql-uuid-literals.mjs`.
 *
 * Yang dibuktikan di sini adalah **kelas bug** yang sebenarnya pernah terjadi:
 * literal teks yang bukan UUID diberikan ke parameter bertipe `uuid`. PostgreSQL
 * menolaknya dengan SQLSTATE 22P02 tepat saat pemanggilan, sebelum badan fungsi
 * dijalankan — jadi satu literal salah di berkas uji menghentikan seluruh
 * berkas uji lain. Contoh nyata: `public.create_hazard(…, 'a-client-001')` di
 * `supabase/tests/rls_hazards_test.sql`.
 *
 * Test ini sengaja memuat tiga kelompok kasus:
 * 1. **Kasus bug** — literal yang salah harus ditemukan, lengkap dengan nomor
 *    baris dan kolom yang tepat.
 * 2. **Kasus bukan-bug** — hal yang *mirip* tapi sah (UUID kanonis, UUID tanpa
 *    tanda hubung, UUID berkurung kurawal, argumen ke parameter `text`, nilai
 *    yang bukan literal, nama fungsi di dalam string/komentar) tidak boleh
 *    dilaporkan. Laporan palsu membuat orang mematikan pemeriksaan ini.
 * 3. **Kasus tepi** — parser tanda tangan harus menangani mode parameter,
 *    `default`, overload, dan badan PL/pgSQL di dalam `do $$ … $$`.
 *
 * Yang tidak diuji di sini: perilaku runner `npm run db:test` terhadap
 * database sungguhan. Yang diuji adalah bahwa pra-syarat statisnya berjalan
 * sebelum runner menyentuh koneksi apa pun.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  checkTestFiles,
  collectSignatures,
  findUuidLiteralViolations,
  isUuidLiteral,
  maskNonCode,
  parseFunctionSignatures,
  splitArgument,
  splitTopLevel,
} from '../lib/sql-uuid-literals.mjs';
import { runScript } from './support/git-repo.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** CLI yang diuji; `runScript` menerima path relatif terhadap folder `scripts/`. */
const CLI = 'check-test-uuid-literals.mjs';

/** UUID kanonis yang sah — dipakai di seluruh test sebagai nilai yang benar. */
const UUID_SAH = 'a1111111-2222-4333-8444-555555555555';

/** UUID tanpa tanda hubung (32 heksadesimal) — juga sah menurut PostgreSQL. */
const UUID_TANPA_HUBUNG = UUID_SAH.replaceAll('-', '');

/** Tanda tangan fungsi yang dipakai fixture: satu parameter `uuid`, satu `text`. */
const MIGRASI = `
create or replace function public.BuatLaporan(
  p_kategori text,
  p_klient_id uuid default null
)
returns integer
language plpgsql
as $$
begin
  return 1;
end;
$$;
`;

/**
 * Fixture satu migration + satu berkas uji.
 * Mengembalikan `{ migrations, tests }` sesuai bentuk yang dipakai pustaka.
 */
function fixture(sqlUji, { sqlMigration = MIGRASI } = {}) {
  return {
    migrations: [{ path: '20260101000000_fungsi.sql', sql: sqlMigration }],
    tests: [{ path: 'supabase/tests/uji.sql', sql: sqlUji }],
  };
}

/** Menjalankan pustaka pada fixture dan mengembalikan daftar pelanggaran. */
function violations(sqlUji, options) {
  const { migrations, tests } = fixture(sqlUji, options);
  return checkTestFiles(migrations, tests);
}

/** repository tiruan di direktori sementara, untuk menguji CLI. */
function repoTiruan(t, { migration = MIGRASI, test = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uuid-literal-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sisa direktori temp tidak memengaruhi hasil test.
    }
  });

  fs.mkdirSync(path.join(dir, 'supabase', 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'supabase', 'tests'), { recursive: true });

  if (migration !== null) {
    fs.writeFileSync(
      path.join(dir, 'supabase', 'migrations', '20260101000000_fungsi.sql'),
      migration,
    );
  }

  if (test !== null) {
    fs.writeFileSync(path.join(dir, 'supabase', 'tests', 'uji.sql'), test);
  }

  return dir;
}

describe('isUuidLiteral', () => {
  it('menerima bentuk kanonis, huruf besar, dan tanpa tanda hubung', () => {
    assert.equal(isUuidLiteral(UUID_SAH), true);
    assert.equal(isUuidLiteral('A1111111-2222-4333-8444-555555555555'), true);
    assert.equal(isUuidLiteral(UUID_TANPA_HUBUNG), true);
    assert.equal(UUID_TANPA_HUBUNG.length, 32);
  });

  it('menerima bentuk berkurung kurawal dan UUID nil', () => {
    assert.equal(isUuidLiteral(`{${UUID_SAH}}`), true);
    assert.equal(isUuidLiteral('{}'), true);
  });

  it('menolak literal teks yang bukan UUID', () => {
    // Ini nilai yang pernah benar-benar ada di berkas uji.
    assert.equal(isUuidLiteral('a-client-001'), false);
    assert.equal(isUuidLiteral(''), false);
    assert.equal(isUuidLiteral('not-a-uuid'), false);
    assert.equal(isUuidLiteral('a1111111-2222-4333-8444-55555555555'), false);
    assert.equal(isUuidLiteral('g1111111-2222-4333-8444-555555555555'), false);
    assert.equal(isUuidLiteral(`${UUID_SAH}-ekstra`), false);
  });
});

describe('splitArgument', () => {
  it('membedah argumen posisional dan bernama', () => {
    assert.deepEqual(splitArgument("'teks'"), { name: null, value: "'teks'", valueIndex: 0 });
    assert.deepEqual(splitArgument("p_x => 'teks'"), {
      name: 'p_x',
      value: "'teks'",
      valueIndex: 7,
    });
  });

  it('tidak salah membaca panah di dalam literal sebagai argumen bernama', () => {
    // `=>` di dalam string bukan penanda argumen bernama.
    assert.deepEqual(splitArgument("'a => b'"), { name: null, value: "'a => b'", valueIndex: 0 });
  });
});

describe('maskNonCode', () => {
  it('menyamakan panjang teks dan menjaga nomor baris', () => {
    const sql = "select 1;\n-- komentar\nselect 'teks';\n";
    const masked = maskNonCode(sql);

    assert.equal(masked.length, sql.length);
    assert.equal(masked.split('\n').length, sql.split('\n').length);
    assert.doesNotMatch(masked, /komentar/);
    assert.doesNotMatch(masked, /teks/);
  });

  it('menyamakan panjang teks walau string tidak dikosongkan', () => {
    const sql = "select 'teks' -- catatan\nfrom t;";
    const readable = maskNonCode(sql, { blankStrings: false });

    assert.equal(readable.length, sql.length);
    assert.match(readable, /'teks'/);
    assert.doesNotMatch(readable, /catatan/);
  });

  it('membiarkan isi dollar-quoted sebagai kode kecuali diminta dikosongkan', () => {
    const sql = 'do $$ begin perform 1; end $$;';

    assert.match(maskNonCode(sql), /perform 1/);
    assert.doesNotMatch(maskNonCode(sql, { blankDollarQuoted: true }), /perform 1/);
  });
});

describe('splitTopLevel', () => {
  it('tidak membelah pada koma di dalam kurung atau kurung siku', () => {
    // Dua argumen di level terluar: `f('a', g(1, 2))` dan `'b'`. Koma di
    // dalam `f(...)` dan `g(...)` tidak boleh ikut membelah.
    const parts = splitTopLevel(maskNonCode("f('a', g(1, 2)), 'b'"));

    assert.equal(parts.length, 2);
    assert.equal(parts[0].end - parts[0].start, "f('a', g(1, 2))".length);
  });
});

describe('parseFunctionSignatures', () => {
  it('membaca nama dan tipe parameter beserta nilai default', () => {
    const [signature] = parseFunctionSignatures(MIGRASI);

    assert.equal(signature.name, 'BuatLaporan');
    assert.deepEqual(signature.params, [
      { name: 'p_kategori', type: 'text', hasDefault: false },
      { name: 'p_klient_id', type: 'uuid', hasDefault: true },
    ]);
  });

  it('melepas mode parameter agar tipenya tidak tertukar dengan nama', () => {
    const [signature] = parseFunctionSignatures(
      'create function f(inout p_x uuid, variadic p_y text) returns void as $$$$;',
    );

    assert.deepEqual(signature.params, [
      { name: 'p_x', type: 'uuid', hasDefault: false },
      { name: 'p_y', type: 'text', hasDefault: false },
    ]);
  });

  it('tidak membaca "create function" di dalam badan fungsi lain', () => {
    const signatures = parseFunctionSignatures(`
      create function luar(p_a uuid) returns void as $$
      begin
        create function dalam(p_b uuid) returns void as $$ begin end $$;
      end;
      $$;
    `);

    assert.equal(signatures.length, 1);
    assert.equal(signatures[0].name, 'luar');
  });
});

describe('collectSignatures', () => {
  it('menggantikan definisi lama bila nama dan tipenya sama', () => {
    const signatures = collectSignatures([
      { path: 'a.sql', sql: 'create function f(p_a uuid) returns void as $$$$;' },
      { path: 'b.sql', sql: 'create or replace function f(p_a uuid) returns int as $$$$;' },
    ]);

    assert.equal(signatures.get('f').length, 1);
  });

  it('menyimpan keduanya bila tipenya berbeda (overload, bukan penggantian)', () => {
    const signatures = collectSignatures([
      { path: 'a.sql', sql: 'create function f(p_a uuid) returns void as $$$$;' },
      { path: 'b.sql', sql: 'create or replace function f(p_a text) returns void as $$$$;' },
    ]);

    assert.equal(signatures.get('f').length, 2);
  });
});

describe('findUuidLiteralViolations', () => {
  const signatures = collectSignatures([{ path: 'a.sql', sql: MIGRASI }]);

  it('menemukan literal salah pada parameter uuid', () => {
    const violations = findUuidLiteralViolations(
      "select public.BuatLaporan('pothole', 'a-client-001');",
      signatures,
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0].paramName, 'p_klient_id');
    assert.equal(violations[0].literal, 'a-client-001');
    assert.equal(violations[0].line, 1);
    assert.equal(violations[0].functionName, 'public.BuatLaporan');
  });

  it('menemukan literal salah pada argumen bernama', () => {
    const violations = findUuidLiteralViolations(
      "select public.BuatLaporan(p_kategori => 'pothole', p_klient_id => 'a-client-001');",
      signatures,
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0].paramName, 'p_klient_id');
    assert.equal(violations[0].literal, 'a-client-001');
  });

  it('melaporkan nomor baris dan kolom yang menunjuk ke literalnya', () => {
    const violations = findUuidLiteralViolations(
      [
        '-- baris komentar',
        'select public.BuatLaporan(',
        "  'pothole',",
        "  'a-client-001'",
        ');',
      ].join('\n'),
      signatures,
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 4);
    // Kolom menunjuk ke posisi literal, bukan ke awal baris.
    assert.equal(violations[0].column, 3);
  });

  it('menemukan pemanggilan di dalam badan PL/pgSQL (do $$ … $$)', () => {
    // Ini bentuk yang dipakai berkas uji sungguhan: seluruh pemanggilan ada di
    // dalam badan `do $$ … $$`, bukan di SQL level.
    const violations = findUuidLiteralViolations(
      [
        'do $$',
        'declare',
        '  v_x integer;',
        'begin',
        "  v_x := public.BuatLaporan('pothole', 'a-client-001');",
        'end;',
        '$$;',
      ].join('\n'),
      signatures,
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 5);
  });

  it('menemukan literal salah pada pemanggilan tanpa prefik skema', () => {
    const violations = findUuidLiteralViolations(
      "select BuatLaporan('pothole', 'a-client-001');",
      signatures,
    );

    assert.equal(violations.length, 1);
  });

  it('tidak melaporkan UUID yang sah', () => {
    assert.deepEqual(
      findUuidLiteralViolations(`select public.BuatLaporan('pothole', '${UUID_SAH}');`, signatures),
      [],
    );
  });

  it('tidak melaporkan argumen yang jatuh ke parameter text', () => {
    assert.deepEqual(
      findUuidLiteralViolations("select public.BuatLaporan('a-client-001', null);", signatures),
      [],
    );
  });

  it('tidak melaporkan nilai yang bukan literal tunggal', () => {
    // Nilai yang belum diketahui saat pemrosesan statis tidak bisa dinilai;
    // satu-satunya cara memastikannya adalah menjalankannya.
    for (const nilai of ['v_id', 'null', 'gen_random_uuid()', '(select id from t)', "'a' || 'b'"]) {
      assert.deepEqual(
        findUuidLiteralViolations(`select public.BuatLaporan('x', ${nilai});`, signatures),
        [],
        `nilai ${nilai} seharusnya tidak dilaporkan`,
      );
    }
  });

  it('tidak melaporkan nama fungsi yang muncul di dalam string', () => {
    const violations = findUuidLiteralViolations(
      "select to_regprocedure('public.BuatLaporan(text,uuid)');",
      signatures,
    );

    assert.deepEqual(violations, []);
  });

  it('tidak melaporkan pemanggilan yang hanya disebut di dalam komentar', () => {
    const violations = findUuidLiteralViolations(
      "-- public.BuatLaporan('pothole', 'a-client-001')\nselect 1;",
      signatures,
    );

    assert.deepEqual(violations, []);
  });

  it('tidak melaporkan UUID yang ditulis sebagai literal berkurung kurawal', () => {
    assert.deepEqual(
      findUuidLiteralViolations(`select public.BuatLaporan('x', '{${UUID_SAH}}');`, signatures),
      [],
    );
  });

  it('menemukan literal yang salah meski ada cast ke uuid', () => {
    const violations = findUuidLiteralViolations(
      "select public.BuatLaporan('x', 'a-client-001'::uuid);",
      signatures,
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0].literal, 'a-client-001');
  });

  it('menemukan literal yang salah meski ada komentar di antara argumen', () => {
    // Komentar tidak boleh menyembunyikan literal yang salah.
    const violations = findUuidLiteralViolations(
      "select public.BuatLaporan('x' /* kategori */, 'a-client-001');",
      signatures,
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0].literal, 'a-client-001');
  });

  it('menunjuk ke posisi literal, bukan ke awal argumen', () => {
    // Posisi yang dilaporkan harus jatuh pada kutip pembuka literal — kalau
    // tidak, penanda di diff pull request menunjuk ke tempat yang salah.
    const sql = "select public.BuatLaporan('x',\n  'a-client-001');";
    const violations = findUuidLiteralViolations(sql, signatures);

    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);

    const baris = sql.split('\n')[violations[0].line - 1];
    assert.equal(baris[violations[0].column - 1], "'");
    assert.match(baris.slice(violations[0].column - 1), /^'a-client-001'/);
  });

  it('menemukan dua pelanggaran pada berkas yang sama dan mengurutkannya', () => {
    const violations = findUuidLiteralViolations(
      [
        "select public.BuatLaporan('a', 'salah-1');",
        "select public.BuatLaporan('b', 'salah-2');",
      ].join('\n'),
      signatures,
    );

    assert.equal(violations.length, 2);
    assert.equal(violations[0].line, 1);
    assert.equal(violations[1].line, 2);
  });

  it('tidak melaporkan pelanggaran ganda untuk satu pemanggilan yang sama', () => {
    // Fungsi yang sama bisa muncul di beberapa migration; satu literal salah
    // tetap satu masalah, bukan beberapa.
    const findings = checkTestFiles(
      [
        { path: 'a.sql', sql: MIGRASI },
        { path: 'b.sql', sql: MIGRASI },
      ],
      [{ path: 'supabase/tests/uji.sql', sql: "select public.BuatLaporan('a', 'salah-1');" }],
    );

    assert.equal(findings.length, 1);
  });
});

describe('checkTestFiles', () => {
  it('menyertakan nama berkas pada setiap temuan', () => {
    const findings = violations("select public.BuatLaporan('a', 'salah-1');");

    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'supabase/tests/uji.sql');
  });
});

describe('CLI check-test-uuid-literals.mjs', () => {
  it('lulus pada repository ini: seluruh berkas uji bebas literal non-UUID', () => {
    const result = runScript(REPO_ROOT, CLI);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /LULUS/);
  });

  it('gagal dan menunjuk berkas serta baris ketika ada literal salah', (t) => {
    const dir = repoTiruan(t, {
      test: "select public.BuatLaporan('pothole', 'a-client-001');",
    });

    const result = runScript(dir, CLI, ['--root', dir]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /::error file=supabase\/tests\/uji\.sql,line=1,col=/);
    assert.match(result.stderr, /a-client-001/);
    assert.match(result.stderr, /22P02/);
  });

  it('gagal pada berkas uji yang sama persis dengan yang pernah rusak', (t) => {
    // Nilai literal dan bentuk pemanggilan diambil apa adanya dari commit yang
    // memperbaiki bug: `public.create_hazard(…, 'a-client-001')` di dalam
    // badan `do $$ … $$`.
    const dir = repoTiruan(t, {
      migration: `
        create or replace function public.create_hazard(
          p_category text,
          p_severity text,
          p_latitude double precision,
          p_longitude double precision,
          p_description text default null,
          p_ride_id uuid default null,
          p_client_report_id uuid default null
        )
        returns integer
        language plpgsql
        as $$
        begin
          return 1;
        end;
        $$;
      `,
      test: [
        'do $$',
        'declare',
        '  v_h integer;',
        'begin',
        "  v_h := public.create_hazard('pothole','moderate',-6.2,106.8,'Lubang global',null,'a-client-001');",
        'end;',
        '$$;',
      ].join('\n'),
    });

    const result = runScript(dir, CLI, ['--root', dir]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /p_client_report_id/);
    assert.match(result.stderr, /'a-client-001'/);
    assert.match(result.stderr, /line=5/);
  });

  it('lulus pada berkas uji yang memakai UUID kanonis', (t) => {
    const dir = repoTiruan(t, {
      test: `select public.BuatLaporan('pothole', '${UUID_SAH}');`,
    });

    const result = runScript(dir, CLI, ['--root', dir]);

    assert.equal(result.code, 0, result.stderr);
  });

  it('gagal, bukan lolos diam-diam, bila tidak ada migration untuk dibaca', (t) => {
    const dir = repoTiruan(t, { migration: null, test: 'select 1;' });

    const result = runScript(dir, CLI, ['--root', dir]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Tidak ada migration/);
  });

  it('memeriksa satu berkas saja dengan --file', (t) => {
    const dir = repoTiruan(t, { test: "select public.BuatLaporan('a', 'salah-1');" });
    const file = path.join(dir, 'supabase', 'tests', 'uji.sql');

    const result = runScript(dir, CLI, ['--root', dir, '--file', file]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /salah-1/);
  });

  it('menampilkan bantuan tanpa menjalankan pemeriksaan', () => {
    const result = runScript(REPO_ROOT, CLI, ['--help']);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /--file/);
    assert.match(result.stdout, /--root/);
  });

  it('menolak argumen yang tidak dikenal', () => {
    const result = runScript(REPO_ROOT, CLI, ['--entah']);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Argumen tidak dikenal/);
  });
});
