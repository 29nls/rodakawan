/**
 * Helper bersama untuk state layar dan pesan error.
 *
 * Dua hal yang dijaga di sini:
 * - Prasyarat backend/sesi dikembalikan sebagai `AppError`, bukan boolean, supaya
 *   layar menampilkan satu state "belum tersedia" yang menyebut tindakan
 *   pemulihan — bukan spinner yang tidak pernah selesai ketika backend belum
 *   dikonfigurasi atau sesi tidak ada.
 * - Pesan error selalu Bahasa Indonesia dan menyebut langkah berikutnya.
 */

import type { AppError } from '@/features/auth/errors';
import { describeUnavailableReason, type SupabaseClientState } from '@/lib/supabase/client';

/**
 * Prasyarat yang harus terpenuhi sebelum layar memuat data dari Supabase.
 *
 * `sessionMessage` wajib menyebut apa yang harus dilakukan pengguna (mis.
 * "Masuk kembali untuk membuka garasi."), karena pesan ini tampil apa adanya.
 */
export function screenPrecondition(
  backend: SupabaseClientState,
  userId: string | null,
  sessionMessage: string,
): AppError | null {
  if (!backend.available) {
    return {
      code: 'backend_not_configured',
      message: describeUnavailableReason(backend.reason),
      retryable: false,
    };
  }

  if (!userId) {
    return { code: 'session_expired', message: sessionMessage, retryable: false };
  }

  return null;
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
