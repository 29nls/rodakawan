import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ChatPanel } from '@/features/chat/ChatPanel';
import type { ChatMessageRow } from '@/features/chat/api';
import { createFakeChatClient } from '@/test-support/fakeChatClient';

/**
 * Pengujian panel chat konvoi.
 *
 * Fokusnya adalah janji ke pengguna: pesan baru tidak pernah tampil "terkirim"
 * sebelum server mengonfirmasi, pemberitahuan gagal bisa dicoba ulang dengan
 * `clientMessageId` yang sama, isi pesan terhapus tidak muncul, dan peserta yang
 * bukan anggota aktif tidak melihat kolom kirim sama sekali.
 */

const RIDE_ID = 'ride-1';
const ME = 'user-1';
const OTHER = 'user-2';

function buildRow(overrides: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: 'msg-1',
    ride_id: RIDE_ID,
    sender_id: OTHER,
    message_type: 'text',
    content: 'Halo dari peserta lain',
    created_at: '2026-10-20T10:00:00.000Z',
    edited_at: null,
    deleted_at: null,
    client_message_id: null,
    ...overrides,
  };
}

async function renderPanel(
  options: {
    rows?: Record<string, unknown[]>;
    rpc?: (call: {
      name: string;
      args: Record<string, unknown>;
    }) => { data?: unknown; error?: unknown } | Promise<{ data?: unknown; error?: unknown }>;
    isActiveMember?: boolean;
    rideStatus?: string;
  } = {},
) {
  const fake = createFakeChatClient({ rows: options.rows, rpc: options.rpc });
  let counter = 0;

  await render(
    <ChatPanel
      client={fake.client}
      createClientId={() => {
        counter += 1;
        return `client-${counter}`;
      }}
      isActiveMember={options.isActiveMember ?? true}
      now={() => Date.parse('2026-10-20T10:05:00.000Z')}
      rideId={RIDE_ID}
      rideStatus={options.rideStatus ?? 'active'}
      senderNames={{ [OTHER]: 'Budi' }}
      userId={ME}
    />,
  );

  return fake;
}

describe('ChatPanel', () => {
  it('tidak menampilkan kolom kirim untuk peserta yang bukan anggota aktif', async () => {
    await renderPanel({ isActiveMember: false });

    expect(screen.getByText('Chat terkunci untuk non-peserta')).toBeTruthy();
    expect(screen.queryByLabelText('Pesan baru')).toBeNull();
  });

  it('memuat riwayat, menampilkan nama pengirim, dan pesan sistem', async () => {
    await renderPanel({
      rows: {
        chat_messages: [
          buildRow({
            id: 'sys-1',
            message_type: 'system',
            sender_id: ME,
            content: 'Perjalanan dimulai',
          }),
          buildRow({ id: 'msg-1', content: 'Halo dari peserta lain' }),
        ],
      },
    });

    expect(await screen.findByText('Halo dari peserta lain')).toBeTruthy();
    expect(screen.getByText('Budi', { exact: false })).toBeTruthy();
    expect(screen.getByText('Perjalanan dimulai', { exact: false })).toBeTruthy();
  });

  it('mengirim pesan dengan menampilkan "Mengirim…" lalu "terkirim" hanya setelah server menjawab', async () => {
    const confirmed = buildRow({
      id: 'msg-new',
      sender_id: ME,
      content: 'Siap, saya di belakang',
    });
    let resolveSend: (value: { data: unknown; error: unknown }) => void = () => undefined;
    const fake = await renderPanel({
      rows: { chat_messages: [] },
      rpc: (call) => {
        if (call.name !== 'send_chat_message') return { data: null, error: null };
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      },
    });

    await fireEvent.changeText(screen.getByLabelText('Pesan baru'), '  Siap, saya di belakang  ');
    // Jangan di-await: pengiriman sengaja masih menggantung sampai server menjawab.
    const press = fireEvent.press(screen.getByText('Kirim'));

    expect((await screen.findAllByText('Mengirim…')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/terkirim/)).toBeNull();

    resolveSend({ data: confirmed, error: null });
    await press;

    await waitFor(() => expect(screen.getByText('Siap, saya di belakang')).toBeTruthy());
    expect(screen.queryByText('Mengirim…')).toBeNull();
    expect(screen.getByText(/terkirim/)).toBeTruthy();

    expect(fake.rpcCalls[0]).toEqual({
      name: 'send_chat_message',
      args: {
        p_ride_id: RIDE_ID,
        p_content: 'Siap, saya di belakang',
        p_client_message_id: 'client-1',
      },
    });
  });

  it('menandai pesan gagal dan mengirim ulang dengan client id yang sama', async () => {
    let attempt = 0;
    const fake = await renderPanel({
      rows: { chat_messages: [] },
      rpc: (call) => {
        if (call.name !== 'send_chat_message') return { data: null, error: null };
        attempt += 1;
        if (attempt === 1) return { data: null, error: { detail: 'chat_rate_limit' } };
        return { data: buildRow({ id: 'msg-ok', sender_id: ME, content: 'Halo' }), error: null };
      },
    });

    await fireEvent.changeText(screen.getByLabelText('Pesan baru'), 'Halo');
    await fireEvent.press(screen.getByText('Kirim'));

    expect(await screen.findByText('Belum terkirim')).toBeTruthy();
    expect(screen.getByText(/20 per 60 detik/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Kirim ulang'));

    await waitFor(() => expect(screen.getByText(/terkirim/)).toBeTruthy());
    expect(fake.rpcCalls).toHaveLength(2);
    expect(fake.rpcCalls[0].args.p_client_message_id).toBe('client-1');
    expect(fake.rpcCalls[1].args.p_client_message_id).toBe('client-1');
  });

  it('menolak pesan kosong tanpa memanggil backend', async () => {
    const fake = await renderPanel({ rows: { chat_messages: [] } });

    await fireEvent.changeText(screen.getByLabelText('Pesan baru'), '    ');
    await fireEvent.press(screen.getByText('Kirim'));

    expect(fake.rpcCalls).toHaveLength(0);
    expect(screen.queryByText('Mengirim…')).toBeNull();
  });

  it('menonaktifkan pengiriman saat perjalanan sudah final', async () => {
    await renderPanel({ rows: { chat_messages: [] }, rideStatus: 'completed' });

    expect(screen.getByText('Hanya baca')).toBeTruthy();
    expect(
      screen.getByText(/Perjalanan ini sudah selesai atau dibatalkan/, { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText('Kirim')).toBeTruthy();
    await fireEvent.press(screen.getByText('Kirim'));
    expect(screen.queryByText('Mengirim…')).toBeNull();
  });

  it('tidak menampilkan isi pesan yang sudah dihapus', async () => {
    await renderPanel({
      rows: {
        chat_messages: [
          buildRow({
            id: 'msg-del',
            sender_id: ME,
            content: 'isi yang harus hilang',
            deleted_at: '2026-10-20T10:02:00.000Z',
          }),
        ],
      },
    });

    expect(await screen.findByText('Pesan ini dihapus oleh pengirim.')).toBeTruthy();
    expect(screen.queryByText('isi yang harus hilang')).toBeNull();
  });

  it('tidak memuat daftar blokir di klien; pesan terblokir tidak pernah datang dari server', async () => {
    const fake = await renderPanel({ rows: { chat_messages: [buildRow()] } });

    expect(await screen.findByText('Halo dari peserta lain')).toBeTruthy();

    // Filter blokir milik policy `chat_select_ride_member` (ADR-068): panel tidak
    // boleh menanyakan `user_blocks` atau memutuskan sendiri pesan mana yang
    // disembunyikan, karena isinya sudah tidak dikirim server.
    expect(fake.queryCalls.some((call) => call.table === 'user_blocks')).toBe(false);
    expect(fake.queryCalls.every((call) => call.table === 'chat_messages')).toBe(true);
    expect(screen.queryByText(/Pesan disembunyikan/)).toBeNull();
  });

  it('menampilkan keadaan kosong yang menjelaskan langkah berikutnya', async () => {
    await renderPanel({ rows: { chat_messages: [] } });

    expect(await screen.findByText('Belum ada pesan')).toBeTruthy();
  });
});
