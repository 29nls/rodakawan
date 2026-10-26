import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEV_PROJECT_REF,
  describeDatabaseTarget,
  elapsedMs,
  isDevProjectUrl,
  matchesRealtimePayload,
  projectRefFromUrl,
  redactSensitive,
} from '../lib/shared-ride.mjs';

describe('projectRefFromUrl', () => {
  it('mengenali ref dari URL Supabase https', () => {
    assert.equal(projectRefFromUrl('https://abcdefghijklmno.supabase.co'), 'abcdefghijklmno');
  });

  it('menolak http, host lain, dan nilai yang bukan URL', () => {
    assert.equal(projectRefFromUrl('http://abcdefghijklmno.supabase.co'), null);
    assert.equal(projectRefFromUrl('https://supabase.co'), null);
    assert.equal(projectRefFromUrl('https://abcdefghijklmno.supabase.co.evil.test'), null);
    assert.equal(projectRefFromUrl('bukan url'), null);
    assert.equal(projectRefFromUrl(''), null);
    assert.equal(projectRefFromUrl(null), null);
  });
});

describe('isDevProjectUrl', () => {
  it('hanya menerima project development', () => {
    assert.equal(isDevProjectUrl(`https://${DEV_PROJECT_REF}.supabase.co`), true);
    assert.equal(isDevProjectUrl('https://abcdefghijklmno.supabase.co'), false);
    assert.equal(isDevProjectUrl(`https://${DEV_PROJECT_REF}.supabase.co.evil.test`), false);
  });
});

describe('redactSensitive', () => {
  it('menyunting JWT, kunci, token URL, dan connection string', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.tanda-tangan';
    const text = [
      `Authorization: Bearer ${jwt}`,
      'apikey sb_publishable_rahasia123',
      'https://contoh.test/cb?token=abc123&next=1',
      'postgresql://postgres:password@host:5432/postgres',
    ].join('\n');

    const hasil = redactSensitive(text);

    assert.ok(!hasil.includes(jwt));
    assert.ok(!hasil.includes('sb_publishable_rahasia123'));
    assert.ok(!hasil.includes('token=abc123'));
    assert.ok(!hasil.includes('password@host'));
    assert.ok(hasil.includes('<jwt>'));
    assert.ok(hasil.includes('<kunci>'));
    assert.ok(hasil.includes('token=<disunting>'));
    assert.ok(hasil.includes('<database-url>'));
  });
});

describe('describeDatabaseTarget', () => {
  it('hanya menampilkan host dan nama database', () => {
    const target = describeDatabaseTarget(
      'postgresql://postgres.abcdefghijklmno:password-rahasia@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require',
    );

    assert.equal(target, 'aws-0-ap-southeast-1.pooler.supabase.com/postgres');
    assert.ok(!target.includes('password'));
    assert.ok(!target.includes('postgres.'));
  });

  it('mengembalikan placeholder untuk nilai kosong atau rusak', () => {
    assert.equal(describeDatabaseTarget(''), '<tidak terbaca>');
    assert.equal(describeDatabaseTarget('bukan url'), '<tidak terbaca>');
  });
});

describe('matchesRealtimePayload', () => {
  const rideId = '11111111-1111-4111-8111-111111111111';

  it('menerima chat milik perjalanan yang diuji', () => {
    assert.equal(
      matchesRealtimePayload(
        { new: { id: 'pesan-1', ride_id: rideId, content: 'halo' } },
        { table: 'chat_messages', rideId },
      ),
      true,
    );
  });

  it('menerima lokasi milik perjalanan yang diuji', () => {
    assert.equal(
      matchesRealtimePayload(
        { new: { ride_id: rideId, latitude: -6.2, longitude: 106.8 } },
        { table: 'ride_locations', rideId },
      ),
      true,
    );
  });

  it('mengabaikan perjalanan lain, tabel lain, dan bentuk yang tidak lengkap', () => {
    const otherRide = '22222222-2222-4222-8222-222222222222';

    assert.equal(
      matchesRealtimePayload(
        { new: { id: 'pesan-1', ride_id: otherRide, content: 'halo' } },
        { table: 'chat_messages', rideId },
      ),
      false,
    );
    assert.equal(
      matchesRealtimePayload(
        { new: { id: 'pesan-1', ride_id: rideId, content: 'halo' } },
        { table: 'ride_locations', rideId },
      ),
      false,
    );
    assert.equal(
      matchesRealtimePayload(
        { new: { ride_id: rideId, latitude: -6.2 } },
        { table: 'ride_locations', rideId },
      ),
      false,
    );
    assert.equal(matchesRealtimePayload({ new: null }, { table: 'chat_messages', rideId }), false);
    assert.equal(matchesRealtimePayload({}, { table: 'chat_messages', rideId }), false);
  });
});

describe('elapsedMs', () => {
  it('menghitung selisih bulat dan tidak pernah negatif', () => {
    assert.equal(elapsedMs(1000, 2500), 1500);
    assert.equal(elapsedMs(2500, 1000), 0);
    assert.equal(elapsedMs(1000.4, 1000.9), 1);
  });

  it('mengembalikan NaN untuk waktu yang tidak valid', () => {
    assert.ok(Number.isNaN(elapsedMs(Number.NaN, 1)));
    assert.ok(Number.isNaN(elapsedMs(1, Number.NaN)));
  });
});
