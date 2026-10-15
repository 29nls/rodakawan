#!/usr/bin/env node
/**
 * Menyiapkan proyek Android hasil `npx expo prebuild` supaya bisa menghasilkan APK
 * rilis yang **ditandatangani** dengan kunci rilis, dan memberi tahu nomor versi
 * build yang dipakai. Dipakai kedua workflow rilis (`release-on-push.yml` dan
 * `android-release.yml`) sebelum `./gradlew assembleRelease`.
 *
 * Kenapa ada script ini: `android/` tidak di-commit (dibuat ulang tiap kali
 * prebuild), dan template prebuild menandatangani `release` dengan kunci **debug**
 * — `signingConfig signingConfigs.debug` — yang tidak boleh terbit. EAS Cloud dulu
 * menangani ini di sisi server; sekarang penanganannya ada di repo, sehingga bisa
 * dibaca, diuji, dan gagal dengan pesan yang jelas.
 *
 * Yang dikerjakan, semuanya di dalam direktori proyek Android:
 *
 *   1. Menulis `local-signing.properties` (tidak pernah di-commit — `android/`
 *      diabaikan git) berisi lokasi keystore dan kredensialnya.
 *   2. Menambahkan satu blok Groovy di **akhir** `app/build.gradle` yang:
 *      - mendaftarkan `signingConfigs.release` dari berkas itu,
 *      - mengarahkan `buildTypes.release.signingConfig` ke kunci rilis, bukan debug,
 *      - menetapkan `versionCode` dan `versionName` build ini.
 *      Blok ditambahkan di akhir, bukan disisipkan ke tengah template, supaya
 *      penetapan ulang terjadi setelah template selesai dievaluasi dan tidak
 *      bergantung pada tata letak berkas yang bisa berubah antar versi SDK.
 *
 * Pemakaian:
 *   node scripts/configure-android-release.mjs --project android --version-code 42
 *   node scripts/configure-android-release.mjs --version-code auto      # hitung dari git
 *
 * Rahasia dibaca dari lingkungan (tidak pernah dari argumen, supaya tidak muncul di
 * daftar proses maupun log):
 *   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS,
 *   ANDROID_KEY_PASSWORD
 *
 * Keluar dengan kode 0 bila proyek siap dibangun; selain itu kode 1 dengan pesan
 * `::error::…`. Pemeriksaan yang bisa dilakukan tanpa menunggu Gradle (berkas
 * keystore ada dan jenisnya dikenal, alias serta sandinya cocok menurut `keytool`,
 * nomor versi masuk akal) dilakukan di sini, supaya kesalahan konfigurasi ketahuan
 * dalam hitungan detik — bukan setelah belasan menit build native.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { fail, parseOptions } from './lib/cli.mjs';

const USAGE =
  'Pemakaian: node scripts/configure-android-release.mjs --project <direktori> ' +
  '--version-code <angka|auto> [--app-config <berkas>]';

/**
 * Batas atas versionCode menurut Android (`versionCode` adalah int 32 bit bertanda
 * dalam manifest). Nilai di atas ini akan ditolak pemasang paket, jadi lebih baik
 * ditolak di sini.
 */
export const MAX_VERSION_CODE = 2100000000;

/** Penanda blok yang ditambahkan script ini ke `app/build.gradle`. */
export const BLOCK_START =
  '// >>> rodakawan:konfigurasi-rilis — dibuat scripts/configure-android-release.mjs';
export const BLOCK_END = '// <<< rodakawan:konfigurasi-rilis';

/** Opsi yang wajib ada beserta nama variabel lingkungannya. */
const SECRETS = [
  ['ANDROID_KEYSTORE_PATH', 'lokasi berkas keystore rilis'],
  ['ANDROID_KEYSTORE_PASSWORD', 'sandi keystore'],
  ['ANDROID_KEY_ALIAS', 'alias kunci di dalam keystore'],
  ['ANDROID_KEY_PASSWORD', 'sandi kunci'],
];

/** Versi semver yang sama dengan yang diterima input `version` rilis produksi. */
const VERSION_NAME = /^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$/;

/**
 * Jenis keystore dari magic bytes-nya, atau `null` bila bukan keduanya.
 *
 * JKS diawali `FE ED FE ED`; PKCS#12 adalah DER sehingga diawali `30 82` (SEQUENCE
 * dengan panjang dua byte). Pemeriksaan ini bukan keamanan, melainkan penangkap
 * kesalahan yang paling sering terjadi: rahasia berisi base64 yang belum didekode,
 * berkas kosong, atau berkas yang salah tempat.
 */
export function keystoreKind(buffer) {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xfe &&
    buffer[1] === 0xed &&
    buffer[2] === 0xfe &&
    buffer[3] === 0xed
  ) {
    return 'JKS';
  }
  if (buffer.length >= 2 && buffer[0] === 0x30 && buffer[1] === 0x82) {
    return 'PKCS12';
  }
  return null;
}

/**
 * Nomor versi dari riwayat repository: jumlah seluruh commit yang bisa dicapai dari
 * ref mana pun (`git rev-list --count --all`).
 *
 * Kenapa bukan `github.run_number`: nomor itu per-workflow, sedangkan APK preview dan
 * APK produksi memakai id paket yang sama dengan kunci yang sama — nomor yang saling
 * menyalip antar dua workflow akan membuat pemasangan berikutnya ditolak Android.
 * Kenapa bukan jumlah commit commit yang dirilis saja: build boleh dijalankan dari
 * branch yang belum di-merge (ADR-044), dan branch yang bercabang jauh bisa punya
 * hitungan lebih besar daripada `main` sehingga build `main` berikutnya justru
 * bernomor lebih kecil. Menghitung seluruh ref membuat angkanya tidak pernah turun
 * selama repository bertambah commit, dari commit mana pun build dijalankan.
 *
 * Konsekuensi yang diterima: nomor versi bukan sifat commit itu sendiri, melainkan
 * sifat repository saat build dijalankan — membangun ulang commit lama setelah ada
 * commit baru menghasilkan nomor yang lebih besar.
 */
export function deriveVersionCode({ cwd = process.cwd() } = {}) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  let shallow;
  try {
    shallow = git(['rev-parse', '--is-shallow-repository']);
  } catch (error) {
    return fail('Tidak bisa membaca status repository git.', [String(error.message ?? error)]);
  }
  if (shallow !== 'false') {
    return fail(
      'Repository ini hasil clone dangkal (`--is-shallow-repository` bukan false), sehingga jumlah commit bukan jumlah seluruh riwayat.',
      [
        'Nomor versi dari hitungan commit yang terpotong bisa lebih kecil daripada APK yang sudah terpasang, dan Android akan menolak pemasangannya.',
        'Checkout dengan `fetch-depth: 0` (seluruh riwayat dan tag) sebelum memakai --version-code auto.',
      ],
    );
  }

  let count;
  try {
    count = Number.parseInt(git(['rev-list', '--count', '--all']), 10);
  } catch (error) {
    return fail('`git rev-list --count --all` gagal dijalankan.', [String(error.message ?? error)]);
  }
  if (!Number.isInteger(count) || count < 1) {
    return fail(`Jumlah commit tidak masuk akal: ${count}.`);
  }
  return count;
}

/**
 * Nomor versi final: yang dihitung/diberikan, atau lantai dari `app.json` bila lebih
 * tinggi. Lantai itu penting karena ia satu-satunya cara menaikkan nomor secara
 * sengaja bila riwayat repository justru lebih pendek daripada APK yang sudah
 * beredar (mis. repository pernah di-rewrite atau riwayat dipindahkan).
 */
export function chooseVersionCode({ versionCode, floor }) {
  const candidate = Number.isInteger(versionCode) ? versionCode : Number.NaN;
  if (!Number.isInteger(candidate) || candidate < 1) {
    return fail(
      `Nomor versi build tidak dikenali: ${versionCode}. Isinya bilangan bulat minimal 1.`,
    );
  }
  if (candidate > MAX_VERSION_CODE) {
    return fail(
      `Nomor versi build ${candidate} melebihi batas Android (${MAX_VERSION_CODE}), jadi APK-nya akan ditolak saat dipasang.`,
    );
  }

  const lantai = Number.isInteger(floor) && floor > 0 ? floor : 1;
  if (lantai > candidate) {
    console.error(
      `::notice::Nomor versi dihitung ${candidate}, tetapi \`android.versionCode\` di app.json bernilai ${lantai}; dipakai ${lantai} sebagai lantai supaya APK tidak pernah lebih tua daripada yang sudah beredar.`,
    );
    return lantai;
  }
  return candidate;
}

/** Isi `local-signing.properties` (escaping sesuai aturan berkas .properties). */
export function signingProperties({ storeFile, storePassword, keyAlias, keyPassword }) {
  // Penggantinya berupa **fungsi**, bukan string: pada `String.replace` string
  // pengganti ikut ditafsirkan (`\\` menjadi satu backslash, `$&` menjadi kecocokan),
  // sehingga escaping seperti ini mudah salah tanpa terlihat — dan salahnya baru
  // ketahuan setelah Gradle gagal membuka keystore. Nilai balikan fungsi dipakai apa
  // adanya.
  const escape = (value) =>
    String(value)
      .replace(/\\/g, () => '\\\\')
      .replace(/([:=])/g, (match) => `\\${match}`)
      .replace(/^(\s)/, (match) => `\\${match}`);

  return [
    '# Dibuat scripts/configure-android-release.mjs — jangan di-commit.',
    `storeFile=${escape(storeFile)}`,
    `storePassword=${escape(storePassword)}`,
    `keyAlias=${escape(keyAlias)}`,
    `keyPassword=${escape(keyPassword)}`,
    '',
  ].join('\n');
}

/**
 * Blok Groovy yang ditambahkan di akhir `app/build.gradle`.
 *
 * Nilai yang disisipkan sudah divalidasi (bilangan bulat dan semver), jadi tidak ada
 * yang bisa menyuntikkan kode lewat `app.json`.
 */
export function signingBlock({ versionCode, versionName }) {
  return `android {
    signingConfigs {
        release {
            def rkSigning = new Properties()
            def rkSigningFile = rootProject.file("local-signing.properties")
            if (!rkSigningFile.exists()) {
                throw new GradleException("Berkas tanda tangan rilis tidak ada: \${rkSigningFile}. Jalankan scripts/configure-android-release.mjs lebih dulu.")
            }
            rkSigningFile.withInputStream { rkSigning.load(it) }
            storeFile new File(rkSigning.getProperty("storeFile"))
            storePassword rkSigning.getProperty("storePassword")
            keyAlias rkSigning.getProperty("keyAlias")
            keyPassword rkSigning.getProperty("keyPassword")
        }
    }
    buildTypes {
        release {
            // Template prebuild menandatangani release dengan kunci debug; baris ini
            // menggantinya dengan kunci rilis yang dimuat di atas.
            signingConfig signingConfigs.release
        }
    }
    defaultConfig {
        versionCode ${versionCode}
        versionName "${versionName}"
    }
}`;
}

/**
 * Menambahkan blok ke isi `app/build.gradle`, atau mengganti blok yang sudah ada
 * beserta penandanya. Idempoten: menjalankannya dua kali menghasilkan berkas yang
 * sama, sehingga script boleh dijalankan ulang tanpa menumpuk konfigurasi.
 *
 * Satu penanda saja (tanpa pasangannya) berarti berkasnya sudah disentuh sesuatu
 * yang lain atau suntingan sebelumnya terpotong — itu keadaan yang tidak bisa
 * ditebak dengan aman, jadi script berhenti daripada menghasilkan konfigurasi ganda.
 */
export function applySigningBlock(content, block) {
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);

  if (start !== -1 && end !== -1) {
    // Batas akhir adalah akhir baris penanda, bukan `end` itu sendiri: penanda bisa
    // saja ikut tergeser bila isinya disunting tangan, dan seluruh blok di antaranya
    // memang harus diganti.
    const endOfLine = content.indexOf('\n', end);
    const after = endOfLine === -1 ? '' : content.slice(endOfLine + 1);
    return {
      content: `${content.slice(0, start)}${BLOCK_START}\n${block}\n${BLOCK_END}\n${after}`,
      replaced: true,
    };
  }
  if (start !== -1 || end !== -1) {
    return fail(
      'app/build.gradle memuat salah satu penanda blok konfigurasi rilis saja, bukan keduanya. Berkas itu tidak disunting lagi supaya konfigurasinya tidak menjadi ganda.',
      [
        'Jalankan `npx expo prebuild --platform android --clean` untuk membuat ulang proyek Android, lalu ulangi perintah ini.',
      ],
    );
  }

  return {
    content: `${content.replace(/\n*$/, '')}\n\n${BLOCK_START}\n${block}\n${BLOCK_END}\n`,
    replaced: false,
  };
}

/** Membaca `app.json`/`app.config.json` (ekspo). Berhenti bila tidak bisa dibaca. */
function readAppConfig(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return fail(`Tidak bisa membaca berkas konfigurasi aplikasi (${filePath}).`, [
      String(error.message ?? error),
    ]);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fail(`Berkas konfigurasi aplikasi bukan JSON yang sah (${filePath}).`, [
      String(error.message ?? error),
    ]);
  }

  const expo = parsed?.expo;
  if (expo === null || typeof expo !== 'object') {
    return fail(`Berkas konfigurasi aplikasi tidak memuat objek \`expo\` (${filePath}).`);
  }
  if (typeof expo.version !== 'string' || !VERSION_NAME.test(expo.version)) {
    return fail(
      `\`expo.version\` di ${filePath} bukan versi semver: ${JSON.stringify(expo.version)}.`,
      ['Versi itu dikirim ke Gradle sebagai versionName, jadi harus bentuk yang bisa dipercaya.'],
    );
  }
  return expo;
}

/** Membaca rahasia dari lingkungan, tanpa pernah menyebut nilainya di pesan galat. */
function readSecrets(env) {
  const missing = SECRETS.filter(([name]) => typeof env[name] !== 'string' || env[name] === '');
  if (missing.length > 0) {
    return fail(
      `Rahasia tanda tangan rilis belum lengkap: ${missing.map(([name]) => name).join(', ')} belum diatur.`,
      [
        ...missing.map(([name, description]) => `- ${name}: ${description}`),
        'Atur keempatnya sebagai secret repository di Settings → Secrets and variables → Actions (nama dan caranya: docs/SETUP_GUIDE.md bagian 6.1).',
      ],
    );
  }
  return Object.fromEntries(SECRETS.map(([name]) => [name, env[name]]));
}

/**
 * Memastikan keystore benar-benar bisa dibuka dan aliasnya ada, memakai `keytool`
 * dari JDK. Sandi dikirim lewat `-storepass:env` / `-keypass:env` supaya tidak pernah
 * muncul di daftar proses atau log perintah.
 *
 * Bila `keytool` tidak ada, pemeriksaan ini dilewati dengan peringatan: yang penting
 * bukan `keytool`-nya, melainkan build dengan kunci yang benar.
 */
function checkKeystore({ keytool, keystorePath, alias }) {
  const run = (args) =>
    spawnSync(keytool, args, {
      encoding: 'utf8',
      env: process.env,
    });

  const probe = run(['-help']);
  if (probe.error?.code === 'ENOENT') {
    console.error(
      '::warning::`keytool` tidak ditemukan, jadi alias serta sandi keystore tidak bisa diperiksa lebih dulu; kegagalannya baru akan terlihat saat Gradle menandatangani.',
    );
    return false;
  }

  const result = run([
    '-list',
    '-keystore',
    keystorePath,
    '-storepass:env',
    'ANDROID_KEYSTORE_PASSWORD',
    '-keypass:env',
    'ANDROID_KEY_PASSWORD',
    '-alias',
    alias,
  ]);

  if (result.error) {
    return fail(`Tidak bisa menjalankan keytool (${result.error.message}).`);
  }
  if ((result.status ?? 1) !== 0) {
    return fail(
      `Keystore atau aliasnya tidak bisa dibuka menurut keytool (exit ${result.status ?? 'tidak diketahui'}): ${keystorePath}, alias ${alias}.`,
      [
        ...`${result.stdout ?? ''}\n${result.stderr ?? ''}`
          .split('\n')
          .filter((line) => line.trim() !== '')
          .slice(-4),
        'Periksa ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD, dan ANDROID_KEY_ALIAS. Pesan di atas datang dari keytool dan tidak memuat sandi.',
      ],
    );
  }
  return true;
}

function main() {
  const options = parseOptions(process.argv.slice(2), {
    usage: USAGE,
    values: {
      '--project': 'direktori proyek Android hasil prebuild',
      '--version-code': 'nomor versi build, atau `auto` untuk menghitungnya dari git',
      '--app-config': 'berkas konfigurasi aplikasi (app.json)',
    },
    required: ['--project', '--version-code'],
  });

  const projectDir = options['--project'];
  const appConfigPath = options['--app-config'] ?? 'app.json';
  const requested = options['--version-code'];

  const gradleFile = path.join(projectDir, 'app', 'build.gradle');
  if (!fs.existsSync(gradleFile)) {
    return fail(`Berkas ${gradleFile} tidak ada, jadi ini bukan proyek Android hasil prebuild.`, [
      'Jalankan `npx expo prebuild --platform android --no-install` lebih dulu.',
    ]);
  }

  const expo = readAppConfig(appConfigPath);
  const secrets = readSecrets(process.env);

  const keystorePath = path.resolve(secrets.ANDROID_KEYSTORE_PATH);
  let keystoreBuffer;
  try {
    keystoreBuffer = fs.readFileSync(keystorePath);
  } catch (error) {
    return fail(`Berkas keystore rilis tidak bisa dibaca (${keystorePath}).`, [
      String(error.message ?? error),
      'ANDROID_KEYSTORE_PATH menunjuk sebuah berkas .jks/.p12 di runner, bukan isinya dan bukan nilai base64-nya.',
    ]);
  }
  if (keystoreBuffer.length === 0) {
    return fail(`Berkas keystore rilis kosong (${keystorePath}).`);
  }
  const kind = keystoreKind(keystoreBuffer);
  if (kind === null) {
    return fail(
      `Berkas ${keystorePath} bukan keystore JKS maupun PKCS#12 (magic bytes tidak dikenali).`,
      [
        'Penyebab yang paling sering: secret berisi base64 yang belum didekode, atau berkas lain (mis. sertifikat .pem) yang tertukar.',
      ],
    );
  }

  const alias = secrets.ANDROID_KEY_ALIAS;
  const keytoolPath = process.env.KEYTOOL ?? 'keytool';
  checkKeystore({ keytool: keytoolPath, keystorePath, alias });

  const versionCodeInput =
    requested === 'auto' ? deriveVersionCode() : Number.parseInt(requested, 10);
  const versionCode = chooseVersionCode({
    versionCode: versionCodeInput,
    floor: expo.android?.versionCode,
  });

  const versionName = expo.version;
  const propertiesPath = path.join(projectDir, 'local-signing.properties');
  fs.writeFileSync(
    propertiesPath,
    signingProperties({
      storeFile: keystorePath,
      storePassword: secrets.ANDROID_KEYSTORE_PASSWORD,
      keyAlias: alias,
      keyPassword: secrets.ANDROID_KEY_PASSWORD,
    }),
    { mode: 0o600 },
  );

  const original = fs.readFileSync(gradleFile, 'utf8');
  const { content, replaced } = applySigningBlock(
    original,
    signingBlock({ versionCode, versionName }),
  );
  fs.writeFileSync(gradleFile, content);

  console.error(
    `::notice::Konfigurasi rilis siap — versionCode ${versionCode}, versionName ${versionName}, keystore ${kind} (${path.basename(keystorePath)}), blok Gradle ${replaced ? 'diganti' : 'ditambahkan'}.`,
  );
  process.stdout.write(
    `version_code=${versionCode}\nversion_name=${versionName}\nkeystore_type=${kind}\n`,
  );
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung; fungsi di atas murni dan
// dipakai test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
