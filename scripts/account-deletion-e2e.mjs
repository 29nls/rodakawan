#!/usr/bin/env node
/**
 * Uji E2E penghapusan akun terhadap project development (Auth + Storage + Edge Function).
 *
 * Kenapa runner ini ada
 * ---------------------------------------------------------------------------
 * `npm run db:test` membuktikan `purge_account_data()` dan lease/checkpoint di
 * dalam transaksi, tetapi tidak pernah melewati Auth Admin API atau Storage API.
 * E2E 23 Oktober 2026 membuktikan alur penuh itu, namun skripnya sementara dan
 * tidak dapat diulang. Runner ini menggantikannya.
 *
 * Alur yang diuji (satu akun uji A, satu akun pembanding B, satu penerus C):
 *   1. A memiliki avatar, foto kendaraan, klub + logo yang dipakai, laporan
 *      bahaya, laporan moderasi, pesan chat, dan token push.
 *   2. A memanggil Edge Function `delete-account` dengan JWT-nya sendiri.
 *   3. Fungsi memindahkan logo klub, menghapus media pribadi, memanggil
 *      `purge_account_data` (tombstone), lalu menghapus `auth.users` lewat Auth
 *      Admin API.
 *   4. Runner memeriksa hasilnya: Auth user hilang, profil/data privat hilang,
 *      konten bersama tetap ada tanpa identitas A, logo klub tetap bisa diakses
 *      penerus, data B utuh, JWT lama tidak bisa membaca/menulis, dan login
 *      ulang gagal.
 *
 * Aturan keamanan
 * ---------------------------------------------------------------------------
 * - Hanya project development (ref diperiksa). Tidak pernah production.
 * - Tidak memakai service_role: akun uji dibuat lewat `DATABASE_URL` dan JWT
 *   diperoleh lewat password grant GoTrue yang sesungguhnya.
 * - Kata sandi dan JWT dibuat acak per run, tidak pernah dicetak; URL signed
 *   disunting sebelum dicetak.
 * - Semua akun/objek/baris uji dibersihkan di `finally`, dan kebersihannya
 *   diverifikasi. Sisa objek Storage yang tidak dapat dihapus tanpa pemiliknya
 *   dilaporkan sebagai kegagalan, bukan disembunyikan.
 *
 * Pemakaian
 * ---------------------------------------------------------------------------
 *   npm run e2e:account-delete -- --yes
 *   node --env-file-if-exists=.env.local --env-file-if-exists=.env.db \
 *     scripts/account-deletion-e2e.mjs --yes
 *
 * Environment: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * (dari .env.local) dan DATABASE_URL atau SUPABASE_DB_URL (dari .env.db).
 *
 * Tidak dijalankan otomatis di CI; ini perintah manual yang menghapus akun uji
 * di development.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';

import pg from 'pg';

const DEV_REF = 'xvmcpfkkveeaevfcvfug';
const TOMBSTONE = '00000000-0000-4000-8000-000000000001';
const FETCH_TIMEOUT_MS = 30_000;
const SUCCESS_NOTICE = 'UJI E2E HAPUS AKUN LULUS';

/** PNG 1x1 valid; ketiga bucket privat menerima image/png. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const HELP = `Uji E2E penghapusan akun (project development).

Pemakaian:
  npm run e2e:account-delete -- --yes
  node --env-file-if-exists=.env.local --env-file-if-exists=.env.db scripts/account-deletion-e2e.mjs --yes

--yes wajib: runner ini membuat lalu menghapus akun uji di project development.

Yang diuji:
  - Edge Function delete-account menghapus Auth user, profil, dan media pribadi;
  - laporan bahaya/laporan moderasi tetap ada dengan identitas tombstone;
  - pesan chat diredaksi dan pengirimnya menjadi tombstone;
  - logo klub dipindahkan dan tetap bisa diakses anggota yang berhak;
  - akun pembanding B tidak berubah; JWT lama tidak bisa membaca/menulis;
  - login ulang akun yang dihapus gagal; job berstatus completed.

Runner tidak memakai service_role: akun uji dibuat lewat DATABASE_URL dan JWT
diperoleh lewat password grant GoTrue. Semua data uji dibersihkan di akhir.
`;

class UjiGagal extends Error {}

let langkahLulus = 0;

function ok(pesan) {
  langkahLulus += 1;
  console.log(`[e2e:hapus-akun] ok ${langkahLulus}: ${pesan}`);
}

function check(syarat, pesan) {
  if (!syarat) throw new UjiGagal(pesan);
}

/** Jangan pernah mencetak JWT, kunci, atau signed URL. */
function redact(value) {
  return String(value)
    .replace(/eyJ[A-Za-z0-9._-]+/g, '<jwt>')
    .replace(/sb_(publishable|secret)_[A-Za-z0-9_-]+/g, '<kunci>')
    .replace(/[?&]token=[^&\s]+/g, '?token=<disunting>')
    .replace(/postgres(ql)?:\/\/\S+/gi, '<database-url>');
}

function describeDatabase(connectionString) {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return '<tidak terbaca>';
  }
}

async function request(url, { method = 'GET', headers = {}, body } = {}) {
  try {
    return await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new UjiGagal(`permintaan HTTP gagal: ${redact(error?.message ?? error)}`);
  }
}

/** Body JSON dengan pesan galat yang aman; tidak pernah memuat kredensial. */
async function jsonBody(response) {
  const text = await response.text();
  try {
    return { text, json: text.length > 0 ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

async function main() {
  const setuju = process.argv.includes('--yes');

  const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

  if (!setuju) {
    console.error('[e2e:hapus-akun] Tolak berjalan tanpa --yes.');
    console.error(HELP);
    return 2;
  }

  const kurang = [];
  if (!supabaseUrl) kurang.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!publishableKey) kurang.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (!connectionString) kurang.push('DATABASE_URL');

  if (kurang.length > 0) {
    console.error(`[e2e:hapus-akun] Environment belum lengkap: ${kurang.join(', ')}.`);
    console.error(HELP);
    return 2;
  }

  if (!supabaseUrl.startsWith('https://') || !supabaseUrl.includes(DEV_REF)) {
    console.error(
      `[e2e:hapus-akun] URL project bukan project development (${DEV_REF}); runner menolak berjalan.`,
    );
    return 2;
  }

  const apiBase = `${supabaseUrl}/functions/v1`;
  const restBase = `${supabaseUrl}/rest/v1`;
  const authBase = `${supabaseUrl}/auth/v1`;
  const storageBase = `${supabaseUrl}/storage/v1`;

  const id = {
    a: randomUUID(),
    b: randomUUID(),
    c: randomUUID(),
    club: randomUUID(),
    ride: randomUUID(),
    motor: randomUUID(),
    hazardA: randomUUID(),
    hazardB: randomUUID(),
    report: randomUUID(),
    chat: randomUUID(),
  };
  const suffix = randomUUID().slice(0, 8);
  const email = {
    a: `e2e.hapus.a.${suffix}@contoh.test`,
    b: `e2e.hapus.b.${suffix}@contoh.test`,
    c: `e2e.hapus.c.${suffix}@contoh.test`,
  };
  const password = {
    a: randomBytes(18).toString('base64url'),
    b: randomBytes(18).toString('base64url'),
    c: randomBytes(18).toString('base64url'),
  };

  const avatarPath = {
    a: `${id.a}/e2e-avatar.png`,
    b: `${id.b}/e2e-avatar.png`,
  };
  const vehiclePath = `${id.a}/${id.motor}/e2e-photo.png`;
  const logoPath = `${id.club}/logo-e2e.png`;

  const client = new pg.Client({
    connectionString,
    ssl: connectionString.includes('localhost') ? undefined : { rejectUnauthorized: false },
  });

  const sql = (text, params) => client.query(text, params);
  const scalar = async (text, params) => Number((await sql(text, params)).rows[0].count);

  let tokenA;
  let tokenB;
  let tokenC;
  let terhubung = false;
  let gagalBersih = false;

  const authHeaders = (token) => ({
    apikey: publishableKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const storageRequest = (suffixPath, { method = 'GET', token, contentType, body } = {}) => {
    const headers = authHeaders(token);
    if (contentType) headers['content-type'] = contentType;
    return request(`${storageBase}${suffixPath}`, { method, headers, body });
  };

  const signIn = async (label, mail, pass) => {
    const response = await request(`${authBase}/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: mail, password: pass }),
    });
    const { json } = await jsonBody(response);

    if (response.status !== 200 || typeof json?.access_token !== 'string') {
      throw new UjiGagal(`sign-in ${label} gagal (HTTP ${response.status}).`);
    }

    ok(`sign-in ${label} lewat GoTrue password grant`);
    return json.access_token;
  };

  const removeObjects = async (token, bucket, paths) => {
    if (!token || paths.length === 0) return 0;
    const response = await storageRequest(`/object/${bucket}`, {
      method: 'DELETE',
      token,
      contentType: 'application/json',
      body: JSON.stringify({ prefixes: paths }),
    });
    if (response.status !== 200) return 0;
    const { json } = await jsonBody(response);
    return Array.isArray(json) ? json.length : paths.length;
  };

  /** Hapus semua baris/objek uji; dipanggil juga saat run gagal di tengah jalan. */
  const cleanup = async () => {
    const sisa = { objek: 0 };
    let gagalBersih = false;

    // Objek harus dihapus lewat Storage API (DELETE langsung ke storage.objects
    // diblokir Supabase), memakai pemilik atau admin klub yang masih ada.
    try {
      const rows = await sql(
        `select bucket_id, name from storage.objects
          where (bucket_id = 'avatars' and (storage.foldername(name))[1] = any($1::text[]))
             or (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = any($1::text[]))
             or (bucket_id = 'club-logos' and (storage.foldername(name))[1] = $2)`,
        [[id.a, id.b], id.club],
      );

      const bucketPaths = { avatars: [], 'vehicle-photos': [], 'club-logos': [] };
      for (const row of rows.rows) {
        bucketPaths[row.bucket_id]?.push(row.name);
      }

      for (const [bucket, paths] of Object.entries(bucketPaths)) {
        if (paths.length === 0) continue;

        const token =
          bucket === 'club-logos' ? (tokenC ?? tokenA) : bucket === 'avatars' ? tokenA : tokenA;
        // Avatar/vehicle milik B harus dihapus oleh B; milik A oleh A.
        if (bucket === 'avatars') {
          const aPaths = paths.filter((p) => p.startsWith(`${id.a}/`));
          const bPaths = paths.filter((p) => p.startsWith(`${id.b}/`));
          await removeObjects(tokenA, bucket, aPaths);
          await removeObjects(tokenB, bucket, bPaths);
        } else {
          const removed = await removeObjects(token, bucket, paths);
          if (removed < paths.length) sisa.objek += paths.length - removed;
        }
      }
    } catch (error) {
      gagalBersih = true;
      console.error(`[e2e:hapus-akun] pembersihan Storage: ${redact(error?.message ?? error)}`);
    }

    // Baris database: urutan mengikuti foreign key.
    try {
      await sql(`delete from public.account_deletion_jobs where user_id = any($1::uuid[])`, [
        [id.a, id.b, id.c],
      ]);
      await sql(`delete from public.content_reports where reporter_id = any($1::uuid[])`, [
        [id.a, id.b, id.c],
      ]);
      await sql(`delete from public.chat_messages where id = $1 or sender_id = any($2::uuid[])`, [
        id.chat,
        [id.a, id.b, id.c],
      ]);
      await sql(`delete from public.hazard_reports where id = any($1::uuid[])`, [
        [id.hazardA, id.hazardB],
      ]);
      await sql(`delete from public.ride_members where ride_id = $1 or user_id = any($2::uuid[])`, [
        id.ride,
        [id.a, id.b, id.c],
      ]);
      await sql(`delete from public.rides where id = $1`, [id.ride]);
      await sql(`delete from public.club_members where club_id = $1 or user_id = any($2::uuid[])`, [
        id.club,
        [id.a, id.b, id.c],
      ]);
      await sql(`delete from public.clubs where id = $1`, [id.club]);
      await sql(`delete from public.profiles where id = any($1::uuid[])`, [[id.a, id.b, id.c]]);
      await sql(`delete from auth.users where id = any($1::uuid[])`, [[id.a, id.b, id.c]]);
    } catch (error) {
      gagalBersih = true;
      console.error(`[e2e:hapus-akun] pembersihan baris: ${redact(error?.message ?? error)}`);
    }

    try {
      const sisaObjek = await scalar(
        `select count(*) as count from storage.objects
          where (bucket_id in ('avatars','vehicle-photos')
                 and (storage.foldername(name))[1] = any($1::text[]))
             or (bucket_id = 'club-logos' and (storage.foldername(name))[1] = $2)`,
        [[id.a, id.b], id.club],
      );
      const sisaBaris = await scalar(
        `select
           (select count(*) from auth.users where id = any($1::uuid[]))
         + (select count(*) from public.profiles where id = any($1::uuid[]))
         + (select count(*) from public.clubs where id = $2)
         + (select count(*) from public.hazard_reports where id = any($3::uuid[])) as count`,
        [[id.a, id.b, id.c], id.club, [id.hazardA, id.hazardB]],
      );

      sisa.objek = sisaObjek;
      if (sisaObjek + sisaBaris > 0) {
        gagalBersih = true;
        console.error(
          `[e2e:hapus-akun] sisa data uji: ${sisaObjek} objek Storage, ${sisaBaris} baris database.`,
        );
      } else {
        ok('pembersihan: 0 objek Storage dan 0 baris database tersisa');
      }
    } catch (error) {
      gagalBersih = true;
      console.error(`[e2e:hapus-akun] verifikasi kebersihan: ${redact(error?.message ?? error)}`);
    }

    return gagalBersih;
  };

  console.log(`[e2e:hapus-akun] API      : project development`);
  console.log(`[e2e:hapus-akun] Database : ${describeDatabase(connectionString)}`);
  console.log(
    '[e2e:hapus-akun] PERINGATAN: runner ini membuat lalu menghapus akun uji di development.',
  );

  try {
    await client.connect();
    terhubung = true;

    /* 1. Akun uji + fixture. Token string kosong wajib (GoTrue memindai kolom
          string); profil dibuat trigger bootstrap. */
    await sql(
      `insert into auth.users (
         id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
         confirmation_token, recovery_token, email_change, email_change_token_new,
         email_change_token_current, phone_change, phone_change_token,
         reauthentication_token, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at
       ) values
         ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $4, crypt($7, gen_salt('bf')), now(), '', '', '', '', '', '', '', '', '{"provider":"email","providers":["email"]}', $10::jsonb, now(), now()),
         ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $5, crypt($8, gen_salt('bf')), now(), '', '', '', '', '', '', '', '', '{"provider":"email","providers":["email"]}', $11::jsonb, now(), now()),
         ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $6, crypt($9, gen_salt('bf')), now(), '', '', '', '', '', '', '', '', '{"provider":"email","providers":["email"]}', $12::jsonb, now(), now())`,
      [
        id.a,
        id.b,
        id.c,
        email.a,
        email.b,
        email.c,
        password.a,
        password.b,
        password.c,
        JSON.stringify({ username: `e2e_hapus_a_${suffix}`, display_name: 'E2E Hapus A' }),
        JSON.stringify({ username: `e2e_hapus_b_${suffix}`, display_name: 'E2E Hapus B' }),
        JSON.stringify({ username: `e2e_hapus_c_${suffix}`, display_name: 'E2E Hapus C' }),
      ],
    );
    ok('tiga akun uji dibuat (profil otomatis lewat trigger bootstrap)');

    await sql(
      `insert into public.clubs (id, name, slug, description, visibility, join_policy, created_by)
       values ($1, 'E2E Hapus Akun', $2, 'Klub uji E2E penghapusan akun.', 'private', 'approval', $3)`,
      [id.club, `e2e-hapus-${suffix}`, id.a],
    );
    await sql(
      `insert into public.club_members (club_id, user_id, role, status, joined_at) values
         ($1, $2, 'owner', 'active', now()),
         ($1, $3, 'admin', 'active', now())`,
      [id.club, id.a, id.c],
    );

    await sql(
      `insert into public.rides (id, club_id, created_by, title, status, started_at)
       values ($1, $2, $3, 'Ride E2E hapus akun', 'active', now())`,
      [id.ride, id.club, id.a],
    );
    await sql(
      `insert into public.ride_members (ride_id, user_id, role, status, joined_at) values
         ($1, $2, 'host', 'joined', now()),
         ($1, $3, 'rider', 'joined', now())`,
      [id.ride, id.a, id.c],
    );

    await sql(
      `insert into public.hazard_reports
         (id, reporter_id, ride_id, category, severity, latitude, longitude, status, expires_at, description)
       values
         ($1, $3, $5, 'pothole', 'moderate', -6.20, 106.80, 'active', now() + interval '1 day', 'Hazard A untuk E2E'),
         ($2, $4, null, 'crash', 'high', -6.21, 106.81, 'active', now() + interval '1 day', 'Hazard B untuk E2E')`,
      [id.hazardA, id.hazardB, id.a, id.b, id.ride],
    );
    await sql(
      `insert into public.content_reports (id, reporter_id, target_type, target_id, reason, details)
       values ($1, $2, 'hazard', $3, 'spam', 'Laporan uji E2E')`,
      [id.report, id.a, id.hazardA],
    );
    await sql(
      `insert into public.chat_messages (id, ride_id, sender_id, message_type, content)
       values ($1, $2, $3, 'text', 'Pesan rahasia A untuk E2E')`,
      [id.chat, id.ride, id.a],
    );
    await sql(
      `insert into public.motorcycles (id, owner_id, make, model, photo_path)
       values ($1, $2, 'Uji', 'E2E', $3)`,
      [id.motor, id.a, vehiclePath],
    );
    await sql(
      `insert into public.push_tokens (user_id, token, platform) values ($1, $2, 'android')`,
      [id.a, `e2e-${suffix}-token`],
    );
    await sql(`update public.profiles set avatar_url = $2 where id = $1`, [id.a, avatarPath.a]);
    await sql(`update public.profiles set avatar_url = $2 where id = $1`, [id.b, avatarPath.b]);
    await sql(`update public.clubs set logo_path = $2 where id = $1`, [id.club, logoPath]);
    ok('fixture database: klub, ride, hazard, laporan, chat, kendaraan, token push');

    /* 2. JWT lewat password grant GoTrue (bukan service_role). */
    tokenA = await signIn('A', email.a, password.a);
    tokenB = await signIn('B', email.b, password.b);
    tokenC = await signIn('C', email.c, password.c);

    /* 3. Unggah media nyata ke tiga bucket privat. */
    const upload = async (bucket, path, token, label) => {
      const response = await storageRequest(`/object/${bucket}/${path}`, {
        method: 'POST',
        token,
        contentType: 'image/png',
        body: PNG_BYTES,
      });
      check(response.status === 200, `unggah ${label} gagal (HTTP ${response.status}).`);
      ok(`unggah ${label} lewat Storage API`);
    };

    await upload('avatars', avatarPath.a, tokenA, 'avatar A');
    await upload('vehicle-photos', vehiclePath, tokenA, 'foto kendaraan A');
    await upload('club-logos', logoPath, tokenA, 'logo klub A');
    await upload('avatars', avatarPath.b, tokenB, 'avatar B');

    const objekAwal = await scalar(
      `select count(*) as count from storage.objects
        where (bucket_id = 'avatars' and name = any($1::text[]))
           or (bucket_id = 'vehicle-photos' and name = $2)
           or (bucket_id = 'club-logos' and name = $3)`,
      [[avatarPath.a, avatarPath.b], vehiclePath, logoPath],
    );
    check(objekAwal === 4, `objek awal tidak lengkap (${objekAwal}/4).`);

    /* 4. Panggil Edge Function dengan JWT A. Body kosong; target tidak pernah
          berasal dari body. */
    const hapus = await request(`${apiBase}/delete-account`, {
      method: 'POST',
      headers: {
        ...authHeaders(tokenA),
        'content-type': 'application/json',
        'content-length': '0',
      },
    });
    const hasil = await jsonBody(hapus);

    check(
      hapus.status === 200 && hasil.json?.status === 'completed',
      `delete-account tidak selesai (HTTP ${hapus.status}, body ${redact(hasil.text).slice(0, 160)}).`,
    );
    ok('Edge Function delete-account mengembalikan status completed');

    /* 5. Auth + data privat A benar-benar hilang. */
    const authA = await scalar(`select count(*) as count from auth.users where id = $1`, [id.a]);
    const profilA = await scalar(`select count(*) as count from public.profiles where id = $1`, [
      id.a,
    ]);
    const motorA = await scalar(
      `select count(*) as count from public.motorcycles where owner_id = $1`,
      [id.a],
    );
    const tokenA_db = await scalar(
      `select count(*) as count from public.push_tokens where user_id = $1`,
      [id.a],
    );
    check(
      authA + profilA + motorA + tokenA_db === 0,
      `data privat A tersisa (auth=${authA}, profil=${profilA}, motor=${motorA}, token=${tokenA_db}).`,
    );
    ok('auth.users, profil, kendaraan, dan token push A hilang');

    /* 6. Konten bersama tetap ada tanpa identitas A. */
    const hazard = (
      await sql(`select reporter_id, description from public.hazard_reports where id = $1`, [
        id.hazardA,
      ])
    ).rows[0];
    check(hazard?.reporter_id === TOMBSTONE, 'hazard A tidak dialihkan ke tombstone.');
    check(
      hazard?.description === 'Hazard A untuk E2E',
      'isi hazard A berubah padahal data keselamatan harus dipertahankan.',
    );

    const laporan = (
      await sql(`select reporter_id from public.content_reports where id = $1`, [id.report])
    ).rows[0];
    check(laporan?.reporter_id === TOMBSTONE, 'laporan moderasi A tidak dialihkan ke tombstone.');

    const chat = (
      await sql(`select sender_id, content from public.chat_messages where id = $1`, [id.chat])
    ).rows[0];
    check(chat?.sender_id === TOMBSTONE, 'pengirim pesan chat bukan tombstone.');
    check(
      chat?.content === '[Pesan dihapus]',
      `isi pesan chat tidak diredaksi (${chat?.content}).`,
    );
    ok('hazard/laporan/chat dipertahankan dengan identitas tombstone dan isi privat diredaksi');

    /* 7. Logo klub dipindahkan dan masih bisa dibaca penerus C. */
    const klub = (
      await sql(`select created_by, logo_path from public.clubs where id = $1`, [id.club])
    ).rows[0];
    check(klub?.created_by === id.c, 'kepemilikan klub tidak dialihkan ke penerus C.');
    check(
      typeof klub?.logo_path === 'string' &&
        klub.logo_path.startsWith(`${id.club}/logo-`) &&
        klub.logo_path !== logoPath,
      `logo_path klub tidak menunjuk path baru (${klub?.logo_path}).`,
    );

    const logoLama = await scalar(
      `select count(*) as count from storage.objects where bucket_id = 'club-logos' and name = $1`,
      [logoPath],
    );
    const logoBaru = await scalar(
      `select count(*) as count from storage.objects where bucket_id = 'club-logos' and name = $1`,
      [klub.logo_path],
    );
    check(logoLama === 0 && logoBaru === 1, 'objek logo lama/baru tidak sesuai harapan.');

    const signLogo = await storageRequest(`/object/sign/club-logos/${klub.logo_path}`, {
      method: 'POST',
      token: tokenC,
      contentType: 'application/json',
      body: JSON.stringify({ expiresIn: 600 }),
    });
    check(
      signLogo.status === 200,
      `penerus C tidak bisa membuat signed URL logo (${signLogo.status}).`,
    );
    const signJson = (await jsonBody(signLogo)).json;
    check(typeof signJson?.signedURL === 'string', 'respons signed URL tidak memuat signedURL.');

    const unduhLogo = await fetch(`${storageBase}${signJson.signedURL}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    check(unduhLogo.status === 200, `unduhan logo oleh C gagal (${unduhLogo.status}).`);
    ok('logo klub pindah ke path baru, objek lama hilang, dan C bisa mengaksesnya');

    /* 8. Media pribadi A hilang; data B utuh. */
    const mediaA = await scalar(
      `select count(*) as count from storage.objects
        where (bucket_id = 'avatars' and name = $1)
           or (bucket_id = 'vehicle-photos' and name = $2)`,
      [avatarPath.a, vehiclePath],
    );
    check(mediaA === 0, 'avatar/foto kendaraan A masih ada.');
    check(
      (await scalar(
        `select count(*) as count from storage.objects where bucket_id = 'avatars' and name = $1`,
        [avatarPath.b],
      )) === 1,
      'avatar B ikut terhapus.',
    );

    const authB = await scalar(`select count(*) as count from auth.users where id = $1`, [id.b]);
    const hazardB = (
      await sql(`select reporter_id from public.hazard_reports where id = $1`, [id.hazardB])
    ).rows[0];
    check(authB === 1, 'akun B ikut terhapus.');
    check(hazardB?.reporter_id === id.b, 'hazard B berubah.');
    ok('media A hilang, sedangkan akun/avatar/hazard B tidak tersentuh');

    /* 9. JWT lama A tidak bisa membaca atau menulis; login ulang gagal. */
    const bacaLama = await request(`${restBase}/profiles?select=id&id=eq.${id.a}`, {
      headers: authHeaders(tokenA),
    });
    const bacaJson = await jsonBody(bacaLama);
    check(
      bacaLama.status === 200 && Array.isArray(bacaJson.json) && bacaJson.json.length === 0,
      `JWT lama masih membaca profil A (HTTP ${bacaLama.status}).`,
    );

    const tulisLama = await request(`${restBase}/motorcycles`, {
      method: 'POST',
      headers: {
        ...authHeaders(tokenA),
        'content-type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ id: randomUUID(), owner_id: id.a, make: 'Uji', model: 'Lama' }),
    });
    check(
      tulisLama.status >= 400,
      `JWT lama masih bisa menulis kendaraan (HTTP ${tulisLama.status}).`,
    );

    const loginLagi = await request(`${authBase}/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.a, password: password.a }),
    });
    check(loginLagi.status !== 200, 'akun A masih bisa login setelah dihapus.');
    ok('JWT lama tidak bisa membaca/menulis, dan login ulang A gagal');

    /* 10. Job selesai. */
    const job = (
      await sql(`select status, last_step from public.account_deletion_jobs where user_id = $1`, [
        id.a,
      ])
    ).rows[0];
    check(job?.status === 'completed', `job hapus akun berstatus ${job?.status ?? 'tidak ada'}.`);
    ok('account_deletion_jobs berstatus completed');
  } finally {
    if (terhubung) {
      gagalBersih = await cleanup();
    }
    await client.end().catch(() => undefined);
  }

  if (gagalBersih) return 1;

  console.log(`[e2e:hapus-akun] ${SUCCESS_NOTICE}: ${langkahLulus} langkah lulus.`);
  return 0;
}

const exitCode = await main().catch((error) => {
  console.error(`[e2e:hapus-akun] GAGAL: ${redact(error?.message ?? error)}`);
  return 1;
});
process.exitCode = exitCode ?? 0;
