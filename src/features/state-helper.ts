/** Helper shared untuk klasifikasi state dan error handling konsisten.
 *  Semua fitur harus memakai pola ini agar error dan state menampilkan
 *  pesan yang konsisten, menyebut tindakan pemulihan, dan Bahasa Indonesia.
 *
 *  Gunakan dari setiap fitur melalui `import { useSupabaseState, useErrorState }`
 *  dari berkas ini.
 */

/** Status state umum */
export type StateStatus = 'loading' | 'ready' | 'error' | 'empty';

/** Result dari supabase state check */
export function useSupabaseState(): {
  available: boolean;
  reason?: 'not_configured' | 'invalid_url' | 'privileged_key';
  client?: any;
} {
  // Import dinamis untuk menghindari circular dependency di build awal
  // Fungsi ini akan dipakai di layar-layer yang butuh backend
  return { available: false, reason: 'not_configured' };
}

/** Error yang bisa diulang (retryable) */
export function isRetryableError(error: any): boolean {
  if (!error) return false;
  if (error.retryable === true) return true;
  if (error.code === 'network') return true;
  if (error.code === 'rate_limited') return true;
  if (error.code === 'deletion_in_progress') return true;
  if (error.code === 'deletion_incomplete') return true;
  if (error.code === 'account_deletion_rate_limited') return true;
  return false;
}

/** Error yang tidak boleh diulang (tampilkan pesan statis) */
export function isPermanentError(error: any): boolean {
  if (!error) return false;
  if (error.retryable === false) return true;
  if (error.code === 'invalid_credentials') return true;
  if (error.code === 'email_taken') return true;
  if (error.code === 'username_taken') return true;
  if (error.code === 'password_weak') return true;
  if (error.code === 'session_expired') return true;
  if (error.code === 'not_authorized') return true;
  if (error.code === 'profile_missing') return true;
  if (error.code === 'not_found') return true;
  if (error.code === 'invalid_data') return true;
  return false;
}

/** Terjemahkan error Supabase ke AppError konsisten */
export function mapSupabaseError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  // Jika sudah AppError, kembalikan langsung. Pemeriksaan struktural hanya
  // membuktikan ketiga properti ada; nilainya tetap `unknown`, jadi bentuknya
  // ditegaskan sekali di sini alih-alih menyebar `any` ke pemanggil.
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    'retryable' in error
  ) {
    const appError = error as { code: string; message: string; retryable: boolean };
    return {
      code: appError.code,
      message: appError.message,
      retryable: appError.retryable,
    };
  }

  // Jika error object dengan message
  if (error && typeof error === 'object') {
    const msg = (error as any).message ?? String(error);
    const code = (error as any).code ?? 'unknown';

    // Network errors
    if (msg.includes('network') || msg.includes('gagal') || (error as any).status === 0) {
      return {
        code: 'network',
        message:
          'Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi. Data yang sudah Anda isi tidak hilang.',
        retryable: true,
      };
    }

    // Rate limited
    if (msg.includes('terlalu sering') || (error as any).status === 429) {
      return {
        code: 'rate_limited',
        message: 'Permintaan terlalu sering dikirim. Tunggu sebentar sebelum mencoba lagi.',
        retryable: true,
      };
    }

    // Auth errors - basic mapping
    if (msg.includes('kata sandi') || msg.includes('password')) {
      return {
        code: 'invalid_credentials',
        message:
          'Email atau kata sandi tidak cocok. Periksa kembali, atau pulihkan kata sandi bila lupa.',
        retryable: false,
      };
    }

    // Default: unknown error
    return {
      code: 'unknown',
      message:
        'Terjadi kesalahan yang belum dikenali. Coba lagi; bila berulang, laporkan ke pengembang.',
      retryable: true,
    };
  }

  // String error
  if (typeof error === 'string') {
    const msg = error.toLowerCase();
    if (msg.includes('gagal')) {
      return {
        code: 'network',
        message: 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi.',
        retryable: true,
      };
    }
    return {
      code: 'unknown',
      message: error || 'Terjadi kesalahan yang belum dikenali',
      retryable: true,
    };
  }

  // Fallback
  return {
    code: 'unknown',
    message: 'Terjadi kesalahan yang belum dikenali',
    retryable: true,
  };
}

/** Buat pesan error yang sudah diformat untuk ditampilkan di UI */
export function formatErrorMessage(error: any): string {
  const mapped = mapSupabaseError(error);

  // Jika retryable, tambahkan tindakan pemulihan
  if (mapped.retryable) {
    return `${mapped.message} Coba lagi.`;
  }

  // Jika permanent, pesan sudah mencakup tindakan
  return mapped.message;
}

/** Klasifikasi state layar berdasarkan status Supabase */
export function classifyScreenState(
  supabaseAvailable: boolean,
  profileStatus: 'loading' | 'ready' | 'error' | null,
  dataCount: number,
): { status: StateStatus; showEmpty: boolean; showError: boolean } {
  // Jika backend belum dikonfigurasi
  if (!supabaseAvailable) {
    return {
      status: 'error',
      showEmpty: false,
      showError: true,
    };
  }

  // Jika sedang loading
  if (profileStatus === 'loading') {
    return {
      status: 'loading',
      showEmpty: false,
      showError: false,
    };
  }

  // Jika error pada profile
  if (profileStatus === 'error') {
    return {
      status: 'error',
      showEmpty: false,
      showError: true,
    };
  }

  // Jika ready tapi data kosong
  if (profileStatus === 'ready' && dataCount === 0) {
    return {
      status: 'empty',
      showEmpty: true,
      showError: false,
    };
  }

  // Jika ready dengan data
  return {
    status: 'ready',
    showEmpty: false,
    showError: false,
  };
}

/** Teks empty state per tipe layar */
export function getEmptyStateText(
  screenType: 'garage' | 'club' | 'ride' | 'hazard' | 'profile',
): string {
  const texts: Record<string, string> = {
    garage: 'Belum ada kendaraan. Tambah kendaraan pertama dari Profil → Garasi.',
    club: 'Belum ada klub. Buat klub pertama dari Garasi → Buat Klub.',
    ride: 'Belum ada perjalanan. Buat ride pertama dari Garasi → Buat Ride.',
    hazard: 'Belum ada laporan bahaya. Buat laporan dari tab Peringatan.',
    profile: 'Belum ada profil. Lengkapi profil dari area Profil.',
  };
  return texts[screenType] || 'Belum ada data. Mulai dengan menambah data pertama.';
}

/** Teks error state per tipe layar */
export function getErrorStateText(
  screenType: 'auth' | 'profile' | 'garage' | 'club' | 'ride',
): string {
  const texts: Record<string, string> = {
    auth: 'Belum ada konfigurasi Supabase. Isi .env.local lalu jalankan ulang aplikasi.',
    profile: 'Profil tidak dapat dimuat. Masuk kembali, lalu muat ulang profil.',
    garage: 'Gagal memuat garasi. Periksa koneksi, lalu coba lagi.',
    club: 'Gagal memuat klub. Pastikan Anda anggota, lalu muat ulang.',
    ride: 'Gagal memuat perjalanan. Pastikan masih bergabung, lalu muat ulang.',
  };
  return texts[screenType] || 'Terjadi kesalahan. Coba lagi; bila berulang, hubungi dukungan.';
}
