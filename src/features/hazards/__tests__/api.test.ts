import {
  canEditHazard,
  confirmHazard,
  createHazard,
  getActiveHazards,
  HAZARD_EDIT_WINDOW_MS,
  removeHazard,
  updateHazard,
  type HazardRow,
} from '@/features/hazards/api';
import { createFakeChatClient } from '@/test-support/fakeChatClient';

/**
 * Pengujian lapisan laporan bahaya.
 *
 * Yang dibuktikan: validasi klien berhenti sebelum RPC, klien tidak pernah
 * mengirim `expires_at`, idempotency key diteruskan apa adanya, filter daftar
 * memakai status aktif + `expires_at` (bukan hanya status), laporan kedaluwarsa
 * tidak lolos ke UI, dan setiap tag galat database diterjemahkan menjadi pesan
 * Bahasa Indonesia yang benar.
 */

const NOW = Date.parse('2026-10-20T10:00:00.000Z');

function buildRow(overrides: Partial<HazardRow> = {}): HazardRow {
  return {
    id: 'hazard-1',
    reporter_id: 'user-1',
    ride_id: null,
    category: 'pothole',
    description: 'Lubang besar',
    severity: 'moderate',
    latitude: -6.2,
    longitude: 106.8166,
    status: 'active',
    expires_at: '2026-10-21T10:00:00.000Z',
    created_at: '2026-10-20T09:55:00.000Z',
    updated_at: null,
    client_report_id: null,
    ...overrides,
  };
}

const VALID_INPUT = {
  category: 'pothole' as const,
  severity: 'moderate' as const,
  latitude: -6.2,
  longitude: 106.8166,
};

describe('createHazard', () => {
  it('mengirim argumen RPC tanpa expires_at dan meneruskan idempotency key', async () => {
    const { client, rpcCalls } = createFakeChatClient({
      rpc: () => ({ data: buildRow(), error: null }),
    });

    const result = await createHazard(client, {
      ...VALID_INPUT,
      description: '  Lubang besar  ',
      clientReportId: 'client-report-1',
    });

    expect(result.ok).toBe(true);
    expect(rpcCalls[0].name).toBe('create_hazard');
    expect(rpcCalls[0].args).toEqual({
      p_category: 'pothole',
      p_severity: 'moderate',
      p_latitude: -6.2,
      p_longitude: 106.8166,
      p_description: 'Lubang besar',
      p_ride_id: null,
      p_client_report_id: 'client-report-1',
    });
    expect(Object.keys(rpcCalls[0].args)).not.toContain('p_expires_at');
  });

  it('mengosongkan deskripsi yang hanya berisi spasi', async () => {
    const { client, rpcCalls } = createFakeChatClient({
      rpc: () => ({ data: buildRow(), error: null }),
    });

    await createHazard(client, { ...VALID_INPUT, description: '    ' });

    expect(rpcCalls[0].args.p_description).toBeNull();
  });

  it('menolak kategori, keparahan, koordinat, dan deskripsi tidak sah tanpa memanggil backend', async () => {
    const { client, rpcCalls } = createFakeChatClient();

    const category = await createHazard(client, {
      ...VALID_INPUT,
      category: 'banjir-besar' as never,
    });
    const severity = await createHazard(client, {
      ...VALID_INPUT,
      severity: 'extreme' as never,
    });
    const latitude = await createHazard(client, { ...VALID_INPUT, latitude: 91 });
    const longitude = await createHazard(client, { ...VALID_INPUT, longitude: 181 });
    const description = await createHazard(client, {
      ...VALID_INPUT,
      description: 'a'.repeat(1001),
    });

    expect(category.ok).toBe(false);
    if (!category.ok) expect(category.error.code).toBe('invalid_category');
    expect(severity.ok).toBe(false);
    if (!severity.ok) expect(severity.error.code).toBe('invalid_severity');
    expect(latitude.ok).toBe(false);
    if (!latitude.ok) expect(latitude.error.code).toBe('invalid_coordinates');
    expect(longitude.ok).toBe(false);
    if (!longitude.ok) expect(longitude.error.code).toBe('invalid_coordinates');
    expect(description.ok).toBe(false);
    if (!description.ok) expect(description.error.code).toBe('invalid_description');

    expect(rpcCalls).toHaveLength(0);
  });

  it('menerjemahkan rate limit server menjadi error yang bisa dicoba ulang', async () => {
    const { client } = createFakeChatClient({
      rpc: () => ({ data: null, error: { detail: 'hazard_rate_limit', code: 'P0001' } }),
    });

    const result = await createHazard(client, VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rate_limited');
      expect(result.error.retryable).toBe(true);
      expect(result.error.message).toContain('5 per 10 menit');
    }
  });

  it('menerjemahkan duplikat 50 m menjadi error yang tidak diulang otomatis', async () => {
    const { client } = createFakeChatClient({
      rpc: () => ({ data: null, error: { detail: 'hazard_duplicate_nearby', code: '23505' } }),
    });

    const result = await createHazard(client, VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('duplicate');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('menolak menautkan laporan ke perjalanan yang bukan milik pelapor', async () => {
    const { client } = createFakeChatClient({
      rpc: () => ({ data: null, error: { detail: 'hazard_ride_not_member', code: '42501' } }),
    });

    const result = await createHazard(client, { ...VALID_INPUT, rideId: 'ride-1' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_authorized');
      expect(result.error.message).toContain('peserta perjalanan');
    }
  });

  it('melaporkan kegagalan jaringan sebagai error yang bisa dicoba ulang', async () => {
    const client = {
      rpc: () => Promise.reject(new Error('Network request failed')),
    } as never;

    const result = await createHazard(client, VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe('getActiveHazards', () => {
  it('menyaring status aktif dan expires_at di server', async () => {
    const { client, queryCalls } = createFakeChatClient({
      rows: { hazard_reports: [buildRow()] },
    });

    const result = await getActiveHazards(client, { category: 'all', severity: 'all' });

    expect(result.ok).toBe(true);
    expect(queryCalls[0].table).toBe('hazard_reports');
    expect(queryCalls[0].filters).toContainEqual({ column: 'status', value: 'active' });
    const expiryFilter = queryCalls[0].filters.find((filter) => filter.column === 'expires_at');
    expect(expiryFilter?.value).toEqual({ op: 'gt', value: expect.any(String) });
  });

  it('menambahkan filter kategori dan keparahan hanya bila dipilih', async () => {
    const { client, queryCalls } = createFakeChatClient({
      rows: { hazard_reports: [] },
    });

    await getActiveHazards(client, { category: 'flood', severity: 'critical' });

    expect(queryCalls[0].filters).toContainEqual({ column: 'category', value: 'flood' });
    expect(queryCalls[0].filters).toContainEqual({ column: 'severity', value: 'critical' });
  });

  it('membuang laporan kedaluwarsa yang masih berstatus active', async () => {
    const expired = buildRow({
      id: 'hazard-expired',
      expires_at: '2026-10-20T09:00:00.000Z',
    });
    const active = buildRow({ id: 'hazard-active', expires_at: '2099-01-01T00:00:00.000Z' });
    const { client } = createFakeChatClient({ rows: { hazard_reports: [expired, active] } });

    const result = await getActiveHazards(client);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((row) => row.id)).toEqual(['hazard-active']);
  });

  it('tidak melempar exception saat backend mengembalikan galat', async () => {
    const { client } = createFakeChatClient({ rows: {} });
    const broken = {
      from: () => {
        throw new Error('boom');
      },
    } as never;

    const result = await getActiveHazards(broken);
    expect(result.ok).toBe(false);

    const empty = await getActiveHazards(client);
    expect(empty.ok).toBe(true);
  });
});

describe('canEditHazard', () => {
  it('mengizinkan pelapor mengubah laporan aktif dalam 15 menit', () => {
    expect(canEditHazard(buildRow({ created_at: new Date(NOW - 60_000).toISOString() }), NOW)).toBe(
      true,
    );
  });

  it('menolak setelah jendela 15 menit atau bila laporan tidak aktif', () => {
    expect(
      canEditHazard(
        buildRow({ created_at: new Date(NOW - HAZARD_EDIT_WINDOW_MS - 1000).toISOString() }),
        NOW,
      ),
    ).toBe(false);
    expect(canEditHazard(buildRow({ status: 'removed' }), NOW)).toBe(false);
  });
});

describe('konfirmasi dan status transisi', () => {
  it('mengembalikan jumlah konfirmasi dari RPC', async () => {
    const { client, rpcCalls } = createFakeChatClient({ rpc: () => ({ data: 3, error: null }) });

    const result = await confirmHazard(client, 'hazard-1');

    expect(rpcCalls[0]).toEqual({ name: 'confirm_hazard', args: { p_hazard_id: 'hazard-1' } });
    expect(result).toEqual({ ok: true, data: { total: 3 } });
  });

  it('menolak konfirmasi ganda dengan pesan yang jelas', async () => {
    const { client } = createFakeChatClient({
      rpc: () => ({ data: null, error: { detail: 'hazard_already_confirmed', code: '23505' } }),
    });

    const result = await confirmHazard(client, 'hazard-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('conflict');
      expect(result.error.message).toContain('sudah mengonfirmasi');
    }
  });

  it('menolak konfirmasi laporan kedaluwarsa', async () => {
    const { client } = createFakeChatClient({
      rpc: () => ({ data: null, error: { detail: 'hazard_expired', code: '23514' } }),
    });

    const result = await confirmHazard(client, 'hazard-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('conflict');
  });

  it('menerjemahkan jendela edit yang lewat saat mengubah laporan', async () => {
    const { client } = createFakeChatClient({
      rpc: () => ({ data: null, error: { detail: 'hazard_edit_window', code: '23514' } }),
    });

    const result = await updateHazard(client, 'hazard-1', {
      severity: 'high',
      description: 'lebih parah',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('conflict');
      expect(result.error.message).toContain('15 menit');
    }
  });

  it('menolak pengubahan oleh bukan pelapor', async () => {
    const { client } = createFakeChatClient({
      rpc: () => ({ data: null, error: { detail: 'hazard_not_reporter', code: '42501' } }),
    });

    const result = await updateHazard(client, 'hazard-1', { severity: 'info' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
  });

  it('melepas laporan lewat RPC remove_hazard, bukan DELETE', async () => {
    const { client, rpcCalls, queryCalls } = createFakeChatClient({
      rpc: () => ({ data: buildRow({ status: 'removed' }), error: null }),
    });

    const result = await removeHazard(client, 'hazard-1');

    expect(rpcCalls[0]).toEqual({ name: 'remove_hazard', args: { p_hazard_id: 'hazard-1' } });
    expect(queryCalls).toHaveLength(0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe('removed');
  });
});
