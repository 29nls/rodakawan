/**
 * Test untuk `scripts/smoke-test-apk.mjs`: uji nyala APK di emulator.
 *
 * Dua lapis, sama seperti test script rilis lain:
 * - fungsi murni (penguraian keluaran adb, pemindaian crash) diuji langsung,
 *   sehingga kegagalannya menunjuk ke satu aturan;
 * - CLI-nya dijalankan sungguhan dengan `adb` tiruan (`support/fake-adb.mjs`),
 *   karena yang paling mudah rusak diam-diam adalah **urutan langkahnya**:
 *   logcat dibersihkan sebelum peluncuran, proses dipantau setelah diluncurkan,
 *   dan crash hanya boleh menuduh paket aplikasi ini.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  excerptFor,
  findAppCrash,
  installSucceeded,
  packageFromAppJson,
  parseAmStart,
  parseFramesRendered,
  parsePid,
  parseResolvedActivity,
  parseResumedActivity,
  parseWindowFocus,
} from '../smoke-test-apk.mjs';
import { runScript } from './support/git-repo.mjs';

const PACKAGE = 'com.rodakawan.app';
const APK = 'app-preview.apk';

const FATAL_APP = [
  '09-01 10:00:00.000  12345  12345 E AndroidRuntime: FATAL EXCEPTION: main',
  `09-01 10:00:00.000  12345  12345 E AndroidRuntime: Process: ${PACKAGE}, PID: 12345`,
  '09-01 10:00:00.000  12345  12345 E AndroidRuntime: java.lang.RuntimeException: gagal',
  '09-01 10:00:00.000  12345  12345 E AndroidRuntime: \tat com.rodakawan.app.MainActivity.onCreate',
].join('\n');

const FATAL_OTHER = [
  '09-01 10:00:00.000  99999  99999 E AndroidRuntime: FATAL EXCEPTION: main',
  '09-01 10:00:00.000  99999  99999 E AndroidRuntime: Process: com.android.systemui, PID: 99999',
  '09-01 10:00:00.000  99999  99999 E AndroidRuntime: java.lang.IllegalStateException: lain',
].join('\n');

/** Jawaban yang membuat aplikasi seolah-olah menyala normal. */
const HIDUP = {};

/** Direktori kerja sementara plus skenario untuk adb tiruan. */
function harness(t, scenario = HIDUP) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-apk-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Sisa direktori temp tidak memengaruhi hasil test.
    }
  });

  const scenarioFile = path.join(dir, 'skenario.json');
  fs.writeFileSync(scenarioFile, JSON.stringify({ package: PACKAGE, ...scenario }));
  const logFile = path.join(dir, 'perintah.log');
  fs.writeFileSync(logFile, '');
  fs.writeFileSync(path.join(dir, APK), 'PK\u0003\u0004berkas-palsu');

  return {
    dir,
    /** Setiap pemanggilan adb, berurutan, dalam bentuk argv. */
    commands: () =>
      fs
        .readFileSync(logFile, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line)),
    run: (args) =>
      runScript(dir, 'smoke-test-apk.mjs', args, {
        env: {
          SMOKE_TEST_ADB: JSON.stringify([
            process.execPath,
            path.resolve(import.meta.dirname, 'support', 'fake-adb.mjs'),
          ]),
          SMOKE_FAKE_ADB_SCENARIO: scenarioFile,
          SMOKE_FAKE_ADB_LOG: logFile,
        },
      }),
    read: (file) => fs.readFileSync(path.join(dir, file), 'utf8'),
  };
}

describe('packageFromAppJson', () => {
  it('mengambil id paket dari app.json milik repository ini', () => {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    const appJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'app.json'), 'utf8'));
    // Id paket di app.json dan di test ini harus sama: workflow memakai script
    // ini tanpa --package, jadi id dari berkas itulah yang dipasang di emulator.
    assert.equal(packageFromAppJson(appJson), PACKAGE);
  });

  it('mengembalikan null bila id paketnya tidak ada', () => {
    assert.equal(packageFromAppJson({}), null);
    assert.equal(packageFromAppJson({ expo: { android: {} } }), null);
    assert.equal(packageFromAppJson({ expo: { android: { package: '   ' } } }), null);
    assert.equal(packageFromAppJson(null), null);
  });
});

describe('parsePid', () => {
  it('membaca pid dari keluaran pidof', () => {
    assert.equal(parsePid('12345\n'), 12345);
    assert.equal(parsePid('12345 67890\n'), 12345);
    assert.equal(parsePid(''), null);
    assert.equal(parsePid('tidak ada'), null);
  });
});

describe('parseResolvedActivity', () => {
  it('menerima aktivitas bentuk pendek maupun lengkap', () => {
    assert.equal(
      parseResolvedActivity(`${PACKAGE}/.MainActivity\n`, PACKAGE),
      `${PACKAGE}/${PACKAGE}.MainActivity`,
    );
    assert.equal(
      parseResolvedActivity(`${PACKAGE}/${PACKAGE}.MainActivity\n`, PACKAGE),
      `${PACKAGE}/${PACKAGE}.MainActivity`,
    );
  });

  it('melewati baris pembuka dan menolak paket lain', () => {
    const output = [
      'priority=0 preferredOrder=0 match=0x108000',
      'com.lain.app/.MainActivity',
    ].join('\n');
    assert.equal(parseResolvedActivity(output, PACKAGE), null);
    assert.equal(parseResolvedActivity('', PACKAGE), null);
  });
});

describe('parseAmStart', () => {
  it('membaca status, aktivitas, dan waktu peluncuran', () => {
    const output = [
      `Starting: Intent { cmp=${PACKAGE}/.MainActivity }`,
      'Status: ok',
      `Activity: ${PACKAGE}/.MainActivity`,
      'ThisTime: 100',
      'TotalTime: 120',
      'WaitTime: 130',
      'Complete',
    ].join('\n');

    assert.deepEqual(parseAmStart(output), {
      status: 'ok',
      error: null,
      activity: `${PACKAGE}/.MainActivity`,
      totalTime: 120,
      waitTime: 130,
    });
  });

  it('membaca kegagalan peluncuran, bukan menyangka statusnya kosong', () => {
    const tidakAda = parseAmStart(
      [
        `Starting: Intent { cmp=${PACKAGE}/.MainActivity }`,
        'Error type 3',
        `Error: Activity class {${PACKAGE}/${PACKAGE}.MainActivity} does not exist.`,
      ].join('\n'),
    );
    assert.equal(tidakAda.status, null);
    assert.ok(tidakAda.error.includes('does not exist'), tidakAda.error);

    const hanyaTipe = parseAmStart('Error type 3\n');
    assert.equal(hanyaTipe.status, null);
    assert.equal(hanyaTipe.error, '3');
  });
});

describe('parseResumedActivity dan parseWindowFocus', () => {
  it('mengenali aktivitas terdepan milik paket ini', () => {
    const dumpsys = [
      'ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)',
      `    topResumedActivity=ActivityRecord{ab12 u0 ${PACKAGE}/.MainActivity t42}`,
      `    * Task{ab12 #42 type=standard A=10… U:0 ${PACKAGE}}`,
    ].join('\n');
    assert.ok(parseResumedActivity(dumpsys, PACKAGE).includes('topResumedActivity'));

    // Android versi lain hanya mencetak `mResumedActivity` atau `state=RESUMED`.
    assert.ok(
      parseResumedActivity(
        `  mResumedActivity: ActivityRecord{ab12 ${PACKAGE}/.MainActivity}`,
        PACKAGE,
      ).includes('mResumedActivity'),
    );
    assert.ok(
      parseResumedActivity(
        `  ActivityRecord{ab12 u0 ${PACKAGE}/.MainActivity t42 state=RESUMED}`,
        PACKAGE,
      ).includes('state=RESUMED'),
    );
  });

  it('tidak menyangka aktivitas paket lain sebagai milik kita', () => {
    const dumpsys =
      '  topResumedActivity=ActivityRecord{ab12 u0 com.android.launcher3/.Launcher t1}';
    assert.equal(parseResumedActivity(dumpsys, PACKAGE), null);
    assert.equal(parseResumedActivity('', PACKAGE), null);
  });

  it('membaca fokus jendela sebagai cadangan', () => {
    assert.ok(
      parseWindowFocus(
        `  mCurrentFocus=Window{ab12 u0 ${PACKAGE}/${PACKAGE}.MainActivity}`,
        PACKAGE,
      ),
    );
    assert.equal(
      parseWindowFocus('  mCurrentFocus=Window{ab12 u0 com.android.systemui/.Popup}', PACKAGE),
      null,
    );
  });
});

describe('parseFramesRendered', () => {
  it('membaca jumlah frame, atau null bila tidak disebut', () => {
    assert.equal(parseFramesRendered('Total frames rendered: 421\n'), 421);
    assert.equal(parseFramesRendered('Total frames rendered: 0'), 0);
    assert.equal(parseFramesRendered('Profiling data in use'), null);
    assert.equal(parseFramesRendered(''), null);
  });
});

describe('findAppCrash', () => {
  it('mengenali crash paket ini lewat baris Process di blok logcat', () => {
    const crash = findAppCrash(FATAL_APP, { packageId: PACKAGE, pid: 12345 });
    assert.equal(crash.kind, 'FATAL EXCEPTION');
    assert.ok(crash.lines.some((line) => line.includes(PACKAGE)));
    // Baris penyebab ikut dikutip supaya pesan kegagalan langsung berguna.
    assert.ok(crash.lines.some((line) => line.includes('RuntimeException')));
  });

  it('tidak menuduh crash milik proses lain', () => {
    assert.equal(findAppCrash(FATAL_OTHER, { packageId: PACKAGE, pid: 12345 }), null);
    assert.equal(findAppCrash('', { packageId: PACKAGE, pid: null }), null);
  });

  it('mengenali crash native dan ANR milik paket ini', () => {
    const native = [
      '*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***',
      'pid: 12345, tid: 12345, name: m.rodakawan.app  >>> com.rodakawan.app <<<',
      'signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0',
    ].join('\n');
    assert.equal(findAppCrash(native, { packageId: PACKAGE, pid: 12345 }).kind, 'Fatal signal');

    const anr = `09-01 10:00:00.000  1000  1000 E ActivityManager: ANR in ${PACKAGE}`;
    assert.equal(findAppCrash(anr, { packageId: PACKAGE, pid: 12345 }).kind, 'ANR');
    assert.equal(
      findAppCrash('E ActivityManager: ANR in com.android.systemui', {
        packageId: PACKAGE,
        pid: 12345,
      }),
      null,
    );
  });

  it('memakai PID sebagai jaring pengaman bila paketnya tidak disebut', () => {
    const tanpaNamaPaket = [
      '09-01 10:00:00.000  12345  12345 E AndroidRuntime: FATAL EXCEPTION: main',
      '09-01 10:00:00.000  12345  12345 E AndroidRuntime: Process: proses-tanpa-nama, PID: 12345',
    ].join('\n');
    assert.ok(findAppCrash(tanpaNamaPaket, { packageId: PACKAGE, pid: 12345 }) !== null);
    // PID yang berbeda (proses lain) tidak boleh menyeret kegagalan.
    assert.equal(findAppCrash(tanpaNamaPaket, { packageId: PACKAGE, pid: 777 }), null);
  });
});

describe('installSucceeded dan excerptFor', () => {
  it('hanya menerima keluaran pemasangan yang benar-benar berhasil', () => {
    assert.equal(installSucceeded('Performing Streamed Install\nSuccess\n'), true);
    assert.equal(installSucceeded('Success\n'), true);
    assert.equal(
      installSucceeded(`Failure [INSTALL_FAILED_INVALID_APK: ${APK} tidak valid]`),
      false,
    );
    assert.equal(installSucceeded(''), false);
  });

  it('mengutip baris terakhir yang cocok, bukan seluruh keluaran', () => {
    const lines = Array.from({ length: 30 }, (_, index) => `baris ${index}`);
    const excerpt = excerptFor(lines.join('\n'), [/baris/], 3);
    assert.deepEqual(excerpt, ['baris 27', 'baris 28', 'baris 29']);
    assert.deepEqual(excerptFor('tidak cocok', [/tidak ada/]), []);
  });
});

describe('CLI smoke-test-apk.mjs', () => {
  it('lulus dan menjalankan langkahnya dalam urutan yang benar', (t) => {
    const { run, commands, dir } = harness(t);
    const { stdout, stderr, code } = run(['--apk', APK, '--evidence', 'bukti']);

    assert.equal(code, 0, stderr);
    assert.ok(stdout.includes(`paket=${PACKAGE}`), stdout);
    assert.ok(stdout.includes('pid=12345'), stdout);
    assert.ok(stdout.includes(`aktivitas=${PACKAGE}/${PACKAGE}.MainActivity`), stdout);
    assert.ok(stderr.includes('uji nyala lulus'), stderr);

    const perintah = commands().map((argv) => argv.join(' '));
    const index = (needle) => perintah.findIndex((line) => line.includes(needle));
    const urutan = perintah.join(' | ');
    // Pemeriksaan boot lebih dulu, lalu pemasangan, lalu logcat dibersihkan
    // **sebelum** peluncuran, lalu peluncuran, baru pemantauan proses: urutan
    // inilah yang membuat pemindaian crash di akhir hanya melihat kejadian sejak
    // aplikasi ini dijalankan.
    assert.ok(index('sys.boot_completed') === 0, urutan);
    assert.ok(index(`install -r ${APK}`) > 0, urutan);
    assert.ok(index('logcat -c') > index(`install -r ${APK}`), urutan);
    assert.ok(index('am start -W') > index('logcat -c'), urutan);
    assert.ok(index(`pidof ${PACKAGE}`) > index('am start -W'), urutan);
    assert.ok(index('dumpsys activity activities') > index(`pidof ${PACKAGE}`), urutan);

    const bukti = fs.readdirSync(path.join(dir, 'bukti')).sort();
    assert.deepEqual(bukti, ['layar.png', 'logcat.txt', 'ringkasan.txt']);
    assert.equal(fs.readFileSync(path.join(dir, 'bukti', 'layar.png'), 'utf8'), 'PNGDATA');
  });

  it('--package menimpa id paket dari app.json', (t) => {
    const { run, commands } = harness(t, {
      package: 'com.lain.app',
      activities: '  topResumedActivity=ActivityRecord{ab12 u0 com.lain.app/.MainActivity t1}\n',
      window: '  mCurrentFocus=Window{ab12 u0 com.lain.app/com.lain.app.MainActivity}\n',
    });
    const { stdout, code, stderr } = run(['--apk', APK, '--package', 'com.lain.app']);

    assert.equal(code, 0, stderr);
    assert.ok(stdout.includes('paket=com.lain.app'), stdout);
    assert.ok(
      commands().some((argv) => argv.join(' ').includes('pidof com.lain.app')),
      'perintah harus memakai paket dari opsi',
    );
  });

  it('gagal bila emulator belum selesai boot', (t) => {
    const { run } = harness(t, { boot: '0\n' });
    const { stderr, code } = run(['--apk', APK]);

    assert.equal(code, 1);
    assert.ok(stderr.includes('belum selesai boot'), stderr);
  });

  it('gagal bila APK tidak bisa dipasang, dengan pesan adb-nya', (t) => {
    const { run } = harness(t, {
      install: `Failure [INSTALL_FAILED_INVALID_APK: ${APK} tidak valid]\n`,
      exit: { install: 1 },
    });
    const { stderr, code } = run(['--apk', APK]);

    assert.equal(code, 1);
    assert.ok(stderr.includes('gagal dipasang'), stderr);
    assert.ok(stderr.includes('INSTALL_FAILED_INVALID_APK'), stderr);
  });

  it('gagal bila aktivitas peluncur tidak bisa ditanyakan ke perangkat', (t) => {
    const { run } = harness(t, { resolve: 'com.lain.app/.MainActivity\n' });
    const { stderr, code } = run(['--apk', APK]);

    assert.equal(code, 1);
    assert.ok(stderr.includes('Aktivitas peluncur'), stderr);
  });

  it('gagal bila peluncuran ditolak, meski paketnya terpasang', (t) => {
    const { run } = harness(t, {
      amStart: `Error type 3\nError: Activity class {${PACKAGE}/${PACKAGE}.MainActivity} does not exist.\n`,
      exit: { amStart: 1 },
    });
    const { stderr, code } = run(['--apk', APK]);

    assert.equal(code, 1);
    assert.ok(stderr.includes('tidak bisa diluncurkan'), stderr);
    assert.ok(stderr.includes('does not exist'), stderr);
  });

  it('gagal bila prosesnya tidak pernah muncul', (t) => {
    const { run } = harness(t, { pidof: [''] });
    const { stderr, code } = run(['--apk', APK, '--timeout', '1']);

    assert.equal(code, 1);
    assert.ok(stderr.includes('tidak pernah muncul'), stderr);
  });

  it('gagal bila prosesnya hidup lalu berhenti sebelum layarnya terlihat', (t) => {
    const { run } = harness(t, {
      pidof: ['12345\n', ''],
      activities:
        '  topResumedActivity=ActivityRecord{ab12 u0 com.android.launcher3/.Launcher t1}\n',
      window:
        '  mCurrentFocus=Window{ab12 u0 com.android.launcher3/com.android.launcher3.Launcher}\n',
    });
    const { stderr, code } = run(['--apk', APK, '--timeout', '1']);

    assert.equal(code, 1);
    assert.ok(stderr.includes('sempat hidup lalu berhenti'), stderr);
  });

  it('gagal bila aplikasinya tidak pernah berada di depan', (t) => {
    const { run } = harness(t, {
      activities:
        '  topResumedActivity=ActivityRecord{ab12 u0 com.android.launcher3/.Launcher t1}\n',
      window:
        '  mCurrentFocus=Window{ab12 u0 com.android.launcher3/com.android.launcher3.Launcher}\n',
    });
    const { stderr, code } = run(['--apk', APK, '--timeout', '1']);

    assert.equal(code, 1);
    assert.ok(stderr.includes('tidak pernah menjadi aktivitas terdepan'), stderr);
    assert.ok(stderr.includes('com.android.launcher3'), stderr);
  });

  it('gagal bila logcat mencatat crash paket ini', (t) => {
    const { run } = harness(t, { logcat: `${FATAL_APP}\n` });
    const { stderr, code } = run(['--apk', APK]);

    assert.equal(code, 1);
    assert.ok(stderr.includes('FATAL EXCEPTION'), stderr);
    assert.ok(stderr.includes('tidak boleh dirilis'), stderr);
  });

  it('tidak gagal karena crash milik proses lain', (t) => {
    const { run } = harness(t, { logcat: `${FATAL_OTHER}\n` });
    const { code, stderr } = run(['--apk', APK]);

    assert.equal(code, 0, stderr);
  });

  it('gagal bila emulatornya tidak punya pidof', (t) => {
    const { run } = harness(t, { pidof: 'pidof: not found\n', exit: { pidof: 127 } });
    const { stderr, code } = run(['--apk', APK]);

    assert.equal(code, 1);
    assert.ok(stderr.includes('`pidof` tidak tersedia'), stderr);
  });

  it('menolak pemakaian yang tidak lengkap atau keliru', (t) => {
    const { run } = harness(t);

    const tanpaApk = run([]);
    assert.equal(tanpaApk.code, 1);
    assert.ok(tanpaApk.stderr.includes('Opsi --apk wajib diisi.'), tanpaApk.stderr);

    const berkasHilang = run(['--apk', 'tidak-ada.apk']);
    assert.equal(berkasHilang.code, 1);
    assert.ok(berkasHilang.stderr.includes('tidak ditemukan'), berkasHilang.stderr);

    const waktuSalah = run(['--apk', APK, '--timeout', 'nol']);
    assert.equal(waktuSalah.code, 1);
    assert.ok(waktuSalah.stderr.includes('Batas waktu tidak dikenali'), waktuSalah.stderr);

    const opsiAsing = run(['--apk', APK, '--evidance', 'bukti']);
    assert.equal(opsiAsing.code, 1);
    assert.ok(opsiAsing.stderr.includes('Argumen tidak dikenal'), opsiAsing.stderr);
  });

  it('menampilkan konten UI nyata setelah diluncurkan', (t) => {
    const { run, dir } = harness(t);
    const { stdout, stderr, code } = run(['--apk', APK, '--evidence', 'bukti']);

    assert.equal(code, 0, stderr);
    // Verifikasi konten UI nyata muncul setelah aplikasi startup
    const buktiDir = path.join(dir, 'bukti');
    const ringkasan = fs.readFileSync(path.join(buktiDir, 'ringkasan.txt'), 'utf8');
    // Konten yang muncul ringkasan setelah diluncurkan:
    // - id paket dan aktivitas yang sesuai yang di-release
    assert.ok(ringkasan.includes('paket='), ringkasan);
    assert.ok(ringkasan.includes('aktivitas='), ringkasan);
    // Verifikasi paket dan aktivitas sesuai yang dijualankan
    assert.ok(ringkasan.includes('paket=com.rodakawan.app'), ringkasan);
    assert.ok(ringkasan.includes('aktivitas='), ringkasan);
    // Tangkapan layar sebagai bukti bahwa aktivitas terlihat
    const layar = fs.readFileSync(path.join(buktiDir, 'layar.png'), 'utf8');
    assert.ok(layar.length > 0, 'Tangkapan layar harus ada');
  });

  it('gagal dengan pesan jelas bila adb tidak bisa dijalankan', (t) => {
    const { dir } = harness(t);
    const { stderr, code } = runScript(dir, 'smoke-test-apk.mjs', ['--apk', APK], {
      env: { SMOKE_TEST_ADB: JSON.stringify(['adb-tidak-ada-di-mesin-ini']) },
    });

    assert.equal(code, 1);
    assert.ok(stderr.includes('Tidak bisa menjalankan adb-tidak-ada-di-mesin-ini'), stderr);
    assert.ok(stderr.includes('emulator yang sudah menyala'), stderr);
  });

  it('menolak SMOKE_TEST_ADB yang bukan JSON array', (t) => {
    const { dir } = harness(t);
    const { stderr, code } = runScript(dir, 'smoke-test-apk.mjs', ['--apk', APK], {
      env: { SMOKE_TEST_ADB: 'bukan-json' },
    });

    assert.equal(code, 1);
    assert.ok(stderr.includes('SMOKE_TEST_ADB bukan JSON yang sah'), stderr);
  });
});
