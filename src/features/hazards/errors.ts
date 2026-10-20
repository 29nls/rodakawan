/**
 * Pemetaan galat RPC laporan bahaya menjadi `AppError`.
 *
 * Kontrak dengan database: setiap `raise exception` di
 * `supabase/migrations/20261020090000_hazard_reports_m4.sql` mengisi
 * `detail` dengan tag mesin yang stabil (`hazard_rate_limit`, …). Teks
 * `message` milik database boleh berubah, jadi aplikasi tidak memakainya untuk
 * mengambil keputusan dan tidak menampilkannya apa adanya: pesan di bawah ini
 * yang dilihat pengguna.
 *
 * Tag yang tidak dikenal jatuh ke `mapRpcError` supaya kegagalan jaringan,
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
export const HAZARD_ERROR_TAGS: Record<string, AppError> = {
  hazard_unauthenticated: {
    code: 'not_authorized',
    message: 'Masuk dulu untuk mengirim atau mengubah laporan bahaya.',
    retryable: false,
  },
  hazard_invalid_category: {
    code: 'invalid_category',
    message: 'Kategori laporan tidak dikenal. Pilih salah satu kategori yang tersedia.',
    retryable: false,
  },
  hazard_invalid_severity: {
    code: 'invalid_severity',
    message: 'Tingkat keparahan tidak dikenal. Pilih Info, Sedang, Tinggi, atau Kritis.',
    retryable: false,
  },
  hazard_invalid_coordinates: {
    code: 'invalid_coordinates',
    message:
      'Koordinat laporan tidak valid. Isi lintang antara -90 dan 90 serta bujur antara -180 dan 180, atau pakai lokasi saat ini.',
    retryable: false,
  },
  hazard_invalid_description: {
    code: 'invalid_description',
    message: 'Deskripsi laporan maksimal 1000 karakter. Pendekkan dulu, lalu kirim lagi.',
    retryable: false,
  },
  hazard_ride_not_found: {
    code: 'not_found',
    message: 'Perjalanan untuk laporan ini tidak ditemukan. Muat ulang daftar perjalanan Anda.',
    retryable: false,
  },
  hazard_ride_not_member: {
    code: 'not_authorized',
    message:
      'Hanya peserta perjalanan yang dapat menautkan laporan ke perjalanan itu. Bergabung dulu, atau kosongkan ID perjalanan.',
    retryable: false,
  },
  hazard_rate_limit: {
    code: 'rate_limited',
    message:
      'Terlalu banyak laporan dalam waktu singkat (maksimal 5 per 10 menit). Tunggu sebentar, lalu coba lagi.',
    retryable: true,
  },
  hazard_duplicate_nearby: {
    code: 'duplicate',
    message:
      'Laporan serupa baru saja dikirim di sekitar titik ini. Konfirmasi laporan yang ada, atau pilih kategori lain.',
    retryable: false,
  },
  hazard_not_found: {
    code: 'not_found',
    message: 'Laporan ini tidak ditemukan. Muat ulang daftar laporan bahaya.',
    retryable: false,
  },
  hazard_not_reporter: {
    code: 'not_authorized',
    message: 'Hanya pelapor yang dapat mengubah atau melepas laporan ini.',
    retryable: false,
  },
  hazard_not_active: {
    code: 'conflict',
    message: 'Laporan ini sudah tidak aktif (kedaluwarsa, dilepas, atau diselesaikan).',
    retryable: false,
  },
  hazard_edit_window: {
    code: 'conflict',
    message:
      'Jendela pengubahan laporan sudah lewat (15 menit sejak dilaporkan). Kirim laporan baru bila kondisinya masih ada.',
    retryable: false,
  },
  hazard_expired: {
    code: 'conflict',
    message:
      'Laporan ini sudah kedaluwarsa, jadi tidak bisa dikonfirmasi. Laporkan ulang bila kondisinya masih ada.',
    retryable: false,
  },
  hazard_already_confirmed: {
    code: 'conflict',
    message: 'Anda sudah mengonfirmasi laporan ini sebelumnya.',
    retryable: false,
  },
  hazard_confirm_rate_limit: {
    code: 'rate_limited',
    message:
      'Terlalu banyak konfirmasi dalam waktu singkat (maksimal 10 per jam). Tunggu sebentar, lalu coba lagi.',
    retryable: true,
  },
  hazard_expiry_immutable: {
    code: 'invalid_data',
    message: 'Masa berlaku laporan dihitung server dan tidak dapat diubah dari aplikasi.',
    retryable: false,
  },
};

/** Terjemahkan galat RPC laporan bahaya/konten; tag tak dikenal memakai `mapRpcError`. */
export function mapHazardError(error: unknown): AppError {
  const tag = tagOf(error);
  if (tag.length === 0) return mapRpcError(error);

  for (const [key, mapped] of Object.entries(HAZARD_ERROR_TAGS)) {
    if (tag.includes(key)) return mapped;
  }

  return mapRpcError(error);
}
