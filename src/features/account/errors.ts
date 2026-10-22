/**
 * Pemetaan galat `delete_my_account()` menjadi `AppError`.
 *
 * Kontrak dengan database: setiap `raise exception` di
 * `supabase/migrations/20261022190000_account_deletion_m5.sql` mengisi `detail`
 * dengan tag mesin yang stabil. `message` milik database tidak pernah
 * ditampilkan apa adanya, karena teksnya boleh berubah dan bisa memuat detail
 * internal.
 *
 * Tag yang tidak dikenal jatuh ke `mapRpcError`, sehingga kegagalan jaringan,
 * fungsi yang belum dimigrasikan (`PGRST202`), dan penolakan RLS tetap
 * diterjemahkan dengan benar.
 */

import { mapRpcError, type AppError } from '@/features/auth/errors';

function tagOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const like = error as { detail?: unknown; details?: unknown };
  const detail = like.detail ?? like.details;
  return typeof detail === 'string' ? detail : '';
}

/** Pemetaan tag → `AppError`. Diekspor agar bisa diuji tanpa client Supabase. */
export const ACCOUNT_ERROR_TAGS: Record<string, AppError> = {
  account_unauthenticated: {
    code: 'session_expired',
    message: 'Sesi Anda sudah berakhir. Masuk kembali, lalu ulangi permintaan hapus akun.',
    retryable: false,
  },
  account_profile_missing: {
    code: 'profile_missing',
    message:
      'Profil akun ini belum tersedia di server, jadi belum ada yang bisa dihapus. Muat ulang aplikasi lalu coba lagi.',
    retryable: true,
  },
};

export function mapAccountError(error: unknown): AppError {
  const mapped = ACCOUNT_ERROR_TAGS[tagOf(error)];
  return mapped ?? mapRpcError(error);
}
