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

import { APP_ENV_VARS, appEnvFile, collectAppEnv } from '../write-app-env.mjs';
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

describe('collectAppEnv', () => {
  it('menerima nilai lengkap apa adanya', () => {
    assert.deepEqual(collectAppEnv(LENGKAP), LENGKAP);
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

  it('menganggap nilai spasi EXPO_PUBLIC_MAP_STYLE_URL bukan kegagalan (variabel opsional)', (t) => {
    const dir = dirSementara(t);
    const hasil = runScript(dir, 'write-app-env.mjs', [], {
      env: { ...LENGKAP, EXPO_PUBLIC_MAP_STYLE_URL: '   ' },
    });

    // Sekarang variabel opsional ini tidak menyebabkan gagal validasi;
    // hanya Supabase yang wajib diisi.
    assert.equal(hasil.code, 0);
    // Tapi nilai spasi tidak ikut ditulis ke .env.local (diabaikan karena kosong)
    assert.equal(fs.existsSync(path.join(dir, '.env.local')), true);
    const isi = fs.readFileSync(path.join(dir, '.env.local'), 'utf8');
    // Supabase varis tetap ikut ditulis
    assert.equal(isi.includes(LENGKAP.EXPO_PUBLIC_SUPABASE_URL), true);
    assert.equal(isi.includes(LENGKAP.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY), true);
    // Map style url dengan spasi tidak ikut ditulis (filter di collectAppEnv)
    assert.equal(isi.includes('EXPO_PUBLIC_MAP_STYLE_URL'), false);
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
