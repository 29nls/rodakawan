import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AccountDeleteScreen from '@/app/account-delete';
import { collectOwnMedia, deleteMyAccount, removeOwnMedia } from '@/features/account/api';

const mockReplace = jest.fn();
const mockSignOut = jest.fn(async () => ({ ok: true as const, data: { revokedRemotely: true } }));
const mockReload = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useRouter: () => ({ replace: mockReplace }),
}));

// `backend` harus stabil antar-render: layar memakainya sebagai dependency.
jest.mock('@/features/auth/session', () => {
  const backend = { available: true, client: {} };

  return {
    useAuthSession: () => ({ backend, userId: 'u1', signOut: mockSignOut }),
  };
});

jest.mock('@/features/profile/useProfile', () => {
  const state = {
    status: 'ready',
    profile: {
      id: 'u1',
      username: 'rider_a',
      display_name: 'Rider A',
      avatar_url: null,
      bio: null,
      city: null,
      is_private: false,
      created_at: '2026-10-22T00:00:00Z',
      updated_at: '2026-10-22T00:00:00Z',
    },
  };

  return { useProfile: () => ({ reload: mockReload, state }) };
});

jest.mock('@/features/account/api', () => ({
  ...jest.requireActual('@/features/account/api'),
  collectOwnMedia: jest.fn(),
  removeOwnMedia: jest.fn(),
  deleteMyAccount: jest.fn(),
}));

const mockedCollect = jest.mocked(collectOwnMedia);
const mockedRemove = jest.mocked(removeOwnMedia);
const mockedDelete = jest.mocked(deleteMyAccount);

beforeEach(() => {
  mockedCollect.mockReset();
  mockedRemove.mockReset();
  mockedDelete.mockReset();
  mockSignOut.mockClear();
  mockReplace.mockClear();
  mockedCollect.mockResolvedValue([{ bucket: 'avatars', path: 'u1/avatar.jpg' }]);
  mockedRemove.mockResolvedValue({ removed: 1, failed: 0 });
  mockedDelete.mockResolvedValue({ ok: true, data: null });
});

describe('AccountDeleteScreen', () => {
  it('menjelaskan konsekuensi dan menonaktifkan tombol sampai username diketik benar', async () => {
    await render(<AccountDeleteScreen />);

    expect(screen.getByText(/Apa yang terjadi/)).toBeTruthy();
    expect(screen.getByTestId('account-delete-submit')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('account-delete-confirm'), 'salah');
    expect(screen.getByTestId('account-delete-submit')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('account-delete-confirm'), 'RIDER_A');
    await waitFor(() => {
      expect(screen.getByTestId('account-delete-submit')).toBeEnabled();
    });
  });

  it('menghapus media lebih dulu, memanggil RPC, lalu keluar dan mengalihkan ke halaman masuk', async () => {
    await render(<AccountDeleteScreen />);

    await fireEvent.changeText(screen.getByTestId('account-delete-confirm'), 'rider_a');
    await waitFor(() => {
      expect(screen.getByTestId('account-delete-submit')).toBeEnabled();
    });
    await fireEvent.press(screen.getByTestId('account-delete-submit'));

    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByTestId('account-delete-notice')).toBeTruthy();

    const collectOrder = mockedCollect.mock.invocationCallOrder[0];
    const removeOrder = mockedRemove.mock.invocationCallOrder[0];
    const deleteOrder = mockedDelete.mock.invocationCallOrder[0];

    expect(collectOrder).toBeLessThan(removeOrder);
    expect(removeOrder).toBeLessThan(deleteOrder);
    expect(mockedRemove).toHaveBeenCalledWith(expect.anything(), [
      { bucket: 'avatars', path: 'u1/avatar.jpg' },
    ]);
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/sign-in');
    });
  });

  it('menampilkan galat server dan tidak mengeluarkan pengguna bila RPC gagal', async () => {
    mockedDelete.mockResolvedValue({
      ok: false,
      error: {
        code: 'session_expired',
        message: 'Sesi Anda sudah berakhir. Masuk kembali, lalu ulangi permintaan hapus akun.',
        retryable: false,
      },
    });

    await render(<AccountDeleteScreen />);

    await fireEvent.changeText(screen.getByTestId('account-delete-confirm'), 'rider_a');
    await waitFor(() => {
      expect(screen.getByTestId('account-delete-submit')).toBeEnabled();
    });
    await fireEvent.press(screen.getByTestId('account-delete-submit'));

    expect(await screen.findByTestId('account-delete-error')).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('tidak memalsukan sukses ketika sebagian objek Storage gagal dihapus', async () => {
    mockedRemove.mockResolvedValue({ removed: 0, failed: 1 });

    await render(<AccountDeleteScreen />);

    await fireEvent.changeText(screen.getByTestId('account-delete-confirm'), 'rider_a');
    await waitFor(() => {
      expect(screen.getByTestId('account-delete-submit')).toBeEnabled();
    });
    await fireEvent.press(screen.getByTestId('account-delete-submit'));

    const notice = await screen.findByTestId('account-delete-notice');
    expect(notice).toBeTruthy();
    expect(screen.getByText(/tidak dapat dihapus otomatis/)).toBeTruthy();
    expect(mockedDelete).toHaveBeenCalledTimes(1);
  });
});
