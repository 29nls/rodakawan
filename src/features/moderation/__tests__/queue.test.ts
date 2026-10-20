import {
  isContentReportReason,
  loadModerationAudit,
  loadModerationQueue,
  removeReportedContent,
  reviewReport,
  type ModerationQueueItem,
} from '@/features/moderation/queue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { createQueryClient, type QueryResponse } from '@/test-support/fakeSupabase';

const HAZARD_REPORT = {
  id: 'repo-1',
  reporter_id: 'user-b',
  target_type: 'hazard',
  target_id: 'hazard-1',
  reason: 'unsafe_content',
  details: 'Menutup jalur evakuasi.',
  status: 'open',
  created_at: '2026-10-21T02:00:00.000Z',
  reviewed_at: null,
};

const CHAT_REPORT = {
  id: 'repo-2',
  reporter_id: 'user-b',
  target_type: 'chat_message',
  target_id: 'message-1',
  reason: 'harassment',
  details: null,
  status: 'open',
  created_at: '2026-10-21T03:00:00.000Z',
  reviewed_at: null,
};

const HAZARD_ROW = {
  id: 'hazard-1',
  reporter_id: 'user-b',
  ride_id: 'ride-1',
  category: 'pothole',
  description: 'Lubang besar di lajur kanan.',
  severity: 'high',
  status: 'active',
  created_at: '2026-10-21T01:58:00.000Z',
};

const MESSAGE_ROW = {
  id: 'message-1',
  sender_id: 'user-c',
  ride_id: 'ride-1',
  content: 'Pesan kasar berulang.',
  message_type: 'text',
  created_at: '2026-10-21T02:59:00.000Z',
  deleted_at: null,
};

const RIDE_ROW = { id: 'ride-1', title: 'Touring Malam' };

const PROFILE_ROWS = [
  { id: 'user-b', username: 'rider_b', display_name: 'Rider B' },
  { id: 'user-c', username: 'rider_c', display_name: null },
];

function createClient(responses: QueryResponse | QueryResponse[]) {
  const { client, log } = createQueryClient(responses);
  const rpc = jest.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data: null as unknown,
    error: null as unknown,
  }));

  (client as unknown as { rpc: typeof rpc }).rpc = rpc;

  return { client: client as SupabaseClient<Database>, log, rpc };
}

function itemWithSubject(
  overrides: Partial<ModerationQueueItem> & { subject?: ModerationQueueItem['subject'] } = {},
): ModerationQueueItem {
  return {
    report: HAZARD_REPORT,
    subject: {
      kind: 'hazard',
      id: 'hazard-1',
      authorId: 'user-b',
      rideId: 'ride-1',
      body: 'Lubang besar di lajur kanan.',
      category: 'pothole',
      severity: 'high',
      status: 'active',
      createdAt: '2026-10-21T01:58:00.000Z',
      removed: false,
    },
    ride: RIDE_ROW,
    ...overrides,
  };
}

describe('loadModerationQueue', () => {
  it('menggabungkan laporan terbuka dengan isi konten, judul perjalanan, dan nama pengguna', async () => {
    const { client, log, rpc } = createClient([
      { data: [HAZARD_REPORT, CHAT_REPORT] },
      { data: [HAZARD_ROW] },
      { data: [MESSAGE_ROW] },
      { data: [RIDE_ROW] },
      { data: PROFILE_ROWS },
    ]);

    const result = await loadModerationQueue(client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(log.queries.map((query) => query.table)).toEqual([
      'content_reports',
      'hazard_reports',
      'chat_messages',
      'rides',
      'profiles',
    ]);

    expect(log.queries[0].filters).toEqual([{ column: 'status', value: 'open' }]);
    expect(log.queries[1].filters).toEqual([
      { column: 'id', value: { op: 'in', value: ['hazard-1'] } },
    ]);
    expect(log.queries[2].filters).toEqual([
      { column: 'id', value: { op: 'in', value: ['message-1'] } },
    ]);

    const [hazardItem, chatItem] = result.data.items;

    expect(hazardItem.subject).toMatchObject({
      kind: 'hazard',
      body: 'Lubang besar di lajur kanan.',
    });
    expect(hazardItem.ride).toEqual({ id: 'ride-1', title: 'Touring Malam' });
    expect(chatItem.subject).toMatchObject({ kind: 'chat_message', body: 'Pesan kasar berulang.' });

    expect(result.data.people).toEqual({
      'user-b': 'Rider B',
      'user-c': '@rider_c',
    });

    // Tidak ada konten yang perlu diambil lewat RPC bila policy sudah membacanya.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('mengambil isi konten lewat RPC ketika moderator tidak bisa membacanya langsung', async () => {
    const { client, rpc } = createClient([
      { data: [CHAT_REPORT] },
      { data: [] },
      { data: [RIDE_ROW] },
      { data: PROFILE_ROWS },
    ]);

    rpc.mockResolvedValueOnce({
      data: {
        kind: 'chat_message',
        id: 'message-1',
        author_id: 'user-c',
        ride_id: 'ride-1',
        body: 'Pesan kasar berulang.',
        category: null,
        severity: null,
        status: 'text',
        created_at: '2026-10-21T02:59:00.000Z',
        removed: false,
      },
      error: null,
    });

    const result = await loadModerationQueue(client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(rpc).toHaveBeenCalledWith('get_moderation_subject', {
      p_target_type: 'chat_message',
      p_target_id: 'message-1',
    });
    expect(result.data.items[0].subject).toMatchObject({
      kind: 'chat_message',
      body: 'Pesan kasar berulang.',
    });
  });

  it('membiarkan isi konten kosong bila RPC pun tidak mengembalikannya', async () => {
    const { client, rpc } = createClient([
      { data: [HAZARD_REPORT] },
      { data: [] },
      { data: [RIDE_ROW] },
      { data: PROFILE_ROWS },
    ]);

    const result = await loadModerationQueue(client);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0].subject).toBeNull();
    expect(result.data.items[0].ride).toBeNull();
  });

  it('meneruskan galat RLS sebagai kegagalan, bukan antrean kosong', async () => {
    const { client } = createClient([{ error: { code: '42501', message: 'permission denied' } }]);

    const result = await loadModerationQueue(client);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_authorized');
  });

  it('mengembalikan antrean kosong tanpa query tambahan', async () => {
    const { client, log } = createClient([{ data: [] }]);

    const result = await loadModerationQueue(client);

    expect(result).toEqual({ ok: true, data: { items: [], people: {} } });
    expect(log.queries).toHaveLength(1);
  });

  it('mengabaikan laporan atas target selain hazard dan chat', async () => {
    const { client, log } = createClient([
      { data: [{ ...HAZARD_REPORT, id: 'repo-x', target_type: 'post', target_id: 'post-1' }] },
    ]);

    const result = await loadModerationQueue(client);

    expect(result).toEqual({ ok: true, data: { items: [], people: {} } });
    expect(log.queries).toHaveLength(1);
  });
});

describe('reviewReport', () => {
  it('menutup laporan dengan status dan catatan yang diminta', async () => {
    const { client, rpc } = createClient([]);
    rpc.mockResolvedValueOnce({ data: { id: 'repo-1', status: 'reviewed' }, error: null });

    const result = await reviewReport(client, 'repo-1', 'reviewed', '  Sudah dicek  ');

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('review_content_report', {
      p_report_id: 'repo-1',
      p_status: 'reviewed',
      p_note: 'Sudah dicek',
    });
  });

  it('menolak catatan lebih dari 1000 karakter sebelum memanggil server', async () => {
    const { client, rpc } = createClient([]);

    const result = await reviewReport(client, 'repo-1', 'reviewed', 'x'.repeat(1001));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_data');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('menerjemahkan tag galat moderasi menjadi pesan yang bisa ditindaklanjuti', async () => {
    const { client, rpc } = createClient([]);
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'denied', details: 'moderation_not_allowed' },
    });

    const result = await reviewReport(client, 'repo-1', 'dismissed');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_authorized');
    expect(result.error.message).toMatch(/host perjalanan atau admin klub/);
  });
});

describe('removeReportedContent', () => {
  it('menghapus konten lalu menutup laporan sebagai removed', async () => {
    const { client, rpc } = createClient([]);
    rpc
      .mockResolvedValueOnce({
        data: { id: 'message-1', deleted_at: '2026-10-21T04:00:00.000Z' },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'repo-2', status: 'removed' }, error: null });

    const item = itemWithSubject({
      report: CHAT_REPORT,
      subject: {
        kind: 'chat_message',
        id: 'message-1',
        authorId: 'user-c',
        rideId: 'ride-1',
        body: 'Pesan kasar berulang.',
        category: null,
        severity: null,
        status: 'text',
        createdAt: '2026-10-21T02:59:00.000Z',
        removed: false,
      },
    });

    const result = await removeReportedContent(client, item, 'harassment');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contentRemoved).toBe(true);

    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'moderate_chat_message',
      'review_content_report',
    ]);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_message_id: 'message-1',
      p_reason: 'harassment',
    });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_report_id: 'repo-2', p_status: 'removed' });
  });

  it('tidak menghapus ulang konten yang sudah terhapus, hanya menutup laporan', async () => {
    const { client, rpc } = createClient([]);
    rpc.mockResolvedValueOnce({ data: { id: 'repo-1', status: 'removed' }, error: null });

    const result = await removeReportedContent(
      client,
      itemWithSubject({ subject: { ...itemWithSubject().subject!, removed: true } }),
      'unsafe_content',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contentRemoved).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('review_content_report');
  });

  it('menolak menghapus bila isi konten tidak terbaca', async () => {
    const { client, rpc } = createClient([]);

    const result = await removeReportedContent(
      client,
      itemWithSubject({ subject: null, ride: null }),
      'spam',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('content_unavailable');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('melaporkan kegagalan langkah kedua sebagai partial, bukan sukses', async () => {
    const { client, rpc } = createClient([]);
    rpc
      .mockResolvedValueOnce({ data: { id: 'hazard-1', status: 'removed' }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'conflict', details: 'moderation_report_closed' },
      });

    const result = await removeReportedContent(client, itemWithSubject(), 'unsafe_content');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('partial');
    expect(result.error.retryable).toBe(true);
  });
});

describe('loadModerationAudit', () => {
  it('membaca jejak audit lewat RPC dan memberi label pelaku', async () => {
    const { client, log, rpc } = createClient([
      { data: [{ id: 'user-a', username: 'host_a', display_name: 'Host A' }] },
    ]);
    const rows = [
      {
        id: 'audit-1',
        actor_id: 'user-a',
        target_type: 'hazard',
        target_id: 'hazard-1',
        action: 'remove',
        reason: 'unsafe_content',
        note: null,
        created_at: '2026-10-21T04:00:00.000Z',
      },
    ];
    rpc.mockResolvedValueOnce({ data: rows, error: null });

    const result = await loadModerationAudit(client, 10);

    expect(result).toEqual({ ok: true, data: { actions: rows, people: { 'user-a': 'Host A' } } });
    expect(rpc).toHaveBeenCalledWith('list_moderation_actions', { p_limit: 10 });
    expect(log.queries.map((query) => query.table)).toEqual(['profiles']);
    expect(log.queries[0].filters).toEqual([
      { column: 'id', value: { op: 'in', value: ['user-a'] } },
    ]);
  });

  it('mengembalikan daftar kosong bila server mengirim balasan bukan array', async () => {
    const { client, rpc } = createClient([]);
    rpc.mockResolvedValueOnce({ data: { unexpected: true }, error: null });

    const result = await loadModerationAudit(client);

    expect(result).toEqual({ ok: true, data: { actions: [], people: {} } });
  });
});

describe('isContentReportReason', () => {
  it('hanya menerima alasan yang dikenal CHECK constraint', () => {
    expect(isContentReportReason('harassment')).toBe(true);
    expect(isContentReportReason('lainnya')).toBe(false);
  });
});
