/**
 * Penjaga Milestone 3.
 *
 * Dulu berkas ini memastikan migration perjalanan tetap **draft**. Sejak
 * gerbang Milestone 2 dilaporkan lulus oleh pemilik aplikasi, migration itu
 * aktif dan ujinya ikut berjalan di `npm run db:test`. Penjaga baru memastikan
 * dua hal yang mudah rusak tanpa terlihat:
 *
 *   1. migration M3 tetap memuat RPC state machine/consent dan pembersihan
 *      lokasi (bukan hanya komentar);
 *   2. uji RLS-nya benar-benar terdaftar di daftar default runner, sehingga CI
 *      tidak kembali hijau tanpa pernah menjalankan uji perjalanan.
 *
 * Jalankan: `npm run test:scripts`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261019120000_ride_workflow.sql');
const TEST = path.join(ROOT, 'supabase', 'tests', 'rls_rides_test.sql');
const RUNNER = path.join(ROOT, 'scripts', 'db-test.mjs');

const read = (file) => fs.readFileSync(file, 'utf8');

describe('Milestone 3', () => {
  it('migration aktif memuat RPC perjalanan dan pembersihan lokasi', () => {
    const sql = read(MIGRATION);

    for (const token of [
      'create or replace function public.create_ride',
      'create or replace function public.transition_ride',
      'create or replace function public.set_ride_location_sharing',
      'create or replace function public.publish_ride_location',
      'create or replace function public.invite_ride_member',
      'create or replace function public.accept_ride_invite',
      'create or replace function public.join_ride',
      'create or replace function public.leave_ride',
      'create trigger ride_members_clear_location',
      'create trigger rides_clear_locations',
      'revoke insert, update on public.ride_locations from authenticated',
      "v_ride.status in ('completed', 'cancelled')",
    ]) {
      assert.equal(sql.includes(token), true, `migration M3 kehilangan: ${token}`);
    }
  });

  it('uji RLS perjalanan terdaftar di runner default', () => {
    const runner = read(RUNNER);
    assert.equal(
      runner.includes("'supabase/tests/rls_rides_test.sql'"),
      true,
      'uji RLS perjalanan harus berjalan di npm run db:test',
    );
  });

  it('uji perjalanan memuat notice, rollback, dan kasus allow/deny penting', () => {
    const sql = read(TEST);

    assert.match(sql, /^--\s*db:test notice:\s*\S.+$/m, 'uji wajib punya direktif notice');
    assert.match(sql, /rollback;\s*$/i, 'uji wajib berakhir ROLLBACK');

    for (const token of [
      'public.create_ride',
      'public.transition_ride',
      'public.set_ride_location_sharing',
      'public.publish_ride_location',
      'insufficient_privilege',
      'check_violation',
      'anon',
      'ride_locations',
      'host',
      'completed',
    ]) {
      assert.equal(sql.includes(token), true, `uji kehilangan kasus: ${token}`);
    }
  });

  it('tidak ada lagi draf perjalanan yang bisa lolos tanpa terlihat', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'supabase', 'drafts')), false);
    assert.equal(fs.existsSync(path.join(ROOT, 'supabase', 'tests', 'drafts')), false);
  });
});
