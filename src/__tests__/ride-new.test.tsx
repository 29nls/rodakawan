import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import RideNewScreen from '@/app/ride-new';
import {
  createRide,
  getRideDetails,
  listMyActiveClubs,
  updateRide,
  type RideClubSummary,
  type RideDetails,
} from '@/features/rides/api';
import type { RideRow } from '@/lib/supabase/database.types';

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();

let mockParams: { id?: string } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: mockPush }),
}));

// `backend` harus stabil antar-render: layar memakainya sebagai dependency effect.
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
  createRide: jest.fn(),
  updateRide: jest.fn(),
  getRideDetails: jest.fn(),
  listMyActiveClubs: jest.fn(),
}));

const mockedCreate = jest.mocked(createRide);
const mockedUpdate = jest.mocked(updateRide);
const mockedDetails = jest.mocked(getRideDetails);
const mockedClubs = jest.mocked(listMyActiveClubs);

const USER_ID = '11111111-1111-1111-1111-111111111111';
const CLUB_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SECOND_CLUB_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const RIDE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const CLUBS: RideClubSummary[] = [
  { id: CLUB_ID, name: 'Touring Malam', visibility: 'public' },
  { id: SECOND_CLUB_ID, name: 'Kopi Pagi', visibility: 'private' },
];

function buildRide(overrides: Partial<RideRow> = {}): RideRow {
  return {
    id: RIDE_ID,
    club_id: CLUB_ID,
    created_by: USER_ID,
    title: 'Kopdar Sabtu pagi',
    description: 'Kumpul di alun-alun.',
    activity_type: 'motorcycle',
    status: 'planned',
    visibility: 'club',
    starts_at: '2030-01-05T01:15:00.000Z',
    meeting_label: 'Alun-alun',
    meeting_lat: null,
    meeting_lng: null,
    destination_label: 'Puncak',
    destination_lat: null,
    destination_lng: null,
    invite_code: null,
    started_at: null,
    ended_at: null,
    created_at: '2026-10-19T00:00:00.000Z',
    updated_at: '2026-10-19T00:00:00.000Z',
    ...overrides,
  };
}

function buildDetails(overrides: Partial<RideDetails> = {}): RideDetails {
  const ride = buildRide();
  const membership = {
    ride_id: ride.id,
    user_id: USER_ID,
    role: 'host' as const,
    status: 'joined' as const,
    joined_at: '2026-10-19T00:00:00.000Z',
    last_location_published_at: null,
    last_seen_at: null,
    sharing_location: false,
    created_at: '2026-10-19T00:00:00.000Z',
    updated_at: '2026-10-19T00:00:00.000Z',
    profiles: { id: USER_ID, username: 'uji_user', display_name: 'Uji User', avatar_url: null },
  };

  return {
    ride: { ...ride, clubs: { id: CLUB_ID, name: 'Touring Malam', visibility: 'public' } },
    members: [membership],
    locations: [],
    myMembership: membership,
    ...overrides,
  };
}

/** Format `YYYY-MM-DD HH:mm` waktu lokal, sama seperti formulir. */
function localInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

async function fillMinimalForm() {
  await fireEvent.changeText(await screen.findByTestId('ride-title'), 'Kopdar Sabtu pagi');
}

describe('formulir perjalanan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockedClubs.mockResolvedValue({ ok: true, data: CLUBS });
    mockedDetails.mockResolvedValue({ ok: true, data: buildDetails() });
    mockedCreate.mockResolvedValue({ ok: true, data: buildRide() });
    mockedUpdate.mockResolvedValue({ ok: true, data: buildRide() });
  });

  it('menampilkan formulir buat perjalanan dengan klub pertama terpilih', async () => {
    await render(<RideNewScreen />);

    expect(await screen.findByText('Perjalanan selalu milik satu klub.')).toBeTruthy();
    expect(screen.getByTestId('ride-new-screen')).toBeTruthy();

    expect(screen.getByRole('radio', { name: 'Touring Malam' })).toHaveProp('accessibilityState', {
      selected: true,
    });
    expect(screen.getByRole('radio', { name: 'Kopi Pagi' })).toHaveProp('accessibilityState', {
      selected: false,
    });

    expect(screen.getByLabelText('Judul perjalanan')).toBeTruthy();
    expect(screen.getByLabelText('Jadwal')).toBeTruthy();
    expect(screen.getByLabelText('Titik kumpul')).toBeTruthy();
    expect(screen.getByLabelText('Tujuan')).toBeTruthy();
    expect(screen.getByLabelText('Deskripsi')).toBeTruthy();

    expect(screen.getByText('Siapa yang dapat melihat?')).toBeTruthy();
    // Opsi visibilitas membawa label + penjelasan, jadi namanya dicocokkan
    // sebagai pola, bukan teks persis.
    expect(screen.getByRole('radio', { name: /^Anggota klub/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Hanya undangan/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Publik/ })).toBeTruthy();

    expect(
      screen.getByText(
        /Format 2026-10-20 19:30 \(waktu perangkat\). Kosongkan bila belum dijadwalkan\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Membuat perjalanan tidak menyalakan lokasi/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buat perjalanan' })).toBeTruthy();
  });

  it('menolak judul kosong sebelum memanggil backend', async () => {
    await render(<RideNewScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Buat perjalanan' }));

    expect(await screen.findByText('Isi judul perjalanan.')).toBeTruthy();
    expect(screen.getByText('Isi judul perjalanan.')).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('tidak menampilkan tombol simpan bila pengguna belum punya klub aktif', async () => {
    mockedClubs.mockResolvedValue({ ok: true, data: [] });

    await render(<RideNewScreen />);

    expect(await screen.findByText('Belum ada klub aktif')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Buat perjalanan' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Cari klub' }));

    expect(mockPush).toHaveBeenCalledWith('/community');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('menolak jadwal yang tidak valid tanpa mengirim apa pun', async () => {
    await render(<RideNewScreen />);
    await fillMinimalForm();

    await fireEvent.changeText(screen.getByLabelText('Jadwal'), '2030-02-30 10:00');
    await fireEvent.press(screen.getByRole('button', { name: 'Buat perjalanan' }));

    expect(await screen.findByText('Tanggal atau jam tidak valid.')).toBeTruthy();
    expect(mockedCreate).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Jadwal'), 'besok pagi');
    await fireEvent.press(screen.getByRole('button', { name: 'Buat perjalanan' }));

    expect(
      await screen.findByText('Gunakan format 2026-10-20 19:30 atau tanggal ISO.'),
    ).toBeTruthy();
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('membuat perjalanan lewat createRide lalu membuka detailnya', async () => {
    const scheduledAt = new Date(2030, 0, 5, 8, 15, 0, 0);

    await render(<RideNewScreen />);
    await fillMinimalForm();

    await fireEvent.changeText(screen.getByLabelText('Jadwal'), localInput(scheduledAt));
    await fireEvent.changeText(screen.getByLabelText('Titik kumpul'), '  Alun-alun  ');
    await fireEvent.changeText(screen.getByLabelText('Tujuan'), 'Puncak');
    await fireEvent.changeText(screen.getByLabelText('Deskripsi'), 'Kecepatan santai.');

    await fireEvent.press(screen.getByRole('button', { name: 'Buat perjalanan' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));

    expect(mockedCreate).toHaveBeenCalledWith(expect.anything(), {
      clubId: CLUB_ID,
      title: 'Kopdar Sabtu pagi',
      description: 'Kecepatan santai.',
      startsAt: scheduledAt.toISOString(),
      meetingLabel: 'Alun-alun',
      destinationLabel: 'Puncak',
      visibility: 'club',
    });

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/ride',
        params: { id: RIDE_ID },
      }),
    );
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('mengirim klub dan visibilitas yang dipilih pengguna', async () => {
    await render(<RideNewScreen />);
    await fillMinimalForm();

    await fireEvent.press(screen.getByRole('radio', { name: 'Kopi Pagi' }));
    await fireEvent.press(screen.getByRole('radio', { name: /^Hanya undangan/ }));

    expect(screen.getByRole('radio', { name: 'Kopi Pagi' })).toHaveProp('accessibilityState', {
      selected: true,
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Buat perjalanan' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));

    expect(mockedCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clubId: SECOND_CLUB_ID,
        visibility: 'invite_only',
        startsAt: null,
        description: null,
        meetingLabel: null,
        destinationLabel: null,
      }),
    );
  });

  it('memuat nilai lama pada mode ubah dan memakai updateRide', async () => {
    mockParams = { id: RIDE_ID };
    const details = buildDetails();
    mockedDetails.mockResolvedValue({ ok: true, data: details });

    await render(<RideNewScreen />);

    expect(await screen.findByText('Ubah detail sebelum perjalanan dimulai.')).toBeTruthy();
    expect(screen.getByTestId('ride-title')).toHaveDisplayValue('Kopdar Sabtu pagi');
    expect(screen.getByLabelText('Jadwal')).toHaveDisplayValue(
      localInput(new Date(details.ride.starts_at!)),
    );
    expect(screen.getByLabelText('Titik kumpul')).toHaveDisplayValue('Alun-alun');
    expect(screen.getByLabelText('Tujuan')).toHaveDisplayValue('Puncak');
    expect(screen.getByLabelText('Deskripsi')).toHaveDisplayValue('Kumpul di alun-alun.');

    // Klub dan visibilitas tidak diubah dari layar ini.
    expect(screen.queryByText('Siapa yang dapat melihat?')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('ride-title'), 'Kopdar Sabtu malam');
    await fireEvent.press(screen.getByRole('button', { name: 'Simpan perubahan' }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));

    expect(mockedUpdate).toHaveBeenCalledWith(expect.anything(), RIDE_ID, {
      title: 'Kopdar Sabtu malam',
      description: 'Kumpul di alun-alun.',
      startsAt: details.ride.starts_at,
      meetingLabel: 'Alun-alun',
      destinationLabel: 'Puncak',
    });
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/ride', params: { id: RIDE_ID } });
  });

  it('menolak ubah perjalanan bila pengguna bukan host', async () => {
    mockParams = { id: RIDE_ID };
    const membership = buildDetails().members[0]!;
    mockedDetails.mockResolvedValue({
      ok: true,
      data: buildDetails({
        myMembership: { ...membership, role: 'rider', user_id: USER_ID },
      }),
    });

    await render(<RideNewScreen />);

    expect(await screen.findByText('Perjalanan tidak bisa diubah')).toBeTruthy();
    expect(screen.getByText('Hanya host yang dapat mengubah perjalanan ini.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Simpan perubahan' })).toBeNull();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('menolak ubah perjalanan yang sudah dimulai atau final', async () => {
    mockParams = { id: RIDE_ID };
    mockedDetails.mockResolvedValue({
      ok: true,
      data: buildDetails({
        ride: {
          ...buildRide({ status: 'active' }),
          clubs: { id: CLUB_ID, name: 'Touring Malam', visibility: 'public' },
        },
      }),
    });

    await render(<RideNewScreen />);

    expect(
      await screen.findByText(
        'Perjalanan sudah dimulai atau selesai, jadi detailnya tidak dapat diubah.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Simpan perubahan' })).toBeNull();
  });

  it('menampilkan pesan galat service lalu membolehkan percobaan ulang tanpa duplikasi', async () => {
    mockedCreate.mockResolvedValueOnce({
      ok: false,
      error: { code: 'conflict', message: 'Klub tidak lagi aktif.', retryable: false },
    });

    await render(<RideNewScreen />);
    await fillMinimalForm();

    await fireEvent.press(screen.getByRole('button', { name: 'Buat perjalanan' }));

    expect(await screen.findByText('Perjalanan belum tersimpan')).toBeTruthy();
    expect(screen.getByText('Klub tidak lagi aktif.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    // Tombol kembali aktif setelah kegagalan, dan percobaan ulang tidak
    // meninggalkan perjalanan setengah jadi: satu panggilan per penekanan.
    expect(screen.getByRole('button', { name: 'Buat perjalanan' })).toHaveProp(
      'accessibilityState',
      { disabled: false },
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Buat perjalanan' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(2));
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('mencegah kiriman ganda selama penyimpanan berlangsung', async () => {
    let resolveCreate: (value: { ok: true; data: RideRow }) => void = () => undefined;
    mockedCreate.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    await render(<RideNewScreen />);
    await fillMinimalForm();

    // Penekanan tidak di-`await`: penyimpanan sengaja masih menggantung, dan
    // `fireEvent.press` menunggu handler-nya selesai.
    void fireEvent.press(screen.getByRole('button', { name: 'Buat perjalanan' }));

    const saving = await screen.findByRole('button', { name: 'Menyimpan…' });
    expect(saving).toHaveProp('accessibilityState', { disabled: true });

    await fireEvent.press(saving);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate({ ok: true, data: buildRide() });
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });
});
