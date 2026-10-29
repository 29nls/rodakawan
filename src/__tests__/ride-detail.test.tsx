import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import RideScreen from '@/app/ride';
import {
  acceptRideInvite,
  getRideDetails,
  setRideLocationSharing,
  type RideDetails,
} from '@/features/rides/api';
import type { MapRendererProps } from '@/features/map/provider';
import {
  isRideLocationTrackingActive,
  readTrackedRideId,
  requestBackgroundPermission,
  requestForegroundPermission,
  startRideLocationTracking,
  stopRideLocationTracking,
} from '@/features/rides/tracking';

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

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
  getRideDetails: jest.fn(),
  subscribeRideLocations: jest.fn(() => ({ unsubscribe: jest.fn() })),
  setRideLocationSharing: jest.fn(),
  joinRide: jest.fn(),
  acceptRideInvite: jest.fn(),
  leaveRide: jest.fn(),
  inviteRideMember: jest.fn(),
  removeRideMember: jest.fn(),
  transitionRide: jest.fn(),
  findRideInvitee: jest.fn(),
}));

jest.mock('@/features/rides/tracking', () => ({
  getForegroundPermissionState: jest.fn(async () => 'undetermined'),
  getBackgroundPermissionState: jest.fn(async () => 'denied'),
  isRideLocationTrackingActive: jest.fn(async () => false),
  readTrackedRideId: jest.fn(() => null),
  requestForegroundPermission: jest.fn(async () => 'granted'),
  requestBackgroundPermission: jest.fn(async () => 'granted'),
  requestTrackingNotificationPermission: jest.fn(async () => 'granted'),
  startRideLocationTracking: jest.fn(async () => ({ ok: true })),
  stopRideLocationTracking: jest.fn(async () => undefined),
}));

jest.mock('@/lib/env', () => ({
  readPublicEnv: () => ({
    EXPO_PUBLIC_MAP_STYLE_URL: 'https://api.maptiler.com/maps/streets/style.json?key=unit-test',
  }),
  isHttpsUrl: (value: string) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  },
}));

jest.mock('@maplibre/maplibre-react-native', () =>
  jest.requireActual('@/test-support/mapLibreMock'),
);

jest.mock('@/features/map/MapLibreRenderer', () => ({
  MapLibreRenderer: jest.fn(({ styleUrl, markers, initialRegion }: MapRendererProps) => {
    const { Text, View } = jest.requireActual('react-native');

    return (
      <View accessibilityLabel={styleUrl} testID="maplibre-map">
        {markers.map((marker) => (
          <View key={marker.userId} testID={`maplibre-marker-${marker.userId}`}>
            <Text>{marker.label}</Text>
            <Text>{marker.freshness === 'stale' ? 'Basi' : 'Live'}</Text>
          </View>
        ))}
        <Text>{initialRegion ? 'region tersedia' : 'region kosong'}</Text>
      </View>
    );
  }),
}));

const mockedDetails = jest.mocked(getRideDetails);
const mockedSharing = jest.mocked(setRideLocationSharing);
const mockedAccept = jest.mocked(acceptRideInvite);
const mockedStart = jest.mocked(startRideLocationTracking);
const mockedForeground = jest.mocked(requestForegroundPermission);
const mockedBackground = jest.mocked(requestBackgroundPermission);
const mockedTrackingActive = jest.mocked(isRideLocationTrackingActive);
const mockedStop = jest.mocked(stopRideLocationTracking);
const mockedTrackedRide = jest.mocked(readTrackedRideId);
const mockedMapLibreRenderer = jest.mocked(
  jest.requireMock('@/features/map/MapLibreRenderer').MapLibreRenderer,
);

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ID = '22222222-2222-2222-2222-222222222222';
const INVITED_ID = '44444444-4444-4444-4444-444444444444';

function buildDetails(overrides: Partial<RideDetails> = {}): RideDetails {
  return {
    ride: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      club_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      created_by: USER_ID,
      title: 'Kopdar Sabtu',
      description: 'Kumpul pagi.',
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
      started_at: '2026-10-19T10:00:00.000Z',
      ended_at: null,
      created_at: '2026-10-19T00:00:00.000Z',
      updated_at: '2026-10-19T00:00:00.000Z',
      clubs: {
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        name: 'Touring Malam',
        visibility: 'public',
      },
    },
    members: [
      {
        ride_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        user_id: USER_ID,
        role: 'host',
        status: 'joined',
        joined_at: '2026-10-19T10:00:00.000Z',
        last_location_published_at: null,
        last_seen_at: null,
        sharing_location: false,
        created_at: '2026-10-19T10:00:00.000Z',
        updated_at: '2026-10-19T10:00:00.000Z',
        profiles: { id: USER_ID, username: 'uji_user', display_name: 'Uji User', avatar_url: null },
      },
      {
        ride_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        user_id: OTHER_ID,
        role: 'rider',
        status: 'joined',
        joined_at: '2026-10-19T10:01:00.000Z',
        last_location_published_at: null,
        last_seen_at: null,
        sharing_location: true,
        created_at: '2026-10-19T10:01:00.000Z',
        updated_at: '2026-10-19T10:01:00.000Z',
        profiles: { id: OTHER_ID, username: 'budi', display_name: 'Budi', avatar_url: null },
      },
      {
        ride_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        user_id: INVITED_ID,
        role: 'rider',
        status: 'invited',
        joined_at: null,
        last_location_published_at: null,
        last_seen_at: null,
        sharing_location: false,
        created_at: '2026-10-19T10:02:00.000Z',
        updated_at: '2026-10-19T10:02:00.000Z',
        profiles: { id: INVITED_ID, username: 'sari', display_name: 'Sari', avatar_url: null },
      },
    ],
    locations: [
      {
        ride_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        user_id: OTHER_ID,
        latitude: -6.2,
        longitude: 106.8,
        accuracy_m: 12,
        heading_deg: null,
        speed_mps: null,
        recorded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    myMembership: {
      ride_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      user_id: USER_ID,
      role: 'host',
      status: 'joined',
      joined_at: '2026-10-19T10:00:00.000Z',
      last_location_published_at: null,
      last_seen_at: null,
      sharing_location: false,
      created_at: '2026-10-19T10:00:00.000Z',
      updated_at: '2026-10-19T10:00:00.000Z',
      profiles: { id: USER_ID, username: 'uji_user', display_name: 'Uji User', avatar_url: null },
    },
    ...overrides,
  };
}

describe('detail perjalanan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDetails.mockResolvedValue({ ok: true, data: buildDetails() });
    mockedSharing.mockResolvedValue({ ok: true, data: true });
    mockedStart.mockResolvedValue({ ok: true });
    mockedForeground.mockResolvedValue('granted');
    mockedBackground.mockResolvedValue('granted');
    mockedTrackingActive.mockResolvedValue(false);
    mockedStop.mockResolvedValue(undefined);
    mockedTrackedRide.mockReturnValue(null);
  });

  it('mendaftarkan renderer dan mengirim marker basi pada layar perjalanan', async () => {
    const details = buildDetails();
    details.locations = [
      {
        ...details.locations[0]!,
        recorded_at: new Date(Date.now() - 61_000).toISOString(),
      },
    ];
    mockedDetails.mockResolvedValue({ ok: true, data: details });

    await render(<RideScreen />);

    expect(await screen.findByText('Kopdar Sabtu')).toBeTruthy();
    await waitFor(() => expect(mockedMapLibreRenderer).toHaveBeenCalled());
    expect(mockedMapLibreRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        styleUrl: 'https://api.maptiler.com/maps/streets/style.json?key=unit-test',
        markers: [expect.objectContaining({ userId: OTHER_ID, label: 'Budi', freshness: 'stale' })],
        initialRegion: expect.objectContaining({ latitude: -6.2, longitude: 106.8 }),
      }),
    );
    expect(screen.getByTestId(`maplibre-marker-${OTHER_ID}`)).toBeTruthy();
    expect(screen.getAllByText('Basi').length).toBeGreaterThan(0);
    expect(screen.getByText('region tersedia')).toBeTruthy();
  });

  it('menyalakan consent lalu memulai pelacakan perangkat', async () => {
    await render(<RideScreen />);

    expect(await screen.findByText('Kopdar Sabtu')).toBeTruthy();
    expect(screen.getByText('Berbagi nonaktif')).toBeTruthy();
    expect(screen.getAllByText(/Budi/).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByText('Nyalakan berbagi lokasi'));

    await waitFor(() => {
      expect(mockedSharing).toHaveBeenCalledWith(expect.anything(), expect.any(String), true);
      expect(mockedStart).toHaveBeenCalled();
    });

    expect(await screen.findByText(/Berbagi lokasi aktif/)).toBeTruthy();
  });

  it('tidak memulai pelacakan bila izin lokasi ditolak', async () => {
    mockedForeground.mockResolvedValue('denied');

    await render(<RideScreen />);
    await fireEvent.press(await screen.findByText('Nyalakan berbagi lokasi'));

    await waitFor(() => {
      expect(mockedForeground).toHaveBeenCalled();
    });

    expect(mockedSharing).not.toHaveBeenCalled();
    expect(mockedStart).not.toHaveBeenCalled();
    expect(await screen.findByText(/Izin lokasi belum diberikan/)).toBeTruthy();
  });

  it('menampilkan undangan untuk target dan menyembunyikan kontrol host', async () => {
    const details = buildDetails({
      myMembership: {
        ...buildDetails().members[2]!,
      },
    });
    mockedDetails.mockResolvedValue({ ok: true, data: details });
    mockedAccept.mockResolvedValue({ ok: true, data: 'joined' });

    await render(<RideScreen />);

    expect(await screen.findByText('Terima undangan')).toBeTruthy();
    expect(screen.queryByText('Mulai perjalanan')).toBeNull();
    expect(screen.queryByText('Selesaikan perjalanan')).toBeNull();

    await fireEvent.press(screen.getByText('Terima undangan'));

    await waitFor(() => {
      expect(mockedAccept).toHaveBeenCalled();
    });
  });

  it('menghentikan task yang masih berjalan saat perjalanan sudah final', async () => {
    const details = buildDetails();
    details.ride = { ...details.ride, status: 'completed' };
    mockedDetails.mockResolvedValue({ ok: true, data: details });
    mockedTrackedRide.mockReturnValue(details.ride.id);

    await render(<RideScreen />);

    await waitFor(() => expect(mockedStop).toHaveBeenCalled());
  });

  it('tidak menghentikan task milik perjalanan lain', async () => {
    const details = buildDetails();
    details.ride = { ...details.ride, status: 'completed' };
    mockedDetails.mockResolvedValue({ ok: true, data: details });
    mockedTrackedRide.mockReturnValue('perjalanan-lain');

    await render(<RideScreen />);

    expect(await screen.findByText('Kopdar Sabtu')).toBeTruthy();
    await waitFor(() => expect(mockedStop).not.toHaveBeenCalled());
  });

  it('menampilkan state error dengan tombol coba lagi saat detail gagal dimuat', async () => {
    mockedDetails.mockResolvedValue({
      ok: false,
      error: { code: 'network', message: 'Tidak dapat terhubung ke server.', retryable: true },
    });

    await render(<RideScreen />);

    // Sebelumnya layar ini `return null` saat gagal, jadi pesan ini tidak pernah tampil.
    expect(await screen.findByText('Perjalanan gagal dimuat')).toBeTruthy();
    expect(screen.getByText('Tidak dapat terhubung ke server.')).toBeTruthy();

    expect(mockedDetails).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('Coba lagi'));
    await waitFor(() => expect(mockedDetails).toHaveBeenCalledTimes(2));
  });

  it('menampilkan state memuat selama detail belum tersedia', async () => {
    mockedDetails.mockReturnValue(new Promise(() => {}));

    await render(<RideScreen />);

    expect(screen.getByText('Memuat perjalanan…')).toBeTruthy();
  });

  it('non-anggota hanya melihat penjelasan, bukan lokasi peserta', async () => {
    mockedDetails.mockResolvedValue({
      ok: true,
      data: buildDetails({ myMembership: null, members: [], locations: [] }),
    });

    await render(<RideScreen />);

    expect(
      await screen.findByText(/Bergabunglah ke perjalanan untuk melihat peserta/),
    ).toBeTruthy();
    expect(screen.queryByText('Nyalakan berbagi lokasi')).toBeNull();
    expect(screen.queryByText(/Budi/)).toBeNull();
  });
});
