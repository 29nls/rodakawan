/**
 * Helper untuk test script rilis: membuat repository git **sungguhan** di
 * direktori sementara.
 *
 * Test di `scripts/__tests__` sengaja tidak mem-mock git. Keluaran `git log` dan
 * `git describe` (pemisah NUL, urutan commit, pemilihan tag) adalah bagian yang
 * paling mudah berubah diam-diam saat git atau cara pemanggilannya berubah, dan
 * hanya git asli yang bisa membuktikan parsingnya masih benar.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPTS_DIR = path.resolve(import.meta.dirname, '..', '..');

/** URL berkas (untuk `import` di dalam proses Node lain) dari script di `scripts/`. */
export function scriptUrl(relativePath) {
  return pathToFileURL(path.resolve(SCRIPTS_DIR, relativePath)).href;
}

/**
 * Membuat repository kosong di direktori sementara. Identitas dan penandatanganan
 * diatur lokal supaya test tidak bergantung konfigurasi global mesin
 * (mis. `commit.gpgsign` atau `tag.gpgSign` yang aktif).
 *
 * Direktori dibersihkan setelah test; kegagalan membersihkan (mis. berkas masih
 * terkunci di Windows) tidak menggagalkan test — direktori temp milik OS.
 */
export function createRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rodakawan-rilis-'));

  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sengaja diabaikan: sisa direktori temp tidak memengaruhi hasil test.
    }
  });

  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '.');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test Rilis');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgSign', 'false');

  return {
    dir,
    git,
    /** Commit kosong; mengembalikan SHA pendeknya. */
    commit(message) {
      git('commit', '-q', '--allow-empty', '-m', message);
      return git('rev-parse', '--short', 'HEAD');
    },
    tag(name) {
      git('tag', name);
    },
  };
}

/**
 * Menjalankan script rilis di dalam repo itu, persis seperti workflow memanggilnya.
 * Mengembalikan keluaran mentah dan kode keluar, bukan melempar saat script gagal.
 *
 * `env` menambahkan variabel lingkungan untuk proses itu saja — dipakai test yang
 * mengganti program `adb` dengan tiruannya, sehingga test lain dan lingkungan test
 * itu sendiri tidak terpengaruh.
 *
 * `input` menulis teks ke stdin proses itu lalu menutupnya — dipakai test
 * script interaktif (`device-checklist.mjs`), di mana setiap baris adalah
 * jawaban operator. Tanpa opsi ini stdin ditutup sejak awal, jadi pembaca
 * baris di dalam script langsung menerima EOF dan tidak pernah menggantung.
 *
 * `unset` menghapus nama variabel dari lingkungan proses itu. Diperlukan untuk
 * membuktikan perilaku "variabel benar-benar tidak ada": tanpa ini, variabel yang
 * kebetulan diset di mesin penguji akan lolos ke proses anak dan hasil test
 * bergantung pada mesin, bukan pada kode.
 */
export function runScript(dir, relativePath, args = [], { env = {}, unset = [], input } = {}) {
  const childEnv = { ...process.env, ...env };
  for (const nama of unset) delete childEnv[nama];

  const result = spawnSync(process.execPath, [path.resolve(SCRIPTS_DIR, relativePath), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: childEnv,
    input: input ?? '',
  });

  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status };
}

/**
 * Menjalankan potongan ESM di dalam repo itu dan mengembalikan stdout-nya.
 *
 * Dipakai untuk memanggil fungsi perpustakaan yang membaca repository lewat
 * `process.cwd()` (mis. `resolvePreviousTag`), sehingga test tidak perlu
 * `process.chdir` dan tetap aman dijalankan paralel dengan test lain.
 */
export function evalInRepo(dir, source) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: dir,
    encoding: 'utf8',
  });

  return { stdout: (result.stdout ?? '').trim(), stderr: result.stderr ?? '', code: result.status };
}
