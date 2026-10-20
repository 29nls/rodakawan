/** Mapping kesalahan RPC laporan bahaya ke `AppError` aplikasi.
 * Konteks: error dari RPC `public.create_hazard`, `public.update_hazard`,
 * `public.remove_hazard`, `public.confirm_hazard`, dan `public.expire_hazard_reports`
 * dipetakan menggunakan kontrak `detail = '<tag>'` di masing-masing fungsi.
 * Lihat `supabase/migrations/20261020090000_hazard_reports_m4.sql` untuk detail tag error.
 */

import type { AppError } from '@/features/auth/errors';

/** Mapping error RPC laporan bahaya.
 * Setiap kunci sesuai dengan `detail` yang diterbitkan oleh fungsi database.
 */
export function mapHazardRpcError(error: any): AppError {
  const detail = error?.detail ?? '';
  const message = error?.message ?? 'Terjadi kesalahan tak terduga';

  switch (true) {
    case detail.includes('hazard_unauthenticated'):
      return { code: 'chat_unauthenticated', message: 'Mengirim laporan bahaya membutuhkan sesi', retryable: false };
    case detail.includes('hazard_invalid_category'):
      return { code: 'invalid_category', message: detail.replace('kategori laporan tidak dikenal: ', ''), retryable: false };
    case detail.includes('hazard_invalid_severity'):
      return { code: 'invalid_severity', message: detail.replace('tingkat keparahan tidak dikenal: ', ''), retryable: false };
    case detail.includes('hazard_invalid_coordinates'):
      return { code: 'invalid_coordinates', message: detail.replace('lintang/bujur laporan tidak valid', ''), retryable: false };
    case detail.includes('hazard_invalid_description'):
      return { code: 'invalid_description', message: detail.replace('deskripsi laporan maksimal 1000 karakter', ''), retryable: false };
    case detail.includes('hazard_ride_not_found'):
      return { code: 'not_found', message: detail.replace('perjalanan untuk laporan ini tidak ditemukan', ''), retryable: false };
    case detail.includes('hazard_ride_not_member'):
      return { code: 'not_authorized', message: detail.replace('hanya peserta perjalanan yang dapat menautkan laporan ke perjalanan itu', ''), retryable: false };
    case detail.includes('hazard_rate_limit'):
      return { code: 'rate_limited', message: detail.replace('Terlalu banyak laporan dalam waktu singkat. Coba lagi nanti.', ''), retryable: true };
    case detail.includes('hazard_duplicate_nearby'):
      return { code: 'duplicate', message: detail.replace('Laporan serupa baru saja dikirim di sekitar titik ini.', ''), retryable: false };
    case detail.includes('hazard_not_found'):
      return { code: 'not_found', message: 'Laporan bahaya tidak ditemukan', retryable: false };
    case detail.includes('hazard_not_active'):
      return { code: 'not_authorized', message: 'Laporan ini sudah tidak aktif', retryable: false };
    case detail.includes('hazard_edit_window'):
      return { code: 'not_authorized', message: 'Jendela pengubahan laporan sudah lewat (15 menit sejak dilaporkan)', retryable: false };
    case detail.includes('hazard_expired'):
      return { code: 'not_authorized', message: 'Laporan ini sudah kedaluwarsa', retryable: false };
    case detail.includes('hazard_already_confirmed'):
      return { code: 'not_authorized', message: 'Anda sudah mengonfirmasi laporan ini', retryable: false };
    case detail.includes('hazard_confirm_rate_limit'):
      return { code: 'rate_limited', message: detail.replace('Terlalu banyak konfirmasi dalam waktu singkat. Coba lagi nanti.', ''), retryable: true };
    case detail.includes('hazard_expiry_immutable'):
      return { code: 'not_authorized', message: 'Masa berlaku laporan dihitung server dan tidak dapat diubah', retryable: false };
    default:
      return { code: 'unknown', message, retryable: false };
  }
}
