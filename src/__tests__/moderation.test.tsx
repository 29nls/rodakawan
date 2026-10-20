import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ModerationScreen from '@/app/moderation';
import {
  loadModerationAudit,
  loadModerationQueue,
  removeReportedContent,
  reviewReport,
  type ModerationQueueItem,
} from '@/features/moderation/queue';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true) },
}));

// `backend` harus stabil antar-render: layar memakainya sebagai dependency effect.
jest.mock('@/features/auth/session', () => {
  const backend = { available: true, client: {} };

  return {
    useAuthSession: () => ({ backend, userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  };
});

jest.mock('@/features/moderation/queue', () => ({
  ...jest.requireActual('@/features/moderation/queue'),
  loadModerationQueue: jest.fn(),
  loadModerationAudit: jest.fn(),
  removeReportedContent: jest.fn(),
  reviewReport: jest.fn(),
}));

const mockedQueue = jest.mocked(loadModerationQueue);
const mockedAudit = jest.mocked(loadModerationAudit);
const mockedRemove = jest.mocked(removeReportedContent);
const mockedReview = jest.mocked(reviewReport);

const HAZARD_ITEM: ModerationQueueItem = {
  report: {
    id: 'repo-hazard',
    reporter_id: 'user-b',
    target_type: 'hazard',
    target_id: 'hazard-1',
    reason: 'unsafe_content',
    details: 'Menutup jalur evakuasi.',
    status: 'open',
    created_at: '2026-10-21T02:00:00.000Z',
    reviewed_at: null,
  },
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
  ride: { id: 'ride-1', title: 'Touring Malam' },
};

const CHAT_ITEM: ModerationQueueItem = {
  report: {
    id: 'repo-chat',
    reporter_id: 'user-b',
    target_type: 'chat_message',
    target_id: 'message-1',
    reason: 'harassment',
    details: null,
    status: 'open',
    created_at: '2026-10-21T03:00:00.000Z',
    reviewed_at: null,
  },
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
  ride: { id: 'ride-1', title: 'Touring Malam' },
};

const PEOPLE = { 'user-b': 'Rider B', 'user-c': '@rider_c' };

describe('ModerationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedQueue.mockResolvedValue({
      ok: true,
      data: { items: [HAZARD_ITEM, CHAT_ITEM], people: PEOPLE },
    });
    mockedAudit.mockResolvedValue({
      ok: true,
      data: {
        actions: [
          {
            id: 'audit-1',
            actor_id: 'user-b',
            target_type: 'chat_message',
            target_id: 'message-0',
            action: 'remove',
            reason: 'harassment',
            note: 'Pesan kasar berulang.',
            created_at: '2026-10-21T01:00:00.000Z',
          },
        ],
        people: { 'user-b': 'Rider B' },
      },
    });
    mockedReview.mockResolvedValue({ ok: true, data: {} as never });
    mockedRemove.mockResolvedValue({
      ok: true,
      data: { contentRemoved: true, report: {} as never },
    });
  });

  it('menampilkan isi laporan, penulis, dan perjalanan terkait', async () => {
    await render(<ModerationScreen />);

    expect(await screen.findByTestId('moderation-item-repo-hazard')).toBeTruthy();
    expect(screen.getByText(/Lubang besar di lajur kanan\./)).toBeTruthy();
    expect(screen.getAllByText(/Pesan kasar berulang\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Touring Malam/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Dilaporkan oleh Rider B/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pelecehan atau ancaman/).length).toBeGreaterThan(0);
    expect(mockedQueue).toHaveBeenCalledWith(expect.anything());
  });

  it('menampilkan jejak aksi moderasi yang tercatat', async () => {
    await render(<ModerationScreen />);

    expect(await screen.findByTestId('moderation-audit-audit-1')).toBeTruthy();
    expect(screen.getByText('Konten dihapus')).toBeTruthy();
    expect(screen.getByText(/Catatan: Pesan kasar berulang\./)).toBeTruthy();
  });

  it('menampilkan keadaan kosong yang menjelaskan cakupan wewenang', async () => {
    mockedQueue.mockResolvedValue({ ok: true, data: { items: [], people: {} } });

    await render(<ModerationScreen />);

    expect(await screen.findByTestId('moderation-empty')).toBeTruthy();
    expect(screen.queryByTestId('moderation-item-repo-hazard')).toBeNull();
  });

  it('menampilkan galat antrean dengan tombol coba lagi yang memuat ulang', async () => {
    mockedQueue.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'not_authorized',
        message: 'Sesi Anda sudah berakhir.',
        retryable: false,
      },
    });

    await render(<ModerationScreen />);

    expect(await screen.findByText('Antrean gagal dimuat')).toBeTruthy();
    expect(screen.getByText('Sesi Anda sudah berakhir.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Coba lagi'));

    await waitFor(() => {
      expect(mockedQueue).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByTestId('moderation-item-repo-chat')).toBeTruthy();
  });

  it('menutup laporan sebagai diabaikan tanpa memanggil penghapusan konten', async () => {
    await render(<ModerationScreen />);

    await fireEvent.press(await screen.findByTestId('moderation-dismiss-repo-chat'));

    await waitFor(() => {
      expect(mockedReview).toHaveBeenCalledWith(expect.anything(), 'repo-chat', 'dismissed');
    });
    expect(mockedRemove).not.toHaveBeenCalled();
    expect(await screen.findByTestId('moderation-notice')).toBeTruthy();
  });

  it('menghapus konten hanya setelah dialog konfirmasi destruktif', async () => {
    const alert = jest.spyOn(Alert, 'alert');

    await render(<ModerationScreen />);
    await fireEvent.press(await screen.findByTestId('moderation-remove-repo-hazard'));

    expect(alert).toHaveBeenCalledTimes(1);
    expect(mockedRemove).not.toHaveBeenCalled();

    const destructive = alert.mock.calls[0]?.[2]?.find((button) => button.style === 'destructive');
    expect(destructive?.text).toBe('Hapus');

    await act(async () => {
      destructive?.onPress?.();
    });

    await waitFor(() => {
      expect(mockedRemove).toHaveBeenCalledTimes(1);
    });
    expect(mockedRemove).toHaveBeenCalledWith(expect.anything(), HAZARD_ITEM, 'unsafe_content');
    expect(await screen.findByTestId('moderation-notice')).toBeTruthy();

    alert.mockRestore();
  });

  it('memakai alasan laporan sebagai alasan audit saat menghapus', async () => {
    const alert = jest.spyOn(Alert, 'alert');

    await render(<ModerationScreen />);
    await fireEvent.press(await screen.findByTestId('moderation-remove-repo-chat'));

    expect(String(alert.mock.calls[0]?.[1])).toContain('Pelecehan atau ancaman');

    const destructive = alert.mock.calls[0]?.[2]?.find((button) => button.style === 'destructive');

    await act(async () => {
      destructive?.onPress?.();
    });

    await waitFor(() => {
      expect(mockedRemove).toHaveBeenCalledWith(expect.anything(), CHAT_ITEM, 'harassment');
    });

    alert.mockRestore();
  });

  it('melaporkan kegagalan aksi tanpa menampilkan pesan berhasil', async () => {
    mockedReview.mockResolvedValue({
      ok: false,
      error: {
        code: 'conflict',
        message: 'Laporan ini sudah ditinjau sebelumnya.',
        retryable: false,
      },
    });

    await render(<ModerationScreen />);
    await fireEvent.press(await screen.findByTestId('moderation-review-repo-hazard'));

    expect(await screen.findByText('Laporan ini sudah ditinjau sebelumnya.')).toBeTruthy();
    expect(screen.queryByTestId('moderation-notice')).toBeNull();
  });
});
