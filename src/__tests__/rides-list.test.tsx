import { fireEvent, render, screen } from '@testing-library/react-native';

import RidesScreen from '@/app/(tabs)/rides';
import { listRides, type RideWithClub } from '@/features/rides/api';

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  return {
    Link: ({ children }: { children: unknown }) => children,
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
  };
});

jest.mock('@/features/auth/session', () => {
  const backend = { available: true, client: {} };

  return {
    useAuthSession: () => ({
      backend,
      userId: '11111111-1111-1111-1111-111111111111',
    }),
  };
});

jest.mock('@/features/rides/api', () => ({
  listRides: jest.fn(),
}));

const mockedListRides = jest.mocked(listRides);

const ride: RideWithClub = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  club_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  created_by: '11111111-1111-1111-1111-111111111111',
  title: 'Kopdar Sabtu',
  description: null,
  activity_type: 'motorcycle',
  status: 'active',
  visibility: 'club',
  starts_at: '2026-10-20T12:30:00.000Z',
  meeting_label: 'Alun-alun',
  meeting_lat: null,
  meeting_lng: null,
  destination_label: 'Puncak',
  destination_lat: null,
  destination_lng: null,
  invite_code: null,
  started_at: '2026-10-20T12:35:00.000Z',
  ended_at: null,
  created_at: '2026-10-19T00:00:00.000Z',
  updated_at: '2026-10-19T00:00:00.000Z',
  clubs: {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    name: 'Touring Malam',
    visibility: 'public',
  },
};

describe('tab Perjalanan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListRides.mockResolvedValue({ ok: true, data: [ride] });
  });

  it('menampilkan perjalanan dari klub beserta status dan jadwal', async () => {
    await render(<RidesScreen />);

    expect(await screen.findByText('Kopdar Sabtu')).toBeTruthy();
    expect(screen.getByText('Berlangsung')).toBeTruthy();
    expect(screen.getByText('Touring Malam')).toBeTruthy();
    expect(screen.getByText(/Kumpul: Alun-alun/)).toBeTruthy();
    expect(screen.getByText('Sedang berlangsung')).toBeTruthy();
  });

  it('menampilkan keadaan kosong tanpa data contoh', async () => {
    mockedListRides.mockResolvedValue({ ok: true, data: [] });

    await render(<RidesScreen />);

    expect(await screen.findByText('Belum ada perjalanan')).toBeTruthy();
    expect(screen.queryByText('Kopdar Sabtu')).toBeNull();
  });

  it('membuka formulir buat perjalanan', async () => {
    await render(<RidesScreen />);

    await fireEvent.press(await screen.findByText('Buat perjalanan'));

    expect(mockPush).toHaveBeenCalledWith('/ride-new');
  });
});
