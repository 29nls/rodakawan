/** Mapping kesalahan RPC chat ke `AppError` aplikasi.
 * Konteks: error dari RPC `public.send_chat_message`, `public.edit_chat_message`,
 * `public.delete_chat_message`, `public.report_content`, dan `public.insert_ride_system_message`
 * dipetakan menggunakan kontrak `detail = '<tag>'` di masing-masing fungsi.
 * Lihat `supabase/migrations/20261020100000_convoy_chat_m4.sql` untuk detail tag error.
 */

import type { AppError } from '@/features/auth/errors';

/** Mapping error RPC chat.
 * Setiap kunci sesuai dengan `detail` yang diterbitkan oleh fungsi database.
 */
export function mapChatRpcError(error: any): AppError {
  const detail = error?.detail ?? '';
  const message = error?.message ?? 'Terjadi kesalahan tak terduga';

  switch (true) {
    case detail.includes('chat_unauthenticated'):
      return { code: 'chat_unauthenticated', message: 'Mengirim pesan membutuhkan sesi', retryable: false };
    case detail.includes('chat_invalid_content'):
      return { code: 'chat_trim_invalid', message: detail.replace('pesan harus 1-2000 karakter', ''), retryable: false };
    case detail.includes('chat_ride_not_found'):
      return { code: 'chat_ride_not_found', message: 'Perjalanan tidak ditemukan', retryable: false };
    case detail.includes('chat_not_member'):
      return { code: 'chat_not_member', message: 'Hanya peserta aktif perjalanan ini yang dapat mengirim pesan', retryable: false };
    case detail.includes('chat_ride_final'):
      return { code: 'chat_ride_final', message: 'Perjalanan ini sudah selesai, pesan baru tidak dapat dikirim', retryable: false };
    case detail.includes('chat_rate_limit'):
      return { code: 'chat_rate_limit', message: detail.replace('Terlalu banyak pesan dalam waktu singkat. Coba lagi sebentar lagi.', ''), retryable: true };
    case detail.includes('message_type'):
      return { code: 'chat_edit_window', message: 'Pesan sistem tidak dapat diubah/hapus', retryable: false };
    case detail.includes('chat_message_not_found'):
      return { code: 'chat_message_not_found', message: 'Pesan tidak ditemukan', retryable: false };
    case detail.includes('chat_edit_window'):
      return { code: 'chat_edit_window', message: 'Jendela pengubahan pesan sudah lewat (15 menit sejak dikirim)', retryable: false };
    case detail.includes('chat_not_sender'):
      return { code: 'chat_not_sender', message: 'Hanya pengirim yang dapat mengubah/hapus pesannya', retryable: false };
    case detail.includes('chat_system_message'):
      return { code: 'chat_system_message', message: 'Pesan sistem tidak dapat diubah/hapus', retryable: false };
    case detail.includes('report_invalid_target_type'):
      return { code: 'report_invalid_target_type', message: 'Jenis konten yang dapat dilaporkan hanya hazard dan pesan chat', retryable: false };
    case detail.includes('report_invalid_reason'):
      return { code: 'report_invalid_reason', message: 'Alasan laporan tidak dikenal', retryable: false };
    case detail.includes('report_target_not_found'):
      return { code: 'report_target_not_found', message: 'Target laporan tidak ditemukan', retryable: false };
    default:
      return { code: 'unknown', message, retryable: false };
  }
}
