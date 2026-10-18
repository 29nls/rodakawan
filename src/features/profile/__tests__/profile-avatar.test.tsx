import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import { deleteProfileAvatar, uploadProfileAvatar } from '@/features/media/photos';
import { pickPhoto } from '@/features/media/picker';
import { useProfile } from '@/features/profile/useProfile';
import { buildProfileRow } from '@/test-support/fakeSupabase';

jest.mock('expo-router', () => {
  // `LinkRow` memakai `<Link asChild>`; komponen tiruan cukup meneruskan anaknya.
  const Link = ({ children }: { children: unknown }) => children;

  return {
    Link,
    useRouter: () => ({ push: jest.fn() }),
  };
});

// `backend` harus stabil antar-render: layar memakainya sebagai dependency effect,
// dan objek baru setiap render akan memicu loop muat ulang tanpa henti.
jest.mock('@/features/auth/session', () => {
  const backend = { available: true, client: {} };

  return {
    useAuthSession: () => ({
      backend,
      userId: '11111111-1111-1111-1111-111111111111',
      email: 'uji@contoh.test',
      requestedUsername: null,
      signOut: jest.fn(),
    }),
  };
});

jest.mock('@/features/profile/useProfile', () => ({ useProfile: jest.fn() }));

jest.mock('@/features/media/picker', () => ({ pickPhoto: jest.fn() }));

jest.mock('@/features/media/photos', () => ({
  PROFILE_AVATAR_BUCKET: 'avatars',
  deleteProfileAvatar: jest.fn(),
  getPhotoSignedUrl: jest.fn(async () => ({
    ok: false,
    error: { code: 'unknown', message: 'preview gagal', retryable: true },
  })),
  uploadProfileAvatar: jest.fn(),
}));

const USER_ID = '11111111-1111-1111-1111-111111111111';

const mockedUseProfile = jest.mocked(useProfile);
const mockedPickPhoto = jest.mocked(pickPhoto);
const mockedUpload = jest.mocked(uploadProfileAvatar);
const mockedDelete = jest.mocked(deleteProfileAvatar);

const asset = {
  uri: 'file:///galeri/avatar.jpg',
  mimeType: 'image/jpeg',
  fileSize: 200 * 1024,
  fileName: 'avatar.jpg',
};

describe('foto profil di tab Profil', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseProfile.mockReturnValue({
      state: { status: 'ready', profile: buildProfileRow({ avatar_url: null }) },
      reload: jest.fn(),
    });
    mockedPickPhoto.mockResolvedValue({ ok: true, asset });
    mockedUpload.mockResolvedValue({ ok: true, data: { path: `${USER_ID}/baru.jpg` } });
    mockedDelete.mockResolvedValue({ ok: true, data: { deleted: true } });
  });

  it('mengunggah avatar dengan userId dari sesi dan menampilkan konfirmasi', async () => {
    await render(<ProfileScreen />);

    await fireEvent.press(await screen.findByTestId('profile-avatar-pick'));

    await waitFor(() => {
      expect(mockedUpload).toHaveBeenCalledTimes(1);
    });

    expect(mockedPickPhoto).toHaveBeenCalledWith('avatar');
    expect(mockedUpload).toHaveBeenCalledWith(expect.anything(), USER_ID, asset);
    expect(await screen.findByText(/Foto profil diperbarui/)).toBeTruthy();
  });

  it('tidak memanggil backend bila pengguna membatalkan pemilih foto', async () => {
    mockedPickPhoto.mockResolvedValue({ ok: true, asset: null });

    await render(<ProfileScreen />);
    await fireEvent.press(await screen.findByTestId('profile-avatar-pick'));

    expect(mockedPickPhoto).toHaveBeenCalledTimes(1);
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('menampilkan pesan yang bisa ditindaklanjuti bila galeri ditolak', async () => {
    mockedPickPhoto.mockResolvedValue({
      ok: false,
      error: {
        code: 'not_authorized',
        message: 'Akses galeri belum diberikan.',
        retryable: false,
      },
    });

    await render(<ProfileScreen />);
    await fireEvent.press(await screen.findByTestId('profile-avatar-pick'));

    expect(await screen.findByText('Akses galeri belum diberikan.')).toBeTruthy();
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('menghapus avatar hanya setelah pengguna mengonfirmasi dialog destruktif', async () => {
    mockedUseProfile.mockReturnValue({
      state: {
        status: 'ready',
        profile: buildProfileRow({ avatar_url: `${USER_ID}/lama.jpg` }),
      },
      reload: jest.fn(),
    });
    const alert = jest.spyOn(Alert, 'alert');

    await render(<ProfileScreen />);
    await fireEvent.press(await screen.findByTestId('profile-avatar-remove'));

    expect(alert).toHaveBeenCalledTimes(1);
    expect(mockedDelete).not.toHaveBeenCalled();

    const destructive = alert.mock.calls[0]?.[2]?.find((button) => button.style === 'destructive');
    expect(destructive?.text).toBe('Hapus');

    await act(async () => {
      destructive?.onPress?.();
    });

    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledWith(expect.anything(), USER_ID);
    });
    expect(await screen.findByText('Foto profil dihapus.')).toBeTruthy();

    alert.mockRestore();
  });

  it('melaporkan kegagalan unggah tanpa menyembunyikannya sebagai sukses', async () => {
    mockedUpload.mockResolvedValue({
      ok: false,
      error: {
        code: 'not_authorized',
        message: 'Unggahan ditolak aturan penyimpanan.',
        retryable: false,
      },
    });

    await render(<ProfileScreen />);
    await fireEvent.press(await screen.findByTestId('profile-avatar-pick'));

    expect(await screen.findByText('Unggahan ditolak aturan penyimpanan.')).toBeTruthy();
    expect(screen.queryByText(/Foto profil diperbarui/)).toBeNull();
  });
});
