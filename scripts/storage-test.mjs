#!/usr/bin/env node
/**
 * Uji integrasi HTTP Storage Supabase dengan akun uji sementara (project development).
 *
 * Kenapa runner ini ada:
 * - `npm run db:test` membuktikan policy Storage dari dalam database (RLS pada
 *   `storage.objects`), tetapi tidak pernah melewati HTTP API Storage yang benar-benar
 *   dipakai aplikasi: unggah objek, pembuatan signed URL, dan unduhan bertoken.
 * - Runner ini menjalankan alur nyata itu dengan dua akun uji sementara:
 *     1. unggah foto kendaraan sebagai pemilik (HTTP 200);
 *     2. membuat signed URL lalu mengunduhnya tanpa token — isi berkas wajib sama
 *        persis dengan yang diunggah (bukti objek benar-benar tersimpan);
 *     3. penolakan lintas pengguna: user B tidak bisa mengunggah ke folder A, tidak
 *        bisa menautkan motor A ke folder B, tidak bisa membuat signed URL untuk
 *        objek A, dan tidak bisa mengunduhnya; `anon` juga ditolak;
 *     4. pemilik menghapus objeknya lewat HTTP, lalu signed URL lama mati;
 *     5. SEMUA data uji dibersihkan dan kebersihannya diverifikasi lewat database
 *        sebelum lulus dilaporkan.
 *
 * Kenapa akun uji dibuat lewat database, bukan service_role:
 * - Admin API GoTrue (`/auth/v1/admin/users`) membutuhkan service_role key, yang
 *   sengaja tidak pernah disimpan di repo/mesin ini (lihat scripts/db-test.mjs dan
 *   docs/SETUP_GUIDE.md). Runner ini cukup dengan `DATABASE_URL` (sama dengan yang
 *   sudah dipakai db:test) plus URL + publishable key publik dari `.env.local`.
 * - Kata sandi akun uji dibuat acak setiap run, di-hash dengan pgcrypto saat insert,
 *   dan tidak pernah dicetak. Sesi JWT justru diperoleh lewat password grant GoTrue
 *   yang sesungguhnya (`/auth/v1/token?grant_type=password`), jadi uji ini sekaligus
 *   membuktikan akun buatan database memang bisa dipakai lewat HTTP.
 *
 * Kenapa objek dibersihkan lewat HTTP, bukan `delete from storage.objects`:
 * - Supabase memasang trigger yang menolak DELETE langsung pada tabel Storage
 *   ("Direct deletion from storage tables is not allowed"). Satu-satunya jalur sah
 *   adalah Storage API, yang juga berarti pembersihan ini ikut menguji policy DELETE
 *   milik pemilik. Baris yang tersisa dibaca lewat SELECT (boleh) dan wajib nol.
 *
 * Aturan keamanan yang dipegang file ini:
 * - Kredensial hanya dibaca dari environment. `npm run storage:test` memuat
 *   `.env.local` (hanya variabel EXPO_PUBLIC_*, memang nilainya publik) dan `.env.db`
 *   (DATABASE_URL; tidak pernah dibaca Expo). Tidak ada rahasia yang dikirim sebagai
 *   argumen proses, dicetak, atau ditulis ke log.
 * - JWT, signed URL, dan kata sandi disunting dari setiap keluaran sebelum dicetak.
 * - Runner hanya melaporkan lulus bila seluruh langkah LULUS dan verifikasi
 *   kebersihan menemukan nol sisa; exit 0 tanpa keduanya tidak mungkin terjadi.
 *
 * Pemakaian:
 *   npm run storage:test
 *   node --env-file-if-exists=.env.local --env-file-if-exists=.env.db scripts/storage-test.mjs
 *
 * SSL ke database: sama seperti scripts/db-test.mjs — pakai host *session pooler*
 * (`aws-0-<region>.pooler.supabase.com`) dengan `sslmode=require`, karena host langsung
 * `db.<ref>.supabase.co` hanya punya record AAAA sehingga sering gagal di jaringan IPv4.
 */

import { createHash, randomBytes } from 'node:crypto';
import process from 'node:process';

import pg from 'pg';

const BUCKET = 'vehicle-photos';
/** Bucket avatar memakai pola policy yang sama (owner-only) dengan path lebih pendek. */
const AVATAR_BUCKET = 'avatars';

/** ID uji tetap (bukan acak) supaya sisa run sebelumnya dapat dikenali dan disapu. */
const USER_A_ID = 'a1000000-0000-4000-8000-00000000000a';
const USER_B_ID = 'b2000000-0000-4000-8000-00000000000b';
const MOTOR_ID = 'c3000000-0000-4000-8000-00000000000c';

const USER_A_EMAIL = 'uji.storage.a@contoh.test';
const USER_B_EMAIL = 'uji.storage.b@contoh.test';

/** Nama berkas yang mungkin ditinggalkan run sebelumnya; semuanya dihapus lewat HTTP. */
const FILE_UTAMA = 'uji.png';
const FILE_DITOLAK = ['milik-b.png', 'anon.png'];
const FILE_AVATAR = 'uji-avatar.png';
const FILE_AVATAR_DITOLAK = 'milik-b-avatar.png';

/** PNG 1x1 yang valid; bucket hanya menerima image/jpeg, image/png, image/webp. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const SUCCESS_NOTICE = 'UJI INTEGRASI STORAGE LULUS';
const FETCH_TIMEOUT_MS = 30_000;

const HELP = `Uji integrasi HTTP Storage (project development).

Pemakaian:
  npm run storage:test
  node --env-file-if-exists=.env.local --env-file-if-exists=.env.db scripts/storage-test.mjs

Environment:
  EXPO_PUBLIC_SUPABASE_URL             URL project development (dari .env.local).
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY Publishable/anon key project (dari .env.local).
  DATABASE_URL (wajib)                 Connection string PostgreSQL project DEVELOPMENT
                                       (host session pooler, sslmode=require; dari .env.db).
  SUPABASE_DB_URL                      Dipakai bila DATABASE_URL tidak ada.

Yang dibuktikan:
  - unggah objek privat sebagai pemilik lewat HTTP API Storage (foto kendaraan dan avatar);
  - signed URL bekerja tanpa token dan isi unduhan sama persis dengan yang diunggah;
  - user lain dan "anon" ditolak untuk unggah, sign, dan unduh objek pemilik;
  - pemilik bisa menghapus objeknya dan signed URL lama langsung mati;
  - seluruh data uji (akun, objek, baris turunan) dibersihkan dan diverifikasi nol sisa.

Aturan:
  - Jalankan hanya pada project DEVELOPMENT, jangan memakai kredensial produksi.
  - Tidak memakai service_role: cukup DATABASE_URL + URL/publishable key publik.
  - Password akun uji dibuat acak tiap run dan tidak pernah dicetak.
`;

class UjiGagal extends Error {}

let langkahLulus = 0;

function ok(pesan) {
  langkahLulus += 1;
  console.log(`[storage:test] ok ${langkahLulus}: ${pesan}`);
}

/** Menyunting JWT, token signed URL, dan rahasia koneksi dari teks yang dicetak. */
function redact(text) {
  return String(text ?? '')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '<JWT disunting>')
    .replace(/([?&]token=)[^&\s"']+/gi, '$1<disunting>');
}

/** Deskripsi target koneksi database tanpa rahasia apa pun. */
function describeDatabase(connectionString) {
  try {
    const url = new URL(connectionString);
    const user = url.username ? decodeURIComponent(url.username) : '(tanpa user)';
    const host = url.hostname || '(tanpa host)';
    const port = url.port || '5432';
    const database = url.pathname.replace(/^\//, '') || '(tanpa nama database)';
    const sslmode = url.searchParams.get('sslmode');

    return `${user}@${host}:${port}/${database}${sslmode ? ` (sslmode=${sslmode})` : ''}`;
  } catch {
    return '(connection string tidak dapat dibaca)';
  }
}

/**
 * Terjemahkan connection string menjadi konfigurasi client pg.
 *
 * `sslmode=require` ditangani mengikuti semantik libpq (enkripsi aktif tanpa verifikasi
 * CA) dan dihapus dari URL supaya tidak dipetakan ulang oleh pg-connection-string
 * menjadi `verify-full`; pooler Supabase memakai CA internal sehingga verifikasi penuh
 * gagal tanpa `sslrootcert`. Penjelasan lengkap ada di catatan SSL scripts/db-test.mjs.
 */
function clientConfig(connectionString) {
  const base = {
    application_name: 'rodakawan-storage-test',
    connectionTimeoutMillis: 15_000,
    statement_timeout: 60_000,
  };

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return { ...base, connectionString };
  }

  if (url.searchParams.get('sslmode') !== 'require') {
    return { ...base, connectionString };
  }

  url.searchParams.delete('sslmode');
  return { ...base, connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
}

function connectionHint(error) {
  const code = String(error?.code ?? '');

  switch (code) {
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'Pakai `sslmode=require` pada connection string (pooler Supabase memakai CA internal).';
    case 'ENOTFOUND':
      return 'Host tidak ditemukan. Pakai host session pooler `aws-0-<region>.pooler.supabase.com` dengan user `postgres.<ref>`, bukan host langsung `db.<ref>.supabase.co`.';
    case '28P01':
      return 'Kredensial database ditolak. Pastikan DATABASE_URL memakai kredensial project development.';
    case '3F000':
    case '42P01':
    case 'PGRST205':
      return 'Objek database belum ada. Jalankan migration yang belum diterapkan lebih dulu (docs/SETUP_GUIDE.md bagian 4.3), termasuk bucket Storage.';
    case '42501':
      return 'Izin ditolak server. Pengujian ini perlu kredensial pemilik database (mis. `postgres`).';
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
      return 'Server database tidak dapat dihubungi. Periksa koneksi internet dan apakah IP Anda diizinkan pada project tersebut.';
    default:
      return undefined;
  }
}

/* -------------------------------------------------------------------- HTTP */

/**
 * Permintaan HTTP ke API Supabase. Token, signed URL, dan body respons disunting
 * dari setiap pesan kesalahan; hanya status HTTP yang dipakai untuk asersi.
 */
async function request(url, { method = 'GET', headers = {}, body } = {}) {
  let response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new UjiGagal(`permintaan ${method} ${redact(url)} gagal di jaringan: ${error?.message}`);
  }

  const text = await response.text().catch(() => '');
  return { status: response.status, text };
}

function expectHttp(label, response, expected) {
  if (response.status !== expected) {
    throw new UjiGagal(
      `${label}: diharapkan HTTP ${expected}, dapat ${response.status} — ${redact(response.text).slice(0, 200)}`,
    );
  }

  ok(`${label} (HTTP ${expected})`);
}

/** Semua penolakan otorisasi harus 4xx: data tidak bocor dan server tidak sedang error. */
function expectDenied(label, response) {
  if (response.status < 400 || response.status >= 500) {
    throw new UjiGagal(
      `${label}: diharapkan penolakan 4xx, dapat HTTP ${response.status} — ${redact(response.text).slice(0, 200)}`,
    );
  }

  ok(`${label} ditolak (HTTP ${response.status})`);
}

function expectSql(label, value, expected) {
  if (value !== expected) {
    throw new UjiGagal(`${label}: diharapkan ${expected}, dapat ${value}`);
  }

  ok(`${label} (${value})`);
}

/* ----------------------------------------------------------------- alur uji */

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }

  const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

  const kurang = [];
  if (!supabaseUrl) kurang.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!publishableKey) kurang.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (!connectionString) kurang.push('DATABASE_URL');

  if (kurang.length > 0) {
    console.error(`[storage:test] Environment belum lengkap: ${kurang.join(', ')}.`);
    console.error(
      '[storage:test] `npm run storage:test` memuat .env.local (EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY) dan .env.db (DATABASE_URL) secara otomatis.',
    );
    console.error(
      '[storage:test] Isi keduanya lebih dulu (docs/SETUP_GUIDE.md bagian 3 dan 4); jangan simpan service_role di mana pun pada mesin ini.',
    );
    return 1;
  }

  let apiBase;
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== 'https:') throw new Error('bukan https');
    apiBase = parsed.origin;
  } catch {
    console.error('[storage:test] EXPO_PUBLIC_SUPABASE_URL tidak valid (harus URL https).');
    return 1;
  }

  const storageUrl = (suffix) => `${apiBase}/storage/v1${suffix}`;

  const folderA = `${USER_A_ID}/${MOTOR_ID}`;
  const folderB = `${USER_B_ID}/${MOTOR_ID}`;
  const pathUtama = `${folderA}/${FILE_UTAMA}`;
  const pathDitolak = [
    ...FILE_DITOLAK.map((nama) => `${folderA}/${nama}`),
    `${folderB}/milik-b.png`,
  ];

  const avatarA = `${USER_A_ID}/${FILE_AVATAR}`;
  const avatarDitolak = `${USER_A_ID}/${FILE_AVATAR_DITOLAK}`;
  const avatarAnon = `${USER_A_ID}/anon.png`;
  /** Kedua bucket diuji; pembersihan dan verifikasi harus mencakup keduanya. */
  const BUCKETS_UJI = [BUCKET, AVATAR_BUCKET];

  /** Header yang sama dengan yang dikirim supabase-js (apikey + Authorization). */
  const authHeaders = (token) => ({
    apikey: publishableKey,
    Authorization: `Bearer ${token}`,
  });

  const client = new pg.Client(clientConfig(connectionString));

  const sql = (text, params) => client.query(text, params);
  /** Angka dari query agregat `select count(*) as count ...`. */
  const scalar = async (text, params) => Number((await sql(text, params)).rows[0].count);
  /** Jumlah baris yang benar-benar terhapus (`rowCount` untuk `delete ... returning`). */
  const deleteRows = async (text, params) => (await sql(text, params)).rowCount ?? 0;

  const storageRequest = (suffix, { method = 'GET', token, contentType, body } = {}) => {
    const headers = authHeaders(token ?? publishableKey);
    if (contentType) headers['content-type'] = contentType;

    return request(storageUrl(suffix), { method, headers, body });
  };

  /** Hapus objek lewat Storage API (satu-satunya jalur sah; DELETE tabel ditolak Supabase). */
  const removeObjects = (token, paths, bucket = BUCKET) =>
    storageRequest(`/object/${bucket}`, {
      method: 'DELETE',
      token,
      contentType: 'application/json',
      body: JSON.stringify({ prefixes: paths }),
    });

  let tokenA;
  let tokenB;

  console.log(`[storage:test] Database : ${describeDatabase(connectionString)}`);
  console.log(`[storage:test] API      : ${new URL(apiBase).hostname}`);
  console.log('[storage:test] Kredensial dibaca dari environment dan tidak ditampilkan di sini.');
  console.log(
    '[storage:test] PERINGATAN: jalankan hanya pada project development; runner ini membuat dan menghapus akun uji.',
  );

  let gagal = false;

  try {
    await client.connect();

    /* 0. Akun sisa run sebelumnya (mis. proses terputus di tengah jalan) dibuang lebih
          dulu. Sejak ADR-077 profil TIDAK lagi ikut ON DELETE CASCADE dari auth.users,
          jadi profil dihapus eksplisit (kendaraan ikut cascade dari profil). Objeknya
          baru bisa disapu setelah akun pengganti dengan ID yang sama dibuat (langkah 2b). */
    await deleteRows(`delete from public.profiles where id in ($1, $2) returning 1`, [
      USER_A_ID,
      USER_B_ID,
    ]);
    const sisaAkun = await deleteRows(`delete from auth.users where id in ($1, $2) returning 1`, [
      USER_A_ID,
      USER_B_ID,
    ]);
    if (sisaAkun > 0) {
      console.log(`[storage:test] membersihkan sisa run sebelumnya: ${sisaAkun} akun uji.`);
    }

    /* 1. Dua akun uji sementara + satu kendaraan milik A. Kata sandi acak per run,
          di-hash pgcrypto; trigger bootstrap membuat profiles otomatis.

          Kolom token sengaja diisi '' (bukan dibiarkan NULL seperti default kolom):
          GoTrue memindai baris `auth.users` ke struct Go dengan field string biasa, dan
          satu NULL saja membuat password grant gagal 500 "Database error querying schema"
          walaupun barisnya terlihat wajar di SQL. GoTrue sendiri selalu menulis ''. */
    const passwordA = randomBytes(18).toString('base64url');
    const passwordB = randomBytes(18).toString('base64url');

    await sql(
      `insert into auth.users (
         id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
         confirmation_token, recovery_token, email_change, email_change_token_new,
         email_change_token_current, phone_change, phone_change_token,
         reauthentication_token, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at
       ) values
         ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          $3, crypt($4, gen_salt('bf')), now(),
          '', '', '', '', '', '', '', '',
          '{"provider":"email","providers":["email"]}', $5::jsonb, now(), now()),
         ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          $6, crypt($7, gen_salt('bf')), now(),
          '', '', '', '', '', '', '', '',
          '{"provider":"email","providers":["email"]}', $8::jsonb, now(), now())`,
      [
        USER_A_ID,
        USER_B_ID,
        USER_A_EMAIL,
        passwordA,
        JSON.stringify({ username: 'uji_storage_a', display_name: 'Uji Storage A' }),
        USER_B_EMAIL,
        passwordB,
        JSON.stringify({ username: 'uji_storage_b', display_name: 'Uji Storage B' }),
      ],
    );

    const profil = await scalar(
      `select count(*) as count from public.profiles where id in ($1, $2)`,
      [USER_A_ID, USER_B_ID],
    );
    expectSql('bootstrap trigger membuat 2 profil uji', profil, 2);

    await sql(
      `insert into public.motorcycles (id, owner_id, make, model)
       values ($1, $2, 'Uji', 'Storage') on conflict (id) do nothing`,
      [MOTOR_ID, USER_A_ID],
    );
    ok('kendaraan uji milik A dibuat');

    /* 2. Sign-in lewat password grant GoTrue yang sesungguhnya — JWT untuk semua
          langkah HTTP berikutnya. */
    const signIn = async (label, email, password) => {
      const response = await request(`${apiBase}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: publishableKey, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.status !== 200) {
        throw new UjiGagal(
          `sign-in ${label} gagal (HTTP ${response.status}) — ${redact(response.text).slice(0, 200)}`,
        );
      }

      let payload;
      try {
        payload = JSON.parse(response.text);
      } catch {
        throw new UjiGagal(`sign-in ${label} mengembalikan respons bukan JSON.`);
      }

      if (typeof payload?.access_token !== 'string' || payload.access_token.length === 0) {
        throw new UjiGagal(`sign-in ${label} tidak mengembalikan access_token.`);
      }

      ok(`sign-in ${label} via GoTrue password grant`);
      return payload.access_token;
    };

    tokenA = await signIn('A', USER_A_EMAIL, passwordA);
    tokenB = await signIn('B', USER_B_EMAIL, passwordB);

    /* 2b. Objek sisa run sebelumnya disapu oleh pemiliknya masing-masing. Policy DELETE
           hanya memeriksa folder pemilik, jadi ID tetap membuat objek lama tetap bisa
           dihapus oleh akun pengganti. */
    await removeObjects(tokenA, [pathUtama, ...FILE_DITOLAK.map((nama) => `${folderA}/${nama}`)]);
    await removeObjects(tokenA, [avatarA, avatarDitolak, avatarAnon], AVATAR_BUCKET);
    await removeObjects(tokenB, [`${folderB}/milik-b.png`]);

    const sisaObjek = await scalar(
      `select count(*) as count from storage.objects
       where bucket_id = any($1::text[]) and (storage.foldername(name))[1] in ($2, $3)`,
      [BUCKETS_UJI, USER_A_ID, USER_B_ID],
    );
    expectSql('tidak ada objek sisa run sebelumnya', sisaObjek, 0);

    /* 3. Unggah sebagai pemilik (HTTP API Storage, bukan lewat database). */
    const unggah = await storageRequest(`/object/${BUCKET}/${pathUtama}`, {
      method: 'POST',
      token: tokenA,
      contentType: 'image/png',
      body: PNG_BYTES,
    });
    expectHttp('unggah foto kendaraan sebagai A', unggah, 200);

    /* 4. Signed URL lalu unduh tanpa token apa pun; isi wajib sama persis. */
    const sign = await storageRequest(`/object/sign/${BUCKET}/${pathUtama}`, {
      method: 'POST',
      token: tokenA,
      contentType: 'application/json',
      body: JSON.stringify({ expiresIn: 600 }),
    });
    expectHttp('pembuatan signed URL oleh A', sign, 200);

    let signedUrl;
    try {
      signedUrl = storageUrl(JSON.parse(sign.text).signedURL);
    } catch {
      throw new UjiGagal('respons signed URL tidak memuat field signedURL.');
    }

    let unduhan;
    try {
      unduhan = await fetch(signedUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (error) {
      throw new UjiGagal(`unduhan signed URL gagal di jaringan: ${error?.message}`);
    }

    if (unduhan.status !== 200) {
      throw new UjiGagal(`unduhan signed URL: diharapkan HTTP 200, dapat ${unduhan.status}.`);
    }

    const isi = Buffer.from(await unduhan.arrayBuffer());
    const hashUnggah = createHash('sha256').update(PNG_BYTES).digest('hex');
    const hashUnduh = createHash('sha256').update(isi).digest('hex');
    if (hashUnduh !== hashUnggah) {
      throw new UjiGagal('isi unduhan signed URL berbeda dengan berkas yang diunggah.');
    }
    ok('unduhan signed URL tanpa token mengembalikan isi yang sama persis');

    /* 5. Penolakan lintas pengguna dan anon. Objek yang ditolak juga diverifikasi lewat
          database: tidak satu pun boleh benar-benar terbentuk. */
    expectDenied(
      'unggah B ke folder A',
      await storageRequest(`/object/${BUCKET}/${folderA}/milik-b.png`, {
        method: 'POST',
        token: tokenB,
        contentType: 'image/png',
        body: PNG_BYTES,
      }),
    );

    expectDenied(
      'unggah B ke folder B dengan motor A',
      await storageRequest(`/object/${BUCKET}/${USER_B_ID}/${MOTOR_ID}/milik-b.png`, {
        method: 'POST',
        token: tokenB,
        contentType: 'image/png',
        body: PNG_BYTES,
      }),
    );

    expectDenied(
      'signed URL B untuk objek A',
      await storageRequest(`/object/sign/${BUCKET}/${pathUtama}`, {
        method: 'POST',
        token: tokenB,
        contentType: 'application/json',
        body: JSON.stringify({ expiresIn: 600 }),
      }),
    );

    expectDenied(
      'unduhan langsung B ke objek A',
      await storageRequest(`/object/${BUCKET}/${pathUtama}`, { token: tokenB }),
    );

    expectDenied(
      'unggah anon (hanya anon key)',
      await storageRequest(`/object/${BUCKET}/${folderA}/anon.png`, {
        method: 'POST',
        contentType: 'image/png',
        body: PNG_BYTES,
      }),
    );

    const objekDitolak = await scalar(
      `select count(*) as count from storage.objects
       where bucket_id = $1 and name in ($2, $3, $4)`,
      [BUCKET, ...pathDitolak],
    );
    expectSql('tidak ada objek dari percobaan yang ditolak', objekDitolak, 0);

    /* 5b. Foto profil memakai pola yang sama dengan path lebih pendek
           (`<user_id>/<berkas>`): A boleh unggah/baca/hapus folder sendiri, B dan
           "anon" tidak. Ini membuktikan policy `avatars` di API Storage nyata, bukan
           hanya baris policy di database. */
    const unggahAvatar = await storageRequest(`/object/${AVATAR_BUCKET}/${avatarA}`, {
      method: 'POST',
      token: tokenA,
      contentType: 'image/png',
      body: PNG_BYTES,
    });
    expectHttp('unggah foto profil sebagai A', unggahAvatar, 200);

    const signAvatar = await storageRequest(`/object/sign/${AVATAR_BUCKET}/${avatarA}`, {
      method: 'POST',
      token: tokenA,
      contentType: 'application/json',
      body: JSON.stringify({ expiresIn: 600 }),
    });
    expectHttp('pembuatan signed URL foto profil oleh A', signAvatar, 200);

    expectDenied(
      'unggah B ke folder avatar A',
      await storageRequest(`/object/${AVATAR_BUCKET}/${avatarDitolak}`, {
        method: 'POST',
        token: tokenB,
        contentType: 'image/png',
        body: PNG_BYTES,
      }),
    );

    expectDenied(
      'signed URL B untuk foto profil A',
      await storageRequest(`/object/sign/${AVATAR_BUCKET}/${avatarA}`, {
        method: 'POST',
        token: tokenB,
        contentType: 'application/json',
        body: JSON.stringify({ expiresIn: 600 }),
      }),
    );

    expectDenied(
      'unduhan langsung B ke foto profil A',
      await storageRequest(`/object/${AVATAR_BUCKET}/${avatarA}`, { token: tokenB }),
    );

    expectDenied(
      'unggah anon foto profil',
      await storageRequest(`/object/${AVATAR_BUCKET}/${USER_A_ID}/anon.png`, {
        method: 'POST',
        contentType: 'image/png',
        body: PNG_BYTES,
      }),
    );

    const objekAvatarDitolak = await scalar(
      `select count(*) as count from storage.objects
       where bucket_id = $1 and name in ($2, $3)`,
      [AVATAR_BUCKET, avatarDitolak, avatarAnon],
    );
    expectSql('tidak ada foto profil dari percobaan yang ditolak', objekAvatarDitolak, 0);

    const hapusAvatar = await removeObjects(tokenA, [avatarA], AVATAR_BUCKET);
    expectHttp('penghapusan foto profil oleh pemilik A', hapusAvatar, 200);

    const signAvatarHapus = await storageRequest(`/object/sign/${AVATAR_BUCKET}/${avatarA}`, {
      method: 'POST',
      token: tokenA,
      contentType: 'application/json',
      body: JSON.stringify({ expiresIn: 600 }),
    });
    expectDenied('signed URL untuk foto profil yang sudah dihapus', signAvatarHapus);

    /* 6. Pemilik menghapus objeknya lewat HTTP; signed URL lama harus mati. */
    const hapus = await removeObjects(tokenA, [pathUtama]);
    expectHttp('penghapusan objek oleh pemilik A', hapus, 200);

    const setelahHapus = await storageRequest(`/object/sign/${BUCKET}/${pathUtama}`, {
      method: 'POST',
      token: tokenA,
      contentType: 'application/json',
      body: JSON.stringify({ expiresIn: 600 }),
    });
    expectDenied('signed URL untuk objek yang sudah dihapus', setelahHapus);
  } catch (error) {
    gagal = true;
    console.error(`[storage:test] GAGAL: ${redact(error?.message ?? error)}`);

    const hint = connectionHint(error);
    if (hint) console.error(`[storage:test] Petunjuk: ${hint}`);

    if (!(error instanceof UjiGagal) && error?.stack) {
      console.error(redact(error.stack));
    }
  }

  /* 7. Pembersihan SELALU berjalan, termasuk saat langkah uji gagal: objek yang
        mungkin tersisa dihapus lewat HTTP oleh pemiliknya (satu-satunya jalur yang
        diizinkan Supabase), lalu profil dan akun uji dihapus. Sejak ADR-077 profil
        harus dihapus eksplisit sebelum auth.users; kendaraan cascade dari profil. */
  try {
    if (tokenA) {
      await removeObjects(tokenA, [pathUtama, ...pathDitolak.slice(0, 2)]);
      await removeObjects(tokenA, [avatarA, avatarDitolak, avatarAnon], AVATAR_BUCKET);
    }
    if (tokenB) await removeObjects(tokenB, [pathDitolak[2]]);

    if (tokenA || tokenB) {
      console.log('[storage:test] objek uji dihapus lewat Storage API.');
    }

    const sisaObjek = await scalar(
      `select count(*) as count from storage.objects
       where bucket_id = any($1::text[]) and (storage.foldername(name))[1] in ($2, $3)`,
      [BUCKETS_UJI, USER_A_ID, USER_B_ID],
    );

    if (sisaObjek > 0) {
      const nama = await sql(
        `select name from storage.objects
         where bucket_id = any($1::text[]) and (storage.foldername(name))[1] in ($2, $3)
         order by name`,
        [BUCKETS_UJI, USER_A_ID, USER_B_ID],
      );
      throw new UjiGagal(
        `${sisaObjek} objek uji masih tersisa: ${nama.rows.map((row) => row.name).join(', ')}`,
      );
    }

    const profil = await deleteRows(
      `delete from public.profiles where id in ($1, $2) returning 1`,
      [USER_A_ID, USER_B_ID],
    );
    const akun = await deleteRows(`delete from auth.users where id in ($1, $2) returning 1`, [
      USER_A_ID,
      USER_B_ID,
    ]);
    ok(`${profil} profil dan ${akun} akun uji dihapus (kendaraan ikut cascade dari profil)`);

    const sisa = {
      akun: await scalar(`select count(*) as count from auth.users where id in ($1, $2)`, [
        USER_A_ID,
        USER_B_ID,
      ]),
      profil: await scalar(`select count(*) as count from public.profiles where id in ($1, $2)`, [
        USER_A_ID,
        USER_B_ID,
      ]),
      motor: await scalar(
        `select count(*) as count from public.motorcycles where owner_id in ($1, $2)`,
        [USER_A_ID, USER_B_ID],
      ),
    };

    if (sisa.akun + sisa.profil + sisa.motor > 0) {
      throw new UjiGagal(
        `masih ada sisa data uji: ${sisa.akun} akun, ${sisa.profil} profil, ${sisa.motor} kendaraan.`,
      );
    }

    ok('verifikasi kebersihan: 0 objek, 0 akun, 0 profil, 0 kendaraan uji tersisa');
  } catch (error) {
    gagal = true;
    console.error(`[storage:test] GAGAL pembersihan: ${redact(error?.message ?? error)}`);
  } finally {
    await client.end().catch(() => undefined);
  }

  if (gagal) {
    console.error(
      `[storage:test] TIDAK LULUS: ${langkahLulus} langkah lulus sebelum kegagalan. Perbaiki penyebabnya lalu jalankan ulang; run berikutnya menyapu sisa otomatis.`,
    );
    return 1;
  }

  console.log(
    `[storage:test] ${SUCCESS_NOTICE}: ${langkahLulus} langkah lulus, termasuk verifikasi kebersihan.`,
  );
  return 0;
}

const exitCode = await main();
process.exitCode = exitCode;
