#!/usr/bin/env node
/**
 * Uji konkurensi throttle jalur tulis (AUD-14 lanjutan).
 *
 * Kenapa uji ini terpisah dari `npm run db:test`:
 * - Berkas SQL `supabase/tests/*.sql` berjalan dalam SATU transaksi, sehingga
 *   dua permintaan tidak mungkin benar-benar bersamaan. Uji ini memakai dua
 *   koneksi terpisah dan dua transaksi yang benar-benar paralel.
 * - Yang dibuktikan: dua `create_club` (dan dua `create_ride`) serentak dari
 *   akun yang sama tidak dapat melampaui kuota 10/jam. Permintaan kedua
 *   menunggu advisory lock trigger, lalu ditolak `P0001` dengan detail yang
 *   dipetakan klien.
 *
 * Keamanan:
 * - Hanya menerima DATABASE_URL project DEVELOPMENT
 *   (`postgres.xvmcpfkkveeaevfcvfug`) dan menolak target lain sebelum menulis.
 * - Tidak pernah mencetak URL, password, atau isi environment.
 * - Membuat satu akun sintetis + data uji, lalu menghapusnya di `finally`.
 *   Bila proses mati paksa, sisa baris memakai awalan `uji-konkurensi-` dan
 *   akun `m5conc_*` sehingga mudah dicari di project development.
 *
 * Pemakaian:
 *   npm run db:test:concurrency
 */

import { randomUUID } from 'node:crypto';
import process from 'node:process';

import pg from 'pg';

const EXPECTED_REF = 'xvmcpfkkveeaevfcvfug';
// Identitas acak per jalan supaya dua putaran CI tidak bertabrakan.
const USER_ID = randomUUID();
const RUN_TAG = USER_ID.replace(/-/g, '').slice(0, 8);
const USERNAME = `m5conc_${RUN_TAG}`;
// Slug klub unik global; beri tag per jalan agar dua putaran CI tidak bentrok.
const CLUB_SLUG_PREFIX = `uji-konkurensi-${RUN_TAG}-klub-`;
const RIDE_TITLE_PREFIX = 'Uji Konkurensi Ride ';

function fail(message) {
  console.error(`[uji-konkurensi] GAGAL: ${message}`);
  process.exitCode = 1;
}

function connectionConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      'DATABASE_URL belum diisi. Pakai .env.db project development, lalu jalankan ulang.',
    );
  }

  const url = new URL(raw);
  const user = decodeURIComponent(url.username);

  if (user !== `postgres.${EXPECTED_REF}`) {
    throw new Error(
      'Uji ini hanya boleh menulis ke project development. DATABASE_URL tidak menunjuk project yang diizinkan.',
    );
  }

  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
}

async function connect(config) {
  const client = new pg.Client(config);
  await client.connect();
  client.on('error', () => {
    // Koneksi yang ditutup server tidak boleh menjatuhkan proses sebelum
    // cleanup berjalan.
  });
  return client;
}

async function beginAs(client, userId) {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
}

async function setupUser(admin) {
  await admin.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values ($1, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', $3, now(),
       '{"provider":"email","providers":["email"]}',
       jsonb_build_object('username', $2::text, 'display_name', 'Uji Konkurensi'),
       now(), now())`,
    [USER_ID, USERNAME, `m5conc_${RUN_TAG}@contoh.test`],
  );
}

async function seedClubs(admin) {
  await admin.query(
    `insert into public.clubs (name, slug, description, visibility, join_policy, created_by)
     select 'Klub Konkurensi ' || lpad(i::text, 2, '0'),
            $1 || lpad(i::text, 2, '0'),
            'Data uji konkurensi throttle; dihapus otomatis.',
            'private', 'approval', $2
       from generate_series(1, 9) as i`,
    [CLUB_SLUG_PREFIX, USER_ID],
  );
}

async function seedRideContext(admin) {
  const { rows } = await admin.query(
    `select id from public.clubs where created_by = $1 order by slug limit 1`,
    [USER_ID],
  );
  const clubId = rows[0]?.id;
  if (!clubId) throw new Error('klub uji tidak terbentuk');

  await admin.query(
    `insert into public.club_members (club_id, user_id, role, status, joined_at)
     values ($1, $2, 'owner', 'active', now())
     on conflict (club_id, user_id) do nothing`,
    [clubId, USER_ID],
  );

  await admin.query(
    `insert into public.rides (
       club_id, created_by, title, description, activity_type, status, visibility,
       starts_at, meeting_label, destination_label
     )
     select $1, $2, $3 || lpad(i::text, 2, '0'),
            'Data uji konkurensi throttle; dihapus otomatis.',
            'motorcycle', 'planned', 'club', now() + interval '1 hour',
            'Titik kumpul', 'Tujuan'
       from generate_series(1, 9) as i`,
    [clubId, USER_ID, RIDE_TITLE_PREFIX],
  );

  return clubId;
}

async function cleanup(admin) {
  await admin.query(
    `delete from public.club_role_audit
      where club_id in (select id from public.clubs where created_by = $1)`,
    [USER_ID],
  );
  await admin.query(
    `delete from public.club_members
      where club_id in (select id from public.clubs where created_by = $1)`,
    [USER_ID],
  );
  await admin.query(
    `delete from public.ride_members
      where ride_id in (select id from public.rides where created_by = $1)`,
    [USER_ID],
  );
  await admin.query('delete from public.rides where created_by = $1', [USER_ID]);
  await admin.query('delete from public.clubs where created_by = $1', [USER_ID]);
  // Trigger auth_users_purge_profile menghapus profil; jangan hapus manual agar
  // jalur purge yang sebenarnya ikut teruji.
  await admin.query('delete from auth.users where id = $1', [USER_ID]);
}

/**
 * Jalankan dua RPC serentak. Pemanggil pertama menahan transaksinya sampai
 * pemanggil kedua terbukti menunggu, lalu commit. Pemanggil kedua harus
 * ditolak dengan P0001 + detail yang diharapkan.
 */
async function proveSerialization(config, { label, call, expectedDetail }) {
  const first = await connect(config);
  const second = await connect(config);
  let secondSettled = false;

  try {
    await beginAs(first, USER_ID);
    const firstResult = await first.query(call.sql, call.params);
    if (!firstResult.rows[0]) throw new Error(`${label}: pemanggilan pertama tanpa hasil`);

    await beginAs(second, USER_ID);
    const secondPromise = second
      .query(call.sql, call.params)
      .then((result) => ({ ok: true, result }))
      .catch((error) => ({ ok: false, error }));
    secondPromise.then(() => {
      secondSettled = true;
    });

    // Beri waktu trigger kedua mencapai advisory lock. Tanpa serialisasi,
    // pemanggilan kedua akan selesai (menulis baris ke-11) dalam waktu ini.
    await new Promise((resolve) => setTimeout(resolve, 700));

    if (secondSettled) {
      throw new Error(
        `${label}: permintaan kedua selesai saat yang pertama masih menahan transaksi — tidak terserialisasi`,
      );
    }

    await first.query('commit');

    const outcome = await secondPromise;
    await second.query('rollback').catch(() => {});

    if (outcome.ok) {
      throw new Error(`${label}: permintaan kedua lolos padahal kuota sudah penuh`);
    }

    const error = outcome.error;
    if (error?.code !== 'P0001' || error?.detail !== expectedDetail) {
      throw new Error(
        `${label}: penolakan salah (code=${error?.code ?? '-'}, detail=${error?.detail ?? '-'})`,
      );
    }

    console.log(
      `[uji-konkurensi] ${label}: permintaan kedua menunggu lock dan ditolak P0001/${expectedDetail}.`,
    );
  } finally {
    await first.query('rollback').catch(() => {});
    await second.query('rollback').catch(() => {});
    await first.end().catch(() => {});
    await second.end().catch(() => {});
  }
}

async function main() {
  const config = connectionConfig();
  const admin = await connect(config);
  let cleanupNeeded = false;

  try {
    await setupUser(admin);
    cleanupNeeded = true;

    await seedClubs(admin);
    await proveSerialization(config, {
      label: 'create_club',
      call: {
        sql: `select public.create_club('Klub Konkurensi 10', $1, null, 'private', 'approval')`,
        params: [`${CLUB_SLUG_PREFIX}10`],
      },
      expectedDetail: 'club_create_rate_limit',
    });

    const clubs = await admin.query(
      'select count(*)::int as total from public.clubs where created_by = $1',
      [USER_ID],
    );
    if (clubs.rows[0].total !== 10) {
      throw new Error(`jumlah klub setelah uji ${clubs.rows[0].total}, seharusnya 10`);
    }

    const clubId = await seedRideContext(admin);
    await proveSerialization(config, {
      label: 'create_ride',
      call: {
        sql: `select public.create_ride($1, 'Uji Konkurensi Ride 10', now() + interval '1 hour')`,
        params: [clubId],
      },
      expectedDetail: 'ride_create_rate_limit',
    });

    const rides = await admin.query(
      'select count(*)::int as total from public.rides where created_by = $1',
      [USER_ID],
    );
    if (rides.rows[0].total !== 10) {
      throw new Error(`jumlah ride setelah uji ${rides.rows[0].total}, seharusnya 10`);
    }

    console.log(
      '[uji-konkurensi] LULUS: dua permintaan serentak tidak dapat melampaui kuota 10/jam untuk klub dan ride.',
    );
  } finally {
    if (cleanupNeeded) {
      await cleanup(admin).catch((error) => {
        console.error(
          `[uji-konkurensi] PERINGATAN: cleanup gagal (${error?.code ?? 'tanpa kode'}); cari akun ${USERNAME} dan slug uji berawalan ${CLUB_SLUG_PREFIX} di project development.`,
        );
        process.exitCode = 1;
      });
    }
    await admin.end().catch(() => {});
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
