#!/usr/bin/env node
/**
 * Rekam bukti checklist uji perangkat fisik dari perangkat yang terhubung adb.
 *
 * Checklist 14 langkah di `docs/MILESTONE_2_REPORT.md` bagian 5 adalah milik
 * pemilik aplikasi dan tidak boleh ditandai lulus berdasarkan uji unit atau
 * smoke test emulator — isinya harus dikerjakan manusia di HP fisik dengan dua
 * akun nyata. Yang bisa diotomatisasi bukan penilaiannya, tapi **perekamannya**:
 * tanpa alat ini bukti tersebar di ingatan operator (tangkapan layar yang lupa
 * diambil, waktu yang tidak tercatat, logcat yang hilang karena buffer penuh).
 *
 * Jadi script ini membagi tugas secara jujur:
 *
 *   - **Otomatis**: identitas perangkat dan APK yang terpasang, tangkapan layar,
 *     hierarki UI (`uiautomator dump`), aktivitas/jendela terdepan, irisan
 *     logcat sejak langkah dimulai, stempel waktu, dan berkas ringkasan.
 *   - **Manusia**: menilai langkahnya. Operator menyebut hasil lewat pilihan
 *     `rekam` / `rekam & tandai gagal` / `lewati`, dan menuliskan catatan.
 *     Status di ringkasan adalah penilaian operator, bukan kesimpulan script.
 *
 * Langkah 14 (putuskan jaringan) dijalankan sebagian oleh script: jaringan
 * dimatikan, layar keadaan tanpa jaringan direkam, lalu jaringan dinyalakan
 * kembali **sebelum** script menunggu input berikutnya — pemulihan tidak
 * bergantung pada operator menekan tombol apa pun.
 *
 * Pemakaian:
 *   node scripts/device-checklist.mjs                      # seluruh langkah
 *   node scripts/device-checklist.mjs --list               # tampilkan checklist
 *   node scripts/device-checklist.mjs --apk app-preview.apk \
 *     --expect-sha256 4417798e… --steps 1-7 --evidence bukti-perangkat
 *
 * Opsi:
 *   --apk <berkas>       Pasang APK ini dulu (`install -r`) sebelum direkam.
 *   --package <id>       Id paket; default dari `expo.android.package` di app.json.
 *   --serial <sn>        Perangkat yang dipakai bila adb melihat lebih dari satu.
 *   --steps <pilihan>    Pilihan langkah, mis. `1-3,7` (default: semua).
 *   --evidence <dir>     Direktori bukti (default `bukti-perangkat/<waktu>`).
 *   --expect-sha256 <h>  Gagal bila SHA-256 APK yang terpasang berbeda —
 *                        mencegah checklist dijalankan terhadap build yang salah.
 *   --settle <detik>     Jeda setelah jaringan diputus (default 4).
 *   --allow-emulator     Izinkan emulator (checklist menuntut perangkat fisik).
 *   --no-apk-hash        Jangan hitung SHA-256 APK terpasang dari perangkat.
 *   --list, --help       Tampilkan checklist / pemakaian.
 *
 * Prasyarat: `adb` ada di PATH, satu perangkat fisik sudah terpasang dengan
 * izin USB debugging, dan aplikasi sudah terpasang (atau `--apk` diberikan).
 * Untuk menguji tanpa perangkat, `DEVICE_CHECKLIST_ADB` menerima JSON array
 * argv adb tiruan — dipakai oleh `scripts/__tests__/device-checklist.test.mjs`
 * dengan `scripts/__tests__/support/fake-adb.mjs`.
 *
 * Keluar dengan kode 0 hanya bila **semua** langkah terpilih berstatus direkam
 * oleh operator; langkah yang dilewati, ditandai gagal, atau belum sempat
 * dijalankan membuatnya keluar 1, supaya "checklist selesai" tidak pernah
 * berarti setengah jalan.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

import { fail, parseOptions } from './lib/cli.mjs';
import {
  installSucceeded,
  packageFromAppJson,
  parseResumedActivity,
  parseWindowFocus,
} from './smoke-test-apk.mjs';

const USAGE =
  'Pemakaian: node scripts/device-checklist.mjs [--apk <berkas.apk>] [--package <id>] ' +
  '[--serial <sn>] [--steps <pilihan>] [--evidence <dir>] [--expect-sha256 <sha256>] ' +
  '[--settle <detik>] [--allow-emulator] [--no-apk-hash] [--list] [--help]';

/** Judul bagian di dokumen yang memuat tabel checklist. */
const CHECKLIST_HEADING = 'Checklist uji perangkat fisik';

/** Jeda agar pesan galat di layar sempat muncul sebelum layar direkam. */
const DEFAULT_SETTLE_SECONDS = 4;

/** Batas keluaran adb: `dumpsys package` bisa ratusan ribu byte. */
const MAX_ADB_OUTPUT = 64 * 1024 * 1024;

/** Batas waktu perintah adb yang wajar lama (pemasangan APK). */
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

/** Nama berkas di dalam direktori bukti satu langkah. */
const SCREENSHOTS = {
  biasa: 'layar',
  luring: 'layar-offline',
  pulih: 'layar-pulih',
};

// ---------------------------------------------------------------------------
// Fungsi murni (diuji tanpa perangkat)
// ---------------------------------------------------------------------------

/**
 * Membaca tabel checklist dari dokumen.
 *
 * Dokumen adalah sumber kebenaran: teks langkah dan bukti yang diminta tidak
 * diduplikasi di sini, sehingga checklist dan script tidak bisa berbeda isi
 * tanpa ketahuan test. Baris bernomor pertama sampai terakhir diambil dari
 * tabel pertama setelah judul bagian; selain itu dianggap rusak dan dilempar,
 * bukan diam-diam menghasilkan checklist kosong.
 */
export function parseChecklist(markdown) {
  const text = markdown ?? '';
  const heading = new RegExp(`^#{2,}.*${CHECKLIST_HEADING}.*$`, 'm').exec(text);
  if (heading === null) {
    throw new Error(`Judul bagian "${CHECKLIST_HEADING}" tidak ditemukan di dokumen checklist.`);
  }

  const steps = [];
  let inTable = false;
  for (const line of text.slice(heading.index + heading[0].length).split(/\r?\n/)) {
    if (!line.startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!/^\d+$/.test(cells[0] ?? '')) continue; // baris judul atau pemisah
    if (cells.length !== 3 || cells[1] === '' || cells[2] === '') {
      throw new Error(`Baris checklist tidak punya tiga kolom penuh: ${line.trim()}`);
    }
    steps.push({ no: Number(cells[0]), langkah: cells[1], bukti: cells[2] });
  }

  if (steps.length === 0) {
    throw new Error(`Tidak ada langkah bernomor setelah judul "${CHECKLIST_HEADING}".`);
  }
  steps.forEach((step, index) => {
    if (step.no !== index + 1) {
      throw new Error(
        `Nomor langkah tidak berurutan di dokumen: ke-${index + 1} bertuliskan ${step.no}.`,
      );
    }
  });
  return steps;
}

/**
 * Langkah yang memutus jaringan — dikenali dari isinya, bukan dari nomornya,
 * supaya penyusunan ulang tabel tidak diam-diam mematikan otomatisasi ini.
 */
export function isNetworkStep(step) {
  return /mode pesawat|putuskan jaringan/i.test(`${step.langkah} ${step.bukti}`);
}

/**
 * Menerjemahkan pilihan `--steps` (`1-3,7`) menjadi daftar nomor langkah.
 * Melempar untuk token yang tidak dikenal — pilihan yang salah tidak boleh
 * diam-diam dijalankan sebagai "seluruh langkah".
 */
export function resolveSteps(spec, total) {
  if (spec === undefined || spec.trim() === '') {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const picked = new Set();
  const add = (value) => {
    if (!Number.isInteger(value) || value < 1 || value > total) {
      throw new Error(`Langkah ${value} di luar rentang 1-${total}.`);
    }
    picked.add(value);
  };

  for (const rawPart of spec.split(',')) {
    const part = rawPart.trim();
    if (part === '') continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range !== null) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > to) throw new Error(`Rentang terbalik: ${part}.`);
      for (let value = from; value <= to; value += 1) add(value);
      continue;
    }
    if (/^\d+$/.test(part)) {
      add(Number(part));
      continue;
    }
    throw new Error(`Pilihan langkah tidak dikenali: ${part}.`);
  }

  if (picked.size === 0) throw new Error('Pilihan --steps tidak memuat langkah apa pun.');
  return [...picked].sort((a, b) => a - b);
}

/** Daftar perangkat dari keluaran `adb devices`. */
export function parseAdbDevices(output) {
  const devices = [];
  for (const line of (output ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('*') || trimmed.startsWith('List of devices')) {
      continue;
    }
    const [serial, state] = trimmed.split(/\s+/);
    if (serial !== undefined && state !== undefined) devices.push({ serial, state });
  }
  return devices;
}

/** Peta properti dari keluaran `adb shell getprop` (`[kunci]: [nilai]`). */
export function parseDeviceProps(output) {
  const props = {};
  for (const line of (output ?? '').split('\n')) {
    const match = /^\[([^\]]+)\]:\s*\[(.*)\]\s*$/.exec(line);
    if (match !== null) props[match[1]] = match[2];
  }
  return props;
}

/** Identitas aplikasi dari keluaran `dumpsys package <id>`. */
export function parseVersionInfo(output) {
  const text = output ?? '';
  const grab = (pattern) => {
    const match = pattern.exec(text);
    return match === null ? null : match[1].trim();
  };
  return {
    versionName: grab(/versionName=(\S+)/),
    versionCode: grab(/versionCode=(\d+)/),
    firstInstallTime: grab(/firstInstallTime=(.+)/),
    lastUpdateTime: grab(/lastUpdateTime=(.+)/),
  };
}

/** Jalur `base.apk` di perangkat dari keluaran `pm path <id>`, atau `null`. */
export function parsePmPath(output) {
  for (const line of (output ?? '').split('\n')) {
    const match = /^\s*package:(\S+)/.exec(line);
    if (match !== null) return match[1];
  }
  return null;
}

/** Detik sejak epoch di awal sebuah baris logcat `-v epoch`, atau `null`. */
export function parseLogEpoch(line) {
  const match = /^(\d{9,13}(?:\.\d+)?)\s/.exec(line ?? '');
  return match === null ? null : Number(match[1]);
}

/**
 * Irisan logcat sejak sebuah waktu (detik sejak epoch, jam perangkat).
 *
 * `tersaring` menyatakan apakah format epoch benar-benar terbaca. Bila tidak
 * (mis. perangkat memakai format lain), seluruh buffer dikembalikan apa adanya
 * dan pemanggil diberi tahu — bukti yang terlalu banyak lebih baik daripada
 * bukti yang diam-diam kosong.
 */
export function sliceLogcatSince(log, sinceEpoch) {
  const lines = (log ?? '').split('\n');
  const stamps = lines.map(parseLogEpoch);
  const timestamped = stamps.some((stamp) => stamp !== null);

  // Baris terakhir dari keluaran adb selalu kosong; menyambungnya apa adanya
  // menambahkan satu baris kosong tambahan ke berkas bukti di setiap langkah.
  const rangkai = (kept) => {
    const text = kept.join('\n').replace(/\n+$/, '');
    return { text: text === '' ? '' : `${text}\n`, tersaring: timestamped };
  };

  if (!timestamped) return rangkai(lines);

  // Toleransi 1 detik: baris yang sedikit lebih tua dari stempel awal langkah
  // masih relevan (jam perangkat dan host bisa bergeser, dan kejadian pertama
  // sebuah langkah sering tercatat tepat sebelum operator menekan Enter).
  return rangkai(
    lines.filter((line, index) => stamps[index] !== null && stamps[index] >= sinceEpoch - 1),
  );
}

/** SHA-256 dan ukuran berkas, dibaca per blok supaya APK 100 MB tak dimuat penuh. */
export function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  let ukuran = 0;
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const terbaca = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (terbaca === 0) break;
      hash.update(buffer.subarray(0, terbaca));
      ukuran += terbaca;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: hash.digest('hex'), ukuran };
}

/** Hasil seluruh langkah: `lulus` hanya bila semuanya direkam operator. */
export function runStatus(results, selected) {
  const pilih = new Set(selected);
  const terpilih = results.filter((result) => pilih.has(result.no));
  const lengkap =
    terpilih.length === selected.length && terpilih.every((r) => r.status === 'direkam');
  return lengkap ? 'lulus' : 'belum';
}

/** Ringkasan Markdown yang dihasilkan di akhir run. */
export function renderSummary({ kepala, results, selected, status }) {
  const baris = results.map((result) => {
    const nomor = String(result.no).padStart(2, '0');
    const bukti = result.direkam
      ? result.files.map((file) => `langkah-${nomor}/${file}`).join('<br>')
      : '—';
    const catatan = (result.catatan ?? '').replace(/\|/g, '\\|');
    return `| ${result.no} | ${result.langkah} | ${result.status} | ${catatan} | ${bukti} |`;
  });

  const gagal = results.filter((result) => result.status === 'gagal').map((r) => r.no);
  const belum = results.filter((result) => !result.direkam).map((r) => r.no);

  return [
    '# Bukti uji perangkat fisik',
    '',
    `Sumber checklist: \`docs/MILESTONE_2_REPORT.md\` (${CHECKLIST_HEADING}).`,
    'Status di bawah adalah **penilaian operator**; bukti (tangkapan layar, hierarki UI,',
    'logcat, aktivitas terdepan, waktu) direkam otomatis oleh `scripts/device-checklist.mjs`.',
    '',
    ...kepala.map(([kunci, nilai]) => `- **${kunci}:** ${nilai}`),
    '',
    `- Langkah terpilih: ${selected.join(', ')}`,
    `- Hasil run: **${status.toUpperCase()}**` +
      (status === 'lulus' ? '' : ' (belum semua langkah direkam)'),
    gagal.length > 0 ? `- Langkah yang ditandai gagal: ${gagal.join(', ')}` : null,
    belum.length > 0 ? `- Langkah tanpa bukti: ${belum.join(', ')}` : null,
    '',
    '| # | Langkah | Status | Catatan operator | Bukti |',
    '| - | ------- | ------ | ---------------- | ----- |',
    ...baris,
    '',
    'Status: `direkam` (dinilai sesuai harapan), `gagal` (dinilai tidak sesuai),',
    '`dilewati` (operator melewatinya), `belum` (tidak sempat dijalankan).',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Perkakas adb
// ---------------------------------------------------------------------------

/**
 * Perangkat yang dipakai run ini; dipasang sebagai awalan `-s <serial>` pada
 * semua perintah setelah perangkat dipilih, supaya perintah tidak bisa diam-diam
 * mendarat di perangkat lain bila ada emulator ikut terpasang.
 */
let serialTerpilih = null;

/**
 * Argv untuk memanggil adb, dengan `DEVICE_CHECKLIST_ADB` sebagai jalan keluar
 * untuk test menyuntikkan adb tiruan (lihat header berkas ini).
 */
function adbCommand() {
  const override = process.env.DEVICE_CHECKLIST_ADB;
  if (override === undefined || override === '') return ['adb'];

  let parsed;
  try {
    parsed = JSON.parse(override);
  } catch {
    return fail('DEVICE_CHECKLIST_ADB bukan JSON yang sah.');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((it) => typeof it !== 'string')
  ) {
    return fail('DEVICE_CHECKLIST_ADB harus berupa JSON array berisi nama program dan argumennya.');
  }
  return parsed;
}

/** Menjalankan adb; tidak pernah melempar. */
function runAdb(args, { timeoutMs = null, binary = false } = {}) {
  const [program, ...prefix] = adbCommand();
  const target = serialTerpilih === null ? [] : ['-s', serialTerpilih];
  const result = spawnSync(program, [...prefix, ...target, ...args], {
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
      'Script ini butuh adb di PATH dan sebuah perangkat yang sudah diizinkan USB debugging.',
    ]);
  }

  return {
    status: result.status ?? 1,
    stdout: binary ? (result.stdout ?? Buffer.alloc(0)) : (result.stdout ?? ''),
    stderr: result.stderr ?? '',
  };
}

/** Menjalankan `adb <args>`; `ok` menyatakan status keluar 0. */
function adb(args, options) {
  const result = runAdb(args, options);
  return { ...result, ok: result.status === 0 };
}

/** Menjalankan perintah di dalam perangkat. */
function adbShell(args, options) {
  return adb(['shell', ...args], options);
}

/** Waktu perangkat (detik sejak epoch); jatuh ke jam host bila tidak terbaca. */
function deviceEpoch() {
  const result = adbShell(['date', '+%s']);
  const value = Number.parseInt((result.stdout ?? '').trim(), 10);
  return result.ok && Number.isInteger(value) && value > 0 ? value : Date.now() / 1000;
}

// ---------------------------------------------------------------------------
// Pilihan operator
// ---------------------------------------------------------------------------

/**
 * Pembaca baris stdin dengan antrean.
 *
 * `readline` membuang baris yang tiba ketika tidak ada `question` yang menunggu,
 * sehingga input berupa satu blok (piped stdin di test, atau tempelan daftar
 * jawaban) akan hilang setengah jalan. Karena itu setiap baris diantre di sini,
 * dan `close` (EOF) membangunkan pemanggil dengan `null` — bukan menggantung.
 */
export function createLineReader(inputStream, outputStream) {
  const rl = readline.createInterface({ input: inputStream, output: outputStream });
  const antrean = [];
  let penunggu = null;
  let tertutup = false;

  rl.on('line', (line) => {
    if (penunggu !== null) {
      const selesai = penunggu;
      penunggu = null;
      selesai(line);
      return;
    }
    antrean.push(line);
  });
  rl.on('close', () => {
    tertutup = true;
    if (penunggu !== null) {
      const selesai = penunggu;
      penunggu = null;
      selesai(null);
    }
  });

  return {
    ask(teks) {
      // Prompt ke stderr: stdout hanya memuat ringkasan mesin, supaya bisa
      // ditelan pipeline tanpa tercampur teks interaktif.
      outputStream.write(teks);
      if (antrean.length > 0) return Promise.resolve(antrean.shift());
      if (tertutup) return Promise.resolve(null);
      return new Promise((resolve) => {
        penunggu = resolve;
      });
    },
    close() {
      rl.close();
    },
  };
}

/** Pilihan langkah: rekam, rekam & tandai gagal, lewati, atau berhenti. */
async function askChoice(reader, prompt) {
  for (;;) {
    const raw = await reader.ask(prompt);
    if (raw === null) return 'berhenti';
    const value = raw.trim().toLowerCase();
    if (value === '' || value === 'r' || value === 'rekam') return 'rekam';
    if (value === 'g' || value === 'gagal') return 'gagal';
    if (value === 's' || value === 'lewati' || value === 'skip') return 'lewati';
    if (value === 'q' || value === 'berhenti' || value === 'quit') return 'berhenti';
    console.error(`::warning::Pilihan tidak dikenali: ${raw.trim()}. Pilihan: r / g / s / q.`);
  }
}

/** Catatan bebas operator; Enter tanpa teks berarti tanpa catatan. */
async function askNote(reader) {
  const raw = await reader.ask('Catatan langkah (opsional, Enter untuk lanjut): ');
  return raw === null ? null : raw.trim();
}

// ---------------------------------------------------------------------------
// Perekaman bukti
// ---------------------------------------------------------------------------

/** Menulis berkas bukti; kegagalan menulis diperingatkan, tidak menghentikan. */
function writeEvidence(dir, name, content, { binary = false } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
    return true;
  } catch (error) {
    console.error(`::warning::Bukti ${name} tidak bisa ditulis ke ${dir}: ${error.message}`);
    return false;
  }
}

/** Hierarki UI lewat `uiautomator dump`, atau `null` bila perangkat menolak. */
function dumpUiHierarchy(dir, prefix) {
  const remote = '/sdcard/rodakawan-uiautomator.xml';
  const dumped = adbShell(['uiautomator', 'dump', remote]);
  if (!dumped.ok) {
    console.error('::warning::uiautomator dump gagal; bukti hierarki UI dilewati.');
    return null;
  }
  const cat = adb(['exec-out', 'cat', remote]);
  adbShell(['rm', '-f', remote]);
  const xml = (cat.stdout ?? '').trim();
  if (!cat.ok || !xml.includes('<hierarchy')) {
    console.error('::warning::Isi dump UI tidak terbaca; bukti hierarki UI dilewati.');
    return null;
  }
  if (writeEvidence(dir, `${prefix}.xml`, `${xml}\n`)) return `${prefix}.xml`;
  return null;
}

/** Aktivitas terdepan, lalu fokus jendela bila aktivitasnya tidak terbaca. */
function foregroundInfo(packageId) {
  const activities = adbShell(['dumpsys', 'activity', 'activities']).stdout;
  const aktivitas = parseResumedActivity(activities, packageId);
  if (aktivitas !== null) return { aktivitas, jendela: null };
  const window = adbShell(['dumpsys', 'window']).stdout;
  return { aktivitas: null, jendela: parseWindowFocus(window, packageId) };
}

/**
 * Satu putaran perekaman: tangkapan layar, hierarki UI, aktivitas terdepan,
 * dan irisan logcat sejak `sinceEpoch`. Semua bagian bersifat bila gagal
 * (perangkat bisa menolak screencap saat layar mati) — yang penting langkah
 * tetap tercatat dan kegagalannya sendiri terlihat di log.
 */
function capture(dir, { prefix, packageId, sinceEpoch, runDir }) {
  const files = [];

  const shot = adb(['exec-out', 'screencap', '-p'], { binary: true });
  if (shot.ok && shot.stdout.length > 0) {
    if (writeEvidence(dir, `${prefix}.png`, shot.stdout)) files.push(`${prefix}.png`);
  } else {
    console.error('::warning::Tangkapan layar kosong; bukti gambar dilewati.');
  }

  const xml = dumpUiHierarchy(dir, prefix);
  if (xml !== null) files.push(xml);

  // Namanya mengikuti awalan tangkapan, bukan `logcat.txt` tetap: langkah
  // jaringan merekam dua kali (sebelum dan sesudah pulih), dan irisan keduanya
  // berbeda panjang — nama tetap akan menimpa bukti tangkapan pertama.
  const logcatName = `${prefix}-logcat.txt`;
  const logcat = adb(['logcat', '-d', '-v', 'epoch']).stdout;
  const slice = sliceLogcatSince(logcat, sinceEpoch);
  if (!slice.tersaring) {
    console.error(
      '::warning::logcat tidak memuat stempel epoch; irisan per langkah memakai seluruh buffer.',
    );
  }
  if (writeEvidence(dir, logcatName, slice.text)) files.push(logcatName);

  return { files, foreground: foregroundInfo(packageId), logcatTersaring: slice.tersaring };
}

// ---------------------------------------------------------------------------
// Jaringan (langkah "putuskan jaringan")
// ---------------------------------------------------------------------------

/** Nilai `airplane_mode_on` (`'0'`, `'1'`, atau `null` bila tidak terbaca). */
function readAirplaneState() {
  const result = adbShell(['settings', 'get', 'global', 'airplane_mode_on']);
  const value = (result.stdout ?? '').trim();
  if (value === '1' || value === '0') return value;
  return null;
}

/**
 * Mematikan (`false`) / menyalakan (`true`) **jaringan** perangkat.
 *
 * Mode pesawat adalah kebalikan dari jaringan: mematikan jaringan berarti
 * menyalakan mode pesawat, dan itu yang harus diputar balik di sini — salah
 * arah satu langkah akan membuat langkah "putuskan jaringan" merekam layar
 * yang justru sedang tersambung.
 *
 * `cmd connectivity airplane-mode` adalah cara resmi dan terverifikasi lewat
 * flag `airplane_mode_on`. Bila perangkat tidak mendukungnya (versi Android
 * lama atau build yang memblokir perintah shell), cadangan `svc wifi/data`
 * dijalankan: perintah itu selalu boleh bagi shell, meski tidak menyetel flag
 * mode pesawat — karena itu hasilnya dilaporkan apa adanya, bukan dianggap sama.
 */
function setNetwork(enabled) {
  const airplane = enabled ? 'disable' : 'enable';
  const harapkan = enabled ? '0' : '1';
  const sebelum = readAirplaneState();

  const cmd = adbShell(['cmd', 'connectivity', 'airplane-mode', airplane]);
  const sesudah = readAirplaneState();
  if (cmd.ok && sesudah === harapkan) {
    return {
      method: 'cmd connectivity airplane-mode',
      ok: true,
      sebelum,
      sesudah,
      detail: (cmd.stdout ?? '').trim(),
    };
  }

  const wifi = adbShell(['svc', 'wifi', enabled ? 'enable' : 'disable']);
  const data = adbShell(['svc', 'data', enabled ? 'enable' : 'disable']);
  const detail = [
    `cmd connectivity: status ${cmd.ok ? '0' : cmd.status}, flag=${sesudah ?? 'tidak terbaca'}`,
    `svc wifi: status ${wifi.status}`,
    `svc data: status ${data.status}`,
  ].join('\n');
  return {
    method: 'svc wifi/data (cadangan)',
    ok: wifi.ok && data.ok,
    sebelum,
    sesudah: readAirplaneState(),
    detail,
  };
}

// ---------------------------------------------------------------------------
// Identitas perangkat & aplikasi
// ---------------------------------------------------------------------------

/** Properti perangkat yang dipakai untuk bukti identitas. */
const PROP_KEYS = [
  'ro.product.manufacturer',
  'ro.product.brand',
  'ro.product.model',
  'ro.product.device',
  'ro.build.version.release',
  'ro.build.version.sdk',
  'ro.build.version.security_patch',
  'ro.build.abi',
  'ro.kernel.qemu',
  'ro.debuggable',
  'ro.build.fingerprint',
];

/** `true` bila perangkat ini emulator — checklist menuntut perangkat fisik. */
export function isEmulator(props) {
  if (props['ro.kernel.qemu'] === '1') return true;
  const model = `${props['ro.product.model'] ?? ''} ${props['ro.build.fingerprint'] ?? ''}`;
  // Tanpa batas kata: model emulator resmi justru menyambung angka
  // (`sdk_gphone64_x86_64`), dan `\bsdk_gphone\b` tidak pernah cocok dengannya.
  return /emulator|sdk_gphone|sdk_google|android sdk built for/i.test(model);
}

/** Berkas `app.json` repository ini, atau `null` bila tidak ada/tidak terbaca. */
function readAppConfig() {
  const file = path.resolve(import.meta.dirname, '..', 'app.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Alur utama
// ---------------------------------------------------------------------------

async function main() {
  const options = parseOptions(process.argv.slice(2), {
    usage: USAGE,
    values: {
      '--apk': 'sebuah berkas APK',
      '--package': 'sebuah id paket Android',
      '--serial': 'sebuah nomor seri perangkat',
      '--steps': 'pilihan langkah, mis. 1-3,7',
      '--evidence': 'sebuah direktori',
      '--expect-sha256': 'sebuah SHA-256 heksadesimal',
      '--settle': 'sejumlah detik',
    },
    flags: ['--allow-emulator', '--no-apk-hash', '--list', '--help'],
  });

  if (options['--help'] === true) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const orFail = (fn) => {
    try {
      return fn();
    } catch (error) {
      return fail(error.message, [USAGE]);
    }
  };

  // Checklist dibaca dari dokumen, bukan disalin ke script (lihat parseChecklist).
  const docPath = path.resolve(import.meta.dirname, '..', 'docs', 'MILESTONE_2_REPORT.md');
  let doc;
  try {
    doc = fs.readFileSync(docPath, 'utf8');
  } catch (error) {
    return fail(`Dokumen checklist tidak terbaca: ${docPath} (${error.message}).`);
  }
  const steps = orFail(() => parseChecklist(doc));

  if (options['--list'] === true) {
    for (const step of steps) {
      process.stdout.write(
        `${String(step.no).padStart(2, ' ')}. ${step.langkah} — ${step.bukti}\n`,
      );
    }
    return 0;
  }

  const selected = orFail(() => resolveSteps(options['--steps'], steps.length));

  const expectSha = options['--expect-sha256'];
  if (expectSha !== undefined && !/^[0-9a-f]{64}$/i.test(expectSha)) {
    return fail('--expect-sha256 harus 64 karakter heksadesimal (SHA-256).', [USAGE]);
  }

  const settleSeconds = (() => {
    const raw = options['--settle'];
    if (raw === undefined) return DEFAULT_SETTLE_SECONDS;
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value) || value < 0) {
      return fail(`Batas waktu tidak dikenali: ${raw}. Isinya detik, mis. 4.`, [USAGE]);
    }
    return value;
  })();

  const packageId = options['--package'] ?? packageFromAppJson(readAppConfig());
  if (packageId === undefined || packageId === null) {
    return fail(
      'Id paket tidak diketahui: tidak ada --package dan app.json tidak memuat expo.android.package.',
    );
  }

  // ---- Pemilihan perangkat ------------------------------------------------
  const listed = parseAdbDevices(adb(['devices']).stdout);
  const ready = listed.filter((device) => device.state === 'device');

  if (options['--serial'] !== undefined) {
    const chosen = ready.find((device) => device.serial === options['--serial']);
    if (chosen === undefined) {
      return fail(`Perangkat ${options['--serial']} tidak siap.`, [
        `adb devices: ${listed.map((d) => `${d.serial} (${d.state})`).join(', ') || '(kosong)'}`,
        'Perangkat harus berstatus `device`, bukan `unauthorized`/`offline`.',
      ]);
    }
    serialTerpilih = chosen.serial;
  } else if (ready.length === 0) {
    return fail('Tidak ada perangkat yang siap dipakai.', [
      `adb devices: ${listed.map((d) => `${d.serial} (${d.state})`).join(', ') || '(kosong)'}`,
      'Periksa kabel USB dan izin USB debugging di perangkat, lalu jalankan adb devices lagi.',
    ]);
  } else if (ready.length > 1) {
    return fail(`Ada ${ready.length} perangkat terhubung; pilih salah satu dengan --serial.`, [
      ready.map((device) => `  --serial ${device.serial}`).join('\n'),
    ]);
  } else {
    serialTerpilih = ready[0].serial;
  }
  console.error(`::notice::Perangkat ${serialTerpilih} terpilih.`);

  // ---- Kecerminan: fisik, bukan emulator ---------------------------------
  const props = parseDeviceProps(adbShell(['getprop']).stdout);
  const emulator = isEmulator(props);
  if (emulator && options['--allow-emulator'] !== true) {
    return fail('Perangkat yang terhubung adalah emulator, bukan perangkat fisik.', [
      `Model: ${props['ro.product.model'] ?? 'tidak terbaca'} (ro.kernel.qemu=${props['ro.kernel.qemu'] ?? '?'}).`,
      'Checklist bagian 5 menuntut HP fisik dengan dua akun nyata; gunakan --allow-emulator hanya untuk uji coba script ini.',
    ]);
  }
  if (emulator) console.error('::warning::Emulator dipakai atas permintaan --allow-emulator.');

  // ---- APK ---------------------------------------------------------------
  const apkOption = options['--apk'];
  if (apkOption !== undefined) {
    if (!fs.existsSync(apkOption) || !fs.statSync(apkOption).isFile()) {
      return fail(`Berkas APK tidak ditemukan: ${apkOption}`, [USAGE]);
    }
    const install = adb(['install', '-r', apkOption], { timeoutMs: INSTALL_TIMEOUT_MS });
    if (!install.ok || !installSucceeded(install.stdout)) {
      return fail(`APK ${path.basename(apkOption)} gagal dipasang di perangkat.`, [
        ...(install.stdout ?? '')
          .split('\n')
          .filter((line) => line.trim() !== '')
          .slice(-6),
      ]);
    }
    console.error(`::notice::APK ${path.basename(apkOption)} terpasang.`);
  }

  const versi = parseVersionInfo(adbShell(['dumpsys', 'package', packageId]).stdout);
  const installedPath = parsePmPath(adbShell(['pm', 'path', packageId]).stdout);
  if (installedPath === null && apkOption === undefined) {
    return fail(`Aplikasi ${packageId} tidak terpasang di perangkat.`, [
      'Pasang APK-nya lebih dulu, atau jalankan script ini dengan --apk <berkas.apk>.',
    ]);
  }

  let sha256 = null;
  let sha256Sumber = null;
  if (apkOption !== undefined) {
    const hasil = hashFile(apkOption);
    sha256 = hasil.sha256;
    sha256Sumber = `berkas ${path.basename(apkOption)}`;
  } else if (options['--no-apk-hash'] !== true) {
    const result = adbShell(['sha256sum', installedPath]);
    const match = /^\s*([0-9a-f]{64})/i.exec(result.stdout ?? '');
    if (result.ok && match !== null) {
      sha256 = match[1].toLowerCase();
      sha256Sumber = 'perangkat (sha256sum)';
    } else {
      console.error(
        '::warning::SHA-256 APK terpasang tidak bisa dihitung di perangkat; jalankan dengan --apk agar identitas build tercatat.',
      );
    }
  }

  if (expectSha !== undefined) {
    if (sha256 === null) {
      return fail('SHA-256 tidak bisa diverifikasi karena hash tidak bisa dihitung.', [
        'Berikan --apk supaya hash dihitung dari berkas yang dipasang, atau hilangkan --no-apk-hash.',
      ]);
    }
    if (sha256 !== expectSha.toLowerCase()) {
      return fail('APK yang terpasang tidak cocok dengan --expect-sha256.', [
        `terpasang : ${sha256}`,
        `diharapkan: ${expectSha.toLowerCase()}`,
        'Checklist dijalankan terhadap build yang salah; pasang APK yang benar dulu.',
      ]);
    }
    console.error('::notice::SHA-256 APK sesuai yang diharapkan.');
  }

  // ---- Direktori bukti ---------------------------------------------------
  const runId = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const runDir = path.resolve(options['--evidence'] ?? path.join('bukti-perangkat', runId));
  try {
    fs.mkdirSync(runDir, { recursive: true });
  } catch (error) {
    return fail(`Direktori bukti tidak bisa dibuat: ${runDir} (${error.message}).`);
  }

  const mulai = new Date();
  const identitas = {
    waktu_mulai_host: mulai.toISOString(),
    waktu_mulai_perangkat: new Date(deviceEpoch() * 1000).toISOString(),
    serial: serialTerpilih,
    emulator,
    perangkat: Object.fromEntries(PROP_KEYS.map((key) => [key, props[key] ?? null])),
    aplikasi: {
      package: packageId,
      ...versi,
      apk_path: installedPath,
      sha256,
      sha256_sumber: sha256Sumber,
    },
    opsi: {
      apk: apkOption ?? null,
      steps: selected,
      allow_emulator: options['--allow-emulator'] === true,
      settle: settleSeconds,
    },
  };
  writeEvidence(runDir, 'perangkat.json', `${JSON.stringify(identitas, null, 2)}\n`);

  const namaPerangkat =
    `${props['ro.product.manufacturer'] ?? '?'} ${props['ro.product.model'] ?? '?'}`.trim();
  writeEvidence(
    runDir,
    'perangkat.txt',
    [
      `Waktu mulai : ${identitas.waktu_mulai_host}`,
      `Perangkat   : ${namaPerangkat} (serial ${serialTerpilih}${emulator ? ', EMULATOR' : ''})`,
      `Android     : ${props['ro.build.version.release'] ?? '?'} (API ${props['ro.build.version.sdk'] ?? '?'})`,
      `Patch       : ${props['ro.build.version.security_patch'] ?? '?'}`,
      `ABI         : ${props['ro.build.abi'] ?? '?'}`,
      `Aplikasi    : ${packageId} versionName ${versi.versionName ?? '?'} (versionCode ${versi.versionCode ?? '?'})`,
      `Install     : ${versi.firstInstallTime ?? '?'}`,
      `Terakhir    : ${versi.lastUpdateTime ?? '?'}`,
      `APK sha256  : ${sha256 ?? 'tidak dihitung'}${sha256Sumber ? ` (${sha256Sumber})` : ''}`,
      '',
    ].join('\n'),
  );
  console.error(`::notice::Bukti disimpan di ${runDir}.`);

  // ---- Perekaman langkah -------------------------------------------------
  const reader = createLineReader(process.stdin, process.stderr);
  const results = [];
  const state = { networkDirty: false, network: null };
  let berhenti = false;

  try {
    for (const no of selected) {
      const step = steps[no - 1];
      if (berhenti) {
        results.push({ ...step, status: 'belum', direkam: false, catatan: '', files: [] });
        continue;
      }
      const hasil = await runStep(step, {
        selected,
        reader,
        packageId,
        runDir,
        settleSeconds,
        state,
      });
      if (hasil.status === 'berhenti') {
        berhenti = true;
        results.push({
          ...step,
          status: 'belum',
          direkam: false,
          catatan: '',
          files: hasil.files ?? [],
        });
        continue;
      }
      results.push(hasil);
    }
  } finally {
    // Pemulihan jangan pernah bergantung pada operator: jaringan dinyalakan
    // kembali begitu langkahnya selesai, bahkan bila script dihentikan di
    // tengah jalan.
    if (state.networkDirty) {
      const pulih = setNetwork(true);
      state.networkDirty = false;
      if (!pulih.ok) {
        console.error('::warning::Jaringan belum berhasil dinyalakan kembali; nyalakan manual.');
      }
      state.network = { ...state.network, pemulihan: pulih };
    }
    reader.close();
    // stdin yang masih terbuka bisa menahan event loop setelah run selesai;
    // dijeda supaya proses keluar sendiri set exitCode-nya.
    process.stdin.pause();
  }

  // ---- Ringkasan ---------------------------------------------------------
  const logcatLengkap = adb(['logcat', '-d', '-v', 'epoch']).stdout;
  writeEvidence(runDir, 'logcat-lengkap.txt', logcatLengkap);

  const selesai = new Date();
  const status = runStatus(results, selected);
  const kepala = [
    ['Waktu mulai', identitas.waktu_mulai_host],
    ['Waktu selesai', selesai.toISOString()],
    ['Perangkat', `${namaPerangkat} (serial ${serialTerpilih})`],
    [
      'Android',
      `${props['ro.build.version.release'] ?? '?'} (API ${props['ro.build.version.sdk'] ?? '?'})`,
    ],
    [
      'Aplikasi',
      `${packageId} versionName ${versi.versionName ?? '?'} (versionCode ${versi.versionCode ?? '?'})`,
    ],
    ['APK SHA-256', sha256 ?? 'tidak dihitung'],
    ['Operator', process.env.USER ?? process.env.USERNAME ?? 'tidak tercatat'],
  ];
  const summary = renderSummary({ kepala, results, selected, status });
  writeEvidence(runDir, 'ringkasan.md', summary);
  writeEvidence(
    runDir,
    'ringkasan.json',
    `${JSON.stringify({ status, perangkat: identitas, langkah: results }, null, 2)}\n`,
  );

  const direkam = results.filter((result) => result.status === 'direkam').length;
  const gagal = results.filter((result) => result.status === 'gagal').map((r) => r.no);
  const tanpaBukti = results.filter((result) => !result.direkam).map((r) => r.no);

  process.stdout.write(
    [
      `serial=${serialTerpilih}`,
      `paket=${packageId}`,
      `langkah_total=${selected.length}`,
      `langkah_direkam=${direkam}`,
      `status=${status}`,
      `bukti=${runDir}`,
      '',
    ].join('\n'),
  );

  if (status === 'lulus') {
    console.error(
      `::notice::Checklist selesai: ${direkam}/${selected.length} langkah direkam di ${runDir}.`,
    );
    return 0;
  }

  console.error(
    `::error::Checklist belum lengkap: ${direkam}/${selected.length} langkah direkam` +
      `${gagal.length > 0 ? `, gagal: ${gagal.join(', ')}` : ''}` +
      `${tanpaBukti.length > 0 ? `, tanpa bukti: ${tanpaBukti.join(', ')}` : ''}.`,
  );
  console.error(`Bukti parsial tetap disimpan di ${runDir}.`);
  return 1;
}

/**
 * Satu langkah checklist: tampilan langkah, pilihan operator, perekaman, catatan.
 * Mengembalikan `{ status, direkam, catatan, files, ... }` — status `berhenti`
 * hanya untuk sinyal q/EOF kepada pemanggil.
 */
async function runStep(step, { selected, reader, packageId, runDir, settleSeconds, state }) {
  const nomor = String(step.no).padStart(2, '0');
  const dir = path.join(runDir, `langkah-${nomor}`);
  const urutan = selected.indexOf(step.no) + 1;
  const jaringan = isNetworkStep(step);

  console.error('');
  console.error(`── Langkah ${step.no} dari ${selected.length} ─ ${step.langkah}`);
  console.error(`   Bukti: ${step.bukti}`);
  if (jaringan) {
    console.error(
      `   Script mematikan jaringan, merekam layar tanpa jaringan, lalu menyalakannya kembali (jeda ${settleSeconds} dtk).`,
    );
  }

  const prompt = jaringan
    ? '[Enter] mulai (jaringan diputus script) · g rekam & tandai gagal · s lewati · q berhenti: '
    : '[Enter] rekam bukti · g rekam & tandai gagal · s lewati · q berhenti: ';
  const pilihan = await askChoice(reader, prompt);
  if (pilihan === 'berhenti') return { status: 'berhenti' };
  if (pilihan === 'lewati') {
    console.error(`::notice::Langkah ${step.no} dilewati tanpa bukti.`);
    return { ...step, status: 'dilewati', direkam: false, catatan: '', files: [] };
  }

  fs.mkdirSync(dir, { recursive: true });
  const mulaiEpoch = deviceEpoch();
  const files = [];
  let catatan = '';
  let networkInfo = null;
  let foreground = null;
  let foregroundLuring = null;

  if (jaringan) {
    const mati = setNetwork(false);
    networkInfo = { pemutusan: mati };
    if (!mati.ok) {
      const gagalCatatan = `jaringan tidak bisa diputus oleh script (${mati.method})`;
      console.error(`::error::${gagalCatatan}.`);
      writeEvidence(
        dir,
        'meta.json',
        `${JSON.stringify({ no: step.no, status: 'gagal', catatan: gagalCatatan, network: networkInfo }, null, 2)}\n`,
      );
      return {
        ...step,
        status: 'gagal',
        direkam: false,
        catatan: gagalCatatan,
        files: ['meta.json'],
        network: networkInfo,
      };
    }
    state.networkDirty = true;

    if (settleSeconds > 0)
      await new Promise((resolve) => setTimeout(resolve, settleSeconds * 1000));

    const luring = capture(dir, { prefix: SCREENSHOTS.luring, packageId, sinceEpoch: mulaiEpoch });
    files.push(...luring.files);
    foregroundLuring = luring.foreground;

    const pulih = setNetwork(true);
    state.networkDirty = false;
    networkInfo.pemulihan = pulih;
    state.network = networkInfo;
    if (!pulih.ok)
      console.error('::warning::Jaringan belum kembali; nyalakan manual sebelum lanjut.');

    const lanjut = await reader.ask(
      'Jaringan sudah dinyalankan. Pulihkan datanya di aplikasi, lalu Enter untuk merekam layar pemulihan: ',
    );
    if (lanjut === null) {
      writeEvidence(
        dir,
        'meta.json',
        `${JSON.stringify({ no: step.no, status: 'berhenti', catatan: '', files }, null, 2)}\n`,
      );
      return { status: 'berhenti', files: [...new Set([...files, 'meta.json'])] };
    }

    const pulihCapture = capture(dir, {
      prefix: SCREENSHOTS.pulih,
      packageId,
      sinceEpoch: mulaiEpoch,
    });
    files.push(...pulihCapture.files);
    foreground = pulihCapture.foreground;
  } else {
    const biasa = capture(dir, { prefix: SCREENSHOTS.biasa, packageId, sinceEpoch: mulaiEpoch });
    files.push(...biasa.files);
    foreground = biasa.foreground;
  }

  const note = await askNote(reader);
  if (note === null) {
    writeEvidence(
      dir,
      'meta.json',
      `${JSON.stringify({ no: step.no, status: 'berhenti', catatan: '', files }, null, 2)}\n`,
    );
    return { status: 'berhenti', files: [...new Set([...files, 'meta.json'])] };
  }
  catatan = note;

  const status = pilihan === 'gagal' ? 'gagal' : 'direkam';
  // Dua tangkapan pada langkah jaringan bisa menghasilkan nama berkas yang
  // sama hanya bila penulisan gagal sebagian; `Set` menjaga daftar bukti di
  // ringkasan tetap satu baris per berkas.
  const filesUnik = [...new Set(files)];
  const meta = {
    no: step.no,
    langkah: step.langkah,
    bukti_diminta: step.bukti,
    status,
    catatan,
    mulai_perangkat: new Date(mulaiEpoch * 1000).toISOString(),
    selesai_host: new Date().toISOString(),
    files: filesUnik,
    foreground,
    ...(foregroundLuring === null ? {} : { foreground_luring: foregroundLuring }),
    network: networkInfo,
  };
  writeEvidence(dir, 'meta.json', `${JSON.stringify(meta, null, 2)}\n`);
  filesUnik.push('meta.json');

  console.error(`::notice::Langkah ${step.no} ${status} (${urutan}/${selected.length}).`);
  return { ...step, status, direkam: true, catatan, files: filesUnik, network: networkInfo };
}

// CLI hanya berjalan bila berkas ini dieksekusi langsung; fungsi murni di atas
// dipakai test tanpa menyentuh adb.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
