/**
 * CORS untuk Edge Function `delete-account`.
 *
 * Sebelumnya fungsi membalas `Access-Control-Allow-Origin: *`, sehingga halaman
 * mana pun di internet dapat memanggil endpoint ini dari browser pengguna.
 * Token tetap wajib, jadi bug itu tidak menghapus akun tanpa korban mengetik
 * kata sandinya — tetapi simpul yang terbuka membuat phishing lebih mudah:
 * halaman penyerang dapat meminta penghapusan dari sesi yang sudah masuk, lalu
 * menampilkan pesan palsu. Allowlist per-origin menutup jalur itu.
 *
 * Aturan yang dipegang:
 * - **Hanya origin persis yang cocok** yang diizinkan. Pencocokan substring,
 *   awalan, atau wildcard tidak dipakai: `https://evil.example` tidak boleh
 *   lolos hanya karena memuat string origin resmi.
 * - **Fail-closed.** Bila `WEB_ALLOWED_ORIGINS` kosong/tidak diset, tidak ada
 *   origin browser yang diizinkan. Halaman web menampilkan galat yang bisa
 *   ditindaklanjuti sampai pemilik mengisi nilainya; aplikasi Android tidak
 *   terpengaruh karena tidak mengirim header `Origin`.
 * - **`*` bukan nilai yang sah.** Satu tanda bintang di konfigurasi tidak boleh
 *   diam-diam membuka kembali semua origin; nilai itu dibuang.
 * - **Permintaan tanpa `Origin`** (aplikasi native, pemanggilan server) tetap
 *   dilayani tanpa header CORS. CORS adalah aturan browser, bukan autentikasi:
 *   token tetap diverifikasi fungsi.
 * - **`Vary: Origin`** selalu dikirim agar cache tidak menyajikan balasan milik
 *   origin lain.
 *
 * Nilai konfigurasi: daftar origin dipisahkan koma, tanpa path. Origin browser
 * hanya terdiri dari skema + host + port, mis.
 * `WEB_ALLOWED_ORIGINS=https://owner.github.io,http://localhost:8000`.
 * Untuk GitHub Pages project site, origin-nya `https://<owner>.github.io`
 * (path repository bukan bagian dari origin).
 */

const ALLOW_METHODS = 'POST, OPTIONS';
const ALLOW_HEADERS = 'authorization, apikey, content-type, x-client-info';
const MAX_AGE = '86400';

/** Buang spasi dan garis miring akhir; origin tidak pernah berakhir dengan `/`. */
function normalize(value) {
  return String(value ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * Ubah nilai environment menjadi daftar origin yang unik.
 * `undefined`, string kosong, dan wildcard menghasilkan daftar kosong (fail-closed).
 */
export function parseAllowedOrigins(raw) {
  if (typeof raw !== 'string') return [];

  const origins = raw
    .split(',')
    .map(normalize)
    .filter((origin) => origin !== '' && origin !== '*');

  return [...new Set(origins)];
}

/**
 * Putuskan apakah permintaan boleh dijawab browser.
 *
 * `headers` hanya memuat `Access-Control-Allow-Origin` bila origin benar-benar
 * cocok; pada penolakan, header itu **tidak ada** sehingga browser memblokir
 * pembacaan respons.
 */
export function evaluateCors(originHeader, allowedOrigins) {
  const origin = normalize(originHeader);

  if (origin === '') {
    // Bukan permintaan browser (aplikasi native / server). Tidak butuh CORS.
    return { browser: false, allowed: true, headers: { Vary: 'Origin' } };
  }

  const allowed =
    Array.isArray(allowedOrigins) && allowedOrigins.some((entry) => normalize(entry) === origin);

  if (!allowed) {
    return { browser: true, allowed: false, headers: { Vary: 'Origin' } };
  }

  return {
    browser: true,
    allowed: true,
    headers: {
      Vary: 'Origin',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': ALLOW_METHODS,
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Max-Age': MAX_AGE,
    },
  };
}

/**
 * Gerbang CORS untuk satu permintaan.
 *
 * Mengembalikan `{ response }` bila permintaan harus dihentikan di sini
 * (origin ditolak atau preflight), atau `{ headers }` untuk diteruskan ke
 * handler. Pesan penolakan menyebut tindakan pemulihan, bukan detail internal.
 */
export function handleCors(request, allowedOrigins) {
  const cors = evaluateCors(request.headers.get('Origin'), allowedOrigins);

  if (!cors.allowed) {
    return {
      headers: { Vary: 'Origin' },
      response: new Response(
        JSON.stringify({
          error: 'origin_not_allowed',
          message:
            'Alamat halaman ini tidak diizinkan memanggil layanan hapus akun. Buka halaman dari alamat resmi atau gunakan aplikasi RodaKawan.',
        }),
        {
          status: 403,
          headers: {
            Vary: 'Origin',
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        },
      ),
    };
  }

  if (request.method === 'OPTIONS') {
    return { headers: cors.headers, response: new Response(null, { status: 204, headers: cors.headers }) };
  }

  return { headers: cors.headers, response: null };
}
