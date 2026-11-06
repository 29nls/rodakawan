import type { Session } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { ApiResult, SignOutOutcome } from '@/features/auth/api';
import { AuthSessionProvider, useAuthSession } from '@/features/auth/session';
import type { SupabaseClientState } from '@/lib/supabase/client';
import { createAuthClient, createAuthSpies } from '@/test-support/fakeSupabase';

type AuthStateCallback = (event: string, session: Session | null) => void;
type SignOutResult = ApiResult<SignOutOutcome>;

const storedSession = {
  access_token: 'token',
  refresh_token: 'refresh',
  user: { id: 'user-1', is_anonymous: true, user_metadata: {} },
} as unknown as Session;

const freshSession = {
  access_token: 'token-2',
  refresh_token: 'refresh-2',
  user: { id: 'user-2', is_anonymous: true, user_metadata: {} },
} as unknown as Session;

function wrapperFor(clientState: SupabaseClientState) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AuthSessionProvider clientState={clientState}>{children}</AuthSessionProvider>;
  };
}

describe('AuthSessionProvider', () => {
  it('memulihkan sesi tersimpan tanpa membuat identitas baru', async () => {
    const auth = createAuthSpies({
      getSession: jest.fn(async () => ({ data: { session: storedSession }, error: null })),
    });
    const { client } = createAuthClient(auth);

    const { result } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.userId).toBe('user-1');
    expect(result.current.isAnonymous).toBe(true);
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('membuat identitas anonim saat perangkat belum punya sesi', async () => {
    const auth = createAuthSpies({
      signInAnonymously: jest.fn(async () => ({
        data: { session: freshSession, user: freshSession.user },
        error: null,
      })),
      // Setelah signInAnonymously, `getSession` mengembalikan sesi baru.
      getSession: jest
        .fn()
        .mockResolvedValueOnce({ data: { session: null }, error: null })
        .mockResolvedValue({ data: { session: freshSession }, error: null }),
    });

    const { client } = createAuthClient(auth);

    const { result } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(result.current.userId).toBe('user-2');
  });

  it('menampilkan status offline saat identitas pertama gagal karena jaringan', async () => {
    const auth = createAuthSpies({
      signInAnonymously: jest.fn(async () => ({
        data: { session: null, user: null },
        error: { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 },
      })),
    });
    const { client } = createAuthClient(auth);

    const { result } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    await waitFor(() => expect(result.current.status).toBe('offline'));

    expect(result.current.startupError?.code).toBe('network');
    expect(result.current.startupError?.retryable).toBe(true);
  });

  it('mencoba lagi membuat identitas setelah offline', async () => {
    const auth = createAuthSpies({
      signInAnonymously: jest
        .fn()
        .mockResolvedValueOnce({
          data: { session: null, user: null },
          error: { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 },
        })
        .mockResolvedValue({
          data: { session: freshSession, user: freshSession.user },
          error: null,
        }),
      getSession: jest
        .fn()
        .mockResolvedValueOnce({ data: { session: null }, error: null })
        .mockResolvedValue({ data: { session: freshSession }, error: null }),
    });

    const { client } = createAuthClient(auth);

    const { result } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    await waitFor(() => expect(result.current.status).toBe('offline'));

    await act(async () => {
      await result.current.retryIdentity();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(2);
  });

  it('menandai identitas hilang ketika sesi tersimpan gagal dipulihkan', async () => {
    const auth = createAuthSpies({
      getSession: jest.fn(async () => ({
        data: { session: null },
        error: { code: 'refresh_token_not_found', message: 'Invalid Refresh Token', status: 400 },
      })),
    });
    const { client } = createAuthClient(auth);

    const { result } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    await waitFor(() => expect(result.current.status).toBe('identity_lost'));
    expect(result.current.userId).toBeNull();
  });

  it('membuat identitas baru hanya setelah startFreshIdentity dipanggil', async () => {
    const auth = createAuthSpies({
      getSession: jest
        .fn()
        .mockResolvedValueOnce({
          data: { session: null },
          error: { code: 'refresh_token_not_found', message: 'Invalid Refresh Token', status: 400 },
        })
        .mockResolvedValue({ data: { session: freshSession }, error: null }),
      signInAnonymously: jest.fn(async () => ({
        data: { session: freshSession, user: freshSession.user },
        error: null,
      })),
    });
    const { client } = createAuthClient(auth);

    const { result } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    await waitFor(() => expect(result.current.status).toBe('identity_lost'));
    expect(auth.signInAnonymously).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.startFreshIdentity();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(result.current.userId).toBe('user-2');
  });

  it('mengikuti perubahan sesi dari SDK (masuk lalu keluar)', async () => {
    let notify: AuthStateCallback | undefined;
    const unsubscribe = jest.fn();

    const auth = createAuthSpies({
      getSession: jest.fn(async () => ({ data: { session: storedSession }, error: null })),
      onAuthStateChange: jest.fn((callback: AuthStateCallback) => {
        notify = callback;
        return { data: { subscription: { unsubscribe } } };
      }),
    });
    const { client } = createAuthClient(auth);

    const { result, unmount } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      notify?.('SIGNED_OUT', null);
    });
    expect(result.current.session).toBeNull();
    expect(result.current.userId).toBeNull();

    await unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('memanggil SDK saat membuang identitas dan membersihkan sesi', async () => {
    const auth = createAuthSpies({
      getSession: jest.fn(async () => ({ data: { session: storedSession }, error: null })),
    });
    const { client } = createAuthClient(auth);

    const { result } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    await waitFor(() => expect(result.current.userId).toBe('user-1'));

    let outcome: SignOutResult | undefined;
    await act(async () => {
      outcome = await result.current.signOut();
    });

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ ok: true, data: { signedOut: true, revokedRemotely: true } });
    expect(result.current.session).toBeNull();
  });

  it('melaporkan backend yang belum dikonfigurasi tanpa menggantung di status loading', async () => {
    const { result } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: false, reason: 'not_configured' }),
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.session).toBeNull();

    let outcome: SignOutResult | undefined;
    await act(async () => {
      outcome = await result.current.signOut();
    });

    expect(outcome?.ok).toBe(false);
    if (outcome && !outcome.ok) expect(outcome.error.code).toBe('backend_not_configured');
  });
});
