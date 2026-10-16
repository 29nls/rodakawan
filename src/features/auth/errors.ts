/**
 * Pemetaan error Supabase Auth/PostgREST menjadi pesan Bahasa Indonesia yang
 * bisa ditindaklanjuti pengguna (docs/UX_SITEMAP.md bagian 6: "error menggunakan
 * bahasa Indonesia sederhana dan menyebut tindakan pemulihan").
 *
 * Catatan implementasi: pemetaan memakai pemeriksaan struktural (code/status/name)
 * dan bukan `instanceof`, supaya pengujian tidak perlu membuat kelas error SDK
 * dan tetap akurat ketika SDK memperbarui diri.
 */

export type AppErrorCode =
  | 'backend_not_configured'
  | 'network'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'email_invalid'
  | 'email_taken'
  | 'password_weak'
  | 'same_password'
  | 'rate_limited'
  | 'username_taken'
  | 'profile_missing'
  | 'not_authorized'
  /** Kode generik untuk tabel selain `public.profiles` (klub, garasi). */
  | 'conflict'
  | 'invalid_data'
  | 'not_found'
  | 'table_missing'
  | 'session_expired'
  | 'link_expired'
  | 'unknown';

export type AppError = {
  code: AppErrorCode;
  message: string;
  /** `true` bila mencoba ulang operasi yang sama masuk akal. */
  retryable: boolean;
};

type ErrorLike = {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
  reasons?: unknown;
  weak_password?: { reasons?: unknown };
};

const UNKNOWN_ERROR: AppError = {
  code: 'unknown',
  message:
    'Terjadi kesalahan yang belum dikenali. Coba lagi; bila berulang, laporkan ke pengembang.',
  retryable: true,
};

const NETWORK_ERROR: AppError = {
  code: 'network',
  message:
    'Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi. Data yang sudah Anda isi tidak hilang.',
  retryable: true,
};

export const NETWORK_APP_ERROR = NETWORK_ERROR;

/**
 * Update/delete tidak mengenai baris apa pun: barisnya tidak ada, bukan milik
 * akun ini, atau policy RLS menolaknya. Dipakai bersama `mapTableError` untuk
 * menghindari "sukses palsu" ketika 0 baris terpengaruh.
 */
export const ROW_NOT_APPLIED_ERROR: AppError = {
  code: 'not_authorized',
  message:
    'Perubahan tidak diterapkan: data ini bukan milik akun Anda, atau sesi Anda sudah berakhir. Muat ulang lalu coba lagi.',
  retryable: false,
};

function toErrorLike(error: unknown): ErrorLike {
  if (typeof error === 'object' && error !== null) return error as ErrorLike;
  return {};
}

function isFetchFailure(like: ErrorLike): boolean {
  if (like.name === 'AuthRetryableFetchError') return true;
  // Supabase menandai kegagalan jaringan sebagai status 0.
  if (like.status === 0) return true;
  if (like.name === 'FunctionsFetchError') return true;

  const message = like.message ?? '';
  return /network request failed|failed to fetch|network error/i.test(message);
}

function passwordWeakError(like: ErrorLike): AppError {
  const reasons = Array.isArray(like.reasons)
    ? like.reasons
    : Array.isArray(like.weak_password?.reasons)
      ? like.weak_password?.reasons
      : undefined;

  const detail =
    Array.isArray(reasons) && reasons.length > 0
      ? ` Alasan dari server: ${reasons.filter((item) => typeof item === 'string').join(', ')}.`
      : '';

  return {
    code: 'password_weak',
    message: `Kata sandi belum memenuhi kebijakan server.${detail}`,
    retryable: false,
  };
}

/** Error dari Supabase Auth (signUp, signIn, reset, updateUser, callback). */
export function mapAuthError(error: unknown): AppError {
  const like = toErrorLike(error);

  if (isFetchFailure(like)) return NETWORK_ERROR;

  switch (like.code) {
    case 'invalid_credentials':
      return {
        code: 'invalid_credentials',
        message:
          'Email atau kata sandi tidak cocok. Periksa kembali, atau pulihkan kata sandi bila lupa.',
        retryable: false,
      };
    case 'email_not_confirmed':
      return {
        code: 'email_not_confirmed',
        message:
          'Email belum dikonfirmasi. Buka tautan konfirmasi di kotak masuk Anda (termasuk folder spam), lalu masuk kembali.',
        retryable: false,
      };
    case 'user_already_exists':
    case 'email_exists':
      return {
        code: 'email_taken',
        message: 'Email ini sudah terdaftar. Coba masuk, atau pulihkan kata sandi bila lupa.',
        retryable: false,
      };
    case 'weak_password':
      return passwordWeakError(like);
    case 'same_password':
      return {
        code: 'same_password',
        message: 'Kata sandi baru harus berbeda dari kata sandi yang sedang dipakai.',
        retryable: false,
      };
    case 'validation_failed':
      return {
        code: 'email_invalid',
        message: 'Email belum bisa dipakai server. Periksa formatnya, misalnya nama@contoh.com.',
        retryable: false,
      };
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return {
        code: 'rate_limited',
        message: 'Permintaan terlalu sering dikirim. Tunggu sebentar sebelum mencoba lagi.',
        retryable: true,
      };
    case 'otp_expired':
    case 'flow_state_expired':
    case 'flow_state_not_found':
      return {
        code: 'link_expired',
        message:
          'Tautan sudah kedaluwarsa atau sudah pernah dipakai. Minta tautan baru dari aplikasi.',
        retryable: false,
      };
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'session_expired':
      return {
        code: 'session_expired',
        message: 'Sesi Anda sudah berakhir. Masuk kembali untuk melanjutkan.',
        retryable: false,
      };
    default:
      break;
  }

  if (like.status === 429) {
    return {
      code: 'rate_limited',
      message: 'Permintaan terlalu sering dikirim. Tunggu sebentar sebelum mencoba lagi.',
      retryable: true,
    };
  }

  return UNKNOWN_ERROR;
}

/** Error dari PostgREST (tabel `public.profiles`). */
export function mapProfileError(error: unknown): AppError {
  const like = toErrorLike(error);

  if (isFetchFailure(like)) return NETWORK_ERROR;

  switch (like.code) {
    case '23505':
      return {
        code: 'username_taken',
        message: 'Username sudah dipakai akun lain. Coba username lain, misalnya dengan angka.',
        retryable: false,
      };
    case '23514':
      return {
        code: 'profile_missing',
        message:
          'Data profil ditolak oleh aturan database. Periksa kembali username, nama tampilan, bio, dan kota.',
        retryable: false,
      };
    case '42501':
    case 'PGRST301':
      return {
        code: 'not_authorized',
        message:
          'Database menolak perubahan ini. Kemungkinan sesi Anda sudah berakhir atau data bukan milik akun Anda; masuk kembali lalu coba lagi.',
        retryable: false,
      };
    case 'PGRST116':
      // 0 baris terpengaruh: baris tidak ada, atau bukan milik sesi ini (RLS).
      return {
        code: 'profile_missing',
        message:
          'Perubahan tidak diterapkan karena profil ini tidak ada atau bukan milik akun Anda. Masuk kembali, lalu muat ulang profil.',
        retryable: false,
      };
    case 'PGRST205':
    case '42P01':
      return {
        code: 'profile_missing',
        message:
          'Tabel profil belum tersedia di backend. Jalankan migration Supabase (lihat docs/SETUP_GUIDE.md) lalu coba lagi.',
        retryable: false,
      };
    default:
      return UNKNOWN_ERROR;
  }
}

/**
 * Error dari PostgREST untuk tabel selain `public.profiles` (klub, garasi).
 *
 * Dipisahkan dari `mapProfileError` karena pesannya berbeda: benturan username
 * pada profil dan benturan nama/alamat klub sama-sama berkode `23505`, tetapi
 * saran perbaikannya tidak sama. Kode yang dikembalikan tetap himpunan `AppErrorCode`
 * sehingga pemanggil dapat menanganinya secara seragam.
 */
export function mapTableError(error: unknown): AppError {
  const like = toErrorLike(error);

  if (isFetchFailure(like)) return NETWORK_ERROR;

  switch (like.code) {
    case '23505':
      return {
        code: 'conflict',
        message:
          'Nilai ini sudah dipakai data lain (mis. nama klub yang sudah ada). Ubah sedikit, lalu simpan lagi.',
        retryable: false,
      };
    case '23503':
      return {
        code: 'invalid_data',
        message:
          'Data ini menunjuk baris yang tidak ada atau masih dipakai baris lain. Muat ulang halaman lalu coba lagi.',
        retryable: false,
      };
    case '23514':
      return {
        code: 'invalid_data',
        message: 'Data ditolak oleh aturan database. Periksa kembali isian Anda, lalu simpan lagi.',
        retryable: false,
      };
    case '42501':
    case 'PGRST301':
      return {
        code: 'not_authorized',
        message:
          'Database menolak perubahan ini. Kemungkinan sesi Anda sudah berakhir atau data bukan milik akun Anda; masuk kembali lalu coba lagi.',
        retryable: false,
      };
    case 'PGRST116':
      // 0 baris terpengaruh: baris tidak ada, atau bukan milik sesi ini (RLS).
      return {
        code: 'not_found',
        message:
          'Data tidak ditemukan atau bukan milik akun Anda. Muat ulang halaman, lalu coba lagi.',
        retryable: false,
      };
    case 'P0002':
      // `raise ... using errcode = 'P0002'` dari RPC: baris target tidak ada.
      return {
        code: 'not_found',
        message: 'Data yang dituju tidak ada lagi di database. Muat ulang halaman, lalu coba lagi.',
        retryable: false,
      };
    case '22023':
      // Argumen ditolak RPC (mis. peran tidak dikenal, status bukan pending).
      return {
        code: 'invalid_data',
        message:
          'Permintaan ini ditolak aturan klub. Muat ulang data terbaru, lalu ulangi dengan pilihan yang tersedia.',
        retryable: false,
      };
    case 'PGRST205':
    case '42P01':
      return {
        code: 'table_missing',
        message:
          'Tabel ini belum tersedia di backend. Jalankan migration Supabase (lihat docs/SETUP_GUIDE.md) lalu coba lagi.',
        retryable: false,
      };
    default:
      return UNKNOWN_ERROR;
  }
}

/**
 * Error dari pemanggilan RPC (`client.rpc(...)`).
 *
 * Beda penting dibanding `mapTableError`: bila fungsi RPC-nya sendiri belum ada di
 * backend, PostgREST menjawab `PGRST202` (dan PostgreSQL `42883`). Itu bukan
 * kegagalan sementara, jadi pesannya harus menyebut migration yang belum
 * diterapkan — bukan "terjadi kesalahan" yang menyuruh pengguna mencoba lagi.
 */
export function mapRpcError(error: unknown): AppError {
  const like = toErrorLike(error);

  switch (like.code) {
    case 'PGRST202':
    case '42883':
      return {
        code: 'table_missing',
        message:
          'Backend belum memuat fungsi keanggotaan klub. Terapkan migration Milestone 2 (20261016093000_club_membership_rpc.sql) lalu coba lagi — lihat docs/SETUP_GUIDE.md.',
        retryable: false,
      };
    default:
      return mapTableError(error);
  }
}
