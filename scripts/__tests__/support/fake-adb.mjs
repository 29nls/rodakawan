#!/usr/bin/env node
/**
 * `adb` tiruan untuk test `scripts/smoke-test-apk.mjs` dan
 * `scripts/device-checklist.mjs`.
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
 *     "pidof": [\"\", \"12345\\n\"],           // daftar jawaban berurutan
 *     "exit": { "install": 1 },           // status keluar per perintah
 *   }
 *
 * Kunci yang tidak disebut memakai jawaban bawaan yang masuk akal (lihat
 * `DEFAULTS`), jadi satu skenario biasanya cukup satu-dua baris. Kunci yang
 * isinya berupa daftar dipakai berurutan: pemanggilan pertama mengambil isi
 * pertama, pemanggilan berikutnya maju satu langkah, dan pemanggilan terakhir
 * mengulang isi terakhir — dipakai untuk `airplane_state`, yang nilainya harus
 * berubah setelah mode pesawat dimatikan.
 *
 * Awalan `-s <serial>` yang dipakai `device-checklist.mjs` dilewati saat
 * menentukan jawaban, tetapi **tetap dicatat** apa adanya di log, supaya test
 * bisa membuktikan setiap perintah mengarah ke perangkat yang dipilih.
 */
import fs from 'node:fs';

const scenarioFile = process.env.SMOKE_FAKE_ADB_SCENARIO;
if (scenarioFile === undefined || scenarioFile === '') {
  process.stderr.write('SMOKE_FAKE_ADB_SCENARIO tidak diatur.\n');
  process.exit(2);
}

const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '-s' ? rawArgs.slice(2) : rawArgs;

const logFile = process.env.SMOKE_FAKE_ADB_LOG;
if (logFile !== undefined && logFile !== '') {
  fs.appendFileSync(logFile, `${JSON.stringify(rawArgs)}\n`);
}

const packageId = scenario.package ?? 'com.rodakawan.app';

const DEFAULT_SHA256 = 'a'.repeat(64);

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
  devices: 'List of devices attached\nTEST1234\tdevice\n',
  props:
    '[ro.product.manufacturer]: [Google]\n' +
    '[ro.product.brand]: [google]\n' +
    '[ro.product.model]: [Pixel 7]\n' +
    '[ro.product.device]: [panther]\n' +
    '[ro.build.version.release]: [14]\n' +
    '[ro.build.version.sdk]: [34]\n' +
    '[ro.build.version.security_patch]: [2026-08-05]\n' +
    '[ro.build.abi]: [arm64-v8a]\n' +
    '[ro.build.fingerprint]: [google/panther/panther:14/AP2A.240905.003/12228894:user/release-keys]\n',
  date: '1760000000\n',
  packageDump:
    `Packages:\n  Package [${packageId}] (1234abcd):\n` +
    '    userId=10234 gids=[]\n' +
    '    versionCode=23 minSdk=24 targetSdk=30\n' +
    '    versionName=0.1.0\n' +
    '    firstInstallTime=2026-10-16 06:00:00\n' +
    '    lastUpdateTime=2026-10-16 06:00:00\n',
  pmPath: `package:/data/app/~~Zz0/${packageId}-Zz0/base.apk\n`,
  sha256: `${DEFAULT_SHA256}  /data/app/base.apk\n`,
  uiDumpCmd: 'UI hierchary dumped to: /sdcard/rodakawan-uiautomator.xml\n',
  uiDumpCat:
    "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n" +
    '<hierarchy rotation="0">\n' +
    `  <node class="android.widget.FrameLayout" resource-id="${packageId}:id/screen" />\n` +
    '</hierarchy>\n',
  airplaneCmd: '',
  // Perubahan flag mode pesawat: `0` sebelum diputus, `1` sesudah, `1` sebelum
  // dipulihkan, `0` sesudah — lalu berhenti di nilai terakhir.
  airplaneState: ['0\n', '1\n', '1\n', '0\n'],
  rm: '',
  svc: '',
  exitSmoke: 0,
};

/** Nama perintah yang dikenali dari sebuah pemanggilan adb, atau `null`. */
function commandName(argv) {
  const [first, ...rest] = argv;
  if (first === 'devices') return 'devices';
  if (first === 'install') return 'install';
  if (first === 'logcat') return rest.includes('-c') ? 'logcatClear' : 'logcat';
  if (first === 'exec-out') {
    if (rest[0] === 'screencap') return 'screencap';
    if (rest[0] === 'cat') return 'uiDumpCat';
    return null;
  }
  if (first !== 'shell') return null;

  const [tool, ...toolArgs] = rest;
  if (tool === 'getprop') {
    if (toolArgs.length === 0) return 'props';
    return toolArgs[0] === 'sys.boot_completed' ? 'boot' : 'prop';
  }
  if (tool === 'pidof') return 'pidof';
  if (tool === 'date') return 'date';
  if (tool === 'pm' && toolArgs[0] === 'path') return 'pmPath';
  if (tool === 'sha256sum') return 'sha256';
  if (tool === 'uiautomator' && toolArgs[0] === 'dump') return 'uiDumpCmd';
  if (tool === 'settings' && toolArgs[0] === 'get') return 'airplaneState';
  if (tool === 'rm') return 'rm';
  if (tool === 'svc') return 'svc';
  if (tool === 'cmd') {
    if (toolArgs[0] === 'package') return 'resolve';
    if (toolArgs[0] === 'connectivity') return 'airplaneCmd';
  }
  if (tool === 'am' && toolArgs[0] === 'start') return 'amStart';
  if (tool === 'dumpsys') {
    if (toolArgs[0] === 'activity') return 'activities';
    if (toolArgs[0] === 'window') return 'window';
    if (toolArgs[0] === 'gfxinfo') return 'gfxinfo';
    if (toolArgs[0] === 'package') return 'packageDump';
  }
  return null;
}

/** Skenario untuk sebuah perintah, dengan jawaban bawaan bila tidak disebut. */
function answer(name, argv) {
  // Jawaban bawaan ikut masuk jalur yang sama dengan skenario: `airplaneState`
  // berupa daftar, dan daftar yang tidak pernah dibaca sebagai daftar akan
  // dikirim sebagai teks `'0\n,1\n,…'` — bukan `'0'`.
  const configured = scenario[name] === undefined ? DEFAULTS[name] : scenario[name];
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
  return '';
}

const name = commandName(args);
const output = answer(name, args);
const status = scenario.exit?.[name] ?? 0;

process.stdout.write(Buffer.from(String(output)));
process.exit(Number(status));
