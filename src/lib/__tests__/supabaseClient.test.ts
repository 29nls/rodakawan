/**
 * Pengujian lifecycle client Supabase: pembuatan lazy, konfigurasi auth, dan
 * penyesuaian auto-refresh token dengan status aplikasi (foreground/background).
 *
 * Kenapa pengujian ini ada:
 * - `auth-js` menyalakan ticker auto-refresh sendiri saat client dibuat pada
 *   lingkungan non-browser (React Native dianggap selalu foreground), dan itu terjadi
 *   setelah pemulihan session selesai. Kalau aplikasi sedang di background, ticker
 *   itu harus dihentikan — bukan dibiarkan berjalan sampai ada event AppState pertama.
 * - Listener AppState harus dibersihkan saat client dibuat ulang agar tidak ada dua
 *   handler yang menunjuk client lama.
 * - `startAutoRefresh()`/`stopAutoRefresh()` async; promise-nya tidak boleh menjadi
 *   unhandled rejection.
 *
 * Modul native dan jaringan tidak disentuh: `createClient` diganti, `readPublicEnv`
 * dipasok nilai uji, dan `AppState` dipasangi harness kecil.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { Database } from '@/lib/supabase/database.types';
import { getSupabaseState, resetSupabaseClientForTests } from '@/lib/supabase/client';
import { createAuthClient, type AuthSpies } from '@/test-support/fakeSupabase';

let mockSupabaseClient: SupabaseClient<Database>;

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

jest.mock('@/lib/env', () => {
  const actual = jest.requireActual('@/lib/env');
  return {
    ...actual,
    readPublicEnv: () => ({
      EXPO_PUBLIC_SUPABASE_URL: 'https://uji-roda.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'kunci-publik-uji',
      EXPO_PUBLIC_MAP_STYLE_URL: undefined,
    }),
  };
});

type ChangeHandler = (state: string) => void;

const mockAppState = { current: 'active' as string };
const mockHandlers: ChangeHandler[] = [];
const mockRemove = jest.fn();
let authSpies: AuthSpies;

/** Mengganti AppState dengan versi yang bisa dikendalikan test. */
function installAppStateHarness(): void {
  mockAppState.current = 'active';
  mockHandlers.length = 0;

  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    get: () => mockAppState.current,
  });

  Object.defineProperty(AppState, 'addEventListener', {
    configurable: true,
    writable: true,
    value: (_type: string, handler: ChangeHandler) => {
      mockHandlers.push(handler);
      return {
        remove: () => {
          const index = mockHandlers.indexOf(handler);
          if (index >= 0) mockHandlers.splice(index, 1);
          mockRemove();
        },
      };
    },
  });
}

/** Membiarkan rantai promise (initialize → penyesuaian ticker) selesai. */
function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function emitAppState(state: string): void {
  mockAppState.current = state;
  for (const handler of [...mockHandlers]) handler(state);
}

const nodeProcess = (
  globalThis as unknown as {
    process: {
      on: (event: string, listener: (reason: unknown) => void) => void;
      off: (event: string, listener: (reason: unknown) => void) => void;
    };
  }
).process;

beforeEach(() => {
  resetSupabaseClientForTests();
  jest.clearAllMocks();
  installAppStateHarness();

  const { client, auth } = createAuthClient();
  mockSupabaseClient = client;
  authSpies = auth;
});

describe('getSupabaseState', () => {
  it('membuat client dengan konfigurasi auth yang diharapkan dan hanya sekali', () => {
    const first = getSupabaseState();
    const second = getSupabaseState();

    expect(first.available).toBe(true);
    expect(second).toBe(first);

    const { createClient } = jest.requireMock('@supabase/supabase-js') as {
      createClient: jest.Mock;
    };
    expect(createClient).toHaveBeenCalledTimes(1);

    const [url, key, options] = createClient.mock.calls[0];
    expect(url).toBe('https://uji-roda.supabase.co');
    expect(key).toBe('kunci-publik-uji');
    expect(options.auth).toMatchObject({
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    });
    expect(options.auth.storage).toBeDefined();
  });
});

describe('auto-refresh mengikuti status aplikasi', () => {
  it('menyalakan refresh setelah SDK selesai inisialisasi saat aplikasi aktif', async () => {
    mockAppState.current = 'active';
    getSupabaseState();

    await flushAsyncWork();

    expect(authSpies.initialize).toHaveBeenCalledTimes(1);
    expect(authSpies.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(authSpies.stopAutoRefresh).not.toHaveBeenCalled();

    // Urutan penting: keputusan diambil setelah initialize, bukan sebelum.
    expect(authSpies.initialize.mock.invocationCallOrder[0]).toBeLessThan(
      authSpies.startAutoRefresh.mock.invocationCallOrder[0],
    );
  });

  it('menghentikan ticker ketika aplikasi dibuat dalam keadaan background', async () => {
    mockAppState.current = 'background';
    getSupabaseState();

    await flushAsyncWork();

    expect(authSpies.initialize).toHaveBeenCalledTimes(1);
    expect(authSpies.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(authSpies.startAutoRefresh).not.toHaveBeenCalled();
  });

  it('mengikuti perpindahan foreground → background → foreground dengan satu listener', async () => {
    getSupabaseState();
    await flushAsyncWork();

    expect(mockHandlers).toHaveLength(1);
    authSpies.startAutoRefresh.mockClear();

    emitAppState('background');
    expect(authSpies.stopAutoRefresh).toHaveBeenCalledTimes(1);

    emitAppState('active');
    expect(authSpies.startAutoRefresh).toHaveBeenCalledTimes(1);

    emitAppState('inactive');
    expect(authSpies.stopAutoRefresh).toHaveBeenCalledTimes(2);
  });

  it('membersihkan listener lama saat client dibuat ulang (tidak menumpuk)', async () => {
    getSupabaseState();
    await flushAsyncWork();
    expect(mockHandlers).toHaveLength(1);

    resetSupabaseClientForTests();

    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockHandlers).toHaveLength(0);

    getSupabaseState();
    await flushAsyncWork();

    expect(mockHandlers).toHaveLength(1);
  });

  it('tidak meninggalkan unhandled rejection saat permintaan refresh gagal', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };

    authSpies.startAutoRefresh.mockImplementation(async () => {
      throw new Error('ticker gagal dinyalakan');
    });

    nodeProcess.on('unhandledRejection', onUnhandled);
    try {
      getSupabaseState();
      await flushAsyncWork();
      await flushAsyncWork();

      expect(authSpies.startAutoRefresh).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
    } finally {
      nodeProcess.off('unhandledRejection', onUnhandled);
    }
  });
});
