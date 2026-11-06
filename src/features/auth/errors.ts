/** Pemetaan error Supabase Auth/PostgREST menjadi pesan Bahasa Indonesia yang bisa ditindaklanjuti pengguna (docs/UX_SITEMAP.md bagian 6: "error menggunakan bahasa Indonesia sederhana dan menyebut tindakan pemulihan"). Catatan implementasi: pemetaan memakai pemeriksaan struktural (code/status/name) dan bukan `instanceof`, supaya pengujian tidak perlu membuat kelas error SDK dan tetap akurat ketika SDK memperbarui diri. */

export type AppErrorCode =
  | 'backend_not_configured'
  | 'network'
  | 'rate_limited'
  | 'anonymous_sign_in_disabled'
  | 'username_taken'
  | 'profile_missing'
  | 'not_authorized'
  | 'conflict'
  | 'invalid_data'
  | 'not_found'
  | 'table_missing'
  | 'session_expired'
  | 'unknown'
  /** Hazard report specific codes. */
  | 'invalid_category'
  | 'invalid_severity'
  | 'invalid_coordinates'
  | 'invalid_description'
  | 'duplicate'
  /** Chat konvoi: pelanggaran kontrak pesan, batas laju, dan otorisasi. */
  | 'chat_trim_invalid'
  | 'chat_rate_limit'
  | 'chat_edit_window'
  | 'chat_ride_final'
  | 'chat_not_member'
  | 'chat_message_not_found'
  | 'chat_not_sender'
  | 'chat_system_message'
  /** Moderasi: isi konten tak terbaca lagi, atau langkah kedua gagal setelah yang pertama. */
  | 'content_unavailable'
  | 'partial'
  /** Hapus akun: build lama, proses yang masih berjalan, kegagalan server yang bisa diulang, dan gagal umum. */
  | 'app_outdated'
  | 'deletion_in_progress'
  | 'deletion_incomplete'
  | 'deletion_failed';

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
  /** PostgREST memakai `details`; beberapa jalur Supabase memakai `detail`. */
  detail?: unknown;
  details?: unknown;
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

function toErrorLike(error: unknown): ErrorLike {
  if (typeof error === 'object' && error !== null) return error as ErrorLike;
  return {};
}

/**
 * Tag mesin dari `raise ... using detail = '<tag>'`.
 *
 * Tag stabil; teks `message` database tidak dipakai untuk keputusan atau
 * ditampilkan apa adanya. Menerima `details` (PostgREST) maupun `detail`
 * (beberapa pembungkus Supabase).
 */
function errorTag(like: ErrorLike): string {
  const value = like.details ?? like.detail;
  return typeof value === 'string' ? value : '';
}

export function isFetchFailure(like: ErrorLike): boolean {
  if (like.name === 'AuthRetryableFetchError') return true;
  // Supabase menandai kegagalan jaringan sebagai status 0.
  if (like.status === 0) return true;
  if (like.name === 'FunctionsFetchError') return true;

  const message = like.message ?? '';
  return /network request failed|failed to fetch|network error/i.test(message);
}

/**
 * Error dari Supabase Auth. Hanya alur identitas anonim yang tersisa: pembuatan
 * identitas, pemulihan session, dan pencabutan session.
 *
 * `anonymous_provider_disabled` berarti Anonymous sign-ins belum diaktifkan di
 * project Supabase; itu kesalahan konfigurasi pemilik project, bukan pengguna,
 * sehingga pesannya menyebut langkah persisnya.
 */
export function mapAuthError(error: unknown): AppError {
  const like = toErrorLike(error);

  if (isFetchFailure(like)) return NETWORK_ERROR;

  switch (like.code) {
    case 'anonymous_provider_disabled':
      return {
        code: 'anonymous_sign_in_disabled',
        message:
          'Identitas perangkat belum bisa dibuat karena Anonymous sign-ins belum diaktifkan di project Supabase. Pemilik aplikasi perlu mengaktifkannya di dashboard (Authentication → Sign In / Providers → Anonymous) atau menyetel enable_anonymous_sign_ins = true pada config.toml, lalu mencoba lagi.',
        retryable: false,
      };
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return {
        code: 'rate_limited',
        message: 'Permintaan terlalu sering dikirim. Tunggu sebentar sebelum mencoba lagi.',
        retryable: true,
      };
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'session_expired':
      return {
        code: 'session_expired',
        message:
          'Identitas perangkat ini tidak dapat dipulihkan lagi. Buat identitas baru untuk melanjutkan; keanggotaan klub dan perjalanan lama tidak akan terbawa.',
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
        message:
          'Username sudah dipakai identitas lain. Coba username lain, misalnya dengan angka.',
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
          'Database menolak perubahan ini. Kemungkinan identitas perangkat ini sudah berakhir atau data bukan milik Anda; mulai identitas baru lalu coba lagi.',
        retryable: false,
      };
    case 'PGRST116':
      // 0 baris terpengaruh: baris tidak ada, atau bukan milik sesi ini (RLS).
      return {
        code: 'profile_missing',
        message:
          'Perubahan tidak diterapkan karena profil ini tidak ada atau bukan milik identitas perangkat ini. Muat ulang profil, lalu coba lagi.',
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

/** Error dari PostgREST untuk tabel selain `public.profiles` (klub, garasi). */
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
          'Database menolak perubahan ini. Kemungkinan identitas perangkat ini sudah berakhir atau data bukan milik Anda; mulai identitas baru lalu coba lagi.',
        retryable: false,
      };
    case 'PGRST116':
      // 0 baris terpengaruh: baris tidak ada, atau bukan milik sesi ini (RLS).
      return {
        code: 'not_found',
        message:
          'Data tidak ditemukan atau bukan milik identitas perangkat ini. Muat ulang halaman, lalu coba lagi.',
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

/** Error dari Supabase Storage (unggah, hapus, signed URL). */
export function mapStorageError(error: unknown): AppError {
  const like = toErrorLike(error);

  if (isFetchFailure(like)) return NETWORK_ERROR;

  const status = typeof like.status === 'number' ? like.status : undefined;
  const message = (like.message ?? '').toLowerCase();

  if (
    status === 413 ||
    /payload too large|exceeded the maximum allowed size|file is too large/.test(message)
  ) {
    return {
      code: 'invalid_data',
      message:
        'Berkas foto terlalu besar untuk diunggah. Pilih foto lain atau perkecil ukurannya, lalu coba lagi.',
      retryable: false,
    };
  }

  if (
    status === 415 ||
    /mime type|content type|invalid file type|unsupported media/.test(message)
  ) {
    return {
      code: 'invalid_data',
      message: 'Format berkas ini tidak didukung. Gunakan foto JPG, PNG, atau WEBP.',
      retryable: false,
    };
  }

  if (status === 403 || status === 401) {
    return {
      code: 'not_authorized',
      message:
        'Penyimpanan foto menolak tindakan ini. Pastikan foto ini milik identitas perangkat ini (atau Anda admin klub), lalu muat ulang dan coba lagi.',
      retryable: false,
    };
  }

  if (status === 404) {
    return {
      code: 'not_found',
      message: 'Foto ini tidak ditemukan di penyimpanan. Muat ulang halaman lalu coba lagi.',
      retryable: false,
    };
  }

  if (status === 409) {
    return {
      code: 'conflict',
      message:
        'Foto dengan nama yang sama sudah ada. Coba unggah ulang; nama berkas baru dibuat otomatis.',
      retryable: true,
    };
  }

  if (status === 429) {
    return {
      code: 'rate_limited',
      message: 'Terlalu banyak permintaan unggah. Tunggu sebentar, lalu coba lagi.',
      retryable: true,
    };
  }

  return {
    code: 'unknown',
    message: 'Penyimpanan foto tidak dapat diakses. Periksa koneksi internet Anda, lalu coba lagi.',
    retryable: true,
  };
}

/** Error dari pemanggilan RPC (`client.rpc(...)`). */
export function mapRpcError(error: unknown): AppError {
  const like = toErrorLike(error);
  const tag = errorTag(like);

  // Rate limit ditulis migration sebagai SQLSTATE P0001 + detail tag stabil.
  // Jangan pernah menampilkan SQLSTATE/detail mentah ke pengguna; pesan di
  // bawah ini yang menjelaskan batas dan tindakan pemulihannya.
  switch (tag) {
    case 'club_create_rate_limit':
      return {
        code: 'rate_limited',
        message:
          'Batas pembuatan klub tercapai: maksimal 10 klub baru per jam. Tunggu hingga kuota jam ini pulih, lalu coba lagi.',
        retryable: true,
      };
    case 'ride_create_rate_limit':
      return {
        code: 'rate_limited',
        message:
          'Batas pembuatan perjalanan tercapai: maksimal 10 perjalanan baru per jam. Tunggu sebentar, lalu coba lagi.',
        retryable: true,
      };
    case 'location_publish_rate_limit':
      return {
        code: 'rate_limited',
        message:
          'Lokasi belum dikirim karena terlalu sering. Tunggu beberapa detik; aplikasi akan mencoba lagi saat posisi berikutnya tersedia.',
        retryable: true,
      };
    case 'ride_update_rate_limit':
      return {
        code: 'rate_limited',
        message:
          'Perubahan perjalanan terlalu sering. Tunggu beberapa menit, lalu coba simpan kembali.',
        retryable: true,
      };
    default:
      break;
  }

  switch (like.code) {
    case 'PGRST202':
    case '42883':
      return {
        code: 'table_missing',
        message:
          'Backend belum memuat fungsi yang dibutuhkan. Terapkan migration Milestone 2 (20261016093000_club_membership_rpc.sql) dan Milestone 3 (20261019120000_ride_workflow.sql) lalu coba lagi -- lihat docs/SETUP_GUIDE.md.',
        retryable: false,
      };
    case '23514':
      return {
        code: 'invalid_data',
        message:
          'Aksi ini ditolak aturan perjalanan, mis. status sudah final atau consent lokasi belum memenuhi syarat. Muat ulang data terbaru lalu coba lagi.',
        retryable: false,
      };
    case '22023':
      return {
        code: 'invalid_data',
        message:
          'Permintaan ditolak karena nilainya tidak sah. Periksa kembali isian dan pilihan Anda, lalu coba lagi.',
        retryable: false,
      };
    default:
      return mapTableError(error);
  }
}
/**
 * Update/delete tidak mengenai baris apa pun: barisnya tidak ada, bukan milik
 * akun ini, atau policy RLS menolaknya. Dipakai bersama `mapTableError` untuk
 * menghindari "sukses palsu" ketika 0 baris terpengaruh.
 */
export const ROW_NOT_APPLIED_ERROR: AppError = {
  code: 'not_authorized',
  message:
    'Perubahan tidak diterapkan: data ini bukan milik identitas perangkat ini, atau identitasnya sudah berakhir. Muat ulang lalu coba lagi.',
  retryable: false,
};
