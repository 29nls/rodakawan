#!/usr/bin/env node
/**
 * `adb` tiruan untuk test `scripts/smoke-test-apk.mjs`.
 *
 * Test di `scripts/__tests__` sengaja menjalankan script yang sebenarnya, bukan
 * mem-mock fungsinya: yang paling mudah rusak diam-diam pada uji nyala adalah
 * **urutan langkahnya** (logcat dibersihkan sebelum peluncuran, proses dipantau
 * setelah diluncurkan) dan bentuk keluaran adb yang diurai. Emulator sungguhan
 * tidak ada di mesin pengembang maupun di CI unit test, jadi yang diganti hanya
 * lapisan adb-nya: berkas ini dipanggil persis seperti adb, dan mencatat setiap
 * perintah yang diterimanya ke `SMOKE_FAKE_ADB_LOG` supaya urutannya bisa
 * diperiksa dari test.
 *
 * Keluarannya ditentukan skenario JSON di `SMOKE_FAKE_ADB_SCENARIO`:
 *
 *   {
 *     "package": "com.example.app",       // dipakai untuk jawaban bawaan
 *     "install": "Success\n",             // teks jawaban
 *     "pidof": ["", "12345\n"],           // daftar jawaban berurutan
 *     "exit": { "install": 1 },           // status keluar per perintah
 *   }
 *
 * Kunci yang tidak disebut memakai jawaban bawaan yang masuk akal (lihat
 * `DEFAULTS`), jadi satu skenario biasanya cukup satu-dua baris. Kunci yang
 * isinya berupa daftar dipakai berurutan: pemanggilan pertama mengambil isi
 * pertama, pemanggilan berikutnya maju satu langkah, dan pemanggilan terakhir
 * mengulang isi terakhir.
 */
import fs from 'node:fs';

const scenarioFile = process.env.SMOKE_FAKE_ADB_SCENARIO;
if (scenarioFile === undefined || scenarioFile === '') {
  process.stderr.write('SMOKE_FAKE_ADB_SCENARIO tidak diatur.\n');
  process.exit(2);
}

const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
const args = process.argv.slice(2);

const logFile = process.env.SMOKE_FAKE_ADB_LOG;
if (logFile !== undefined && logFile !== '') {
  fs.appendFileSync(logFile, `${JSON.stringify(args)}\n`);
}

const packageId = scenario.package ?? 'com.rodakawan.app';

const DEFAULTS = {
  boot: '1\n',
  install: 'Performing Streamed Install\nSuccess\n',
  logcatClear: '',
  logcat: '',
  screencap: 'PNGDATA',
  gfxinfo: 'Total frames rendered: 3\n',
  activities: `  topResumedActivity=ActivityRecord{ab12 u0 ${packageId}/.MainActivity t42}\n`,
  window: `  mCurrentFocus=Window{ab12 u0 ${packageId}/${packageId}.MainActivity}\n`,
  pidof: ['12345\n'],
};

/** Nama perintah yang dikenali dari sebuah pemanggilan adb, atau `null`. */
function commandName(argv) {
  const [first, ...rest] = argv;
  if (first === 'install') return 'install';
  if (first === 'logcat') return rest.includes('-c') ? 'logcatClear' : 'logcat';
  if (first === 'exec-out' && rest[0] === 'screencap') return 'screencap';
  if (first !== 'shell') return null;

  const [tool, ...toolArgs] = rest;
  if (tool === 'getprop' && toolArgs[0] === 'sys.boot_completed') return 'boot';
  if (tool === 'pidof') return 'pidof';
  if (tool === 'cmd' && toolArgs[0] === 'package') return 'resolve';
  if (tool === 'am' && toolArgs[0] === 'start') return 'amStart';
  if (tool === 'dumpsys') {
    if (toolArgs[0] === 'activity') return 'activities';
    if (toolArgs[0] === 'window') return 'window';
    if (toolArgs[0] === 'gfxinfo') return 'gfxinfo';
  }
  return null;
}

/** Skenario untuk sebuah perintah, dengan jawaban bawaan bila tidak disebut. */
function answer(name, argv) {
  const configured = scenario[name];
  if (Array.isArray(configured)) {
    const stateFile = `${scenarioFile}.state.json`;
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    const index = Math.min(state[name] ?? 0, configured.length - 1);
    state[name] = index + 1;
    fs.writeFileSync(stateFile, JSON.stringify(state));
    return configured[index];
  }
  if (typeof configured === 'string') return configured;
  if (name === 'resolve') {
    // `cmd package resolve-activity --brief <paket>` — id paket diambil dari
    // permintaannya supaya jawabannya selalu konsisten dengan yang diminta.
    const requested = argv[argv.length - 1];
    return `${requested}/.MainActivity\n`;
  }
  if (name === 'amStart') {
    const component = argv[argv.length - 1];
    return [
      `Starting: Intent { cmp=${component} }`,
      'Status: ok',
      `Activity: ${component}`,
      'ThisTime: 100',
      'TotalTime: 120',
      'WaitTime: 130',
      'Complete',
      '',
    ].join('\n');
  }
  if (name in DEFAULTS) return DEFAULTS[name];
  return '';
}

const name = commandName(args);
const output = answer(name, args);
const status = scenario.exit?.[name] ?? 0;

process.stdout.write(Buffer.from(String(output)));
process.exit(Number(status));
