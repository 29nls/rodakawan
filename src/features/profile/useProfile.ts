import { useCallback, useEffect, useState } from 'react';

import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import { fetchOwnProfile } from '@/features/profile/api';
import { describeUnavailableReason } from '@/lib/supabase/client';
import type { ProfileRow } from '@/lib/supabase/database.types';

export type ProfileState =
  | { status: 'loading' }
  /** `profile: null` = pengguna masuk tetapi belum punya baris profil. */
  | { status: 'ready'; profile: ProfileRow | null }
  | { status: 'error'; error: AppError };

export type UseProfileResult = {
  state: ProfileState;
  reload: () => void;
};

/**
 * Memuat profil milik pengguna yang sedang masuk.
 *
 * Selalu memakai `userId` dari sesi, bukan nilai yang bisa dipasok UI, sehingga tidak
 * ada cara membaca profil pengguna lain. Prasyarat (backend siap, sesi ada) diperiksa
 * sebagai state turunan supaya tidak ada `setState` sinkron di dalam effect.
 */
export function useProfile(): UseProfileResult {
  const { backend, userId } = useAuthSession();

  const [loaded, setLoaded] = useState<{ profile: ProfileRow | null } | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!backend.available || !userId) return;

    const client = backend.client;
    let active = true;

    void fetchOwnProfile(client, userId).then((result) => {
      if (!active) return;

      if (result.ok) {
        setLoaded({ profile: result.data });
        setError(null);
      } else {
        setLoaded(null);
        setError(result.error);
      }
    });

    return () => {
      active = false;
    };
  }, [backend, reloadToken, userId]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const preconditionError: AppError | null = !backend.available
    ? {
        code: 'backend_not_configured',
        message: describeUnavailableReason(backend.reason),
        retryable: false,
      }
    : !userId
      ? {
          code: 'session_expired',
          message:
            'Sesi tidak ditemukan di perangkat ini. Masuk kembali untuk melihat profil Anda.',
          retryable: false,
        }
      : null;

  const state: ProfileState = preconditionError
    ? { status: 'error', error: preconditionError }
    : error
      ? { status: 'error', error }
      : loaded
        ? { status: 'ready', profile: loaded.profile }
        : { status: 'loading' };

  return { state, reload };
}
