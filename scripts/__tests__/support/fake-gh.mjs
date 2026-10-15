#!/usr/bin/env node
/**
 * `gh` tiruan untuk test `scripts/prune-preview-releases.mjs`.
 *
 * Alasannya sama dengan `fake-adb.mjs`: yang paling mudah rusak diam-diam pada
 * script pemangkas adalah **perintah yang benar-benar dikirim ke GitHub** —
 * rilis mana yang dihapus, dengan flag apa, dan apakah rilis produksi ikut
 * tersentuh. Menguji itu pada repository sungguhan berarti menghapus rilis
 * sungguhan, jadi yang diganti hanya lapisan `gh`-nya.
 *
 * Setiap pemanggilan dicatat ke `SMOKE_FAKE_GH_LOG` (satu baris JSON per
 * pemanggilan), dan jawabannya diambil dari skenario di `SMOKE_FAKE_GH_SCENARIO`:
 *
 *   {
 *     "releases": [ { "tagName": "v0.1.0-build9", "isPrerelease": true, "createdAt": "…" } ],
 *     "listFails": false,            // `gh release list` menulis galat + exit 1
 *     "listOutput": "bukan json",    // jawaban mentah (menggantikan "releases")
 *     "deleteFailures": ["v0.1.0-build3"],   // tag yang gagal dihapus
 *   }
 *
 * Penghapusan yang **berhasil** menghapus rilis itu dari skenario di berkas, jadi
 * pemanggilan `gh release list` berikutnya tidak lagi melihatnya. Ini yang membuat
 * sifat idempoten script (`menjalankannya dua kali tidak menghapus apa pun pada
 * kali kedua`) bisa diuji: tanpa keadaan yang berubah, gh tiruan akan terus
 * mengembalikan rilis yang sudah dihapus dan setiap kali pemangkasan akan
 * menghapus rilis yang sama — pemangkasan seperti itu hanya tampak benar.
 */
import fs from 'node:fs';

const scenarioFile = process.env.SMOKE_FAKE_GH_SCENARIO;
if (scenarioFile === undefined || scenarioFile === '') {
  process.stderr.write('SMOKE_FAKE_GH_SCENARIO tidak diatur.\n');
  process.exit(2);
}

const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
const args = process.argv.slice(2);

const logFile = process.env.SMOKE_FAKE_GH_LOG;
if (logFile !== undefined && logFile !== '') {
  fs.appendFileSync(logFile, `${JSON.stringify(args)}\n`);
}

/** Membalas dengan keluaran dan status keluar. */
const reply = (text, status = 0) => {
  process.stdout.write(text);
  process.exit(status);
};
const refuse = (text) => {
  process.stderr.write(text);
  process.exit(1);
};

const [area, action] = args;

if (area !== 'release') refuse(`gh: perintah tidak dikenal: ${args.join(' ')}\n`);

if (action === 'list') {
  if (scenario.listFails === true) refuse('gh: HTTP 401: Bad credentials\n');
  if (typeof scenario.listOutput === 'string') reply(scenario.listOutput);
  reply(`${JSON.stringify(scenario.releases ?? [])}\n`);
}

if (action === 'delete') {
  const tag = args[2];
  if ((scenario.deleteFailures ?? []).includes(tag)) {
    refuse(`gh: HTTP 422: Could not delete release ${tag}\n`);
  }

  // GitHub sesungguhnya tidak lagi memuat rilis yang sudah dihapus; skenariopun
  // harus begitu, supaya pemanggilan `gh release list` berikutnya mencerminkan
  // pohon rilis yang sudah menyusut.
  scenario.releases = (scenario.releases ?? []).filter((release) => release?.tagName !== tag);
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));

  reply(`Deleted release ${tag}\n`);
}

refuse(`gh: perintah tidak dikenal: ${args.join(' ')}\n`);
