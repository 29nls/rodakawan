/**
 * Test untuk `scripts/write-app-env.mjs`.
 *
 * Yang diuji bukan tulis-menulis berkasnya, melainkan dua hal yang menentukan apakah
 * APK rilis masih menyentuh backend: variabel yang tidak lengkap harus menghentikan
 * build (bukan menghasilkan bundel tanpa backend yang tetap lolos uji nyala), dan
 * hanya variabel yang memang publik yang ditulis ke `.env.local` — bukan seluruh isi
 * lingkungan proses yang menjalankannya.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  APP_ENV_VARS,
  appEnvFile,
  collectAppEnv,
  collectBuildAppEnv,
  writtenAppEnv,
} from '../write-app-env.mjs';
import { runScript } from './support/git-repo.mjs';

const LENGKAP = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://contoh.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'kunci-publik-contoh',
  EXPO_PUBLIC_MAP_STYLE_URL: 'https://tiles.example/style.json',
};

function dirSementara(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-env-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sisa direktori temp tidak memengaruhi hasil test.
    }
  });
  return dir;
}

describe('appEnvFile', () => {
  it('menulis tepat tiga variabel publik, tanpa yang lain', () => {
    const isi = appEnvFile({ ...LENGKAP, DATABASE_URL: 'postgres://rahasia' });
    assert.equal(isi.includes('EXPO_PUBLIC_SUPABASE_URL'), true);
    assert.equal(isi.includes('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), true);
    assert.equal(isi.includes('EXPO_PUBLIC_MAP_STYLE_URL'), true);
    assert.equal(APP_ENV_VARS.length, 3);
    for (const nama of APP_ENV_VARS) {
      assert.equal(isi.includes(`${nama}=${LENGKAP[nama]}`), true, `${nama} tidak tertulis`);
    }
    // Rahasia milik proses pemanggil tidak boleh ikut menjadi berkas di runner.
    assert.equal(isi.includes('DATABASE_URL'), false);
    assert.equal(isi.endsWith('\n'), true);
  });
});

/** Konfigurasi supaya `EXPO_PUBLIC_MAP_STYLE_URL` benar-benar tidak ada. */
function tanpaPeta() {
  const nilai = { ...LENGKAP };
  delete nilai.EXPO_PUBLIC_MAP_STYLE_URL;
  return nilai;
}

describe('collectAppEnv', () => {
  it('menerima nilai lengkap apa adanya', () => {
    assert.deepEqual(collectAppEnv(LENGKAP), LENGKAP);
  });

  it('menerima konfigurasi Supabase yang lengkap tanpa peta custom', () => {
    const nilai = tanpaPeta();

    assert.deepEqual(collectAppEnv(nilai), nilai);
    assert.equal(
      collectAppEnv({ ...nilai, EXPO_PUBLIC_MAP_STYLE_URL: '   ' }).EXPO_PUBLIC_MAP_STYLE_URL,
      undefined,
    );
  });

  it('memangkas spasi nilai yang dipakai', () => {
    const hasil = collectAppEnv({
      ...LENGKAP,
      EXPO_PUBLIC_SUPABASE_URL: '  https://contoh.supabase.co  ',
    });

    assert.equal(hasil.EXPO_PUBLIC_SUPABASE_URL, 'https://contoh.supabase.co');
  });
});

describe('writtenAppEnv', () => {
  it('menulis tiga variabel bila peta custom diisi', () => {
    assert.deepEqual(writtenAppEnv(LENGKAP), [
      `EXPO_PUBLIC_SUPABASE_URL=${LENGKAP.EXPO_PUBLIC_SUPABASE_URL}`,
      `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${LENGKAP.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
      `EXPO_PUBLIC_MAP_STYLE_URL=${LENGKAP.EXPO_PUBLIC_MAP_STYLE_URL}`,
    ]);
  });

  it('menulis dua variabel bila peta custom tidak diisi', () => {
    assert.equal(writtenAppEnv(tanpaPeta()).length, 2);
  });
});

describe('collectBuildAppEnv — beta guard', () => {
  it('memerlukan ref beta eksplisit yang sama dengan URL dan menolak development', () => {
    assert.deepEqual(collectBuildAppEnv(LENGKAP, 'beta'), null);
    assert.deepEqual(
      collectBuildAppEnv(
        {
          ...LENGKAP,
          EXPO_PUBLIC_SUPABASE_URL: 'https://beta123.supabase.co',
          BETA_SUPABASE_PROJECT_REF: 'beta123',
        },
        'beta',
      ),
      { ...LENGKAP, EXPO_PUBLIC_SUPABASE_URL: 'https://beta123.supabase.co' },
    );
    assert.deepEqual(
      collectBuildAppEnv(
        {
          ...LENGKAP,
          EXPO_PUBLIC_SUPABASE_URL: 'https://xvmcpfkkveeaevfcvfug.supabase.co',
          BETA_SUPABASE_PROJECT_REF: 'xvmcpfkkveeaevfcvfug',
        },
        'beta',
      ),
      null,
    );
  });
});

describe('CLI write-app-env.mjs', () => {
  it('menulis .env.local dan tidak mencetak nilainya', (t) => {
    const dir = dirSementara(t);
    const hasil = runScript(dir, 'write-app-env.mjs', [], { env: LENGKAP });

    assert.equal(hasil.code, 0, hasil.stderr);
    assert.deepEqual(hasil.stdout, 'variabel=3\nberkas=.env.local\n');

    const isi = fs.readFileSync(path.join(dir, '.env.local'), 'utf8');
    assert.equal(isi.includes(LENGKAP.EXPO_PUBLIC_SUPABASE_URL), true);
    // Nilai tidak boleh muncul di keluaran yang tersimpan di log Actions.
    assert.equal(hasil.stdout.includes(LENGKAP.EXPO_PUBLIC_SUPABASE_URL), false);
    assert.equal(hasil.stderr.includes(LENGKAP.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY), false);
  });

  it('menghentikan build bila ada variabel yang belum diisi', (t) => {
    const dir = dirSementara(t);
    const hasil = runScript(dir, 'write-app-env.mjs', [], {
      env: { ...LENGKAP, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' },
    });

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /belum lengkap: EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    assert.match(hasil.stderr, /::error::Konfigurasi publik aplikasi belum lengkap/);
    assert.equal(fs.existsSync(path.join(dir, '.env.local')), false);
  });

  it('menghentikan build bila EXPO_PUBLIC_SUPABASE_URL hilang atau hanya spasi', (t) => {
    const dir = dirSementara(t);
    const hilang = runScript(dir, 'write-app-env.mjs', [], {
      env: LENGKAP,
      unset: ['EXPO_PUBLIC_SUPABASE_URL'],
    });

    assert.equal(hilang.code, 1);
    assert.match(hilang.stderr, /belum lengkap: EXPO_PUBLIC_SUPABASE_URL/);

    const spasi = runScript(dir, 'write-app-env.mjs', [], {
      env: { ...LENGKAP, EXPO_PUBLIC_SUPABASE_URL: '   ' },
    });

    assert.equal(spasi.code, 1);
    assert.equal(fs.existsSync(path.join(dir, '.env.local')), false);
  });

  it('tidak menulis rahasia proses pemanggil dan tidak membocorkannya ke log', (t) => {
    const dir = dirSementara(t);
    const rahasia = 'postgres://pengguna:kata-sandi@contoh:5432/basisdata';
    const hasil = runScript(dir, 'write-app-env.mjs', [], {
      env: { ...LENGKAP, DATABASE_URL: rahasia, SUPABASE_SERVICE_ROLE_KEY: 'service-role-contoh' },
    });

    assert.equal(hasil.code, 0, hasil.stderr);

    const isi = fs.readFileSync(path.join(dir, '.env.local'), 'utf8');
    assert.equal(isi.includes('DATABASE_URL'), false);
    assert.equal(isi.includes('SERVICE_ROLE'), false);
    assert.equal(isi.includes(rahasia), false);

    // Log Actions tidak memuat satu pun nilai konfigurasi.
    for (const nilai of [
      rahasia,
      LENGKAP.EXPO_PUBLIC_SUPABASE_URL,
      LENGKAP.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      LENGKAP.EXPO_PUBLIC_MAP_STYLE_URL,
    ]) {
      assert.equal(hasil.stdout.includes(nilai), false, `nilai bocor ke stdout: ${nilai}`);
      assert.equal(hasil.stderr.includes(nilai), false, `nilai bocor ke stderr: ${nilai}`);
    }
  });

  it('mencatat jumlah variabel yang sama dengan isi berkasnya', (t) => {
    const dir = dirSementara(t);
    const hasil = runScript(dir, 'write-app-env.mjs', [], { env: LENGKAP });

    assert.equal(hasil.code, 0, hasil.stderr);
    const isi = fs.readFileSync(path.join(dir, '.env.local'), 'utf8');
    const jumlahDiBerkas = isi
      .split('\n')
      .filter((baris) => baris.startsWith('EXPO_PUBLIC_')).length;

    assert.equal(hasil.stdout, `variabel=${jumlahDiBerkas}\nberkas=.env.local\n`);
    assert.match(
      hasil.stderr,
      new RegExp(`\\(${jumlahDiBerkas} variabel; nilainya tidak dicetak\\)`),
    );
  });

  it('melaporkan jumlah variabel yang benar-benar ditulis, bukan panjang daftar tetap', (t) => {
    const dir = dirSementara(t);
    const hasil = runScript(dir, 'write-app-env.mjs', [], {
      env: tanpaPeta(),
      unset: ['EXPO_PUBLIC_MAP_STYLE_URL'],
    });

    assert.equal(hasil.code, 0, hasil.stderr);
    // Isinya dua, jadi lognya harus mengatakan dua walau daftar tetapnya tiga.
    assert.deepEqual(hasil.stdout, 'variabel=2\nberkas=.env.local\n');
    assert.match(hasil.stderr, /\(2 variabel; nilainya tidak dicetak\)/);
    assert.equal(
      fs.readFileSync(path.join(dir, '.env.local'), 'utf8').includes('EXPO_PUBLIC_MAP_STYLE_URL'),
      false,
    );
  });

  it('menganggap nilai spasi EXPO_PUBLIC_MAP_STYLE_URL bukan kegagalan (variabel opsional)', (t) => {
    const dir = dirSementara(t);
    const hasil = runScript(dir, 'write-app-env.mjs', [], {
      env: { ...LENGKAP, EXPO_PUBLIC_MAP_STYLE_URL: '   ' },
      unset: ['EXPO_PUBLIC_MAP_STYLE_URL'],
    });

    // Sekarang variabel opsional ini tidak menyebabkan gagal validasi;
    // hanya Supabase yang wajib diisi.
    assert.equal(hasil.code, 0);
    assert.deepEqual(hasil.stdout, 'variabel=2\nberkas=.env.local\n');
    // Tapi nilai spasi tidak ikut ditulis ke .env.local (diabaikan karena kosong)
    assert.equal(fs.existsSync(path.join(dir, '.env.local')), true);
    const isi = fs.readFileSync(path.join(dir, '.env.local'), 'utf8');
    // Supabase varis tetap ikut ditulis
    assert.equal(isi.includes(LENGKAP.EXPO_PUBLIC_SUPABASE_URL), true);
    assert.equal(isi.includes(LENGKAP.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY), true);
    // Map style url dengan spasi tidak ikut ditulis (filter di collectAppEnv)
    assert.equal(isi.includes('EXPO_PUBLIC_MAP_STYLE_URL'), false);
  });

  it('menolak ref development atau ref project yang tidak cocok pada target beta', (t) => {
    const dir = dirSementara(t);
    const dev = runScript(dir, 'write-app-env.mjs', ['--environment', 'beta'], {
      env: {
        ...LENGKAP,
        EXPO_PUBLIC_SUPABASE_URL: 'https://xvmcpfkkveeaevfcvfug.supabase.co',
        BETA_SUPABASE_PROJECT_REF: 'xvmcpfkkveeaevfcvfug',
      },
    });
    const mismatch = runScript(dir, 'write-app-env.mjs', ['--environment', 'beta'], {
      env: { ...LENGKAP, BETA_SUPABASE_PROJECT_REF: 'other-project' },
    });

    for (const hasil of [dev, mismatch]) {
      assert.equal(hasil.code, 1);
      assert.match(hasil.stderr, /Target beta tidak valid/);
      assert.equal(fs.existsSync(path.join(dir, '.env.local')), false);
    }
  });

  it('menerima ref beta eksplisit yang cocok tanpa mencetak nilainya', (t) => {
    const dir = dirSementara(t);
    const betaEnv = {
      ...LENGKAP,
      EXPO_PUBLIC_SUPABASE_URL: 'https://beta123.supabase.co',
      BETA_SUPABASE_PROJECT_REF: 'beta123',
    };
    const hasil = runScript(dir, 'write-app-env.mjs', ['--environment', 'beta'], {
      env: betaEnv,
    });

    assert.equal(hasil.code, 0, hasil.stderr);
    assert.equal(
      fs
        .readFileSync(path.join(dir, '.env.local'), 'utf8')
        .includes(betaEnv.EXPO_PUBLIC_SUPABASE_URL),
      true,
    );
    assert.equal(hasil.stdout.includes(betaEnv.EXPO_PUBLIC_SUPABASE_URL), false);
    assert.equal(hasil.stderr.includes(betaEnv.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY), false);
  });

  it('menghormati --out', (t) => {
    const dir = dirSementara(t);
    const hasil = runScript(dir, 'write-app-env.mjs', ['--out', 'konfigurasi-publik.env'], {
      env: LENGKAP,
    });

    assert.equal(hasil.code, 0, hasil.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'konfigurasi-publik.env')), true);
    assert.equal(fs.existsSync(path.join(dir, '.env.local')), false);
  });
});
