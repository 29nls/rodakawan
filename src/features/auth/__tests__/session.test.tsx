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
  user: { id: 'user-1', email: 'rider@contoh.com', user_metadata: { username: 'budi_solo' } },
} as unknown as Session;

function wrapperFor(clientState: SupabaseClientState) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AuthSessionProvider clientState={clientState}>{children}</AuthSessionProvider>;
  };
}

describe('AuthSessionProvider', () => {
  it('tetap di status loading sampai pemeriksaan sesi selesai, lalu memulihkan sesi', async () => {
    type GetSessionResult = { data: { session: Session | null }; error: null };
    let finishGetSession: (value: GetSessionResult) => void = () => undefined;
    const pendingGetSession = new Promise<GetSessionResult>((resolve) => {
      finishGetSession = resolve;
    });

    const { client } = createAuthClient({
      getSession: jest.fn(() => pendingGetSession),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    });

    const { result } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    // Selama pemeriksaan belum selesai, aplikasi harus menampilkan loading,
    // bukan menganggap pengguna belum masuk.
    expect(result.current.status).toBe('loading');
    expect(result.current.session).toBeNull();

    await act(async () => {
      finishGetSession({ data: { session: storedSession }, error: null });
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.userId).toBe('user-1');
    expect(result.current.email).toBe('rider@contoh.com');
    expect(result.current.requestedUsername).toBe('budi_solo');
  });

  it('menganggap pengguna belum masuk ketika tidak ada sesi tersimpan', async () => {
    const { client } = createAuthClient();

    const { result } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.session).toBeNull();
    expect(result.current.userId).toBeNull();
  });

  it('mengikuti perubahan sesi dari SDK (masuk lalu keluar)', async () => {
    let notify: AuthStateCallback | undefined;
    const unsubscribe = jest.fn();

    const { client } = createAuthClient({
      onAuthStateChange: jest.fn((callback: AuthStateCallback) => {
        notify = callback;
        return { data: { subscription: { unsubscribe } } };
      }),
    });

    const { result, unmount } = await renderHook(() => useAuthSession(), {
      wrapper: wrapperFor({ available: true, client }),
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      notify?.('SIGNED_IN', storedSession);
    });
    expect(result.current.userId).toBe('user-1');

    await act(async () => {
      notify?.('SIGNED_OUT', null);
    });
    expect(result.current.session).toBeNull();
    expect(result.current.userId).toBeNull();

    await unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('memanggil SDK saat keluar dan membersihkan sesi', async () => {
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
