#!/usr/bin/env node
/**
 * Uji E2E dua pengguna + realtime untuk alur klub → perjalanan → konvoi.
 *
 * Kenapa runner ini ada
 * ---------------------------------------------------------------------------
 * `npm run db:test` membuktikan RPC/RLS di dalam transaksi SQL, tetapi tidak
 * pernah melewati GoTrue, PostgREST, atau Realtime. Uji manual dua perangkat
 * (QA_TEST_PLAN 8d) juga tidak bisa diulang otomatis. Runner ini menjalankan
 * alur yang sama lewat jalur yang benar-benar dipakai aplikasi:
 *
 *   A buat klub
 *   B minta gabung          → A setujui
 *   A buat perjalanan       → undang B → B terima
 *   A mulai perjalanan
 *   A dan B menyalakan berbagi lokasi
 *   A berlangganan Postgres Changes `ride_locations` + `chat_messages`
 *   B kirim lokasi + chat   → A menerima keduanya dalam ≤ 5 detik
 *   C (bukan anggota)       → tidak menerima event dan tidak bisa membaca data
 *   A selesaikan perjalanan → seluruh lokasi terakhir terhapus
 *
 * Aturan keamanan
 * ---------------------------------------------------------------------------
 * - Hanya project development (ref diperiksa); runner menolak URL lain.
 * - Tidak memakai service_role: akun uji dibuat lewat `DATABASE_URL` dan JWT
 *   diperoleh lewat password grant GoTrue yang sesungguhnya.
 * - Kata sandi, JWT, dan connection string tidak pernah dicetak.
 * - Semua akun/baris uji dibersihkan di `finally`, lalu kebersihannya
 *   diverifikasi. Sisa data dilaporkan sebagai kegagalan, bukan disembunyikan.
 *
 * Pemakaian
 * ---------------------------------------------------------------------------
 *   npm run e2e:shared-ride
 *   node --env-file-if-exists=.env.local --env-file-if-exists=.env.db \
 *     scripts/shared-ride-e2e.mjs
 *
 * Environment: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * (dari .env.local) dan DATABASE_URL atau SUPABASE_DB_URL (dari .env.db).
 *
 * Tidak dijalankan otomatis di CI; ini perintah manual terhadap development.
 */

import { randomUUID } from 'node:crypto';
import process from 'node:process';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

import {
  DEV_PROJECT_REF,
  describeDatabaseTarget,
  elapsedMs,
  isDevProjectUrl,
  matchesRealtimePayload,
  redactSensitive,
} from './lib/shared-ride.mjs';

const SUCCESS_NOTICE = 'UJI SHARED-RIDE LULUS';
const REALTIME_TIMEOUT_MS = 5_000;
const SUBSCRIBE_TIMEOUT_MS = 10_000;
const QUIET_WINDOW_MS = 2_000;
const FETCH_TIMEOUT_MS = 30_000;

const HELP = `Uji E2E dua pengguna + realtime (project development).

Pemakaian:
  npm run e2e:shared-ride
  node --env-file-if-exists=.env.local --env-file-if-exists=.env.db scripts/shared-ride-e2e.mjs

Yang diuji:
  - B (bukan anggota klub) tidak bisa ikut perjalanan sebelum disetujui;
  - undangan perjalanan, consent lokasi, dan publikasi lokasi lewat RPC;
  - Postgres Changes mengirim lokasi dan chat ke peserta lain ≤ 5 detik;
  - pengguna C yang bukan anggota tidak menerima event dan tidak bisa membaca;
  - menyelesaikan perjalanan menghapus seluruh lokasi terakhir.

Runner membuat lalu menghapus tiga akun uji di project development. Tanpa
service_role: akun dibuat lewat DATABASE_URL dan JWT diperoleh lewat GoTrue.
`;

class UjiGagal extends Error {}

let langkahLulus = 0;

function ok(pesan) {
  langkahLulus += 1;
  console.log(`[e2e:shared-ride] ok ${langkahLulus}: ${pesan}`);
}

function check(syarat, pesan) {
  if (!syarat) throw new UjiGagal(pesan);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    throw new UjiGagal(`permintaan HTTP gagal: ${redactSensitive(error?.message ?? error)}`);
  }
}

async function jsonBody(response) {
  const text = await response.text();
  try {
    return { text, json: text.length > 0 ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

/** Galat Supabase tidak boleh membawa JWT/URL mentah ke layar. */
function describeError(error) {
  if (!error) return 'tanpa detail';
  const code = error.code ?? error.status ?? '?';
  return `${code} ${redactSensitive(error.message ?? '')}`.trim();
}

/**
 * Klien dengan JWT yang sudah didapat dari GoTrue. `accessToken` dipakai
 * PostgREST dan Realtime, jadi tidak ada sesi tersimpan yang perlu di-refresh.
 */
function createUserClient(supabaseUrl, publishableKey, token) {
  return createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    accessToken: async () => token,
    global: { headers: { Authorization: `Bearer ${token}` } },
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

/** Tunggu sampai kondisi terpenuhi; tidak pernah menunggu selamanya. */
async function waitFor(predicate, { timeoutMs, label }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const found = predicate();
    if (found) return found;
    await delay(100);
  }

  throw new UjiGagal(`${label} tidak diterima dalam ${timeoutMs} ms.`);
}

/**
 * Berlangganan dua tabel sekaligus. Event dikumpulkan dengan waktu terima
 * supaya latensi bisa diukur, bukan hanya keberadaannya.
 */
async function subscribeRide(client, rideId, label) {
  const events = [];
  // `wait: true` menahan status SUBSCRIBED sampai server benar-benar siap
  // mengalirkan Postgres Changes. Tanpa itu, baris yang dikirim tepat setelah
  // SUBSCRIBED bisa terlewat meski langganannya sehat.
  const channel = client.channel(`e2e-shared-ride-${label}-${randomUUID()}`, {
    config: {
      postgres_changes_options: { wait: true, timeout: 15_000 },
    },
  });

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'ride_locations', filter: `ride_id=eq.${rideId}` },
    (payload) => events.push({ table: 'ride_locations', payload, receivedAt: Date.now() }),
  );

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'chat_messages', filter: `ride_id=eq.${rideId}` },
    (payload) => events.push({ table: 'chat_messages', payload, receivedAt: Date.now() }),
  );

  const subscribed = new Promise((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        resolve();
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reject(
          new UjiGagal(
            `langganan realtime ${label} gagal (${status}): ${describeError(error)}. ` +
              'Pastikan Realtime aktif dan publication memuat kedua tabel.',
          ),
        );
      }
    });
  });

  await Promise.race([
    subscribed,
    delay(SUBSCRIBE_TIMEOUT_MS).then(() => {
      throw new UjiGagal(
        `langganan realtime ${label} tidak selesai dalam ${SUBSCRIBE_TIMEOUT_MS} ms.`,
      );
    }),
  ]);

  return { channel, events };
}

async function main() {
  const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

  if (process.argv.includes('--help')) {
    console.log(HELP);
    return 0;
  }

  const kurang = [];
  if (!supabaseUrl) kurang.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!publishableKey) kurang.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (!connectionString) kurang.push('DATABASE_URL');

  if (kurang.length > 0) {
    console.error(`[e2e:shared-ride] Environment belum lengkap: ${kurang.join(', ')}.`);
    console.error(HELP);
    return 2;
  }

  if (!isDevProjectUrl(supabaseUrl)) {
    console.error(
      `[e2e:shared-ride] URL project bukan project development (${DEV_PROJECT_REF}); runner menolak berjalan.`,
    );
    return 2;
  }

  const authBase = `${supabaseUrl}/auth/v1`;

  const id = {
    /* Diisi dari anonymous sign-in: ID pengguna ditentukan server, bukan klien. */
    a: null,
    b: null,
    c: null,
  };
  const suffix = randomUUID().slice(0, 8);

  const client = new pg.Client({
    connectionString,
    ssl: connectionString.includes('localhost') ? undefined : { rejectUnauthorized: false },
  });

  const sql = (text, params) => client.query(text, params);
  const scalar = async (text, params) => Number((await sql(text, params)).rows[0].count);

  let tokenA;
  let tokenB;
  let supabaseA;
  let supabaseB;
  let supabaseC;
  let subscriptionA;
  let subscriptionC;
  let clubId;
  let rideId;
  let terhubung = false;
  let gagalBersih = false;

  /**
   * Membuat identitas anonim lewat endpoint yang sama dengan
   * `supabase.auth.signInAnonymously()` di aplikasi (`POST /auth/v1/signup` tanpa
   * email/kata sandi). ID pengguna ditentukan server, jadi fixture memakai hasilnya.
   */
  const signInAnonymous = async (label) => {
    const response = await request(`${authBase}/signup`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ data: {}, gotrue_meta_security: {} }),
    });
    const { json } = await jsonBody(response);

    if (response.status !== 200 || typeof json?.access_token !== 'string') {
      throw new UjiGagal(
        `anonymous sign-in ${label} gagal (HTTP ${response.status}). Aktifkan Anonymous sign-ins di dashboard project development (atau enable_anonymous_sign_ins di config.toml).`,
      );
    }

    if (typeof json?.user?.id !== 'string') {
      throw new UjiGagal(`anonymous sign-in ${label} tidak mengembalikan user.id.`);
    }

    ok(`anonymous sign-in ${label} (identitas perangkat)`);
    return { id: json.user.id, token: json.access_token };
  };

  const cleanup = async () => {
    let bersihGagal = false;

    try {
      subscriptionA?.channel.unsubscribe();
      subscriptionC?.channel.unsubscribe();
      supabaseA?.removeAllChannels();
      supabaseC?.removeAllChannels();
      supabaseA?.realtime.disconnect();
      supabaseC?.realtime.disconnect();
    } catch {
      // Koneksi realtime mungkin sudah tertutup; bukan alasan gagal bersih.
    }

    try {
      if (rideId) {
        await sql(`delete from public.chat_messages where ride_id = $1`, [rideId]);
        await sql(`delete from public.ride_locations where ride_id = $1`, [rideId]);
        await sql(`delete from public.ride_members where ride_id = $1`, [rideId]);
        await sql(`delete from public.rides where id = $1`, [rideId]);
      }

      if (clubId) {
        await sql(`delete from public.club_role_audit where club_id = $1`, [clubId]);
        await sql(`delete from public.club_members where club_id = $1`, [clubId]);
        await sql(`delete from public.clubs where id = $1`, [clubId]);
      }

      await sql(`delete from public.notifications where recipient_id = any($1::uuid[])`, [
        [id.a, id.b, id.c],
      ]);
      await sql(`delete from public.profiles where id = any($1::uuid[])`, [[id.a, id.b, id.c]]);
      await sql(`delete from auth.users where id = any($1::uuid[])`, [[id.a, id.b, id.c]]);
    } catch (error) {
      bersihGagal = true;
      console.error(
        `[e2e:shared-ride] pembersihan gagal: ${redactSensitive(error?.message ?? error)}`,
      );
    }

    try {
      const sisa = await scalar(
        `select
           (select count(*) from auth.users where id = any($1::uuid[]))
         + (select count(*) from public.profiles where id = any($1::uuid[]))
         + (select count(*) from public.clubs where id = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
         + (select count(*) from public.rides where id = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
         + (select count(*) from public.chat_messages where ride_id = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
         + (select count(*) from public.ride_members where ride_id = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
         + (select count(*) from public.ride_locations where ride_id = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)) as count`,
        [[id.a, id.b, id.c], clubId ?? null, rideId ?? null],
      );

      if (sisa > 0) {
        bersihGagal = true;
        console.error(`[e2e:shared-ride] masih ada ${sisa} baris data uji setelah pembersihan.`);
      } else {
        ok('pembersihan: 0 baris data uji tersisa');
      }
    } catch (error) {
      bersihGagal = true;
      console.error(
        `[e2e:shared-ride] verifikasi kebersihan: ${redactSensitive(error?.message ?? error)}`,
      );
    }

    return bersihGagal;
  };

  console.log('[e2e:shared-ride] API      : project development');
  console.log(`[e2e:shared-ride] Database : ${describeDatabaseTarget(connectionString)}`);
  console.log(
    '[e2e:shared-ride] PERINGATAN: runner ini membuat lalu menghapus tiga akun uji di development.',
  );

  try {
    await client.connect();
    terhubung = true;

    /* 1. Tiga identitas anonim (jalur yang sama dengan aplikasi); ID berasal dari server. */
    const sesi = {
      a: await signInAnonymous('A'),
      b: await signInAnonymous('B'),
      c: await signInAnonymous('C'),
    };
    id.a = sesi.a.id;
    id.b = sesi.b.id;
    id.c = sesi.c.id;
    tokenA = sesi.a.token;
    const tokenB = sesi.b.token;
    const tokenC = sesi.c.token;

    await sql(
      `update public.profiles set username = $2, display_name = $3, updated_at = now()
        where id = $1`,
      [id.a, `e2e_shared_a_${suffix}`, 'E2E Shared A'],
    );
    await sql(
      `update public.profiles set username = $2, display_name = $3, updated_at = now()
        where id = $1`,
      [id.b, `e2e_shared_b_${suffix}`, 'E2E Shared B'],
    );
    await sql(
      `update public.profiles set username = $2, display_name = $3, updated_at = now()
        where id = $1`,
      [id.c, `e2e_shared_c_${suffix}`, 'E2E Shared C'],
    );
    ok('tiga identitas anonim dibuat (profil otomatis lewat trigger bootstrap)');

    supabaseA = createUserClient(supabaseUrl, publishableKey, tokenA);
    supabaseB = createUserClient(supabaseUrl, publishableKey, tokenB);
    supabaseC = createUserClient(supabaseUrl, publishableKey, tokenC);

    await supabaseA.realtime.setAuth(tokenA);
    await supabaseC.realtime.setAuth(tokenC);

    /* 2. Klub privat + persetujuan anggota. */
    const { data: club, error: clubError } = await supabaseA.rpc('create_club', {
      p_name: `E2E Shared Ride ${suffix}`,
      p_description: 'Klub uji E2E dua pengguna + realtime.',
      p_visibility: 'private',
      p_join_policy: 'approval',
    });
    check(!clubError && club?.id, `A gagal membuat klub: ${describeError(clubError)}.`);
    clubId = club.id;
    ok('A membuat klub privat dengan kebijakan persetujuan');

    const { data: requestStatus, error: requestError } = await supabaseB.rpc(
      'request_club_membership',
      { p_club_id: clubId },
    );
    check(
      !requestError && requestStatus === 'pending',
      `B seharusnya berstatus pending, bukan ${requestStatus ?? 'galat'}: ${describeError(requestError)}.`,
    );
    ok('B meminta gabung dan berstatus pending (belum bisa ikut perjalanan)');

    const { error: approveError } = await supabaseA.rpc('review_club_membership', {
      p_club_id: clubId,
      p_user_id: id.b,
      p_approve: true,
    });
    check(!approveError, `A gagal menyetujui B: ${describeError(approveError)}.`);
    ok('A menyetujui permintaan B');

    /* 3. Perjalanan + undangan. */
    const { data: ride, error: rideError } = await supabaseA.rpc('create_ride', {
      p_club_id: clubId,
      p_title: 'Konvoi E2E Shared Ride',
      p_description: 'Perjalanan uji dua pengguna + realtime.',
    });
    check(!rideError && ride?.id, `A gagal membuat perjalanan: ${describeError(rideError)}.`);
    rideId = ride.id;
    check(ride.status === 'planned', `perjalanan baru seharusnya planned, bukan ${ride.status}.`);
    ok('A membuat perjalanan berstatus planned');

    const { data: invited, error: inviteError } = await supabaseA.rpc('invite_ride_member', {
      p_ride_id: rideId,
      p_user_id: id.b,
    });
    check(
      !inviteError && invited === 'invited',
      `undangan B gagal atau bukan invited: ${describeError(inviteError)}.`,
    );
    ok('A mengundang B ke perjalanan');

    const { data: joined, error: acceptError } = await supabaseB.rpc('accept_ride_invite', {
      p_ride_id: rideId,
    });
    check(
      !acceptError && joined === 'joined',
      `B gagal menerima undangan: ${describeError(acceptError)}.`,
    );
    ok('B menerima undangan dan berstatus joined');

    const { data: started, error: startError } = await supabaseA.rpc('transition_ride', {
      p_ride_id: rideId,
      p_next: 'active',
    });
    check(
      !startError && started?.status === 'active',
      `A gagal memulai perjalanan: ${describeError(startError)}.`,
    );
    ok('A memulai perjalanan (planned → active)');

    /* 4. Consent lokasi kedua peserta. */
    for (const [label, user] of [
      ['A', supabaseA],
      ['B', supabaseB],
    ]) {
      const { data: enabled, error } = await user.rpc('set_ride_location_sharing', {
        p_ride_id: rideId,
        p_enabled: true,
      });
      check(
        !error && enabled === true,
        `${label} gagal menyalakan berbagi lokasi: ${describeError(error)}.`,
      );
    }
    ok('A dan B menyalakan consent berbagi lokasi');

    /* 5. Langganan realtime A (peserta) dan C (bukan anggota). */
    subscriptionA = await subscribeRide(supabaseA, rideId, 'a');
    ok('A berlangganan Postgres Changes ride_locations + chat_messages');

    subscriptionC = await subscribeRide(supabaseC, rideId, 'c');
    ok('C berlangganan kanal yang sama (untuk membuktikan RLS menahan event)');

    // Beri waktu replication slot siap sebelum baris pertama dikirim.
    await delay(300);

    /* 6. A dan B mempublikasikan lokasi; B mengirim chat. */
    const aPublishedAt = Date.now();
    const { error: aLocationError } = await supabaseA.rpc('publish_ride_location', {
      p_ride_id: rideId,
      p_latitude: -6.2,
      p_longitude: 106.8,
      p_accuracy_m: 12,
    });
    check(!aLocationError, `A gagal mempublikasikan lokasi: ${describeError(aLocationError)}.`);

    const bLocationSentAt = Date.now();
    const { error: bLocationError } = await supabaseB.rpc('publish_ride_location', {
      p_ride_id: rideId,
      p_latitude: -6.201,
      p_longitude: 106.801,
      p_accuracy_m: 9,
    });
    check(!bLocationError, `B gagal mempublikasikan lokasi: ${describeError(bLocationError)}.`);

    const chatSentAt = Date.now();
    const { data: chat, error: chatError } = await supabaseB.rpc('send_chat_message', {
      p_ride_id: rideId,
      p_content: 'Halo dari B lewat E2E realtime.',
      p_client_message_id: randomUUID(),
    });
    check(!chatError && chat?.id, `B gagal mengirim chat: ${describeError(chatError)}.`);
    ok('B mengirim lokasi dan chat');

    /* 7. A menerima event B dalam batas waktu. */
    const locationEvent = await waitFor(
      () =>
        subscriptionA.events.find(
          (event) =>
            event.table === 'ride_locations' &&
            event.payload?.new?.user_id === id.b &&
            matchesRealtimePayload(event.payload, { table: 'ride_locations', rideId }),
        ),
      { timeoutMs: REALTIME_TIMEOUT_MS, label: 'event lokasi B' },
    );
    const locationLatency = elapsedMs(bLocationSentAt, locationEvent.receivedAt);
    check(locationLatency <= REALTIME_TIMEOUT_MS, `lokasi B terlambat ${locationLatency} ms.`);
    ok(`A menerima lokasi B dalam ${locationLatency} ms`);

    const chatEvent = await waitFor(
      () =>
        subscriptionA.events.find(
          (event) =>
            event.table === 'chat_messages' &&
            event.payload?.new?.id === chat.id &&
            matchesRealtimePayload(event.payload, { table: 'chat_messages', rideId }),
        ),
      { timeoutMs: REALTIME_TIMEOUT_MS, label: 'event chat B' },
    );
    const chatLatency = elapsedMs(chatSentAt, chatEvent.receivedAt);
    check(chatLatency <= REALTIME_TIMEOUT_MS, `chat B terlambat ${chatLatency} ms.`);
    ok(`A menerima chat B dalam ${chatLatency} ms`);

    // A sendiri juga mempublikasikan lokasi; event itu sah dan tidak dihitung
    // sebagai bukti pengiriman B, tetapi memastikan jalur A bekerja.
    const ownEvent = subscriptionA.events.find(
      (event) => event.table === 'ride_locations' && event.payload?.new?.user_id === id.a,
    );
    check(
      ownEvent && elapsedMs(aPublishedAt, ownEvent.receivedAt) <= REALTIME_TIMEOUT_MS,
      'A tidak menerima event lokasinya sendiri dalam batas waktu.',
    );
    ok('A juga menerima lokasi yang ia publikasikan sendiri');

    /* 8. C tidak menerima apa pun dan tidak bisa membaca. */
    await delay(QUIET_WINDOW_MS);
    check(
      subscriptionC.events.length === 0,
      `C (bukan anggota) menerima ${subscriptionC.events.length} event realtime; RLS gagal menahan.`,
    );
    ok('C tidak menerima satu pun event realtime');

    const readChecks = [
      ['rides', supabaseC.from('rides').select('id').eq('id', rideId)],
      ['chat_messages', supabaseC.from('chat_messages').select('id').eq('ride_id', rideId)],
      ['ride_locations', supabaseC.from('ride_locations').select('ride_id').eq('ride_id', rideId)],
    ];

    for (const [table, query] of readChecks) {
      const { data, error } = await query;
      check(
        !error && Array.isArray(data) && data.length === 0,
        `C bisa membaca ${table} (${data?.length ?? 0} baris): ${describeError(error)}.`,
      );
    }
    ok('C tidak bisa membaca rides, chat_messages, maupun ride_locations');

    const { error: cChatError } = await supabaseC.rpc('send_chat_message', {
      p_ride_id: rideId,
      p_content: 'Pesan dari bukan anggota.',
      p_client_message_id: randomUUID(),
    });
    check(cChatError, 'C berhasil mengirim chat padahal bukan anggota perjalanan.');
    ok('C ditolak saat mencoba mengirim chat');

    /* 9. Selesaikan perjalanan → seluruh lokasi terakhir dihapus. */
    const { data: completed, error: completeError } = await supabaseA.rpc('transition_ride', {
      p_ride_id: rideId,
      p_next: 'completed',
    });
    check(
      !completeError && completed?.status === 'completed',
      `A gagal menyelesaikan perjalanan: ${describeError(completeError)}.`,
    );
    ok('A menyelesaikan perjalanan (active → completed)');

    const { data: remaining, error: remainingError } = await supabaseA
      .from('ride_locations')
      .select('user_id')
      .eq('ride_id', rideId);
    check(
      !remainingError && Array.isArray(remaining) && remaining.length === 0,
      `lokasi terakhir belum terhapus (${remaining?.length ?? 0} baris): ${describeError(remainingError)}.`,
    );

    const sisaLokasi = await scalar(
      `select count(*) as count from public.ride_locations where ride_id = $1`,
      [rideId],
    );
    check(
      sisaLokasi === 0,
      `masih ada ${sisaLokasi} baris ride_locations setelah perjalanan selesai.`,
    );
    ok('lokasi terakhir A dan B terhapus setelah perjalanan selesai');

    console.log(`\n[e2e:shared-ride] ${SUCCESS_NOTICE}`);
  } catch (error) {
    console.error(`\n[e2e:shared-ride] GAGAL: ${redactSensitive(error?.message ?? error)}`);
    if (error instanceof UjiGagal) {
      console.error('[e2e:shared-ride] Perbaiki penyebab di atas lalu jalankan ulang.');
    }
    return 1;
  } finally {
    if (terhubung) {
      gagalBersih = await cleanup();
    }

    try {
      await client.end();
    } catch {
      // Sambungan mungkin sudah tertutup karena kegagalan jaringan.
    }

    if (gagalBersih) {
      console.error('[e2e:shared-ride] Data uji TIDAK bersih; periksa sisa di atas.');
    }
  }

  return 0;
}

const exitCode = await main();
process.exit(exitCode);
