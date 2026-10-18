/**
 * Test untuk `scripts/device-checklist.mjs`: perekam bukti checklist perangkat
 * fisik (14 langkah, `docs/MILESTONE_2_REPORT.md` bagian 5).
 *
 * Dua lapis, sama seperti test script rilis lain:
 * - fungsi murni (pembacaan checklist dari dokumen, penguraian keluaran adb,
 *   irisan logcat per langkah) diuji langsung, sehingga kegagalannya menunjuk
 *   ke satu aturan;
 * - CLI-nya dijalankan sungguhan dengan `adb` tiruan (`support/fake-adb.mjs`)
 *   dan stdin berisi jawaban operator, karena yang paling mudah rusak diam-diam
 *   adalah **urutan perintahnya** (jaringan diputus sebelum layar luring
 *   direkam, lalu dinyalakan lagi sebelum menunggu input berikutnya) dan
 *   pemetaan jawaban operator menjadi status.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import {
  createLineReader,
  hashFile,
  isEmulator,
  isNetworkStep,
  parseAdbDevices,
  parseChecklist,
  parseDeviceProps,
  parseLogEpoch,
  parsePmPath,
  parseVersionInfo,
  renderSummary,
  resolveSteps,
  runStatus,
  sliceLogcatSince,
} from '../device-checklist.mjs';
import { runScript } from './support/git-repo.mjs';

const PACKAGE = 'com.rodakawan.app';
const APK = 'app-preview.apk';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DOC = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'MILESTONE_2_REPORT.md'), 'utf8');

/** Judul langkah pertama pada tabel dokumen, dipakai sebagai penanda baris ringkasan. */
const FIRST_STEP = 'Registrasi akun baru';

/** Argumen adb tanpa awalan `-s <serial>` yang dipakai script setelah memilih perangkat. */
const argsOf = (argv) => (argv[0] === '-s' ? argv.slice(2) : argv);

/** Direktori kerja sementara plus skenario adb tiruan dan opsi CLI bawaan. */
function harness(t, scenario = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-checklist-'));
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
    run: (args, input = '') =>
      runScript(dir, 'device-checklist.mjs', args, {
        env: {
          DEVICE_CHECKLIST_ADB: JSON.stringify([
            process.execPath,
            path.resolve(import.meta.dirname, 'support', 'fake-adb.mjs'),
          ]),
          SMOKE_FAKE_ADB_SCENARIO: scenarioFile,
          SMOKE_FAKE_ADB_LOG: logFile,
        },
        input,
      }),
    /** Membaca berkas di dalam direktori bukti. */
    evidence: (...parts) => path.join(dir, 'bukti', ...parts),
    read: (...parts) => fs.readFileSync(path.join(dir, 'bukti', ...parts), 'utf8'),
    exists: (...parts) => fs.existsSync(path.join(dir, 'bukti', ...parts)),
    /** Argumen CLI yang dipakai hampir semua test: satu langkah, tanpa jeda. */
    args: (extra = []) => ['--settle', '0', '--evidence', 'bukti', ...extra],
  };
}

describe('parseChecklist', () => {
  it('membaca 14 langkah dari dokumen dan mempertahankan teks aslinya', () => {
    const steps = parseChecklist(DOC);

    assert.equal(steps.length, 14);
    assert.deepEqual(
      steps.map((step) => step.no),
      Array.from({ length: 14 }, (_, index) => index + 1),
    );
    // Teks langkah berasal dari dokumen, bukan dari salinan di script: bila
    // tabel dokumen berubah, script ikut berubah tanpa disentuh.
    assert.match(steps[0].langkah, new RegExp(FIRST_STEP));
    assert.match(steps[13].langkah, /mode pesawat/i);
    assert.ok(steps.every((step) => step.bukti !== ''));
  });

  it('melempar bila judul bagian atau tabelnya hilang', () => {
    assert.throws(() => parseChecklist('# Dokumen lain\n\nTidak ada tabel.'), /tidak ditemukan/);
    assert.throws(
      () => parseChecklist('## Checklist uji perangkat fisik\n\nTidak ada tabel.\n'),
      /Tidak ada langkah bernomor/,
    );
  });

  it('menolak baris yang jumlah kolomnya tidak tiga', () => {
    const doc =
      '## Checklist uji perangkat fisik\n\n| # | Langkah | Bukti |\n| - | - | - |\n| 1 | a |\n';
    assert.throws(() => parseChecklist(doc), /tiga kolom/);
  });

  it('menolak nomor langkah yang tidak berurutan', () => {
    const doc =
      '## Checklist uji perangkat fisik\n\n| # | Langkah | Bukti |\n| - | - | - |\n' +
      '| 1 | a | b |\n| 3 | c | d |\n';
    assert.throws(() => parseChecklist(doc), /tidak berurutan/);
  });
});

describe('isNetworkStep', () => {
  it('mengenali langkah yang memutus jaringan tanpa bergantung pada nomornya', () => {
    const steps = parseChecklist(DOC);
    assert.deepEqual(
      steps.filter(isNetworkStep).map((step) => step.no),
      [14],
    );
    assert.equal(
      isNetworkStep({ no: 1, langkah: 'Buka garasi', bukti: 'kendaraan tampil' }),
      false,
    );
    assert.equal(isNetworkStep({ no: 1, langkah: 'Aktifkan mode pesawat', bukti: '-' }), true);
  });
});

describe('resolveSteps', () => {
  it('mengembalikan semua langkah bila pilihan kosong', () => {
    assert.deepEqual(resolveSteps(undefined, 3), [1, 2, 3]);
    assert.deepEqual(resolveSteps('  ', 3), [1, 2, 3]);
  });

  it('membaca rentang, daftar, dan gabungannya tanpa duplikat', () => {
    assert.deepEqual(resolveSteps('1-3', 14), [1, 2, 3]);
    assert.deepEqual(resolveSteps('3,1,3', 14), [1, 3]);
    assert.deepEqual(resolveSteps('1-2, 7 ,9-10', 14), [1, 2, 7, 9, 10]);
  });

  it('menolak pilihan yang salah alih-alih menjalankan semuanya', () => {
    assert.throws(() => resolveSteps('0', 14), /di luar rentang/);
    assert.throws(() => resolveSteps('15', 14), /di luar rentang/);
    assert.throws(() => resolveSteps('3-1', 14), /Rentang terbalik/);
    assert.throws(() => resolveSteps('satu', 14), /tidak dikenali/);
    assert.throws(() => resolveSteps(',', 14), /tidak memuat langkah/);
  });
});

describe('penguraian keluaran adb', () => {
  it('membaca daftar perangkat beserta keadaannya', () => {
    const output = [
      'List of devices attached',
      '* daemon started successfully',
      'TEST1234\tdevice',
      '  ',
      'ABC123\tunauthorized',
    ].join('\n');

    assert.deepEqual(parseAdbDevices(output), [
      { serial: 'TEST1234', state: 'device' },
      { serial: 'ABC123', state: 'unauthorized' },
    ]);
    assert.deepEqual(parseAdbDevices('List of devices attached\n'), []);
  });

  it('membaca properti getprop', () => {
    const props = parseDeviceProps(
      '[ro.product.model]: [Pixel 7]\n[ro.build.version.sdk]: [34]\nbaris rusak\n',
    );
    assert.deepEqual(props, { 'ro.product.model': 'Pixel 7', 'ro.build.version.sdk': '34' });
  });

  it('membaca identitas paket dan jalur APK terpasang', () => {
    const info = parseVersionInfo(
      [
        '    versionCode=23 minSdk=24 targetSdk=30',
        '    versionName=0.1.0',
        '    firstInstallTime=2026-10-16 06:00:00',
        '    lastUpdateTime=2026-10-16 07:30:00',
      ].join('\n'),
    );

    assert.equal(info.versionName, '0.1.0');
    assert.equal(info.versionCode, '23');
    assert.equal(info.firstInstallTime, '2026-10-16 06:00:00');
    assert.equal(info.lastUpdateTime, '2026-10-16 07:30:00');
    assert.equal(parsePmPath('package:/data/app/~~Zz0/base.apk\n'), '/data/app/~~Zz0/base.apk');
    assert.equal(parsePmPath(''), null);
  });
});

describe('irisan logcat', () => {
  const LOG = [
    '1759999990.100  1000  1000 I lama: sebelum langkah',
    '1760000000.000  1000  1000 I batas: tepat di awal',
    '1760000001.500  1000  1000 I baru: selama langkah',
  ].join('\n');

  it('membaca stempel epoch dan menyaring baris yang lebih tua dari langkah', () => {
    assert.equal(parseLogEpoch('1760000000.000  1000  1000 I a'), 1760000000);
    assert.equal(parseLogEpoch('10-17 10:00:00.000  1000  1000 I a'), null);

    const slice = sliceLogcatSince(LOG, 1760000000);
    assert.equal(slice.tersaring, true);
    assert.ok(!slice.text.includes('sebelum langkah'));
    assert.ok(slice.text.includes('tepat di awal'));
    assert.ok(slice.text.includes('selama langkah'));
    assert.ok(slice.text.endsWith('\n'));
  });

  it('memberi toleransi satu detik untuk kejadian di awal langkah', () => {
    const slice = sliceLogcatSince(LOG, 1760000001);
    assert.ok(slice.text.includes('tepat di awal'));
  });

  it('mengembalikan seluruh buffer apa adanya bila stempel epoch tidak ada', () => {
    const raw = '10-17 10:00:00.000  1000  1000 I a\n';
    const slice = sliceLogcatSince(raw, 1760000000);
    assert.equal(slice.tersaring, false);
    assert.equal(slice.text, raw);
    assert.deepEqual(sliceLogcatSince('', 0), { text: '', tersaring: false });
  });
});

describe('hashFile', () => {
  it('menghitung SHA-256 dan ukuran berkas', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-hash-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const kosong = path.join(dir, 'kosong.apk');
    fs.writeFileSync(kosong, '');
    assert.deepEqual(hashFile(kosong), {
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ukuran: 0,
    });

    // Nilai acuan dari `sha256sum`, bukan dihitung ulang di test: hash yang
    // salah karena bug di implementasi tidak bisa lolos dengan sendirinya.
    const abc = path.join(dir, 'abc.apk');
    fs.writeFileSync(abc, 'abc');
    assert.deepEqual(hashFile(abc), {
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      ukuran: 3,
    });

    // Berkas lebih besar dari satu blok pembacaan tetap dihitung utuh.
    const besar = path.join(dir, 'besar.apk');
    const isi = crypto.randomBytes(1024 * 1024 + 7);
    fs.writeFileSync(besar, isi);
    const hasil = hashFile(besar);
    assert.equal(hasil.ukuran, isi.length);
    assert.equal(hasil.sha256, crypto.createHash('sha256').update(isi).digest('hex'));
  });
});

describe('isEmulator', () => {
  it('membedakan emulator dari perangkat fisik', () => {
    assert.equal(isEmulator({ 'ro.kernel.qemu': '1' }), true);
    assert.equal(isEmulator({ 'ro.product.model': 'sdk_gphone64_x86_64' }), true);
    assert.equal(isEmulator({ 'ro.build.fingerprint': 'Android SDK built for x86' }), true);
    assert.equal(
      isEmulator({
        'ro.product.model': 'Pixel 7',
        'ro.build.fingerprint':
          'google/panther/panther:14/AP2A.240905.003/12228894:user/release-keys',
      }),
      false,
    );
  });
});

describe('runStatus', () => {
  const results = [
    { no: 1, status: 'direkam', direkam: true },
    { no: 2, status: 'gagal', direkam: true },
  ];

  it('lulus hanya bila semua langkah terpilih direkam operator', () => {
    assert.equal(runStatus([{ no: 1, status: 'direkam', direkam: true }], [1]), 'lulus');
    assert.equal(runStatus(results, [1, 2]), 'belum');
    assert.equal(runStatus(results.slice(0, 1), [1, 2]), 'belum');
    assert.equal(runStatus([{ no: 1, status: 'dilewati', direkam: false }], [1]), 'belum');
  });
});

describe('renderSummary', () => {
  const results = [
    {
      no: 1,
      langkah: 'Registrasi akun baru',
      status: 'direkam',
      direkam: true,
      catatan: 'pakai | pipa',
      files: ['layar.png', 'meta.json'],
    },
    { no: 2, langkah: 'Konfirmasi email', status: 'gagal', direkam: true, catatan: '', files: [] },
    { no: 3, langkah: 'Masuk', status: 'belum', direkam: false, catatan: '', files: [] },
  ];

  it('menuliskan status operator, catatan yang di-escape, dan jalur bukti', () => {
    const summary = renderSummary({
      kepala: [['Perangkat', 'Pixel 7']],
      results,
      selected: [1, 2, 3],
      status: 'belum',
    });

    assert.match(summary, /- \*\*Perangkat:\*\* Pixel 7/);
    assert.match(summary, /Hasil run: \*\*BELUM\*\*/);
    assert.match(summary, /Langkah yang ditandai gagal: 2/);
    // Langkah yang dinilai gagal tetap punya bukti, jadi hanya langkah yang
    // benar-benar belum dijalankan yang masuk daftar ini.
    assert.match(summary, /Langkah tanpa bukti: 3/);
    assert.match(summary, /pakai \\\| pipa/);
    assert.match(summary, /langkah-01\/layar\.png<br>langkah-01\/meta\.json/);
    // Baris langkah yang dilewati tidak boleh kehilangan nomor/teksnya.
    assert.match(summary, /\| 2 \| Konfirmasi email \| gagal \|/);
  });
});

describe('createLineReader', () => {
  it('mengantrekan baris yang datang sebelum diminta dan mengembalikan null saat EOF', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reader = createLineReader(input, output);

    input.write('satu\ndua\n');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(await reader.ask('Pertama: '), 'satu');
    assert.equal(await reader.ask('Kedua: '), 'dua');

    input.end();
    assert.equal(await reader.ask('Ketiga: '), null);
    reader.close();

    const prompts = output.read()?.toString() ?? '';
    assert.match(prompts, /Pertama: /);
  });
});

describe('CLI dengan adb tiruan', () => {
  it('--list menampilkan seluruh langkah dokumen tanpa menyentuh perangkat', (t) => {
    const h = harness(t);
    const run = h.run(['--list']);

    assert.equal(run.code, 0, run.stderr);
    const lines = run.stdout.replace(/\n$/, '').split('\n');
    assert.equal(lines.length, 14);
    assert.match(lines[0], new RegExp(`^ 1\\. ${FIRST_STEP}`));
    assert.match(lines[13], /^\s*14\./);
    assert.deepEqual(h.commands(), []);
  });

  it('merekam satu langkah: tangkapan layar, hierarki UI, logcat, dan meta', (t) => {
    const h = harness(t, {
      logcat: [
        '1759999990.000  1000  1000 I lama: sebelum langkah',
        '1760000000.000  1000  1000 I layar: dibuka',
      ].join('\n'),
    });

    const run = h.run(h.args(['--steps', '1']), 'r\ncatatan uji\n');

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /status=lulus/);
    assert.match(run.stdout, /langkah_direkam=1/);

    assert.equal(h.read('langkah-01', 'layar.png'), 'PNGDATA');
    assert.match(h.read('langkah-01', 'layar.xml'), /<hierarchy/);

    // Logcat per langkah hanya memuat baris sejak langkah dimulai.
    const logcat = h.read('langkah-01', 'layar-logcat.txt');
    assert.match(logcat, /dibuka/);
    assert.ok(!logcat.includes('sebelum langkah'));

    const meta = JSON.parse(h.read('langkah-01', 'meta.json'));
    assert.equal(meta.status, 'direkam');
    assert.equal(meta.catatan, 'catatan uji');
    assert.match(meta.foreground.aktivitas, /topResumedActivity/);

    // Identitas perangkat dan build ikut tercatat, bukan hanya cerita operator.
    const perangkat = JSON.parse(h.read('perangkat.json'));
    assert.equal(perangkat.serial, 'TEST1234');
    assert.equal(perangkat.perangkat['ro.product.model'], 'Pixel 7');
    assert.equal(perangkat.aplikasi.versionName, '0.1.0');
    assert.equal(perangkat.aplikasi.sha256, 'a'.repeat(64));

    const ringkasan = h.read('ringkasan.md');
    assert.match(ringkasan, /Hasil run: \*\*LULUS\*\*/);
    assert.match(ringkasan, /langkah-01\/layar\.png/);

    const json = JSON.parse(h.read('ringkasan.json'));
    assert.equal(json.status, 'lulus');
    assert.equal(json.langkah[0].no, 1);
  });

  it('mengarahkan setiap perintah ke perangkat yang dipilih dengan -s', (t) => {
    const h = harness(t, { devices: 'List of devices attached\nA1\tdevice\nB2\tdevice\n' });

    const tanpaSerial = h.run(h.args(['--steps', '1']), 'r\n\n');
    assert.equal(tanpaSerial.code, 1);
    assert.match(tanpaSerial.stderr, /--serial/);

    const run = h.run(h.args(['--serial', 'B2', '--steps', '1']), 'r\n\n');
    assert.equal(run.code, 0, run.stderr);

    // `adb devices` dipanggil tanpa -s (memang harus melihat semua perangkat);
    // semua perintah sesudah perangkat dipilih harus menunjuk B2, supaya
    // perintah tidak mendarat di perangkat lain.
    const setelahPilih = h.commands().filter((argv) => argv[0] !== 'devices');
    assert.ok(setelahPilih.length > 0);
    for (const argv of setelahPilih) {
      assert.deepEqual(argv.slice(0, 2), ['-s', 'B2'], `perintah tanpa serial: ${argv.join(' ')}`);
    }
  });

  it('menolak jalan tanpa perangkat yang siap', (t) => {
    const h = harness(t, { devices: 'List of devices attached\n' });
    const run = h.run(h.args(['--steps', '1']), 'r\n');

    assert.equal(run.code, 1);
    assert.match(run.stderr, /Tidak ada perangkat/);
  });

  it('menolak emulator kecuali --allow-emulator diberikan', (t) => {
    const h = harness(t, {
      props:
        '[ro.product.model]: [sdk_gphone64_x86_64]\n' +
        '[ro.kernel.qemu]: [1]\n[ro.build.version.sdk]: [34]\n',
    });

    const ditolak = h.run(h.args(['--steps', '1']), 'r\n\n');
    assert.equal(ditolak.code, 1);
    assert.match(ditolak.stderr, /emulator, bukan perangkat fisik/);

    const diizinkan = h.run(h.args(['--steps', '1', '--allow-emulator']), 'r\n\n');
    assert.equal(diizinkan.code, 0, diizinkan.stderr);
    assert.match(diizinkan.stderr, /Emulator dipakai atas permintaan/);
  });

  it('memasang APK dan memverifikasi SHA-256-nya sebelum merekam', (t) => {
    const h = harness(t);
    const hash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(h.dir, APK)))
      .digest('hex');

    const salah = h.run(
      h.args(['--apk', APK, '--expect-sha256', 'b'.repeat(64), '--steps', '1']),
      'r\n',
    );
    assert.equal(salah.code, 1);
    assert.match(salah.stderr, /tidak cocok dengan --expect-sha256/);
    assert.equal(h.exists('langkah-01'), false);

    const benar = h.run(h.args(['--apk', APK, '--expect-sha256', hash, '--steps', '1']), 'r\n\n');
    assert.equal(benar.code, 0, benar.stderr);

    const install = h.commands().find((argv) => argsOf(argv)[0] === 'install');
    assert.deepEqual(install, ['-s', 'TEST1234', 'install', '-r', APK]);

    const perangkat = JSON.parse(h.read('perangkat.json'));
    assert.equal(perangkat.aplikasi.sha256, hash);
    assert.equal(perangkat.aplikasi.sha256_sumber, `berkas ${APK}`);
  });

  it('berhenti bila APK gagal dipasang', (t) => {
    const h = harness(t, {
      install: 'Performing Streamed Install\nFailure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]\n',
      exit: { install: 1 },
    });

    const run = h.run(h.args(['--apk', APK, '--steps', '1']), 'r\n');

    assert.equal(run.code, 1);
    assert.match(run.stderr, /gagal dipasang/);
    assert.match(run.stderr, /INSTALL_FAILED_UPDATE_INCOMPATIBLE/);
    assert.equal(h.exists('langkah-01'), false);
  });

  it('menandai langkah yang dilewati dan tetap menulis barisnya di ringkasan', (t) => {
    const h = harness(t);
    const run = h.run(h.args(['--steps', '1']), 's\n');

    assert.equal(run.code, 1);
    assert.match(run.stdout, /status=belum/);
    assert.match(run.stderr, /Langkah 1 dilewati/);

    const json = JSON.parse(h.read('ringkasan.json'));
    assert.equal(json.langkah[0].status, 'dilewati');
    assert.equal(json.langkah[0].no, 1);
    assert.equal(json.langkah[0].langkah.includes(FIRST_STEP), true);

    const ringkasan = h.read('ringkasan.md');
    assert.match(ringkasan, /Langkah tanpa bukti: 1/);
    assert.match(ringkasan, new RegExp(`\\| 1 \\| ${FIRST_STEP}`));
  });

  it('merekam langkah yang dinilai gagal tanpa menghentikan run', (t) => {
    const h = harness(t);
    const run = h.run(h.args(['--steps', '4']), 'g\nsandi salah diterima\n');

    assert.equal(run.code, 1);
    const json = JSON.parse(h.read('ringkasan.json'));
    assert.equal(json.status, 'belum');
    assert.equal(json.langkah[0].status, 'gagal');
    assert.equal(json.langkah[0].catatan, 'sandi salah diterima');
    assert.match(h.read('ringkasan.md'), /Langkah yang ditandai gagal: 4/);
    // Bukti tetap diambil: penilaian "gagal" justru yang paling butuh bukti.
    assert.equal(h.exists('langkah-04', 'layar.png'), true);
  });

  it('menandai langkah yang belum sempat dijalankan saat operator berhenti', (t) => {
    const h = harness(t);
    const run = h.run(h.args(['--steps', '1-2']), 'r\n\nq\n');

    assert.equal(run.code, 1);
    const json = JSON.parse(h.read('ringkasan.json'));
    assert.equal(json.langkah[0].status, 'direkam');
    assert.equal(json.langkah[1].status, 'belum');
    assert.match(h.read('ringkasan.md'), /Langkah tanpa bukti: 2/);
  });

  it('langkah jaringan: putus, rekam luring, pulihkan, lalu rekam pemulihan', (t) => {
    const h = harness(t);
    const run = h.run(h.args(['--steps', '14', '--settle', '0']), 'r\n\n\n');

    assert.equal(run.code, 0, run.stderr);

    const log = h.commands().map(argsOf);
    const airplane = log.filter(
      (argv) => argv[0] === 'shell' && argv[1] === 'cmd' && argv[2] === 'connectivity',
    );
    assert.deepEqual(
      airplane.map((argv) => argv.slice(3).join(' ')),
      ['airplane-mode enable', 'airplane-mode disable'],
    );

    assert.equal(h.exists('langkah-14', 'layar-offline.png'), true);
    assert.equal(h.exists('langkah-14', 'layar-pulih.png'), true);
    // Dua tangkapan pada satu langkah harus punya berkas logcat masing-masing.
    assert.equal(h.exists('langkah-14', 'layar-offline-logcat.txt'), true);
    assert.equal(h.exists('langkah-14', 'layar-pulih-logcat.txt'), true);

    const meta = JSON.parse(h.read('langkah-14', 'meta.json'));
    assert.equal(meta.status, 'direkam');
    assert.equal(meta.network.pemutusan.method, 'cmd connectivity airplane-mode');
    assert.equal(meta.network.pemutusan.sesudah, '1');
    assert.equal(meta.network.pemulihan.ok, true);
    assert.equal(meta.network.pemulihan.sesudah, '0');

    // Mode pesawat benar-benar aktif saat layar luring direkam: perintah
    // `enable` muncul sebelum `screencap`, dan pemulihannya sesudahnya.
    const indexAktif = log.findIndex(
      (argv) => argv[1] === 'cmd' && argv[3] === 'airplane-mode' && argv[4] === 'enable',
    );
    const indexPulih = log.findIndex(
      (argv) => argv[1] === 'cmd' && argv[3] === 'airplane-mode' && argv[4] === 'disable',
    );
    const indexScreencap = log.findIndex(
      (argv) => argv[0] === 'exec-out' && argv[1] === 'screencap',
    );
    assert.ok(indexAktif < indexScreencap, 'jaringan harus diputus sebelum layar luring direkam');
    assert.ok(indexScreencap < indexPulih, 'jaringan harus dinyalakan lagi setelah layar luring');
  });

  it('menolak pilihan langkah di luar tabel', (t) => {
    const h = harness(t);
    const run = h.run(h.args(['--steps', '99']), '');

    assert.equal(run.code, 1);
    assert.match(run.stderr, /di luar rentang/);
  });

  it('menolak DEVICE_CHECKLIST_ADB yang bukan JSON array', (t) => {
    const h = harness(t);
    const run = runScript(h.dir, 'device-checklist.mjs', ['--steps', '1'], {
      env: { DEVICE_CHECKLIST_ADB: 'adb' },
    });

    assert.equal(run.code, 1);
    assert.match(run.stderr, /bukan JSON yang sah/);
  });
});
