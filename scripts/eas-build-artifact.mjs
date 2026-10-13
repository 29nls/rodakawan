#!/usr/bin/env node
/**
 * Membaca keluaran `eas build --json` dan mengambil artifact milik build yang barusan
 * dibuat. Dipakai oleh `.github/workflows/android-release.yml`.
 *
 * Kenapa script terpisah: bentuk keluaran EAS adalah detail pihak ketiga, dan workflow
 * rilis tidak boleh menebak nama berkas atau jatuh ke "build terbaru" milik orang lain.
 * Parser ini menolak setiap bentuk yang tidak diharapkan, mencetak pesan yang jelas, dan
 * tidak pernah menulis URL artifact ke ringkasan (URL artifact hanya keluar lewat
 * perintah `url`, yang langsung dipakai untuk mengunduh).
 *
 * Pemakaian:
 *   node scripts/eas-build-artifact.mjs <hasil.json> url       # cetak URL artifact
 *   node scripts/eas-build-artifact.mjs <hasil.json> id        # cetak id build
 *   node scripts/eas-build-artifact.mjs <hasil.json> summary   # ringkasan aman (tanpa URL)
 *   node scripts/eas-build-artifact.mjs <hasil.json> dump      # isi berkas, URL disamarkan
 *
 * Selalu keluar dengan kode 1 dan pesan `::error::…` bila bentuknya tidak sesuai.
 */

import { readFileSync } from 'node:fs';

const ARTIFACT_FIELDS = ['applicationArchiveUrl', 'buildUrl'];

function fail(message, extraLines = []) {
  console.error(`::error::${message}`);
  for (const line of extraLines) console.error(line);
  process.exit(1);
}

function maskUrls(text) {
  return text.replace(/https?:\/\/[^"'\s]+/g, '<url-disamarkan>');
}

function loadBuildObject(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`Tidak bisa membaca berkas hasil build (${filePath}).`, [String(error.message ?? error)]);
  }

  if (raw.trim() === '') {
    fail('Berkas hasil build kosong — EAS CLI kemungkinan gagal sebelum build terbentuk.', [
      'Isi berkas kosong; tidak ada build id maupun URL artifact yang bisa diverifikasi.',
    ]);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail('Hasil build bukan JSON yang valid — tidak ada release yang dibuat.', [
      `Parser: ${String(error.message ?? error)}`,
      `Cuplikan (URL disamarkan): ${maskUrls(raw).slice(0, 400)}`,
    ]);
  }

  // `eas build --json` mencetak array; sebagian versi CLI mencetak objek tunggal.
  const builds = Array.isArray(parsed) ? parsed : [parsed];
  if (builds.length === 0) {
    fail('Hasil build berisi array kosong — tidak ada build yang bisa diverifikasi.');
  }
  if (builds.length > 1) {
    fail(`Hasil build berisi ${builds.length} build; tidak jelas mana milik pemanggilan ini.`, [
      'Jalankan satu build per pemanggilan supaya artifact tidak tertukar.',
    ]);
  }

  const build = builds[0];
  if (build === null || typeof build !== 'object') {
    fail(`Isi build bukan objek (ditemukan ${build === null ? 'null' : typeof build}).`);
  }
  return build;
}

function readArtifactUrl(build) {
  const artifacts = build.artifacts;
  if (artifacts === undefined || artifacts === null) {
    fail('Hasil build tidak memuat objek `artifacts`; tidak ada berkas APK yang bisa diunduh.', [
      'Build berstatus `finished` seharusnya selalu punya artifacts.',
    ]);
  }
  if (typeof artifacts !== 'object') {
    fail('Kolom `artifacts` hasil build bukan objek, jadi URL artifact tidak bisa dipercaya.');
  }

  const seen = [];
  for (const field of ARTIFACT_FIELDS) {
    const value = artifacts?.[field];
    if (typeof value !== 'string' || value === '') continue;
    seen.push(`${field}=${value.startsWith('https://') ? 'https' : 'bukan-https'}`);
    if (!value.startsWith('https://')) continue;
    // `buildUrl` menunjuk halaman build, bukan berkas; hanya diterima bila jelas berkas APK.
    if (field !== ARTIFACT_FIELDS[0] && !new URL(value).pathname.endsWith('.apk')) continue;
    return { url: value, field };
  }

  fail(
    'Build tidak berstatus/berisi artifact yang bisa diunduh: `artifacts.applicationArchiveUrl` tidak ada.',
    seen.length > 0 ? [`Kolom yang ditemukan: ${seen.join(', ')}`] : ['Tidak ada kolom artifact.'],
  );
}

const [filePath, command] = process.argv.slice(2);

if (!filePath || !command) {
  fail('Pemakaian: node scripts/eas-build-artifact.mjs <hasil.json> <url|id|summary|dump>');
}

const build = loadBuildObject(filePath);
const status = typeof build.status === 'string' ? build.status : 'tidak diketahui';

switch (command) {
  case 'id': {
    if (typeof build.id !== 'string' || build.id === '') {
      fail('Hasil build tidak memuat `id`, jadi build tidak bisa dilacak di EAS.');
    }
    console.log(build.id);
    break;
  }
  case 'summary': {
    // Ringkasan aman: tidak pernah memuat URL artifact.
    console.log(
      [
        `id=${typeof build.id === 'string' && build.id !== '' ? build.id : '-'}`,
        `status=${status}`,
        `platform=${typeof build.platform === 'string' ? build.platform : '-'}`,
      ].join(' '),
    );
    break;
  }
  case 'dump': {
    console.log(maskUrls(readFileSync(filePath, 'utf8')).slice(0, 800));
    break;
  }
  case 'url': {
    if (status !== 'finished') {
      fail(`Build belum selesai (status: ${status}); tidak ada artifact untuk diunduh.`, [
        'Status harus `finished` sebelum APK boleh dirilis.',
      ]);
    }
    const { url, field } = readArtifactUrl(build);
    if (field !== ARTIFACT_FIELDS[0]) {
      console.error(
        `::warning::Keluaran EAS tidak memuat artifacts.applicationArchiveUrl; memakai artifacts.${field} (berkas .apk).`,
      );
    }
    console.log(url);
    break;
  }
  default:
    fail(`Perintah tidak dikenal: ${command}. Pilih url, id, summary, atau dump.`);
}
