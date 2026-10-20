import {
  canEditChatMessage,
  chatAcceptsNewMessages,
  CHAT_EDIT_WINDOW_MS,
  deleteChatMessage,
  editChatMessage,
  getChatMessages,
  MAX_CHAT_CONTENT_LENGTH,
  mergeChatMessages,
  reportChatMessage,
  sendChatMessage,
  subscribeChatMessages,
  validateChatContent,
  type ChatMessageRow,
} from '@/features/chat/api';
import { createFakeChatClient } from '@/test-support/fakeChatClient';

/**
 * Pengujian lapisan chat konvoi.
 *
 * Yang dibuktikan: validasi trim sebelum memanggil backend, kontrak argumen RPC,
 * idempotensi retry (`clientMessageId` sama), keyset pagination, dedupe realtime,
 * kebijakan edit/hapus, dan pelaporan penyalahgunaan lewat `report_content` —
 * bukan INSERT langsung. Penyaringan pengguna yang diblokir **tidak** diuji di
 * sini: itu tanggung jawab policy `chat_select_ride_member` (ADR-068) dan diuji
 * di `supabase/tests/rls_blocked_chat_test.sql`.
 */

const RIDE_ID = 'ride-1';
const USER_ID = 'user-1';

function buildRow(overrides: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: 'msg-1',
    ride_id: RIDE_ID,
    sender_id: USER_ID,
    message_type: 'text',
    content: 'Halo konvoi',
    created_at: '2026-10-20T10:00:00.000Z',
    edited_at: null,
    deleted_at: null,
    client_message_id: null,
    ...overrides,
  };
}

describe('validateChatContent', () => {
  it('membuang spasi di awal/akhir dan menerima isi yang sah', () => {
    const result = validateChatContent('  siap berangkat  ');

    expect(result).toEqual({ ok: true, data: 'siap berangkat' });
  });

  it('menolak pesan kosong atau hanya spasi tanpa memanggil backend', () => {
    const { client, rpcCalls } = createFakeChatClient();

    expect(validateChatContent('   ').ok).toBe(false);

    return sendChatMessage(client, {
      rideId: RIDE_ID,
      content: '    ',
      clientMessageId: 'client-1',
    }).then((result) => {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('chat_trim_invalid');
      expect(rpcCalls).toHaveLength(0);
    });
  });

  it('menerima tepat 2000 karakter dan menolak 2001 karakter', () => {
    expect(validateChatContent('a'.repeat(MAX_CHAT_CONTENT_LENGTH)).ok).toBe(true);

    const tooLong = validateChatContent('a'.repeat(MAX_CHAT_CONTENT_LENGTH + 1));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.error.code).toBe('chat_trim_invalid');
      expect(tooLong.error.message).toContain('2000');
    }
  });
});

describe('sendChatMessage', () => {
  it('mengirim isi yang sudah ditrim bersama client_message_id', async () => {
    const { client, rpcCalls } = createFakeChatClient({
      rpc: () => ({ data: buildRow({ content: 'Halo konvoi' }), error: null }),
    });

    const result = await sendChatMessage(client, {
      rideId: RIDE_ID,
      content: '  Halo konvoi  ',
      clientMessageId: 'client-abc',
    });

    expect(result.ok).toBe(true);
    expect(rpcCalls).toEqual([
      {
        name: 'send_chat_message',
        args: {
          p_ride_id: RIDE_ID,
          p_content: 'Halo konvoi',
          p_client_message_id: 'client-abc',
        },
      },
    ]);
  });

  it('retry memakai clientMessageId yang sama sehingga server tidak menggandakan pesan', async () => {
    const { client, rpcCalls } = createFakeChatClient({
      rpc: () => ({ data: buildRow(), error: null }),
    });

    await sendChatMessage(client, {
      rideId: RIDE_ID,
      content: 'Halo',
      clientMessageId: 'client-same',
    });
    await sendChatMessage(client, {
      rideId: RIDE_ID,
      content: 'Halo',
      clientMessageId: 'client-same',
    });

    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0].args.p_client_message_id).toBe('client-same');
    expect(rpcCalls[1].args.p_client_message_id).toBe('client-same');
  });

  it('menerjemahkan batas laju server menjadi error yang bisa dicoba ulang', async () => {
    const { client } = createFakeChatClient({
      rpc: () => ({ data: null, error: { detail: 'chat_rate_limit', code: 'P0001' } }),
    });

    const result = await sendChatMessage(client, {
      rideId: RIDE_ID,
      content: 'Halo',
      clientMessageId: 'client-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('chat_rate_limit');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('menampilkan penolakan non-anggota sebagai pesan yang menjelaskan tindakan', async () => {
    const { client } = createFakeChatClient({
      rpc: () => ({ data: null, error: { detail: 'chat_not_member', code: '42501' } }),
    });

    const result = await sendChatMessage(client, {
      rideId: RIDE_ID,
      content: 'Halo',
      clientMessageId: 'client-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('chat_not_member');
      expect(result.error.message).toContain('peserta aktif');
    }
  });

  it('melaporkan kegagalan jaringan sebagai error yang bisa dicoba ulang', async () => {
    const client = {
      rpc: () => Promise.reject(new Error('Network request failed')),
    } as never;

    const result = await sendChatMessage(client, {
      rideId: RIDE_ID,
      content: 'Halo',
      clientMessageId: 'client-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe('getChatMessages', () => {
  it('mengambil pesan terbaru lalu mengembalikannya urut lama → baru', async () => {
    const newest = buildRow({ id: 'msg-2', created_at: '2026-10-20T10:05:00.000Z' });
    const oldest = buildRow({ id: 'msg-1', created_at: '2026-10-20T10:00:00.000Z' });
    const { client, queryCalls } = createFakeChatClient({
      rows: { chat_messages: [newest, oldest] },
    });

    const result = await getChatMessages(client, RIDE_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2']);
      expect(result.data.hasMore).toBe(false);
    }
    expect(queryCalls[0].table).toBe('chat_messages');
    expect(queryCalls[0].filters).toContainEqual({ column: 'ride_id', value: RIDE_ID });
  });

  it('memakai keyset sebelum cursor, bukan offset', async () => {
    const { client, queryCalls } = createFakeChatClient({
      rows: { chat_messages: [buildRow()] },
    });

    const cursor = { id: 'msg-9', created_at: '2026-10-20T09:00:00.000Z' };
    await getChatMessages(client, RIDE_ID, { before: cursor, limit: 50 });

    const orFilter = queryCalls[0].filters.find((filter) => filter.column === 'or');
    expect(typeof orFilter?.value).toBe('string');
    expect(orFilter?.value).toContain('created_at.lt');
    expect(orFilter?.value).toContain('id.lt');
    expect(orFilter?.value).toContain(cursor.id);
  });

  it('menandai masih ada halaman lebih lama ketika server mengembalikan limit + 1 baris', async () => {
    const rows = [1, 2, 3].map((index) =>
      buildRow({
        id: `msg-${index}`,
        created_at: `2026-10-20T10:0${index}:00.000Z`,
      }),
    );
    const { client } = createFakeChatClient({ rows: { chat_messages: rows } });

    const result = await getChatMessages(client, RIDE_ID, { limit: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.hasMore).toBe(true);
      expect(result.data.messages).toHaveLength(2);
    }
  });

  it('tidak pernah mengirim isi pesan yang sudah dihapus ke UI', async () => {
    const { client } = createFakeChatClient({
      rows: {
        chat_messages: [
          buildRow({
            deleted_at: '2026-10-20T10:06:00.000Z',
            content: 'isi rahasia',
          }),
        ],
      },
    });

    const result = await getChatMessages(client, RIDE_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.messages[0].deleted).toBe(true);
      expect(result.data.messages[0].content).toBe('');
    }
  });
});

describe('mergeChatMessages', () => {
  it('mendeduplikasi per id server dan menjaga urutan lama → baru', () => {
    const first = buildRow({ id: 'a', created_at: '2026-10-20T10:00:00.000Z' });
    const second = buildRow({ id: 'b', created_at: '2026-10-20T10:01:00.000Z' });

    const merged = mergeChatMessages([], [second, first, first]);

    expect(merged.map((message) => message.id)).toEqual(['a', 'b']);
  });

  it('baris realtime yang lebih lama tidak menurunkan versi hasil edit lokal', () => {
    const editedLocal = {
      ...buildRow({ edited_at: '2026-10-20T10:02:00.000Z', content: 'versi baru' }),
      deleted: false,
    };

    const merged = mergeChatMessages([editedLocal], [buildRow({ content: 'versi lama' })]);

    expect(merged[0].content).toBe('versi baru');
    expect(merged[0].edited_at).toBe('2026-10-20T10:02:00.000Z');
  });
});

describe('kebijakan edit dan hapus', () => {
  const now = Date.parse('2026-10-20T10:10:00.000Z');

  it('mengizinkan pengirim mengubah pesan teks di dalam 15 menit', () => {
    expect(canEditChatMessage(buildRow(), USER_ID, now)).toBe(true);
  });

  it('menolak perubahan setelah jendela 15 menit', () => {
    const late = buildRow({
      created_at: new Date(now - CHAT_EDIT_WINDOW_MS - 1000).toISOString(),
    });

    expect(canEditChatMessage(late, USER_ID, now)).toBe(false);
  });

  it('menolak perubahan pesan orang lain, pesan sistem, dan pesan terhapus', () => {
    expect(canEditChatMessage(buildRow({ sender_id: 'user-2' }), USER_ID, now)).toBe(false);
    expect(canEditChatMessage(buildRow({ message_type: 'system' }), USER_ID, now)).toBe(false);
    expect(
      canEditChatMessage(buildRow({ deleted_at: '2026-10-20T10:05:00.000Z' }), USER_ID, now),
    ).toBe(false);
  });

  it('tidak mengirim pesan baru ke perjalanan final', () => {
    expect(chatAcceptsNewMessages('planned')).toBe(true);
    expect(chatAcceptsNewMessages('active')).toBe(true);
    expect(chatAcceptsNewMessages('completed')).toBe(false);
    expect(chatAcceptsNewMessages('cancelled')).toBe(false);
  });

  it('menghapus pesan lewat RPC dan mengosongkan isinya', async () => {
    const { client, rpcCalls } = createFakeChatClient({
      rpc: () => ({
        data: buildRow({ deleted_at: '2026-10-20T10:05:00.000Z' }),
        error: null,
      }),
    });

    const result = await deleteChatMessage(client, 'msg-1');

    expect(rpcCalls[0]).toEqual({ name: 'delete_chat_message', args: { p_message_id: 'msg-1' } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.content).toBe('');
      expect(result.data.deleted).toBe(true);
    }
  });

  it('mengubah pesan lewat RPC edit_chat_message', async () => {
    const { client, rpcCalls } = createFakeChatClient({
      rpc: () => ({ data: buildRow({ content: 'koreksi', edited_at: 'x' }), error: null }),
    });

    await editChatMessage(client, { messageId: 'msg-1', content: ' koreksi ' });

    expect(rpcCalls[0]).toEqual({
      name: 'edit_chat_message',
      args: { p_message_id: 'msg-1', p_content: 'koreksi' },
    });
  });
});

describe('realtime', () => {
  it('berlangganan Postgres Changes per perjalanan dan meneruskan insert/update/delete', () => {
    const { client, channels, removedChannels } = createFakeChatClient();
    const onInsert = jest.fn();
    const onUpdate = jest.fn();
    const onDelete = jest.fn();
    const onStatus = jest.fn();

    const subscription = subscribeChatMessages(client, RIDE_ID, {
      onInsert,
      onUpdate,
      onDelete,
      onStatus,
    });

    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe(`ride-chat:${RIDE_ID}`);
    expect(channels[0].calls.map((call) => call.config.event)).toEqual([
      'INSERT',
      'UPDATE',
      'DELETE',
    ]);
    for (const call of channels[0].calls) {
      expect(call.event).toBe('postgres_changes');
      expect(call.config).toEqual({
        event: call.config.event,
        schema: 'public',
        table: 'chat_messages',
        filter: `ride_id=eq.${RIDE_ID}`,
      });
    }
    expect(onStatus).toHaveBeenCalledWith('SUBSCRIBED');

    channels[0].emit({ new: buildRow({ id: 'live-1' }) }, 'INSERT');
    channels[0].emit({ new: buildRow({ id: 'live-1', content: 'edit' }) }, 'UPDATE');
    channels[0].emit({ old: { id: 'live-1' } }, 'DELETE');

    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'live-1' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ content: 'edit' }));
    expect(onDelete).toHaveBeenCalledWith('live-1');

    subscription.unsubscribe();
    expect(removedChannels).toEqual([`ride-chat:${RIDE_ID}`]);
  });

  it('mengabaikan baris realtime untuk perjalanan lain', () => {
    const { client, channels } = createFakeChatClient();
    const onInsert = jest.fn();

    subscribeChatMessages(client, RIDE_ID, { onInsert });
    channels[0].emit({ new: buildRow({ ride_id: 'ride-lain' }) }, 'INSERT');

    expect(onInsert).not.toHaveBeenCalled();
  });
});

describe('reportChatMessage', () => {
  it('memakai RPC report_content untuk pesan chat, bukan INSERT langsung', async () => {
    const { client, rpcCalls } = createFakeChatClient({
      rpc: () => ({
        data: {
          id: 'report-1',
          reporter_id: USER_ID,
          target_type: 'chat_message',
          target_id: 'msg-1',
          reason: 'spam',
          details: null,
          status: 'open',
          created_at: '2026-10-20T10:00:00.000Z',
        },
        error: null,
      }),
    });

    const result = await reportChatMessage(client, 'msg-1', 'harassment', '  kasar  ');

    expect(result.ok).toBe(true);
    expect(rpcCalls[0]).toEqual({
      name: 'report_content',
      args: {
        p_target_type: 'chat_message',
        p_target_id: 'msg-1',
        p_reason: 'harassment',
        p_details: 'kasar',
      },
    });
  });

  it('melaporkan penolakan server sebagai error, bukan sukses palsu', async () => {
    const { client } = createFakeChatClient({
      rpc: () => ({ data: null, error: { detail: 'report_target_not_found' } }),
    });

    const result = await reportChatMessage(client, 'msg-hilang', 'spam');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });
});
