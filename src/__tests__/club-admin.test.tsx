import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ClubAdminScreen from '@/app/club-admin';
import { getClubDetails, listClubMembers, updateClub, type ClubDetail } from '@/features/clubs/api';
import type { ClubMemberRow, ClubRow } from '@/lib/supabase/database.types';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }),
}));

// `backend` harus stabil antar-render: layar memakainya sebagai dependency effect,
// dan objek baru setiap render akan memicu loop muat ulang tanpa henti.
jest.mock('@/features/auth/session', () => {
  const backend = { available: true, client: {} };

  return {
    useAuthSession: () => ({
      backend,
      userId: '11111111-1111-1111-1111-111111111111',
    }),
  };
});

jest.mock('@/features/clubs/api', () => ({
  getClubDetails: jest.fn(),
  listClubMembers: jest.fn(),
  updateClub: jest.fn(),
  removeClubMember: jest.fn(),
  reviewClubMembership: jest.fn(),
  setClubMemberRole: jest.fn(),
}));

jest.mock('@/features/media/photos', () => ({
  CLUB_LOGO_BUCKET: 'club-logos',
  deleteClubLogo: jest.fn(),
  getPhotoSignedUrl: jest.fn(async () => ({
    ok: false,
    error: { code: 'unknown', message: 'preview gagal', retryable: true },
  })),
  uploadClubLogo: jest.fn(),
}));

jest.mock('@/features/media/picker', () => ({ pickPhoto: jest.fn() }));

const CLUB_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_ID = '11111111-1111-1111-1111-111111111111';

const club: ClubRow = {
  id: CLUB_ID,
  name: 'Touring Malam',
  slug: 'touring-malam',
  description: 'Klub touring malam mingguan.',
  logo_path: null,
  visibility: 'public',
  join_policy: 'approval',
  created_by: USER_ID,
  created_at: '2026-10-15T00:00:00.000Z',
  updated_at: '2026-10-15T00:00:00.000Z',
};

const detail: ClubDetail = {
  club,
  isMember: true,
  isAdmin: true,
  myRole: 'owner',
  memberStatus: 'active',
};

const owner: ClubMemberRow = {
  club_id: CLUB_ID,
  user_id: USER_ID,
  role: 'owner',
  status: 'active',
  joined_at: '2026-10-15T00:00:00.000Z',
  created_at: '2026-10-15T00:00:00.000Z',
  updated_at: '2026-10-15T00:00:00.000Z',
};

const pendingMember: ClubMemberRow = {
  ...owner,
  user_id: '22222222-2222-2222-2222-222222222222',
  role: 'member',
  status: 'pending',
  joined_at: null,
};

const rejectedMember: ClubMemberRow = {
  ...owner,
  user_id: '33333333-3333-3333-3333-333333333333',
  role: 'member',
  status: 'rejected',
  joined_at: null,
};

describe('ClubAdminScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getClubDetails).mockResolvedValue({ ok: true, data: detail });
    jest.mocked(listClubMembers).mockResolvedValue({
      ok: true,
      data: [owner, pendingMember, rejectedMember],
    });
    jest.mocked(updateClub).mockResolvedValue({ ok: true, data: club });
  });

  it('memuat data klub ke formulir dan menampilkan daftar anggota', async () => {
    await render(<ClubAdminScreen />);

    expect(await screen.findByTestId('club-admin-name')).toHaveDisplayValue('Touring Malam');
    expect(screen.getByText('Anggota klub')).toBeTruthy();
    expect(screen.getByTestId(`club-admin-member-${pendingMember.user_id}`)).toBeTruthy();
    expect(screen.getByTestId(`club-admin-member-${rejectedMember.user_id}`)).toBeTruthy();
    expect(screen.getByText('Setujui')).toBeTruthy();
    expect(screen.getByTestId('club-admin-status-pending')).toBeTruthy();
    expect(screen.getByTestId('club-admin-role-owner')).toBeTruthy();
    expect(getClubDetails).toHaveBeenCalledWith(expect.anything(), CLUB_ID, USER_ID);
  });

  it('menyaring anggota lewat pencarian tanpa membedakan huruf besar/kecil', async () => {
    await render(<ClubAdminScreen />);

    const search = await screen.findByTestId('club-admin-member-search');
    await fireEvent.changeText(search, 'REJECTED');

    expect(screen.getByTestId(`club-admin-member-${rejectedMember.user_id}`)).toBeTruthy();
    expect(screen.queryByTestId(`club-admin-member-${pendingMember.user_id}`)).toBeNull();
    expect(screen.queryByTestId(`club-admin-member-${owner.user_id}`)).toBeNull();
    expect(screen.queryByText('Setujui')).toBeNull();

    await fireEvent.changeText(search, 'tidak-ada-yang-cocok');

    expect(screen.getByTestId('club-admin-members-empty')).toBeTruthy();
  });

  it('menyaring anggota lewat filter status dan peran', async () => {
    await render(<ClubAdminScreen />);

    await fireEvent.press(await screen.findByTestId('club-admin-status-active'));

    expect(screen.getByTestId(`club-admin-member-${owner.user_id}`)).toBeTruthy();
    expect(screen.queryByTestId(`club-admin-member-${pendingMember.user_id}`)).toBeNull();
    expect(screen.queryByTestId(`club-admin-member-${rejectedMember.user_id}`)).toBeNull();

    await fireEvent.press(screen.getByTestId('club-admin-status-all'));
    await fireEvent.press(screen.getByTestId('club-admin-role-owner'));

    expect(screen.getByTestId(`club-admin-member-${owner.user_id}`)).toBeTruthy();
    expect(screen.queryByTestId(`club-admin-member-${pendingMember.user_id}`)).toBeNull();
  });

  it('membagi daftar anggota menjadi halaman dan menjepit tombol di ujung', async () => {
    const actives: ClubMemberRow[] = Array.from({ length: 7 }, (_, index) => ({
      ...owner,
      user_id: `4444444${index + 1}-4444-4444-4444-444444444444`,
      role: 'member',
      status: 'active',
      created_at: `2026-10-0${index + 1}T00:00:00.000Z`,
    }));

    jest.mocked(listClubMembers).mockResolvedValue({ ok: true, data: [owner, ...actives] });

    await render(<ClubAdminScreen />);

    const pageLabel = await screen.findByTestId('club-admin-members-page');
    expect(pageLabel).toHaveTextContent(/Halaman 1 dari 2/);
    expect(screen.getByTestId('club-admin-members-prev').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(screen.queryByTestId(`club-admin-member-${actives[5].user_id}`)).toBeNull();

    await fireEvent.press(screen.getByTestId('club-admin-members-next'));

    expect(screen.getByTestId('club-admin-members-page')).toHaveTextContent(/Halaman 2 dari 2/);
    expect(screen.getByTestId(`club-admin-member-${actives[5].user_id}`)).toBeTruthy();
    expect(screen.getByTestId('club-admin-members-next').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    await fireEvent.press(screen.getByTestId('club-admin-members-prev'));

    expect(screen.getByTestId('club-admin-members-page')).toHaveTextContent(/Halaman 1 dari 2/);
  });

  it('mengirim perubahan klub lewat updateClub, bukan tulis tabel langsung', async () => {
    const updated = { ...club, name: 'Touring Pagi', visibility: 'private' as const };
    jest.mocked(updateClub).mockResolvedValue({ ok: true, data: updated });

    await render(<ClubAdminScreen />);

    const nameInput = await screen.findByTestId('club-admin-name');
    await fireEvent.changeText(nameInput, '  Touring   Pagi  ');
    await fireEvent.press(screen.getByText('Privat'));

    await fireEvent.press(screen.getByTestId('club-admin-save'));

    await waitFor(() => {
      expect(updateClub).toHaveBeenCalledTimes(1);
    });

    expect(updateClub).toHaveBeenCalledWith(
      expect.anything(),
      CLUB_ID,
      expect.objectContaining({
        name: '  Touring   Pagi  ',
        description: 'Klub touring malam mingguan.',
        visibility: 'private',
        join_policy: 'approval',
      }),
    );
    expect(await screen.findByTestId('club-admin-notice')).toBeTruthy();
    expect(screen.getByTestId('club-admin-name')).toHaveDisplayValue('Touring Pagi');
  });

  it('menolak nama terlalu pendek sebelum memanggil backend', async () => {
    await render(<ClubAdminScreen />);

    const nameInput = await screen.findByTestId('club-admin-name');
    await fireEvent.changeText(nameInput, 'a');
    await fireEvent.press(screen.getByTestId('club-admin-save'));

    expect(await screen.findByText('Nama klub minimal 2 karakter.')).toBeTruthy();
    expect(updateClub).not.toHaveBeenCalled();
  });

  it('menampilkan state terlarang untuk anggota biasa', async () => {
    jest.mocked(getClubDetails).mockResolvedValue({
      ok: true,
      data: { ...detail, isAdmin: false, myRole: 'member' },
    });

    await render(<ClubAdminScreen />);

    expect(await screen.findByText('Bukan admin klub')).toBeTruthy();
    expect(screen.queryByTestId('club-admin-save')).toBeNull();
  });
});
