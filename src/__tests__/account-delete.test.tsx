import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AccountDeleteScreen from '@/app/account-delete';
import { deleteMyAccount } from '@/features/account/api';

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
      deleted_at: null,
      created_at: '2026-10-22T00:00:00Z',
      updated_at: '2026-10-22T00:00:00Z',
    },
  };

  return { useProfile: () => ({ reload: mockReload, state }) };
});

jest.mock('@/features/account/api', () => ({
  deleteMyAccount: jest.fn(),
}));

const mockedDelete = jest.mocked(deleteMyAccount);

beforeEach(() => {
  mockedDelete.mockReset();
  mockSignOut.mockClear();
  mockReplace.mockClear();
  mockReload.mockClear();
  mockedDelete.mockResolvedValue({
    ok: true,
    data: { status: 'completed', alreadyCompleted: false },
  });
});

async function confirmAndSubmit() {
  await fireEvent.changeText(screen.getByTestId('account-delete-confirm'), 'rider_a');
  await waitFor(() => {
    expect(screen.getByTestId('account-delete-submit')).toBeEnabled();
  });
  await fireEvent.press(screen.getByTestId('account-delete-submit'));
}

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

  it('memanggil server sekali, menampilkan konfirmasi penuh, lalu keluar dan mengalihkan', async () => {
    await render(<AccountDeleteScreen />);
    await confirmAndSubmit();

    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByTestId('account-delete-notice')).toBeTruthy();
    expect(screen.getByText(/identitas login sudah dihapus/)).toBeTruthy();

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/sign-in');
    });
  });

  it('menampilkan galat server dan tidak mengeluarkan pengguna bila server belum selesai', async () => {
    mockedDelete.mockResolvedValue({
      ok: false,
      error: {
        code: 'deletion_incomplete',
        message:
          'Penghapusan belum selesai sepenuhnya. Coba lagi; bila tetap gagal, hubungi dukungan sebelum menganggap akun sudah hilang.',
        retryable: true,
      },
    });

    await render(<AccountDeleteScreen />);
    await confirmAndSubmit();

    expect(await screen.findByTestId('account-delete-error')).toBeTruthy();
    expect(screen.getByText(/belum selesai sepenuhnya/)).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    // Tombol kembali aktif supaya pengguna dapat mengulang langkah yang gagal.
    await waitFor(() => {
      expect(screen.getByTestId('account-delete-submit')).toBeEnabled();
    });
  });

  it('tidak memalsukan sukses ketika sesi sudah berakhir', async () => {
    mockedDelete.mockResolvedValue({
      ok: false,
      error: {
        code: 'session_expired',
        message: 'Sesi Anda sudah berakhir. Masuk kembali, lalu ulangi permintaan hapus akun.',
        retryable: false,
      },
    });

    await render(<AccountDeleteScreen />);
    await confirmAndSubmit();

    expect(await screen.findByTestId('account-delete-error')).toBeTruthy();
    expect(screen.queryByTestId('account-delete-notice')).toBeNull();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
