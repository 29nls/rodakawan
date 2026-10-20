import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { signInWithEmail } from '@/features/auth/api';
import { useAuthSession, type AuthSessionValue } from '@/features/auth/session';
import { fetchOwnProfile } from '@/features/profile/api';
import type { Database } from '@/lib/supabase/database.types';
import { buildProfileRow } from '@/test-support/fakeSupabase';

// Membangun ulang router lengkap (semua rute + ikon) butuh waktu lebih dari batas default.
jest.setTimeout(30_000);

/**
 * Pengujian navigasi nyata: menjalankan rute Expo Router dari `src/app` dengan sesi
 * yang dikendalikan test. Yang diperiksa:
 * - gerbang loading sesi dan pengarahan pengunjung tanpa sesi;
 * - rute privat tidak dapat diakses tanpa sesi;
 * - alur tab dan layar Fondasi & sistem setelah masuk;
 * - tab Profil memuat data profil dan tombol keluar benar-benar memanggil signOut;
 * - validasi form sebelum backend dipanggil;
 * - aturan "tidak ada tombol yang berpura-pura berfungsi".
 *
 * Catatan: modul `@/lib/supabase/client` di-mock karena membutuhkan modul native
 * (expo-sqlite); test ini tidak menguji jaringan, melainkan navigasi dan lapisan UI.
 */

jest.mock('@/lib/supabase/client', () => ({
  getSupabaseState: () => ({ available: false, reason: 'not_configured' }),
  describeUnavailableReason: () => 'Backend Supabase belum dikonfigurasi pada pengujian ini.',
  resetSupabaseClientForTests: () => undefined,
}));

jest.mock('@/features/auth/session', () => {
  const actual = jest.requireActual('@/features/auth/session');
  return { ...actual, useAuthSession: jest.fn() };
});

jest.mock('@/features/profile/api', () => {
  const actual = jest.requireActual('@/features/profile/api');
  return { ...actual, fetchOwnProfile: jest.fn() };
});

jest.mock('@/features/auth/api', () => {
  const actual = jest.requireActual('@/features/auth/api');
  return { ...actual, signInWithEmail: jest.fn() };
});

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedFetchOwnProfile = jest.mocked(fetchOwnProfile);
const mockedSignInWithEmail = jest.mocked(signInWithEmail);

const unavailableBackend = { available: false as const, reason: 'not_configured' as const };

/**
 * Client palsu minimal untuk pengujian navigasi.
 *
 * Layar Milestone 2 (Komunitas, Garasi) benar-benar memanggil backend, jadi client
 * palsu ini harus bisa dirantai seperti PostgREST: `from(...).select(...).eq(...)`
 * mengembalikan daftar kosong, dan `rpc(...)` mengembalikan status netral. Test ini
 * tidak menguji jaringan, melainkan rute, penjaga sesi, dan judul layar.
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
    email: null,
    requestedUsername: null,
    backend: unavailableBackend,
    signOut: createSignOutSpy(),
    ...overrides,
  };
}

function signedInSession(overrides: Partial<AuthSessionValue> = {}): AuthSessionValue {
  const session = {
    user: {
      id: 'user-1',
      email: 'rider@contoh.com',
      user_metadata: { username: 'budi_solo' },
    },
  } as unknown as Session;

  return sessionValue({
    session,
    userId: 'user-1',
    email: 'rider@contoh.com',
    requestedUsername: 'budi_solo',
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
  mockedSignInWithEmail.mockReset();
  mockedUseAuthSession.mockReturnValue(sessionValue({}));
  mockedFetchOwnProfile.mockResolvedValue({ ok: true, data: null });
});

/** Sesi tanpa backend siap dipakai layar yang tombolnya harus tetap aktif. */
function sessionWithBackend(): AuthSessionValue {
  return sessionValue({ backend: { available: true, client: fakeClient } });
}

describe('gerbang sesi', () => {
  it('menampilkan status loading saat sesi masih diperiksa', async () => {
    mockedUseAuthSession.mockReturnValue(sessionValue({ status: 'loading' }));

    const { app } = await renderApp('/');

    expect(app.getPathname()).toBe('/');
    expect(screen.getByText('Memeriksa sesi…')).toBeTruthy();
  });

  it('mengarahkan pengunjung tanpa sesi ke layar masuk', async () => {
    const { app } = await renderApp('/');

    await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
    expect(screen.getByText('Masuk ke RodaKawan')).toBeTruthy();
  });
});

describe('rute Milestone 2', () => {
  it('membuka Garasi setelah masuk dan menampilkan keadaan kosong yang jelas', async () => {
    mockedUseAuthSession.mockReturnValue(signedInSession());

    const { app } = await renderApp('/garage');

    await waitFor(() => expect(app.getPathname()).toBe('/garage'));
    expect(screen.getByText('Kendaraan saya')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Garasi masih kosong')).toBeTruthy());
    expect(screen.getByText('Nomor polisi tetap privat')).toBeTruthy();
  });

  it('menolak akses langsung ke Garasi tanpa sesi', async () => {
    const { app } = await renderApp('/garage');

    await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
    expect(screen.getByText('Masuk ke RodaKawan')).toBeTruthy();
  });
});

describe('proteksi rute', () => {
  it('menolak akses langsung ke tab privat tanpa sesi', async () => {
    const { app } = await renderApp('/ringkasan');

    await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
    expect(screen.getByText('Masuk ke RodaKawan')).toBeTruthy();
  });

  it('menolak akses langsung ke tab Profil tanpa sesi', async () => {
    const { app } = await renderApp('/profile');

    await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
    expect(screen.queryByText('Akun & pengaturan')).toBeNull();
  });

  it('menampilkan halaman tidak ditemukan untuk rute asing', async () => {
    mockedUseAuthSession.mockReturnValue(signedInSession());

    await renderApp('/rute-yang-tidak-ada');

    expect(screen.getByText('Halaman tidak ditemukan')).toBeTruthy();
  });
});

describe('area aplikasi setelah masuk', () => {
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
    // Layar Komunitas Milestone 2 benar-benar mengambil data klub, bukan placeholder.
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

  it('menampilkan profil milik pengguna dan memanggil signOut saat keluar', async () => {
    const signOut = createSignOutSpy();
    mockedUseAuthSession.mockReturnValue(signedInSession({ signOut }));
    mockedFetchOwnProfile.mockResolvedValue({
      ok: true,
      data: buildProfileRow({ id: 'user-1', username: 'budi_solo', display_name: 'Budi Solo' }),
    });

    await renderApp('/profile');

    await waitFor(() => expect(screen.getByText('@budi_solo')).toBeTruthy());
    expect(screen.getByText('Budi Solo')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('profile-sign-out'));
    });

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('meminta melengkapi profil bila baris profil belum ada', async () => {
    mockedFetchOwnProfile.mockResolvedValue({ ok: true, data: null });

    await renderApp('/profile');

    await waitFor(() => expect(screen.getByText('Profil belum ada')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Lengkapi profil' })).toBeTruthy();
  });
});

describe('form masuk', () => {
  it('menampilkan pesan validasi dan tidak memanggil backend saat field kosong', async () => {
    mockedUseAuthSession.mockReturnValue(sessionWithBackend());

    await renderApp('/sign-in');

    await fireEvent.press(screen.getByTestId('sign-in-submit'));

    expect(screen.getByText('Email wajib diisi.')).toBeTruthy();
    expect(screen.getByText('Kata sandi wajib diisi.')).toBeTruthy();
    expect(mockedSignInWithEmail).not.toHaveBeenCalled();
  });

  it('menolak email dengan format salah sebelum mengirim', async () => {
    mockedUseAuthSession.mockReturnValue(sessionWithBackend());

    await renderApp('/sign-in');

    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'bukan-email');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'rahasia123');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));

    expect(screen.getByText(/Format email/)).toBeTruthy();
    expect(mockedSignInWithEmail).not.toHaveBeenCalled();
  });

  it('menjelaskan backend yang belum siap dan menonaktifkan tombol kirim', async () => {
    await renderApp('/sign-in');

    expect(screen.getByText('Backend belum siap')).toBeTruthy();
    expect(screen.getByTestId('sign-in-submit')).toBeDisabled();
  });

  it('membuka layar pendaftaran dari layar masuk', async () => {
    const { app } = await renderApp('/sign-in');

    await fireEvent.press(screen.getByRole('button', { name: 'Belum punya akun? Daftar' }));

    await waitFor(() => expect(app.getPathname()).toBe('/sign-up'));
    expect(screen.getByText('Daftar akun RodaKawan')).toBeTruthy();
  });
});
