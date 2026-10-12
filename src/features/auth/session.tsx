/**
 * Sumber tunggal status sesi autentikasi.
 *
 * Tanggung jawab:
 * - Memulihkan session tersimpan saat aplikasi mulai (dari storage expo-sqlite).
 * - Mengikuti perubahan sesi (`onAuthStateChange`) sehingga navigasi terlindungi
 *   bereaksi konsisten: masuk, keluar, dan token kedaluwarsa.
 * - Menyediakan `signOut()` yang membersihkan sesi lokal sekaligus server.
 *
 * Catatan: callback `onAuthStateChange` tidak boleh menjalankan operasi Supabase
 * lain (dokumentasi SDK memperingatkan deadlock); di sini callback hanya
 * memperbarui state React.
 */

import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  signOut as requestSignOut,
  type ApiResult,
  type SignOutOutcome,
} from '@/features/auth/api';
import {
  describeUnavailableReason,
  getSupabaseState,
  type SupabaseClientState,
} from '@/lib/supabase/client';

export type SessionStatus = 'loading' | 'ready';

export type AuthSessionValue = {
  /** `loading` sampai pemeriksaan session awal selesai. */
  status: SessionStatus;
  session: Session | null;
  userId: string | null;
  email: string | null;
  /** Username yang diminta saat mendaftar, dipakai untuk memberi tahu bila diganti. */
  requestedUsername: string | null;
  backend: SupabaseClientState;
  signOut: () => Promise<ApiResult<SignOutOutcome>>;
};

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

export type AuthSessionProviderProps = {
  children: ReactNode;
  /** Hanya dipakai pengujian; aplikasi selalu memakai konfigurasi nyata. */
  clientState?: SupabaseClientState;
};

export function AuthSessionProvider({ children, clientState }: AuthSessionProviderProps) {
  const backend = useMemo(() => clientState ?? getSupabaseState(), [clientState]);

  /** `checked` = pemeriksaan sesi awal sudah selesai (berhasil maupun gagal). */
  const [restored, setRestored] = useState<{ checked: boolean; session: Session | null }>({
    checked: false,
    session: null,
  });

  useEffect(() => {
    if (!backend.available) return;

    const client = backend.client;
    let active = true;

    client.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setRestored({ checked: true, session: data.session ?? null });
      })
      .catch(() => {
        if (!active) return;
        setRestored({ checked: true, session: null });
      });

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setRestored({ checked: true, session: nextSession ?? null });
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [backend]);

  // Status diturunkan (bukan diset di dalam effect) agar tidak ada cascading render:
  // tanpa backend yang siap, tidak ada yang perlu diperiksa dan sesi tidak mungkin ada.
  const status: SessionStatus = !backend.available || restored.checked ? 'ready' : 'loading';
  const session = backend.available ? restored.session : null;

  const signOut = useCallback(async (): Promise<ApiResult<SignOutOutcome>> => {
    if (!backend.available) {
      return {
        ok: false,
        error: {
          code: 'backend_not_configured',
          message: describeUnavailableReason(backend.reason),
          retryable: false,
        },
      };
    }

    const result = await requestSignOut(backend.client);
    if (result.ok) setRestored((previous) => ({ ...previous, session: null }));

    return result;
  }, [backend]);

  const requestedUsername = useMemo(() => {
    const value = session?.user.user_metadata?.username;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }, [session]);

  const value = useMemo<AuthSessionValue>(
    () => ({
      status,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      requestedUsername,
      backend,
      signOut,
    }),
    [backend, requestedUsername, session, signOut, status],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionValue {
  const value = useContext(AuthSessionContext);
  if (!value) {
    throw new Error('useAuthSession harus dipakai di dalam <AuthSessionProvider>.');
  }
  return value;
}
