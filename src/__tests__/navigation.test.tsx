import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { useAuthSession, type AuthSessionValue } from '@/features/auth/session';
import { fetchOwnProfile } from '@/features/profile/api';
import type { Database } from '@/lib/supabase/database.types';
import { buildProfileRow } from '@/test-support/fakeSupabase';

// Membangun ulang router lengkap (semua rute + ikon) butuh waktu lebih dari batas default.
jest.setTimeout(30_000);

/**
 * Pengujian navigasi nyata: menjalankan rute Expo Router dari `src/app` dengan
 * identitas perangkat yang dikendalikan test. Yang diperiksa:
 * - gerbang loading, layar "butuh internet", dan layar identitas hilang;
 * - rute privat tidak dapat diakses sebelum identitas siap;
 * - onboarding muncul saat profil belum lengkap / masih username sementara;
 * - alur tab dan layar Fondasi & sistem setelah identitas siap;
 * - tab Profil memuat data profil dan tombol mulai identitas baru memanggil signOut
 *   setelah konfirmasi;
 * - tidak ada lagi rute masuk/daftar.
 *
 * Catatan: modul `@/lib/supabase/client` di-mock karena membutuhkan modul native
 * (expo-sqlite); test ini tidak menguji jaringan, melainkan navigasi dan lapisan UI.
 */

jest.mock('@/lib/supabase/client', () => ({
  getSupabaseState: () => ({ available: false, reason: 'not_configured' }),
  describeUnavailableReason: () => 'Backend Supabase belum dikonfigurasi pada pengujian ini.',
  resetSupabaseClientForTests: () => undefined,
}));

jest.mock('@maplibre/maplibre-react-native', () =>
  jest.requireActual('@/test-support/mapLibreMock'),
);
jest.mock('react-native-svg/css', () => jest.requireActual('@/test-support/mapLibreMock'));

jest.mock('@/features/auth/session', () => {
  const actual = jest.requireActual('@/features/auth/session');
  return { ...actual, useAuthSession: jest.fn() };
});

jest.mock('@/features/profile/api', () => {
  const actual = jest.requireActual('@/features/profile/api');
  return { ...actual, fetchOwnProfile: jest.fn() };
});

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedFetchOwnProfile = jest.mocked(fetchOwnProfile);

const unavailableBackend = { available: false as const, reason: 'not_configured' as const };

/**
 * Client palsu minimal untuk pengujian navigasi.
 *
 * Layar Milestone 2 (Komunitas, Garasi) benar-benar memanggil backend, jadi client
 * palsu ini harus bisa dirantai seperti PostgREST: `from(...).select(...).eq(...)`
 * mengembalikan daftar kosong, dan `rpc(...)` mengembalikan status netral. Test ini
 * tidak menguji jaringan, melainkan rute, penjaga identitas, dan judul layar.
 */
function createFakeClient(): SupabaseClient<Database> {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gt: () => builder,
    gte: () => builder,
    lt: () => builder,
    lte: () => builder,
    is: () => builder,
    in: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: () => builder,
    update: () => builder,
    upsert: () => builder,
    delete: () => builder,
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (onFulfilled?: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [] as unknown[], error: null }).then(onFulfilled),
  };

  return {
    from: () => builder,
    rpc: async () => ({ data: 'pending', error: null }),
  } as unknown as SupabaseClient<Database>;
}

const fakeClient = createFakeClient();

function createSignOutSpy() {
  return jest.fn(async () => ({
    ok: true as const,
    data: { signedOut: true as const, revokedRemotely: true },
  }));
}

function sessionValue(overrides: Partial<AuthSessionValue>): AuthSessionValue {
  return {
    status: 'ready',
    session: null,
    userId: null,
    isAnonymous: true,
    backend: unavailableBackend,
    startupError: null,
    retryIdentity: jest.fn(async () => undefined),
    startFreshIdentity: jest.fn(async () => undefined),
    signOut: createSignOutSpy(),
    ...overrides,
  };
}

function signedInSession(overrides: Partial<AuthSessionValue> = {}): AuthSessionValue {
  const session = {
    user: { id: 'user-1', is_anonymous: true, user_metadata: {} },
  } as unknown as Session;

  return sessionValue({
    session,
    userId: 'user-1',
    backend: { available: true, client: fakeClient },
    ...overrides,
  });
}

async function renderApp(initialUrl: string) {
  const app = renderRouter('src/app', { initialUrl });
  await app;
  return { app };
}

beforeEach(() => {
  mockedUseAuthSession.mockReset();
  mockedFetchOwnProfile.mockReset();
  mockedUseAuthSession.mockReturnValue(sessionValue({}));
  // Profil lengkap secara default supaya gerbang langsung menuju Ringkasan.
  mockedFetchOwnProfile.mockResolvedValue({
    ok: true,
    data: buildProfileRow({ id: 'user-1', username: 'budi_solo', display_name: 'Budi Solo' }),
  });
});

/** Sesi siap dengan client palsu, untuk layar yang benar-benar memanggil backend. */
function sessionWithBackend(): AuthSessionValue {
  return signedInSession();
}

describe('gerbang identitas', () => {
  it('menampilkan status loading saat identitas masih disiapkan', async () => {
    mockedUseAuthSession.mockReturnValue(sessionValue({ status: 'loading' }));

    const { app } = await renderApp('/');

    expect(app.getPathname()).toBe('/');
    expect(screen.getByText('Menyiapkan identitas perangkat…')).toBeTruthy();
  });

  it('menjelaskan bahwa internet dibutuhkan saat identitas pertama belum bisa dibuat', async () => {
    mockedUseAuthSession.mockReturnValue(
      sessionValue({
        status: 'offline',
        startupError: {
          code: 'network',
          message: 'Tidak dapat terhubung ke server.',
          retryable: true,
        },
      }),
    );

    await renderApp('/');

    expect(screen.getByText('Butuh internet untuk memulai')).toBeTruthy();
    expect(screen.getByTestId('auth-gate-retry')).toBeTruthy();
  });

  it('menjelaskan keanggotaan lama tidak terjangkau saat identitas hilang', async () => {
    mockedUseAuthSession.mockReturnValue(sessionValue({ status: 'identity_lost' }));

    await renderApp('/');

    expect(screen.getByText('Identitas lama tidak bisa dipulihkan')).toBeTruthy();
    expect(screen.getByText(/keanggotaan klub dan riwayat perjalanan yang lama/)).toBeTruthy();
    expect(screen.getByTestId('auth-gate-new-identity')).toBeTruthy();
  });
});

describe('onboarding', () => {
  it('mengarahkan ke onboarding ketika profil masih username sementara', async () => {
    mockedUseAuthSession.mockReturnValue(signedInSession());
    mockedFetchOwnProfile.mockResolvedValue({
      ok: true,
      data: buildProfileRow({ id: 'user-1', username: 'rider_abc1234567' }),
    });

    const { app } = await renderApp('/');

    await waitFor(() => expect(app.getPathname()).toBe('/onboarding'));
    expect(screen.getByText('Kenalan dulu')).toBeTruthy();
    expect(screen.getByText(/Username sementara/)).toBeTruthy();
  });

  it('memvalidasi username sebelum memanggil backend', async () => {
    mockedUseAuthSession.mockReturnValue(sessionWithBackend());
    mockedFetchOwnProfile.mockResolvedValue({ ok: true, data: null });

    await renderApp('/onboarding');

    await fireEvent.press(screen.getByTestId('onboarding-submit'));

    expect(screen.getByText('Username wajib diisi.')).toBeTruthy();
    expect(screen.getByText('Nama tampilan wajib diisi.')).toBeTruthy();
  });
});

describe('rute Milestone 2', () => {
  it('membuka Garasi setelah identitas siap dan menampilkan keadaan kosong yang jelas', async () => {
    mockedUseAuthSession.mockReturnValue(signedInSession());

    const { app } = await renderApp('/garage');

    await waitFor(() => expect(app.getPathname()).toBe('/garage'));
    expect(screen.getByText('Kendaraan saya')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Garasi masih kosong')).toBeTruthy());
    expect(screen.getByText('Nomor polisi tetap privat')).toBeTruthy();
  });

  it('menolak akses langsung ke Garasi sebelum identitas siap', async () => {
    mockedUseAuthSession.mockReturnValue(sessionValue({ status: 'offline' }));

    const { app } = await renderApp('/garage');

    expect(app.getPathname()).not.toBe('/garage');
    expect(screen.getByText('Butuh internet untuk memulai')).toBeTruthy();
  });
});

describe('proteksi rute', () => {
  it('menolak akses langsung ke tab privat sebelum identitas siap', async () => {
    mockedUseAuthSession.mockReturnValue(sessionValue({ status: 'offline' }));

    const { app } = await renderApp('/ringkasan');

    expect(app.getPathname()).not.toBe('/ringkasan');
    expect(screen.getByText('Butuh internet untuk memulai')).toBeTruthy();
  });

  it('menolak akses langsung ke tab Profil sebelum identitas siap', async () => {
    mockedUseAuthSession.mockReturnValue(sessionValue({ status: 'identity_lost' }));

    await renderApp('/profile');

    expect(screen.queryByText('Profil & pengaturan')).toBeNull();
  });

  it('tidak lagi menyediakan rute masuk, daftar, atau lupa kata sandi', async () => {
    mockedUseAuthSession.mockReturnValue(signedInSession());

    await renderApp('/sign-in');

    expect(screen.getByText('Halaman tidak ditemukan')).toBeTruthy();
  });

  it('menampilkan halaman tidak ditemukan untuk rute asing', async () => {
    mockedUseAuthSession.mockReturnValue(signedInSession());

    await renderApp('/rute-yang-tidak-ada');

    expect(screen.getByText('Halaman tidak ditemukan')).toBeTruthy();
  });
});

describe('area aplikasi setelah identitas siap', () => {
  beforeEach(() => {
    mockedUseAuthSession.mockReturnValue(signedInSession());
  });

  it('menampilkan Ringkasan pada rute awal', async () => {
    const { app } = await renderApp('/');

    await waitFor(() => expect(app.getPathname()).toBe('/ringkasan'));
    expect(screen.getByText('Pendamping touring & konvoi')).toBeTruthy();
  });

  it('berpindah antar tab Perjalanan, Komunitas, dan Peringatan', async () => {
    const { app } = await renderApp('/');

    await fireEvent.press(screen.getByLabelText('Perjalanan'));
    expect(app.getPathname()).toBe('/rides');
    expect(screen.getByText('Touring & konvoi')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Komunitas'));
    expect(app.getPathname()).toBe('/community');
    expect(screen.getByText('Klub & anggota')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Jelajahi klub')).toBeTruthy());
    expect(screen.getByText('Belum ada klub publik')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Peringatan'));
    expect(app.getPathname()).toBe('/hazards');
    expect(screen.getByText('Kondisi di jalan')).toBeTruthy();
  });

  it('membuka form perjalanan dari tombol Ringkasan', async () => {
    const { app } = await renderApp('/');

    await fireEvent.press(screen.getByRole('button', { name: 'Buat perjalanan' }));

    await waitFor(() => expect(app.getPathname()).toBe('/ride-new'));
    await waitFor(() => expect(screen.getByText('Belum ada klub aktif')).toBeTruthy());
  });

  it('membuka daftar perjalanan dari tombol Ringkasan', async () => {
    const { app } = await renderApp('/');

    await fireEvent.press(screen.getByRole('button', { name: 'Gabung perjalanan' }));

    await waitFor(() => expect(app.getPathname()).toBe('/rides'));
    expect(screen.getByText('Touring & konvoi')).toBeTruthy();
  });

  it('membuka layar Fondasi & sistem dari Ringkasan', async () => {
    const { app } = await renderApp('/');

    await fireEvent.press(screen.getByLabelText('Lihat fondasi & sistem'));

    await waitFor(() => expect(app.getPathname()).toBe('/system'));
    expect(screen.getByText('Checklist Milestone 1')).toBeTruthy();
    expect(screen.getByText('PKCE')).toBeTruthy();
  });

  it('menjelaskan identitas perangkat dan meminta konfirmasi sebelum membuangnya', async () => {
    const signOut = createSignOutSpy();
    mockedUseAuthSession.mockReturnValue(signedInSession({ signOut }));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    try {
      await renderApp('/profile');

      await waitFor(() => expect(screen.getByText('@budi_solo')).toBeTruthy());
      expect(screen.getByText('Budi Solo')).toBeTruthy();
      expect(screen.getByText(/terikat pada perangkat/)).toBeTruthy();
      expect(screen.getByText(/harus diundang ulang/)).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByTestId('profile-sign-out'));
      });

      // Konfirmasi destruktif: signOut baru dipanggil setelah pengguna menyetujui.
      expect(signOut).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledTimes(1);

      const buttons = alertSpy.mock.calls[0]?.[2];
      const confirm = buttons?.find((button) => button.style === 'destructive');
      expect(confirm?.text).toBe('Mulai identitas baru');

      await act(async () => {
        confirm?.onPress?.();
      });

      expect(signOut).toHaveBeenCalledTimes(1);
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('meminta melengkapi profil bila baris profil belum ada', async () => {
    mockedFetchOwnProfile.mockResolvedValue({ ok: true, data: null });

    await renderApp('/profile');

    await waitFor(() => expect(screen.getByText('Profil belum ada')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Lengkapi profil' })).toBeTruthy();
  });
});
