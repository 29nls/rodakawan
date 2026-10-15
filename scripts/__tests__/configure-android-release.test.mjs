/**
 * Test untuk `scripts/configure-android-release.mjs`: penyiapan tanda tangan rilis dan
 * nomor versi build untuk proyek Android hasil `npx expo prebuild`.
 *
 * Tiga lapis, sesuai risikonya:
 * - fungsi murni (jenis keystore, escaping properties, penyisipan blok Groovy) diuji
 *   langsung, karena di situlah kesalahan menghasilkan berkas yang salah tanpa error;
 * - CLI-nya dijalankan sungguhan terhadap proyek tiruan (dan repository git
 *   sungguhan untuk `--version-code auto`), karena yang menentukan adalah berkas yang
 *   benar-benar ditulis;
 * - `keytool` sungguhan dipakai untuk membuktikan alias yang salah tertangkap lebih
 *   dulu, bukan setelah belasan menit build native.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  BLOCK_END,
  BLOCK_START,
  applySigningBlock,
  chooseVersionCode,
  keystoreKind,
  signingBlock,
  signingProperties,
} from '../configure-android-release.mjs';
import { createRepo, runScript } from './support/git-repo.mjs';

/** Apakah `keytool` ada di mesin ini (bagian dari JDK). */
function keytoolAda() {
  const result = spawnSync('keytool', ['-help'], { encoding: 'utf8' });
  return !result.error;
}

/** App/build.gradle tiruan yang menyerupai keluaran `expo prebuild` sungguhan. */
const TEMPLATE_BUILD_GRADLE = `apply plugin: "com.android.application"

android {
    namespace 'com.rodakawan.app'
    defaultConfig {
        applicationId 'com.rodakawan.app'
        versionCode 1
        versionName "0.1.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`;

/** Proyek Android tiruan + app.json, di dalam `dir`. */
function buatProyek(dir, { version = '0.1.0', versionCode = 1 } = {}) {
  fs.mkdirSync(path.join(dir, 'android', 'app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'android', 'app', 'build.gradle'), TEMPLATE_BUILD_GRADLE);
  fs.writeFileSync(
    path.join(dir, 'app.json'),
    `${JSON.stringify({ expo: { version, android: { package: 'com.rodakawan.app', versionCode } } }, null, 2)}\n`,
  );
  return {
    project: path.join(dir, 'android'),
    gradle: path.join(dir, 'android', 'app', 'build.gradle'),
    properties: path.join(dir, 'android', 'local-signing.properties'),
  };
}

/**
 * Keystore untuk test. Bila `keytool` ada, keystore-nya sungguhan sehingga pemeriksaan
 * alias dan sandi di script ikut berjalan; bila tidak, dipakai berkas dengan magic
 * bytes JKS supaya jalur sisanya tetap teruji.
 */
function buatKeystore(dir, { alias = 'rilis', storePassword = 'sandi-rahasia', keyPassword } = {}) {
  const file = path.join(dir, 'rilis.jks');
  if (!keytoolAda()) {
    fs.writeFileSync(file, Buffer.from([0xfe, 0xed, 0xfe, 0xed, 0x00, 0x00, 0x00, 0x02]));
    return { file, alias, storePassword, keyPassword: keyPassword ?? storePassword, nyata: false };
  }

  const result = spawnSync(
    'keytool',
    [
      '-genkeypair',
      '-keystore',
      file,
      '-storetype',
      'PKCS12',
      '-storepass',
      storePassword,
      '-keypass',
      keyPassword ?? storePassword,
      '-alias',
      alias,
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '1',
      '-dname',
      'CN=Uji Rilis, O=RodaKawan, C=ID',
    ],
    { encoding: 'utf8' },
  );
  if ((result.status ?? 1) !== 0) {
    throw new Error(`keytool gagal membuat keystore: ${result.stderr}`);
  }
  return { file, alias, storePassword, keyPassword: keyPassword ?? storePassword, nyata: true };
}

/** Lingkungan rahasia untuk pemanggilan script. */
function rahasia(keystore, override = {}) {
  return {
    ANDROID_KEYSTORE_PATH: keystore.file,
    ANDROID_KEYSTORE_PASSWORD: keystore.storePassword,
    ANDROID_KEY_ALIAS: keystore.alias,
    ANDROID_KEY_PASSWORD: keystore.keyPassword,
    ...override,
  };
}

function dirSementara(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sisa direktori temp tidak memengaruhi hasil test.
    }
  });
  return dir;
}

/** Menghitung kemunculan penanda blok. */
const jumlahBlok = (isi) => isi.split(BLOCK_START).length - 1;

describe('keystoreKind', () => {
  it('mengenali JKS dan PKCS#12, menolak yang lain', () => {
    assert.equal(keystoreKind(Buffer.from([0xfe, 0xed, 0xfe, 0xed, 0x00])), 'JKS');
    assert.equal(keystoreKind(Buffer.from([0x30, 0x82, 0x05, 0x00, 0x01])), 'PKCS12');
    // Base64 yang belum didekode: teks ASCII, bukan keystore.
    assert.equal(keystoreKind(Buffer.from('MIIEvQIBADANBgkqhkiG9w0BAQEFAASC')), null);
    assert.equal(keystoreKind(Buffer.from('')), null);
    assert.equal(keystoreKind(Buffer.from([0xfe, 0xed])), null);
  });
});

/** Isi `local-signing.properties` sebagai peta kunci → nilai mentah. */
function bacaProperties(isi) {
  const entri = {};
  for (const baris of isi.split('\n')) {
    if (baris === '' || baris.startsWith('#')) continue;
    const pisah = baris.indexOf('=');
    entri[baris.slice(0, pisah)] = baris.slice(pisah + 1);
  }
  return entri;
}

describe('signingProperties', () => {
  it('meng-escape backslash, pemisah, dan spasi di depan', () => {
    const isi = signingProperties({
      storeFile: 'C:\\rahasia\\rilis.jks',
      storePassword: 'sandi=rahasia:ini',
      keyAlias: ' rilis',
      keyPassword: 'polos',
    });

    // Java `Properties` menganggap `\`, `:`, `=`, dan spasi di awal sebagai sintaks,
    // jadi nilainya harus di-escape agar terbaca kembali apa adanya.
    assert.deepEqual(bacaProperties(isi), {
      storeFile: 'C\\:\\\\rahasia\\\\rilis.jks',
      storePassword: 'sandi\\=rahasia\\:ini',
      keyAlias: '\\ rilis',
      keyPassword: 'polos',
    });
    assert.equal(isi.endsWith('\n'), true);
  });

  it('terbaca kembali apa adanya oleh parser Properties milik Java', (t) => {
    // Pembuktian yang sebenarnya: yang membaca berkas ini nanti adalah `Properties`
    // milik JVM di dalam Gradle, bukan parser buatan test ini.
    const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
    if (java.error?.code === 'ENOENT') {
      t.skip('`java` tidak tersedia; putaran balik tidak bisa dibuktikan di sini.');
      return;
    }

    const dir = dirSementara(t, 'properties-rilis-');
    const nilai = {
      storeFile: 'C:\\rahasia\\rilis.jks',
      storePassword: 'sandi=rahasia:ini',
      keyAlias: ' rilis',
      keyPassword: 'p@ss word\\1',
    };
    fs.writeFileSync(path.join(dir, 'local-signing.properties'), signingProperties(nilai));
    fs.writeFileSync(
      path.join(dir, 'Baca.java'),
      [
        'import java.io.*;',
        'import java.util.*;',
        'public class Baca {',
        '  public static void main(String[] args) throws Exception {',
        '    Properties p = new Properties();',
        '    try (InputStream in = new FileInputStream(args[0])) { p.load(in); }',
        '    for (String k : new String[] { "storeFile", "storePassword", "keyAlias", "keyPassword" }) {',
        '      System.out.println(k + "=" + p.getProperty(k));',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );

    const hasil = spawnSync('java', ['Baca.java', path.join(dir, 'local-signing.properties')], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(hasil.status, 0, hasil.stderr);
    // `println` di Windows menambahkan CR sebelum LF; itu keluaran konsol, bukan isi
    // properties-nya.
    assert.deepEqual(bacaProperties(hasil.stdout.replace(/\r/g, '')), nilai);
  });
});

describe('applySigningBlock', () => {
  const block = signingBlock({ versionCode: 7, versionName: '1.2.3' });

  it('menambahkan blok di akhir tanpa mengubah isi template', () => {
    const { content, replaced } = applySigningBlock(TEMPLATE_BUILD_GRADLE, block);
    assert.equal(replaced, false);
    assert.equal(content.startsWith(TEMPLATE_BUILD_GRADLE.trimEnd()), true);
    assert.equal(jumlahBlok(content), 1);
    assert.equal(content.includes('versionCode 7'), true);
    assert.equal(content.includes('versionName "1.2.3"'), true);
    // Isi template asli tetap utuh; blok hanya menimpa di belakangnya.
    assert.equal(content.includes('signingConfig signingConfigs.debug'), true);
  });

  it('idempoten: blok lama diganti, bukan ditumpuk', () => {
    const sekali = applySigningBlock(TEMPLATE_BUILD_GRADLE, block).content;
    const duaKali = applySigningBlock(
      sekali,
      signingBlock({ versionCode: 8, versionName: '1.2.4' }),
    );
    assert.equal(duaKali.replaced, true);
    assert.equal(jumlahBlok(duaKali.content), 1);
    assert.equal(duaKali.content.includes('versionCode 8'), true);
    assert.equal(duaKali.content.includes('versionCode 7'), false);
    assert.equal(duaKali.content.includes(BLOCK_END), true);
    assert.equal(duaKali.content.endsWith(`\n${BLOCK_END}\n`), true);
  });
});

describe('CLI configure-android-release.mjs', () => {
  it('menyiapkan proyek: properties, blok Gradle, dan ringkasan', (t) => {
    const dir = dirSementara(t, 'konfigurasi-android-');
    const proyek = buatProyek(dir);
    const keystore = buatKeystore(dir);

    const hasil = runScript(
      dir,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', '42'],
      { env: rahasia(keystore) },
    );

    assert.equal(hasil.code, 0, hasil.stderr);
    // Keystore test dibuat keytool dengan tipe PKCS#12; bila keytool tidak ada, yang
    // dipakai berkas ber-magic-bytes JKS.
    assert.equal(
      hasil.stdout,
      `version_code=42\nversion_name=0.1.0\nkeystore_type=${keystore.nyata ? 'PKCS12' : 'JKS'}\n`,
      hasil.stdout,
    );
    assert.equal(hasil.stderr.includes('::error::'), false, hasil.stderr);

    const properties = fs.readFileSync(proyek.properties, 'utf8');
    assert.match(properties, /^storeFile=/m);
    assert.equal(properties.includes(keystore.storePassword), true);
    // Jalur di berkas itu di-escape menurut aturan .properties; dibuka kembali di sini
    // hanya untuk membuktikan bahwa yang ditulis menunjuk berkas yang benar-benar ada.
    // Kebenaran escaping-nya sendiri dibuktikan test putaran-balik Java di atas.
    const jalurKeystore = bacaProperties(properties).storeFile.replace(/\\(.)/g, '$1');
    assert.equal(fs.existsSync(jalurKeystore), true, jalurKeystore);
    assert.equal(path.resolve(jalurKeystore), path.resolve(keystore.file));

    const gradle = fs.readFileSync(proyek.gradle, 'utf8');
    assert.equal(jumlahBlok(gradle), 1);
    assert.equal(gradle.includes('versionCode 42'), true);
    assert.equal(gradle.includes('signingConfig signingConfigs.release'), true);
    // Rahasia tidak boleh muncul di berkas yang akan di-commit (android/ memang
    // diabaikan git, tetapi blok Gradle tidak memuat sandi sama sekali).
    assert.equal(gradle.includes(keystore.storePassword), false);
  });

  it('tidak menumpuk konfigurasi bila dijalankan dua kali', (t) => {
    const dir = dirSementara(t, 'konfigurasi-android-');
    const proyek = buatProyek(dir);
    const keystore = buatKeystore(dir);
    const args = ['--project', 'android', '--version-code', '9'];

    assert.equal(
      runScript(dir, 'configure-android-release.mjs', args, { env: rahasia(keystore) }).code,
      0,
    );
    const kedua = runScript(dir, 'configure-android-release.mjs', args, { env: rahasia(keystore) });
    assert.equal(kedua.code, 0, kedua.stderr);
    assert.equal(jumlahBlok(fs.readFileSync(proyek.gradle, 'utf8')), 1);
  });

  it('menyebut semua rahasia yang belum diatur, tanpa nilainya', (t) => {
    const dir = dirSementara(t, 'konfigurasi-android-');
    buatProyek(dir);

    const hasil = runScript(
      dir,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', '5'],
      {
        env: {
          ANDROID_KEYSTORE_PATH: '',
          ANDROID_KEYSTORE_PASSWORD: '',
          ANDROID_KEY_ALIAS: '',
          ANDROID_KEY_PASSWORD: '',
        },
      },
    );

    assert.equal(hasil.code, 1);
    for (const nama of [
      'ANDROID_KEYSTORE_PATH',
      'ANDROID_KEYSTORE_PASSWORD',
      'ANDROID_KEY_ALIAS',
      'ANDROID_KEY_PASSWORD',
    ]) {
      assert.equal(hasil.stderr.includes(nama), true, `${nama} tidak disebut: ${hasil.stderr}`);
    }
  });

  it('menolak berkas yang bukan keystore (mis. base64 yang belum didekode)', (t) => {
    const dir = dirSementara(t, 'konfigurasi-android-');
    buatProyek(dir);
    const palsu = path.join(dir, 'keystore-base64.txt');
    fs.writeFileSync(palsu, 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n');

    const hasil = runScript(
      dir,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', '5'],
      { env: rahasia({ file: palsu, alias: 'x', storePassword: 'y', keyPassword: 'y' }) },
    );

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /bukan keystore JKS maupun PKCS#12/);
    assert.equal(fs.existsSync(path.join(dir, 'android', 'local-signing.properties')), false);
  });

  it('menolak proyek yang belum di-prebuild', (t) => {
    const dir = dirSementara(t, 'konfigurasi-android-');
    const keystore = buatKeystore(dir);
    const hasil = runScript(
      dir,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', '5'],
      { env: rahasia(keystore) },
    );

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /bukan proyek Android hasil prebuild/);
  });

  it('mengambil versionName dari app.json dan menolak versi bukan semver', (t) => {
    const dir = dirSementara(t, 'konfigurasi-android-');
    const keystore = buatKeystore(dir);

    const proyek = buatProyek(dir, { version: '2.0.0-rc.1' });
    const hasil = runScript(
      dir,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', '10'],
      { env: rahasia(keystore) },
    );
    assert.equal(hasil.code, 0, hasil.stderr);
    assert.match(fs.readFileSync(proyek.gradle, 'utf8'), /versionName "2\.0\.0-rc\.1"/);

    // Nilai dari app.json masuk ke dalam sumber Groovy, jadi bentuknya harus ketat.
    fs.writeFileSync(
      path.join(dir, 'app.json'),
      `${JSON.stringify({ expo: { version: '0.1.0"; System.exit(1); "' } })}\n`,
    );
    const nakal = runScript(
      dir,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', '11'],
      { env: rahasia(keystore) },
    );
    assert.equal(nakal.code, 1);
    assert.match(nakal.stderr, /bukan versi semver/);
  });

  it('memakai lantai android.versionCode dari app.json bila lebih tinggi', (t) => {
    const dir = dirSementara(t, 'konfigurasi-android-');
    buatProyek(dir, { versionCode: 500 });
    const keystore = buatKeystore(dir);

    const hasil = runScript(
      dir,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', '20'],
      { env: rahasia(keystore) },
    );

    assert.equal(hasil.code, 0, hasil.stderr);
    assert.match(hasil.stdout, /^version_code=500$/m);
    assert.match(hasil.stderr, /dipakai 500 sebagai lantai/);
  });

  it('menolak nomor versi di luar batas Android', (t) => {
    const dir = dirSementara(t, 'konfigurasi-android-');
    buatProyek(dir);
    const keystore = buatKeystore(dir);

    const hasil = runScript(
      dir,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', '2100000001'],
      { env: rahasia(keystore) },
    );

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /melebihi batas Android/);
  });

  it('menangkap alias yang salah lewat keytool, sebelum build dimulai', (t) => {
    const dir = dirSementara(t, 'konfigurasi-android-');
    buatProyek(dir);
    const keystore = buatKeystore(dir);
    if (!keystore.nyata) {
      t.skip('keytool tidak tersedia; pemeriksaan alias tidak bisa dibuktikan di sini.');
      return;
    }

    const hasil = runScript(
      dir,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', '5'],
      { env: rahasia(keystore, { ANDROID_KEY_ALIAS: 'alias-yang-tidak-ada' }) },
    );

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /aliasnya tidak bisa dibuka menurut keytool/);
  });
});

describe('versionCode dari riwayat repository', () => {
  it('--version-code auto memakai jumlah seluruh commit yang bisa dicapai', (t) => {
    const repo = createRepo(t);
    const proyek = buatProyek(repo.dir);
    const keystore = buatKeystore(repo.dir);

    repo.commit('satu');
    repo.commit('dua');
    repo.commit('tiga');
    // Ref yang tidak ada di `main` tetap dihitung: jumlahnya harus mencerminkan
    // seluruh repository, bukan satu branch.
    repo.git('checkout', '-q', '-b', 'lain');
    repo.commit('empat');
    repo.git('checkout', '-q', '-');

    const total = Number.parseInt(repo.git('rev-list', '--count', '--all'), 10);
    const hasil = runScript(
      repo.dir,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', 'auto'],
      { env: rahasia(keystore) },
    );

    assert.equal(hasil.code, 0, hasil.stderr);
    assert.equal(hasil.stdout.includes(`version_code=${total}`), true, hasil.stdout);
    assert.equal(fs.readFileSync(proyek.gradle, 'utf8').includes(`versionCode ${total}`), true);
  });

  it('menolak clone dangkal, karena hitungan commit-nya bisa lebih kecil dari APK yang beredar', (t) => {
    const sumber = createRepo(t);
    buatProyek(sumber.dir);
    // Berkasnya harus ikut ter-commit: yang di-clone test ini adalah isi repository,
    // bukan direktori kerja.
    sumber.git('add', '-A');
    sumber.commit('satu');
    sumber.commit('dua');
    sumber.commit('tiga');

    const tujuan = dirSementara(t, 'dangkal-');
    const klon = path.join(tujuan, 'repo');
    execFileSync(
      'git',
      ['clone', '-q', '--depth', '1', `file://${sumber.dir.replace(/\\/g, '/')}`, klon],
      {
        encoding: 'utf8',
      },
    );

    const keystore = buatKeystore(tujuan);
    const hasil = runScript(
      klon,
      'configure-android-release.mjs',
      ['--project', 'android', '--version-code', 'auto'],
      { env: rahasia(keystore) },
    );

    assert.equal(hasil.code, 1);
    assert.match(hasil.stderr, /clone dangkal/);
  });
});

describe('chooseVersionCode', () => {
  it('menolak nilai yang bukan bilangan bulat positif', () => {
    // `fail` menghentikan proses, jadi jalur galatnya dibuktikan lewat subproses di
    // test CLI di atas; di sini yang diuji nilai yang diterima.
    assert.equal(chooseVersionCode({ versionCode: 1, floor: 1 }), 1);
    assert.equal(chooseVersionCode({ versionCode: 12, floor: 300 }), 300);
    assert.equal(chooseVersionCode({ versionCode: 12, floor: undefined }), 12);
  });
});
