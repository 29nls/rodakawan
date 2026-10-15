#!/usr/bin/env node
/**
 * Uji nyala APK di emulator Android: pasang berkasnya, luncurkan aktivitas
 * utamanya, lalu buktikan aplikasinya benar-benar hidup di layar.
 *
 * Dipakai job `smoke-test` di kedua workflow rilis **sebelum** release dibuat.
 * `scripts/verify-apk.mjs` sudah membuktikan berkasnya utuh dan benar-benar
 * ditandatangani, tetapi tidak membuktikan apa pun tentang perilakunya saat
 * dijalankan: APK yang lolos verifikasi bisa tetap mati seketika karena kode
 * native yang salah, konfigurasi aplikasi yang rusak, atau bundel JS yang tidak
 * bisa dimuat. Uji ini menutup celah itu — rilis yang tidak bisa dinyalakan
 * tidak pernah sampai ke halaman Releases.
 *
 * Yang diperiksa, dalam urutan:
 *
 *   1. Perangkat siap — `sys.boot_completed` bernilai `1` (emulator sudah boot).
 *   2. `adb install -r` melaporkan `Success`.
 *   3. `am start -W` melaporkan `Status: ok` untuk aktivitas peluncur paket itu.
 *   4. Dalam batas waktu, proses paketnya hidup (`pidof`) **dan** aktivitasnya
 *      menjadi aktivitas terdepan (`dumpsys activity activities`).
 *   5. Logcat sejak peluncuran tidak memuat crash milik paket ini
 *      (`FATAL EXCEPTION`, `Fatal signal`, `ANR in`).
 *
 * `am start -W` sengaja tidak dipercaya sendirian: ia melaporkan hasil
 * permintaan peluncuran, dan tetap berbunyi `Status: ok` untuk aplikasi yang
 * langsung mati setelah aktivitasnya diterima. Karena itu langkah 4 dan 5 ada.
 * Pemeriksaan crash hanya menuduh proses aplikasi ini — crash milik proses lain
 * (mis. `system_server` atau layanan Google) bukan kegagalan rilis ini.
 *
 * Pemakaian:
 *   node scripts/smoke-test-apk.mjs --apk app-preview.apk
 *   node scripts/smoke-test-apk.mjs --apk RodaKawan-v0.2.0.apk --timeout 90 \
 *     --evidence bukti-smoke
 *
 * Opsi:
 *   --apk <berkas>       (wajib) APK yang dipasang dan dijalankan.
 *   --package <id>       Id paket; default dari `expo.android.package` di app.json.
 *   --activity <komponen> Aktivitas peluncur bila tidak bisa ditanyakan ke
 *                        perangkat (mis. `.MainActivity` atau nama lengkap).
 *   --timeout <detik>    Batas waktu menunggu aplikasi hidup (default 60).
 *   --evidence <dir>     Direktori bukti: tangkapan layar, logcat, ringkasan.
 *                        Kosongkan bila tidak perlu.
 *
 * Prasyarat: `adb` ada di PATH dan sebuah emulator sudah berjalan (di Actions,
 * `ReactiveCircus/android-emulator-runner` yang menyiapkannya, dan
 * `ANDROID_SERIAL` sudah menunjuk perangkat itu). Script ini tidak menyalakan
 * emulator sendiri: itu tugas runner, dan memisahkannya membuat script ini bisa
 * diuji tanpa emulator lewat adb tiruan (`SMOKE_TEST_ADB`).
 *
 * Keluar dengan kode 0 bila aplikasinya benar-benar menyala; selain itu kode 1
 * dengan pesan `::error::…` beserta kutipan log yang relevan.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { fail, parseOptions } from './lib/cli.mjs';

const USAGE =
  'Pemakaian: node scripts/smoke-test-apk.mjs --apk <berkas.apk> [--package <id>] ' +
  '[--activity <komponen>] [--timeout <detik>] [--evidence <direktori>]';

const DEFAULT_TIMEOUT_SECONDS = 60;

/** Jeda antar pemeriksaan saat menunggu aplikasi hidup. */
const POLL_INTERVAL_MS = 2000;

/** Batas keluaran adb: `dumpsys` bisa mencetak puluhan ribu baris. */
const MAX_ADB_OUTPUT = 64 * 1024 * 1024;

/** Batas waktu perintah adb yang wajar lama (pemasangan APK). */
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

/** Jumlah baris yang dikutip saat melaporkan kegagalan. */
const EXCERPT_LINES = 12;

/**
 * Pola baris logcat yang menandai aplikasi berhenti bekerja. Ketiganya adalah
 * bentuk yang paling sering muncul di rilis: pengecualian tak tertangani di
 * Java/Kotlin, crash di kode native, dan aplikasi yang tidak merespons.
 */
const CRASH_PATTERNS = [
  { kind: 'FATAL EXCEPTION', pattern: /FATAL EXCEPTION/ },
  { kind: 'Fatal signal', pattern: /Fatal signal|signal \d+ \(SIG/ },
  { kind: 'ANR', pattern: /ANR in\b/ },
];

// ---------------------------------------------------------------------------
// Fungsi murni (dipakai test tanpa emulator)
// ---------------------------------------------------------------------------

/** Id paket Android dari isi `app.json`, atau `null` bila tidak ada. */
export function packageFromAppJson(appJson) {
  const id = appJson?.expo?.android?.package;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/** PID pertama dari keluaran `pidof`, atau `null` bila kosong. */
export function parsePid(output) {
  const match = /(\d+)/.exec(output ?? '');
  return match === null ? null : Number(match[1]);
}

/**
 * Aktivitas peluncur dari keluaran `cmd package resolve-activity --brief`.
 *
 * Keluarannya berbentuk `com.paket/.MainActivity` (kadang dengan baris
 * `priority=…` sesudahnya), dan `com.paket/com.paket.MainActivity` bila
 * aktivitasnya ditulis lengkap. Nama paket pada komponen pertama harus sama
 * dengan yang diminta — kalau tidak, keluaran itu milik paket lain.
 */
export function parseResolvedActivity(output, packageId) {
  for (const rawLine of (output ?? '').split('\n')) {
    const line = rawLine.trim();
    const match = /^([A-Za-z0-9_.]+)\/([A-Za-z0-9_.$]+)$/.exec(line);
    if (match === null || match[1] !== packageId) continue;
    const activity = match[2].startsWith('.') ? `${packageId}${match[2]}` : match[2];
    return `${packageId}/${activity}`;
  }
  return null;
}

/** Hasil `am start -W`: status, aktivitas, dan waktunya. */
export function parseAmStart(output) {
  const text = output ?? '';
  const pick = (label) => {
    const match = new RegExp(`^${label}:\\s*(.+)$`, 'm').exec(text);
    return match === null ? null : match[1].trim();
  };

  const status = pick('Status');
  // Kegagalan dilaporkan sebagai `Error: <pesan>`, dan sebagian versi hanya
  // mencetak `Error type <kode>` — tanpa titik dua, jadi pola terpisah diperlukan.
  const errorType = /^Error type\s+(\S+)/m.exec(text);
  const timing = (label) => {
    const value = pick(label);
    if (value === null) return null;
    const number = Number.parseInt(value, 10);
    return Number.isNaN(number) ? null : number;
  };

  return {
    status,
    error: pick('Error') ?? (errorType === null ? null : errorType[1]),
    activity: pick('Activity'),
    totalTime: timing('TotalTime'),
    waitTime: timing('WaitTime'),
  };
}

/**
 * Baris aktivitas terdepan yang menyebut paket ini, dari
 * `dumpsys activity activities`. `null` bila paketnya tidak sedang di depan
 * (mis. aplikasinya bukan fokus, atau layarnya sudah ditutup).
 */
export function parseResumedActivity(output, packageId) {
  const lines = (output ?? '').split('\n');
  const wanted = /topResumedActivity|mResumedActivity|ResumedActivity|topResumedActivity=/;

  for (const line of lines) {
    if (wanted.test(line) && line.includes(packageId)) return line.trim();
  }
  // Sebagian versi Android hanya mencetak blok `ActivityRecord{…}` tanpa label
  // `*ResumedActivity`; baris `state=RESUMED` di blok paket ini setara.
  for (const line of lines) {
    if (line.includes('state=RESUMED') && line.includes(packageId)) return line.trim();
  }
  return null;
}

/** Baris fokus jendela yang menyebut paket ini, dari `dumpsys window`. */
export function parseWindowFocus(output, packageId) {
  for (const line of (output ?? '').split('\n')) {
    if (/mCurrentFocus|mFocusedApp/.test(line) && line.includes(packageId)) return line.trim();
  }
  return null;
}

/** Jumlah frame yang digambar aplikasi (`dumpsys gfxinfo`), atau `null`. */
export function parseFramesRendered(output) {
  const match = /Total frames rendered:\s*(\d+)/.exec(output ?? '');
  return match === null ? null : Number(match[1]);
}

/**
 * Mencari crash **milik paket ini** di baris logcat.
 *
 * Blok `FATAL EXCEPTION` menaruh identitas prosesnya di baris-baris setelah
 * header (`Process: com.paket, PID: 1234`), sedangkan crash native menyebut
 * paketnya di baris yang sama atau tak jauh di sekitarnya. Karena itu setiap
 * kandidat diperiksa bersama jendela baris di sekelilingnya, lalu dicocokkan
 * dengan id paket atau PID aplikasinya.
 */
export function findAppCrash(log, { packageId, pid = null }) {
  const lines = (log ?? '').split('\n');
  const mentionsApp = (text) =>
    text.includes(packageId) || (pid !== null && new RegExp(`\\bPID: ${pid}\\b`).test(text));

  for (let index = 0; index < lines.length; index += 1) {
    const candidate = CRASH_PATTERNS.find(({ pattern }) => pattern.test(lines[index]));
    if (candidate === undefined) continue;

    const from = Math.max(0, index - 4);
    const to = Math.min(lines.length, index + 8);
    const window = lines.slice(from, to);
    if (candidate.kind === 'ANR' && !lines[index].includes(packageId)) continue;
    if (!window.some(mentionsApp)) continue;

    return { kind: candidate.kind, lines: window };
  }
  return null;
}

/** Kutipan baris yang cocok dengan salah satu pola, untuk pesan kegagalan. */
export function excerptFor(output, patterns, maxLines = EXCERPT_LINES) {
  const matched = (output ?? '')
    .split('\n')
    .filter((line) => patterns.some((pattern) => pattern.test(line)));
  return matched.slice(-maxLines);
}

/** `true` bila keluaran `adb install` menandakan pemasangan berhasil. */
export function installSucceeded(output) {
  return /^Success\b/m.test(output ?? '');
}

// ---------------------------------------------------------------------------
// Perkakas adb
// ---------------------------------------------------------------------------

/** Selama `ms` tanpa bergantung pada versi Node atau shell sistem. */
function sleep(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Argv untuk memanggil adb.
 *
 * Di runner nilainya selalu `['adb']`. `SMOKE_TEST_ADB` (JSON array argv) ada
 * hanya supaya test bisa menyuntikkan adb tiruan dan memeriksa urutan perintah
 * yang dijalankan — tanpa itu, satu-satunya cara menguji script ini adalah
 * emulator sungguhan.
 */
function adbCommand() {
  const override = process.env.SMOKE_TEST_ADB;
  if (override === undefined || override === '') return ['adb'];

  let parsed;
  try {
    parsed = JSON.parse(override);
  } catch {
    return fail('SMOKE_TEST_ADB bukan JSON yang sah.');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((it) => typeof it !== 'string')
  ) {
    return fail('SMOKE_TEST_ADB harus berupa JSON array berisi nama program dan argumennya.');
  }
  return parsed;
}

/** Menjalankan adb; tidak pernah melempar. */
function runAdb(args, { timeoutMs = null, binary = false } = {}) {
  const [program, ...prefix] = adbCommand();
  const result = spawnSync(program, [...prefix, ...args], {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: MAX_ADB_OUTPUT,
    timeout: timeoutMs ?? undefined,
  });

  if (result.error) {
    const reason =
      result.error.code === 'ETIMEDOUT'
        ? `perintah adb melewati batas waktu ${timeoutMs} ms`
        : result.error.message;
    return fail(`Tidak bisa menjalankan ${program} (${reason}).`, [
      'Script ini harus berjalan di mesin yang punya adb dan emulator yang sudah menyala.',
    ]);
  }

  return {
    status: result.status ?? 1,
    stdout: binary ? (result.stdout ?? Buffer.alloc(0)) : (result.stdout ?? ''),
    stderr: result.stderr ?? '',
  };
}

/** Menjalankan `adb <args>` dan mengembalikan keluaran teksnya. */
function adb(args, options) {
  const result = runAdb(args, options);
  return { ...result, ok: result.status === 0 };
}

/** Menjalankan perintah di dalam perangkat. */
function adbShell(args) {
  return adb(['shell', ...args]);
}

// ---------------------------------------------------------------------------
// Langkah-langkah uji
// ---------------------------------------------------------------------------

/** Aktivitas peluncur paket ini, dari perangkat atau dari `--activity`. */
function resolveLauncherActivity(packageId, explicit) {
  if (explicit !== undefined) {
    const component = explicit.startsWith('.')
      ? `${packageId}/${packageId}${explicit}`
      : explicit.includes('/')
        ? explicit
        : `${packageId}/${explicit}`;
    console.error(`::notice::Aktivitas peluncur dari opsi --activity: ${component}`);
    return component;
  }

  const result = adbShell(['cmd', 'package', 'resolve-activity', '--brief', packageId]);
  const component = result.ok ? parseResolvedActivity(result.stdout, packageId) : null;
  if (component === null) {
    return fail(`Aktivitas peluncur paket ${packageId} tidak bisa ditentukan.`, [
      ...excerptFor(`${result.stdout}\n${result.stderr}`, [/./], 5),
      'Periksa --package (id paket harus sama dengan expo.android.package), atau sebutkan',
      'aktivitasnya langsung dengan --activity .MainActivity.',
    ]);
  }
  return component;
}

/** PID proses aplikasi, atau `null` bila belum/tidak berjalan. */
function pidOf(packageId) {
  const result = adbShell(['pidof', packageId]);
  // `adb shell` menyatukan stderr perangkat ke stdout-nya, jadi keduanya
  // diperiksa; proses yang sekadar tidak berjalan keluar dengan status 1 dan
  // keluaran kosong — itu bukan kegagalan.
  if (/not found/i.test(`${result.stdout}\n${result.stderr}`)) {
    return fail(
      '`pidof` tidak tersedia di image emulator ini, jadi proses aplikasi tidak bisa dipantau.',
    );
  }
  return result.ok ? parsePid(result.stdout) : null;
}

/**
 * Aktivitas terdepan bila paket ini yang di depan.
 *
 * Mengembalikan `line` (baris yang cocok, atau `null`) sekaligus `dumpsys`
 * mentah — keluaran mentah tetap dikembalikan walau tidak ada yang cocok, supaya
 * pesan kegagalan bisa menunjukkan aktivitas apa yang sebenarnya di depan.
 * `dumpsys window` hanya dijalankan bila yang pertama tidak cocok.
 */
function currentResumedActivity(packageId) {
  const dumpsys = adbShell(['dumpsys', 'activity', 'activities']).stdout;
  const activities = parseResumedActivity(dumpsys, packageId);
  if (activities !== null) return { line: activities, dumpsys };

  const window = adbShell(['dumpsys', 'window']).stdout;
  return { line: parseWindowFocus(window, packageId), dumpsys: `${dumpsys}\n${window}` };
}

/** Menulis berkas bukti; kegagalan menulis tidak menggagalkan uji. */
function writeEvidence(dir, files) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return true;
  } catch (error) {
    console.error(`::warning::Bukti tidak bisa ditulis ke ${dir}: ${error.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Alur utama
// ---------------------------------------------------------------------------

function main() {
  const options = parseOptions(process.argv.slice(2), {
    usage: USAGE,
    values: {
      '--apk': 'sebuah berkas APK',
      '--package': 'sebuah id paket Android',
      '--activity': 'sebuah nama aktivitas',
      '--timeout': 'sejumlah detik',
      '--evidence': 'sebuah direktori',
    },
    required: ['--apk'],
  });

  const apkPath = options['--apk'];
  const evidenceDir = options['--evidence'];
  const timeoutSeconds = (() => {
    const raw = options['--timeout'];
    if (raw === undefined) return DEFAULT_TIMEOUT_SECONDS;
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value) || value < 1) {
      return fail(`Batas waktu tidak dikenali: ${raw}. Isinya jumlah detik, mis. 60.`, [USAGE]);
    }
    return value;
  })();

  if (!fs.existsSync(apkPath) || !fs.statSync(apkPath).isFile()) {
    return fail(`Berkas APK tidak ditemukan: ${apkPath}`, [USAGE]);
  }
  const apkSize = fs.statSync(apkPath).size;

  const packageId = options['--package'] ?? packageFromAppJson(readAppConfig());
  if (packageId === undefined || packageId === null) {
    return fail(
      'Id paket tidak diketahui: tidak ada --package dan app.json tidak memuat expo.android.package.',
    );
  }

  // 1. Perangkat harus sudah selesai boot; kalau tidak, kegagalan berikutnya
  // akan menyesatkan (mis. `install` menggantung karena sistem belum siap).
  const boot = adbShell(['getprop', 'sys.boot_completed']);
  if (!boot.ok || boot.stdout.trim() !== '1') {
    return fail('Emulator belum selesai boot (sys.boot_completed ≠ 1).', [
      `Keluaran adb: ${boot.stdout.trim() || '(kosong)'}`,
      'Pastikan runner sudah menunggu emulator siap sebelum script ini dijalankan.',
    ]);
  }
  console.error('::notice::Emulator siap; memasang APK.');

  // 2. Pemasangan. `-r` supaya pemasangan ulang di perangkat yang sama tidak
  // gagal karena paket sudah ada (mis. emulator dari snapshot/cache AVD).
  const install = adb(['install', '-r', apkPath], { timeoutMs: INSTALL_TIMEOUT_MS });
  if (!install.ok || !installSucceeded(install.stdout)) {
    return fail(`APK ${path.basename(apkPath)} gagal dipasang di emulator.`, [
      ...excerptFor(`${install.stdout}\n${install.stderr}`, [/./], 6),
      'Pesan INSTALL_FAILED_* di atas menjelaskan sebabnya (mis. tanda tangan tidak cocok,',
      'atau minSdk APK lebih tinggi daripada API level emulator).',
    ]);
  }
  console.error('::notice::APK terpasang.');

  const component = resolveLauncherActivity(packageId, options['--activity']);

  // 3. Logcat dibersihkan **sebelum** peluncuran supaya pemindaian crash di
  // bawah hanya melihat apa yang terjadi sejak aplikasi ini dijalankan.
  adb(['logcat', '-c']);

  const start = adbShell(['am', 'start', '-W', '-n', component]);
  const started = parseAmStart(start.stdout);
  if (start.status !== 0 || started.status !== 'ok') {
    return fail(
      `Aplikasi ${packageId} tidak bisa diluncurkan (Status: ${started.status ?? 'tidak ada'}).`,
      [
        ...excerptFor(`${start.stdout}\n${start.stderr}`, [/./], EXCERPT_LINES),
        `Komponen yang dicoba: ${component}`,
      ],
    );
  }
  console.error(
    `::notice::Peluncuran diterima (TotalTime ${started.totalTime ?? '?'} ms); menunggu aplikasi hidup.`,
  );

  // 4. Tunggu sampai prosesnya hidup **dan** layarnya di depan. Keduanya bisa
  // datang berurutan: proses hidup lebih dulu, jendelanya menjadi fokus setelah
  // aktivitasnya selesai dibuat.
  const deadline = Date.now() + timeoutSeconds * 1000;
  let pid = null;
  let aliveOnce = false;
  let resumed = null;
  let dumpsys = '';
  for (;;) {
    pid = pidOf(packageId);
    if (pid !== null) {
      aliveOnce = true;
      const depan = currentResumedActivity(packageId);
      dumpsys = depan.dumpsys;
      if (depan.line !== null) {
        resumed = depan.line;
        break;
      }
    }
    if (Date.now() >= deadline) break;
    sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }

  const logcat = adb(['logcat', '-d', '-v', 'threadtime']).stdout;
  const crash = findAppCrash(logcat, { packageId, pid });

  // 5. Crash milik aplikasi ini selalu menggagalkan uji, apakah prosesnya masih
  // hidup atau tidak (crash di thread non-utama bisa tercatat sebelum proses mati).
  if (crash !== null) {
    return fail(`Logcat mencatat ${crash.kind} pada aplikasi ${packageId}.`, [
      ...crash.lines.map((line) => line.replace(/\s+$/, '')),
      'Aplikasi yang crash saat dinyalakan tidak boleh dirilis.',
    ]);
  }

  if (pid === null) {
    return fail(
      aliveOnce
        ? `Proses ${packageId} sempat hidup lalu berhenti sebelum layarnya terlihat.`
        : `Proses ${packageId} tidak pernah muncul dalam ${timeoutSeconds} detik setelah diluncurkan.`,
      [
        ...excerptFor(logcat, [/rodakawan|AndroidRuntime|ActivityManager|libc/i], EXCERPT_LINES),
        'Periksa logcat di Actions artifact bila ada; pesan di atas biasanya menyebut sebabnya.',
      ],
    );
  }

  if (resumed === null) {
    return fail(
      `Layar aplikasi ${packageId} tidak pernah menjadi aktivitas terdepan dalam ${timeoutSeconds} detik.`,
      [
        ...excerptFor(dumpsys, [/ResumedActivity|state=RESUMED|mCurrentFocus|mFocusedApp/]),
        `Proses ${packageId} (PID ${pid}) hidup, jadi aktivitasnya kemungkinan berhenti sendiri.`,
      ],
    );
  }

  // 6. Jumlah frame yang digambar dilaporkan, bukan digerbangi: yang harus
  // dibuktikan script ini adalah aplikasinya menyala tanpa crash, dan ambang
  // frame berbeda-beda antar perangkat.
  const frames = parseFramesRendered(adbShell(['dumpsys', 'gfxinfo', packageId]).stdout);
  console.error(
    frames === null
      ? '::notice::Jumlah frame tidak terbaca dari dumpsys gfxinfo.'
      : `::notice::Aplikasi menggambar ${frames} frame sejak dinyalakan.`,
  );

  const summary = [
    `apk=${path.basename(apkPath)}`,
    `ukuran=${apkSize}`,
    `paket=${packageId}`,
    `aktivitas=${component}`,
    `pid=${pid}`,
    // Waktu yang dilaporkan `am start -W`; berguna untuk melihat tren peluncuran
    // antar rilis tanpa harus membuka log run-nya.
    `peluncuran_ms=${started.totalTime ?? '?'}`,
    `frame=${frames ?? 'tidak terbaca'}`,
  ];

  if (evidenceDir !== undefined) {
    const screen = runAdb(['exec-out', 'screencap', '-p'], { binary: true }).stdout;
    const files = {
      'logcat.txt': logcat,
      'ringkasan.txt': `${[...summary, `terdepan=${resumed}`].join('\n')}\n`,
    };
    if (screen.length > 0) files['layar.png'] = screen;
    else console.error('::warning::Tangkapan layar kosong; bukti gambar dilewati.');

    if (writeEvidence(evidenceDir, files)) {
      console.error(`::notice::Bukti disimpan di ${evidenceDir}.`);
    }
  }

  console.error(
    `::notice::Aplikasi ${packageId} menyala dan berada di depan (PID ${pid}); uji nyala lulus.`,
  );
  process.stdout.write(`${summary.join('\n')}\n`);
}

/** Isi `app.json` repository ini, atau `null` bila tidak ada/tidak terbaca. */
function readAppConfig() {
  const file = path.resolve(import.meta.dirname, '..', 'app.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung. Fungsi murni di atas
// dipakai test; tanpa penjagaan ini `import` akan ikut memanggil adb.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
