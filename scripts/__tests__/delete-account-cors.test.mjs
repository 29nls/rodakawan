/**
 * Uji allowlist CORS Edge Function `delete-account`.
 *
 * Kenapa ini diuji terpisah: CORS mudah "terlihat benar" di browser pengembang
 * karena `Access-Control-Allow-Origin: *` juga berhasil. Yang perlu dibuktikan
 * justru sebaliknya — origin yang tidak terdaftar **ditolak** dan tidak menerima
 * header izin, sementara aplikasi native (tanpa `Origin`) tetap dilayani.
 *
 * Modul yang diuji adalah `supabase/functions/delete-account/cors.mjs`, bukan
 * salinan logika di tes: `index.ts` mengimpor modul yang sama, jadi tes ini
 * menjaga jalur yang benar-benar berjalan di Edge Function.
 *
 * Jalankan: `npm run test:scripts` (atau `node --test` pada berkas ini).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateCors,
  handleCors,
  parseAllowedOrigins,
} from '../../supabase/functions/delete-account/cors.mjs';

const PAGES = 'https://owner.github.io';
const LOCAL = 'http://localhost:8000';

function request(origin, method = 'POST') {
  const headers = origin === undefined ? {} : { Origin: origin };
  return new Request('https://project.supabase.co/functions/v1/delete-account', {
    method,
    headers,
  });
}

describe('parseAllowedOrigins', () => {
  it('membaca daftar dipisahkan koma, membuang spasi, garis miring akhir, dan duplikat', () => {
    assert.deepEqual(parseAllowedOrigins(` ${PAGES}/ , ${LOCAL},${PAGES} `), [PAGES, LOCAL]);
  });

  it('mengosongkan nilai yang tidak ada atau kosong (fail-closed)', () => {
    assert.deepEqual(parseAllowedOrigins(undefined), []);
    assert.deepEqual(parseAllowedOrigins(null), []);
    assert.deepEqual(parseAllowedOrigins(''), []);
    assert.deepEqual(parseAllowedOrigins(' , , '), []);
  });

  it('menolak wildcard, bukan meneruskannya sebagai origin sah', () => {
    // Satu `*` tidak boleh membuka kembali semua origin.
    assert.deepEqual(parseAllowedOrigins('*'), []);
    assert.deepEqual(parseAllowedOrigins(`${PAGES},*`), [PAGES]);
  });
});

describe('evaluateCors', () => {
  const allowed = parseAllowedOrigins(`${PAGES},${LOCAL}`);

  it('origin persis yang terdaftar diizinkan dan digemakan (bukan "*")', () => {
    const result = evaluateCors(PAGES, allowed);

    assert.equal(result.browser, true);
    assert.equal(result.allowed, true);
    assert.equal(result.headers['Access-Control-Allow-Origin'], PAGES);
    assert.notEqual(result.headers['Access-Control-Allow-Origin'], '*');
    assert.equal(result.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
    assert.match(result.headers['Access-Control-Allow-Headers'], /authorization/);
    assert.equal(result.headers.Vary, 'Origin');
  });

  it('aplikasi native tanpa header Origin tidak diperlakukan sebagai browser', () => {
    const result = evaluateCors(undefined, allowed);

    assert.equal(result.browser, false);
    assert.equal(result.allowed, true);
    assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(result.headers.Vary, 'Origin');
  });

  it('origin lain ditolak, termasuk host, skema, port, dan subdomain yang mirip', () => {
    const rejected = [
      'https://evil.example',
      'https://owner.github.io.evil.example',
      'https://evil-owner.github.io',
      'http://owner.github.io',
      'https://owner.github.io:443',
      'https://sub.owner.github.io',
      'https://owner.github.io/path',
      'null',
    ];

    for (const origin of rejected) {
      const result = evaluateCors(origin, allowed);
      assert.equal(result.browser, true, `${origin} seharusnya dianggap permintaan browser`);
      assert.equal(result.allowed, false, `${origin} seharusnya ditolak`);
      assert.equal(
        result.headers['Access-Control-Allow-Origin'],
        undefined,
        `${origin} tidak boleh menerima header izin`,
      );
    }
  });

  it('tanpa konfigurasi, setiap origin browser ditolak', () => {
    const result = evaluateCors(PAGES, parseAllowedOrigins(undefined));

    assert.equal(result.allowed, false);
    assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
  });
});

describe('handleCors', () => {
  const allowed = parseAllowedOrigins(`${PAGES},${LOCAL}`);

  it('preflight dari origin terdaftar dijawab 204 dengan izin persis', async () => {
    const { response } = handleCors(request(PAGES, 'OPTIONS'), allowed);

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), PAGES);
    assert.match(response.headers.get('Access-Control-Allow-Methods'), /POST/);
  });

  it('permintaan dari origin asing dijawab 403 tanpa header ACAO', async () => {
    const { response } = handleCors(request('https://evil.example'), allowed);
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(body.error, 'origin_not_allowed');
    assert.match(body.message, /alamat resmi atau gunakan aplikasi/i);
  });

  it('preflight dari origin asing juga ditolak, bukan dijawab 204', () => {
    const { response } = handleCors(request('https://evil.example', 'OPTIONS'), allowed);

    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  });

  it('permintaan native tanpa Origin diteruskan ke handler hanya dengan Vary', () => {
    const gate = handleCors(request(undefined), allowed);

    assert.equal(gate.response, null);
    assert.deepEqual(gate.headers, { Vary: 'Origin' });
  });

  it('konfigurasi kosong menolak halaman web (fail-closed)', async () => {
    const { response } = handleCors(request(PAGES), parseAllowedOrigins(''));

    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  });
});
