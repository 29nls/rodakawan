/**
 * Penjaga agar draf Milestone 3 tetap **draft**.
 *
 * Uji RLS/RPC perjalanan belum boleh berjalan di `npm run db:test` selama
 * gerbang uji perangkat Milestone 2 belum lulus. Berkas ini memastikan draf
 * tidak diam-diam menjadi migration aktif atau masuk daftar uji default —
 * kegagalan yang akan membuat CI menyentuh skema live-location lebih awal.
 *
 * Ini bukan pengganti uji RLS-nya: uji sebenarnya ada di
 * `supabase/tests/drafts/rls_rides_m3_draft.sql` dan dijalankan manual setelah
 * draf diterapkan di database scratch.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const DRAFT_MIGRATION = path.join(ROOT, 'supabase', 'drafts', 'milestone_3_ride_state.sql');
const DRAFT_TEST = path.join(ROOT, 'supabase', 'tests', 'drafts', 'rls_rides_m3_draft.sql');

const read = (file) => fs.readFileSync(file, 'utf8');

describe('draf Milestone 3', () => {
  it('tidak menambahkan RPC state machine ke migration aktif', () => {
    const files = fs.readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql'));

    for (const file of files) {
      const sql = read(path.join(MIGRATIONS, file));
      assert.equal(
        /transition_ride|set_ride_location_sharing/.test(sql),
        false,
        `${file} sudah memuat RPC Milestone 3; draf tidak boleh aktif sebelum gerbang M2 lulus`,
      );
    }
  });

  it('tidak terdaftar di DEFAULT_TEST_FILES milik runner', () => {
    const runner = read(path.join(ROOT, 'scripts', 'db-test.mjs'));

    assert.equal(
      runner.includes('rls_rides_m3_draft.sql'),
      false,
      'uji draf M3 tidak boleh masuk daftar uji default sebelum gerbang M2 lulus',
    );
  });

  it('berkas draf memuat state machine, consent, dan pembersihan lokasi', () => {
    const sql = read(DRAFT_MIGRATION);

    for (const token of [
      'create or replace function public.transition_ride',
      'create or replace function public.set_ride_location_sharing',
      'create trigger ride_members_clear_location',
      'create trigger rides_clear_locations',
      "p_next not in ('active', 'completed', 'cancelled')",
      "v_ride.status in ('completed', 'cancelled')",
    ]) {
      assert.equal(sql.includes(token), true, `draf migration kehilangan: ${token}`);
    }
  });

  it('uji draf memuat notice, rollback, dan kasus allow/deny penting', () => {
    const sql = read(DRAFT_TEST);

    assert.match(sql, /^--\s*db:test notice:\s*\S.+$/m, 'uji draf wajib punya direktif notice');
    assert.match(sql, /rollback;\s*$/i, 'uji draf wajib berakhir ROLLBACK');

    for (const token of [
      'public.transition_ride',
      'public.set_ride_location_sharing',
      'insufficient_privilege',
      'check_violation',
      'anon',
      'ride_locations',
      'host',
      'completed',
    ]) {
      assert.equal(sql.includes(token), true, `uji draf kehilangan kasus: ${token}`);
    }
  });
});
