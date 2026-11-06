/**
 * Sumber tunggal identitas perangkat.
 *
 * RodaKawan tidak punya akun. Saat aplikasi pertama dibuka, provider ini:
 * 1. memulihkan session tersimpan (`getSession`);
 * 2. bila kosong, membuat identitas anonim (`signInAnonymously`);
 * 3. mengikuti perubahan session dari SDK.
 *
 * Dua kegagalan yang harus terlihat jelas oleh pengguna, bukan spinner tanpa akhir:
 * - `offline` — pembuatan identitas pertama butuh internet. Aplikasi menampilkan
 *   layar "butuh internet untuk memulai" dengan tombol coba lagi.
 * - `identity_lost` — session tersimpan ada tetapi tidak bisa dipulihkan (refresh
 *   token ditolak/kedaluwarsa). Identitas anonim tidak bisa dipulihkan, jadi
 *   aplikasi membuat identitas baru dan memberi tahu bahwa keanggotaan lama tidak
 *   terjangkau lagi.
 *
 * Catatan: callback `onAuthStateChange` tidak menjalankan operasi Supabase lain
 * (dokumentasi SDK memperingatkan deadlock); callback hanya memperbarui state.
 */

import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  readCurrentSession,
  signInAnonymously as requestAnonymousSignIn,
  signOut as requestSignOut,
  type ApiResult,
  type SignOutOutcome,
} from '@/features/auth/api';
import type { AppError } from '@/features/auth/errors';
import {
  describeUnavailableReason,
  getSupabaseState,
  type SupabaseClientState,
} from '@/lib/supabase/client';

/**
 * `loading`      — identitas sedang dipulihkan/dibuat.
 * `ready`        — ada identitas; aplikasi dapat dipakai.
 * `offline`      — belum ada identitas dan perangkat tidak dapat menghubungi server.
 * `identity_lost`— identitas lama tidak dapat dipulihkan; pengguna harus memulai
 *                  identitas baru (dan keanggotaan lama tidak terbawa).
 */
export type SessionStatus = 'loading' | 'ready' | 'offline' | 'identity_lost';

export type AuthSessionValue = {
  status: SessionStatus;
  session: Session | null;
  userId: string | null;
  /** `false` bila identitas anonim (selalu begitu di RodaKawan); dipakai teks UI. */
  isAnonymous: boolean;
  backend: SupabaseClientState;
  /** Kesalahan terakhir saat membuat identitas, untuk ditampilkan di layar gerbang. */
  startupError: AppError | null;
  /** Coba lagi membuat identitas setelah `offline`/`identity_lost`. */
  retryIdentity: () => Promise<void>;
  /** Buat identitas baru dengan sadar membuang identitas lama yang tak terjangkau. */
  startFreshIdentity: () => Promise<void>;
  signOut: () => Promise<ApiResult<SignOutOutcome>>;
};

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

export type AuthSessionProviderProps = {
  children: ReactNode;
  /** Hanya dipakai pengujian; aplikasi selalu memakai konfigurasi nyata. */
  clientState?: SupabaseClientState;
};

type Restored = {
  checked: boolean;
  session: Session | null;
  /** Session tersimpan ada, tetapi pemulihannya gagal (refresh token ditolak). */
  lostStoredIdentity: boolean;
  startupError: AppError | null;
};

const INITIAL: Restored = {
  checked: false,
  session: null,
  lostStoredIdentity: false,
  startupError: null,
};

export function AuthSessionProvider({ children, clientState }: AuthSessionProviderProps) {
  const backend = useMemo(() => clientState ?? getSupabaseState(), [clientState]);
  const [restored, setRestored] = useState<Restored>(INITIAL);

  /**
   * Mencegah dua pembuatan identitas berjalan bersamaan (mis. effect awal dan
   * tombol "coba lagi" ditekan saat permintaan pertama masih berjalan).
   */
  const creating = useRef(false);

  const createIdentity = useCallback(
    async (client: Extract<SupabaseClientState, { available: true }>['client']) => {
      if (creating.current) return;
      creating.current = true;

      const result = await requestAnonymousSignIn(client);
      creating.current = false;

      if (result.ok) {
        // Baca ulang session agar gerbang tidak bergantung pada event yang mungkin
        // sudah lewat sebelum listener terpasang.
        const current = await readCurrentSession(client);
        setRestored({
          checked: true,
          session: current.ok ? current.data.session : null,
          lostStoredIdentity: false,
          startupError: current.ok ? null : current.error,
        });
        return;
      }

      setRestored((previous) => ({
        ...previous,
        checked: true,
        startupError: result.error,
      }));
    },
    [],
  );

  useEffect(() => {
    if (!backend.available) return;

    const client = backend.client;
    let active = true;

    void (async () => {
      const restoredSession = await readCurrentSession(client);

      if (!active) return;

      if (!restoredSession.ok) {
        // `getSession` gagal karena penyimpanan lokal rusak atau refresh ditolak.
        setRestored({
          checked: true,
          session: null,
          lostStoredIdentity: true,
          startupError: restoredSession.error,
        });
        return;
      }

      if (restoredSession.data.session) {
        setRestored({
          checked: true,
          session: restoredSession.data.session,
          lostStoredIdentity: false,
          startupError: null,
        });
        return;
      }

      setRestored((previous) => ({ ...previous, checked: true }));
      await createIdentity(client);
    })();

    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      if (event === 'SIGNED_OUT' && !nextSession) {
        setRestored({
          checked: true,
          session: null,
          lostStoredIdentity: false,
          startupError: null,
        });
        return;
      }

      if (nextSession) {
        setRestored({
          checked: true,
          session: nextSession,
          lostStoredIdentity: false,
          startupError: null,
        });
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [backend, createIdentity]);

  const status: SessionStatus = useMemo(() => {
    if (!backend.available) return 'ready';
    if (!restored.checked) return 'loading';
    if (restored.session) return 'ready';
    if (restored.lostStoredIdentity) return 'identity_lost';
    if (restored.startupError) return 'offline';
    return 'loading';
  }, [backend.available, restored]);

  const session = backend.available ? restored.session : null;

  const retryIdentity = useCallback(async () => {
    if (!backend.available) return;
    setRestored((previous) => ({ ...previous, startupError: null }));
    await createIdentity(backend.client);
  }, [backend, createIdentity]);

  /**
   * Membuang sesi tersimpan yang tidak dapat dipulihkan lalu membuat identitas
   * baru. Hanya dipanggil dari layar `identity_lost` setelah pengguna menekan
   * tombol, sehingga tidak ada data lama yang terhapus tanpa persetujuan.
   */
  const startFreshIdentity = useCallback(async () => {
    if (!backend.available) return;

    await requestSignOut(backend.client);
    setRestored({ checked: true, session: null, lostStoredIdentity: false, startupError: null });
    await createIdentity(backend.client);
  }, [backend, createIdentity]);

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
    if (result.ok) {
      setRestored({ checked: true, session: null, lostStoredIdentity: false, startupError: null });
    }

    return result;
  }, [backend]);

  const value = useMemo<AuthSessionValue>(
    () => ({
      status,
      session,
      userId: session?.user.id ?? null,
      isAnonymous: session?.user.is_anonymous ?? true,
      backend,
      startupError: restored.startupError,
      retryIdentity,
      startFreshIdentity,
      signOut,
    }),
    [backend, restored.startupError, retryIdentity, session, signOut, startFreshIdentity, status],
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
