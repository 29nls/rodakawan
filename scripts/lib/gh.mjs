#!/usr/bin/env node
/**
 * Helper tipis untuk memanggil `gh` (GitHub CLI) dari script di `scripts/`.
 *
 * Dipisah dari script yang memakainya karena dua alasan: pesan kegagalannya harus
 * seragam (`::error::` + exit 1, sama seperti `cli.mjs`), dan pemanggilan luarnya
 * perlu bisa diganti saat test. Tanpa pemisahan itu, satu-satunya cara menguji
 * script yang menghapus rilis adalah repository GitHub sungguhan.
 */

import { spawnSync } from 'node:child_process';

import { fail } from './cli.mjs';

/** Batas keluaran `gh`; daftar rilis bisa panjang. */
const MAX_OUTPUT = 32 * 1024 * 1024;

/**
 * Argv untuk memanggil `gh`.
 *
 * Di runner nilainya selalu `['gh']`. `GH_CMD` (JSON array argv) ada supaya test
 * bisa menyuntikkan `gh` tiruan dan memeriksa perintah yang benar-benar dijalankan;
 * namanya sengaja berbeda dari variabel milik `gh` sendiri (`GH_TOKEN`, `GH_REPO`).
 */
export function ghCommand() {
  const override = process.env.GH_CMD;
  if (override === undefined || override === '') return ['gh'];

  let parsed;
  try {
    parsed = JSON.parse(override);
  } catch {
    return fail('GH_CMD bukan JSON yang sah.');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((it) => typeof it !== 'string')
  ) {
    return fail('GH_CMD harus berupa JSON array berisi nama program dan argumennya.');
  }
  return parsed;
}

/**
 * Menjalankan `gh <args>`; tidak pernah melempar dan tidak mencetak keluaran
 * mentahnya sendiri.
 *
 * `allowFailure: true` dipakai saat pemanggil ingin menangani kegagalan satu
 * perintah sambil tetap mencoba perintah berikutnya (mis. menghapus beberapa
 * rilis sekaligus, yang tidak boleh berhenti di kegagalan pertama).
 */
export function runGh(args, { allowFailure = false } = {}) {
  const [program, ...prefix] = ghCommand();
  const result = spawnSync(program, [...prefix, ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT,
  });

  if (result.error) {
    return fail(`Tidak bisa menjalankan ${program} (${result.error.message}).`, [
      'Script ini butuh `gh` di PATH dan token di GH_TOKEN dengan izin tulis ke repository.',
    ]);
  }

  const output = {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };

  if (!output.ok && !allowFailure) {
    const lines = `${output.stdout}\n${output.stderr}`
      .split('\n')
      .filter((line) => line.trim() !== '')
      .slice(-6);
    return fail(`Perintah gh gagal (exit ${output.status}): gh ${args.join(' ')}`, lines);
  }

  return output;
}
