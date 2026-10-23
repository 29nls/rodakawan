/**
 * Pemetaan galat hapus akun menjadi `AppError`.
 *
 * Ada dua sumber:
 *
 *   * `delete-account` Edge Function mengembalikan `{ error: '<tag>' }` dengan
 *     tag stabil; detail internal (path Storage, SQL, pesan Auth) tidak pernah
 *     dikirim ke klien.
 *   * RPC lama `delete_my_account()` kini selalu gagal dengan
 *     `account_deletion_requires_server`. Tag itu dipetakan ke "perbarui
 *     aplikasi" supaya build lama tidak menampilkan pesan generik.
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

/** Pemetaan tag RPC → `AppError`. Diekspor agar bisa diuji tanpa client. */
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
  account_deletion_requires_server: {
    code: 'app_outdated',
    message:
      'Cara menghapus akun berubah. Perbarui RodaKawan ke versi terbaru, lalu ulangi dari Profil → Hapus akun.',
    retryable: false,
  },
};

/** Pemetaan tag Edge Function → `AppError`. */
export const ACCOUNT_FUNCTION_ERROR_TAGS: Record<string, AppError> = {  account_deletion_rate_limited: {
    code: 'rate_limited',
    message: 'Terlalu banyak percobaan penghapusan. Tunggu beberapa menit, lalu coba lagi tanpa mengulang berkali-kali.',
    retryable: true,
  },
  account_deletion_in_progress: {
    code: 'deletion_in_progress',
    message: 'Penghapusan akun Anda sedang diproses server. Tunggu sebentar lalu coba lagi; jangan ulang berkali-kali.',
    retryable: true,
  },
  account_deletion_incomplete: {
    code: 'deletion_incomplete',
    message:
      'Penghapusan belum selesai sepenuhnya. Coba lagi; bila tetap gagal, hubungi dukungan sebelum menganggap akun sudah hilang.',
    retryable: true,
  },
  account_deletion_unavailable: {
    code: 'backend_not_configured',
    message:
      'Layanan hapus akun belum tersedia di server. Coba lagi nanti atau hubungi dukungan melalui halaman Kebijakan privasi.',
    retryable: true,
  },
  account_deletion_unauthenticated: {
    code: 'session_expired',
    message: 'Sesi Anda sudah berakhir. Masuk kembali, lalu ulangi permintaan hapus akun.',
    retryable: false,
  },
  account_deletion_invalid_user: {
    code: 'invalid_data',
    message: 'Permintaan hapus akun tidak sah. Muat ulang aplikasi lalu coba lagi.',
    retryable: false,
  },
  account_deletion_requires_server: {
    code: 'app_outdated',
    message:
      'Cara menghapus akun berubah. Perbarui RodaKawan ke versi terbaru, lalu ulangi dari Profil → Hapus akun.',
    retryable: false,
  },
};

export function mapAccountError(error: unknown): AppError {
  const mapped = ACCOUNT_ERROR_TAGS[tagOf(error)];
  return mapped ?? mapRpcError(error);
}

export function mapAccountFunctionError(tag: string): AppError {
  const mapped = ACCOUNT_FUNCTION_ERROR_TAGS[tag];
  return (
    mapped ?? {
      code: 'deletion_failed',
      message:
        'Server tidak dapat menyelesaikan penghapusan. Periksa koneksi lalu coba lagi; bila berulang, hubungi dukungan.',
      retryable: true,
    }
  );
}
