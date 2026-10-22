/**
 * Test untuk `scripts/should-release.mjs`: penentu apakah sebuah commit perlu
 * membangun APK baru.
 *
 * Latar belakangnya konkret: rilis `v0.1.0-build36` dibangun hanya karena dua
 * berkas uji SQL berubah (`supabase/tests/rls_chat_test.sql` dan
 * `supabase/tests/rls_hazards_test.sql`). Berkas uji berjalan terhadap database
 * development dan tidak pernah masuk bundel aplikasi, jadi build itu murni
 * pemborosan. Test di sini mengunci kedua sisi keputusan itu: yang **tidak**
 * boleh memicu build (uji SQL, migration, dokumentasi, tooling database) dan
 * yang **harus** tetap memicunya (kode aplikasi, konfigurasi native, aset,
 * dependency).
 *
 * Dua lapis pengujian, sengaja:
 *   1. `needsBuild` dipanggil langsung — matriks jalur yang cepat dan terbaca.
 *   2. CLI dijalankan di repository git sungguhan (`runScript` + `createRepo`),
 *      karena yang dibaca workflow adalah stdout `true`/`false` dan anotasi
 *      `::notice::` di stderr. Anotasi yang salah menyebut alasan akan membuat
 *      orang ragu pada keputusan yang sebenarnya benar.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ignorableReason, needsBuild, summarizeReasons } from '../should-release.mjs';
import { createRepo, runScript } from './support/git-repo.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CI_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const RELEASE_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'release-on-push.yml');

const read = (file) => fs.readFileSync(file, 'utf8');

/** Commit yang hanya menyentuh berkas-berkas ini; mengembalikan SHA pendeknya. */
function commitFiles(repo, files, message) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(repo.dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  repo.git('add', '--all');
  return repo.commit(message);
}

/**
 * Repo dengan satu tag rilis di commit pertama, lalu satu commit berisi
 * `files`. Persis bentuk yang dinilai workflow: batas bawah tag terakhir,
 * batas atas commit yang akan dirilis.
 */
function repoWith(t, files) {
  const repo = createRepo(t);
  commitFiles(repo, { 'README.md': '# awal\n' }, 'feat: awal');
  repo.tag('v0.1.0-build1');
  commitFiles(repo, files, 'chore: perubahan yang dinilai');
  return repo;
}

describe('needsBuild — berkas yang tidak mengubah isi aplikasi', () => {
  it('uji SQL di supabase/tests tidak memicu build', () => {
    // Kasus nyata yang memicu rilis v0.1.0-build36.
    assert.equal(needsBuild(['supabase/tests/rls_chat_test.sql']), false);
    assert.equal(needsBuild(['supabase/tests/rls_hazards_test.sql']), false);
    assert.equal(
      needsBuild(['supabase/tests/rls_chat_test.sql', 'supabase/tests/rls_hazards_test.sql']),
      false,
    );
  });

  it('berkas uji SQL di subfolder juga tidak memicu build', () => {
    assert.equal(needsBuild(['supabase/tests/drafts/rls_rides_m3_draft.sql']), false);
  });

  it('migration tidak memicu build selama tidak ada perubahan aplikasi', () => {
    assert.equal(needsBuild(['supabase/migrations/20261020090000_hazard_reports_m4.sql']), false);
    assert.equal(
      needsBuild([
        'supabase/migrations/20261021130000_blocked_chat_server_filter.sql',
        'supabase/migrations/20261021120000_moderation_dashboard.sql',
      ]),
      false,
    );
  });

  it('draf SQL yang belum diterapkan tidak memicu build', () => {
    assert.equal(needsBuild(['supabase/drafts/milestone_3_ride_state.sql']), false);
  });

  it('dokumentasi tidak memicu build', () => {
    assert.equal(needsBuild(['docs/QA_TEST_PLAN.md']), false);
    assert.equal(needsBuild(['README.md', 'CHANGELOG.md', 'docs/MILESTONE_4_PLAN.md']), false);
  });

  it('tooling uji database tidak memicu build', () => {
    assert.equal(needsBuild(['scripts/db-test.mjs']), false);
    assert.equal(needsBuild(['scripts/db-types.mjs']), false);
    assert.equal(needsBuild(['scripts/storage-test.mjs']), false);
    assert.equal(needsBuild(['scripts/check-test-uuid-literals.mjs']), false);
    assert.equal(needsBuild(['scripts/lib/sql-uuid-literals.mjs']), false);
    assert.equal(needsBuild(['scripts/__tests__/db-test.test.mjs']), false);
  });

  it('berkas CI dan konfigurasi test tidak memicu build', () => {
    assert.equal(needsBuild(['.github/workflows/ci.yml']), false);
    assert.equal(needsBuild(['jest.config.js']), false);
  });

  it('test aplikasi tidak memicu build', () => {
    assert.equal(needsBuild(['src/features/hazards/__tests__/api.test.ts']), false);
    assert.equal(needsBuild(['src/components/ui/__tests__/Button.test.tsx']), false);
  });
});

describe('needsBuild — berkas yang memengaruhi isi aplikasi', () => {
  it('kode sumber aplikasi memicu build', () => {
    assert.equal(needsBuild(['src/app/(tabs)/hazards.tsx']), true);
    assert.equal(needsBuild(['src/features/hazards/api.ts']), true);
  });

  it('tipe database hasil generate tetap dinilai lewat jalur aslinya', () => {
    // Berada di `src/` dan diimpor kode aplikasi: "generated" bukan alasan untuk
    // mengabaikannya, hanya lokasinyalah yang menentukan.
    assert.equal(needsBuild(['src/lib/supabase/database.generated.ts']), true);
    assert.equal(ignorableReason('src/lib/supabase/database.generated.ts'), null);
  });

  it('metadata aplikasi dan konfigurasi native memicu build', () => {
    assert.equal(needsBuild(['app.json']), true);
    assert.equal(needsBuild(['eas.json']), true);
    assert.equal(needsBuild(['babel.config.js']), true);
  });

  it('dependency runtime dan lockfile memicu build', () => {
    assert.equal(needsBuild(['package.json']), true);
    assert.equal(needsBuild(['package-lock.json']), true);
  });

  it('aset yang dipaketkan memicu build', () => {
    assert.equal(needsBuild(['assets/icon.png']), true);
  });

  it('satu berkas aplikasi cukup untuk memicu build meski sisanya uji', () => {
    assert.equal(
      needsBuild(['supabase/tests/rls_chat_test.sql', 'src/features/chat/api.ts']),
      true,
    );
  });

  it('berkas yang tidak dikenali tetap dianggap perlu build (konservatif)', () => {
    assert.equal(needsBuild(['entah/apa/ini.xyz']), true);
  });
});

describe('summarizeReasons', () => {
  it('menghitung berkas per alasan, bukan sekadar "test"', () => {
    assert.equal(
      summarizeReasons([
        'supabase/tests/rls_chat_test.sql',
        'supabase/tests/rls_hazards_test.sql',
        'supabase/migrations/20261020090000_hazard_reports_m4.sql',
        'docs/MILESTONE_4_PLAN.md',
      ]),
      'uji SQL (2), migrasi database (1), dokumentasi (1)',
    );
  });
});

describe('CLI should-release.mjs', () => {
  it('commit yang hanya mengubah uji SQL dilewati, dengan alasan yang tepat', (t) => {
    const repo = repoWith(t, {
      'supabase/tests/rls_chat_test.sql': '-- db:test notice: UJI RLS CHAT M4 LULUS\n',
    });

    const result = runScript(repo.dir, 'should-release.mjs', ['--to', 'HEAD']);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'false');
    assert.match(result.stderr, /keputusan: lewati build APK/);
    assert.match(result.stderr, /Dilewati karena tidak ada berkas yang mengubah isi aplikasi/);
    assert.match(result.stderr, /uji SQL \(1\)/);
    assert.match(result.stderr, /rls_chat_test\.sql/);
  });

  it('commit yang hanya mengubah migration dilewati', (t) => {
    const repo = repoWith(t, {
      'supabase/migrations/20261021120000_moderation_dashboard.sql': 'select 1;\n',
    });

    const result = runScript(repo.dir, 'should-release.mjs', ['--to', 'HEAD']);

    assert.equal(result.stdout.trim(), 'false', result.stderr);
    assert.match(result.stderr, /migrasi database \(1\)/);
  });

  it('commit yang menyentuh kode aplikasi tetap membangun APK', (t) => {
    const repo = repoWith(t, {
      'supabase/tests/rls_chat_test.sql': '-- db:test notice: UJI RLS CHAT M4 LULUS\n',
      'src/features/chat/api.ts': 'export const x = 1;\n',
    });

    const result = runScript(repo.dir, 'should-release.mjs', ['--to', 'HEAD']);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'true');
    assert.match(result.stderr, /keputusan: build APK/);
    assert.match(result.stderr, /Berkas yang memicu build: src\/features\/chat\/api\.ts/);
  });
});

describe('Pagar workflow rilis', () => {
  it('CI tetap berjalan untuk perubahan uji SQL — tidak ada filter path di ci.yml', () => {
    // Gate APK boleh melewati build, tetapi validasi CI tidak boleh ikut
    // dilewati: `db:test:lint`, typecheck, dan lint tetap perlu melihat
    // perubahan uji SQL. Karena itu `ci.yml` sengaja tanpa `paths`/`paths-ignore`.
    assert.equal(
      /^\s*paths(-ignore)?:/m.test(read(CI_WORKFLOW)),
      false,
      'ci.yml tidak boleh memakai filter paths: validasi CI harus tetap berjalan untuk setiap perubahan',
    );
  });

  it('dispatch manual pada commit tanpa perubahan aplikasi gagal, bukan hijau', () => {
    // ADR-044: permintaan eksplisit manusia tidak boleh berakhir sebagai run
    // sukses yang tidak merilis apa pun. Guard ini ada di job `plan`.
    const workflow = read(RELEASE_WORKFLOW);
    const start = workflow.indexOf(`"$SHOULD_BUILD" = 'false'`);
    assert.notEqual(start, -1, 'job plan harus memeriksa hasil gate sebelum lanjut');

    const branch = workflow.slice(start, workflow.indexOf('\n          fi', start));
    assert.match(branch, /workflow_dispatch/, 'guard hanya berlaku pada dispatch manual');
    assert.match(
      branch,
      /::error::Tidak ada perubahan isi aplikasi/,
      'harus gagal dengan alasan jelas',
    );
    assert.match(branch, /exit 1/, 'harus keluar dengan status bukan nol');
  });

  it('build APK hanya berjalan bila gate mengembalikan true', () => {
    const workflow = read(RELEASE_WORKFLOW);
    assert.match(workflow, /if: needs\.plan\.outputs\.should_build == 'true'/);
  });
});
