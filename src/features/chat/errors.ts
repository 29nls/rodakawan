/**
 * Pemetaan galat RPC chat konvoi menjadi `AppError`.
 *
 * Kontrak dengan database: `raise exception ... using detail = '<tag>'` di
 * `supabase/migrations/20261020100000_convoy_chat_m4.sql`. Tag stabil, teks
 * `message` tidak: aplikasi memakai pesan di bawah ini, bukan teks database.
 * Tag tak dikenal (jaringan, `PGRST202` saat migration belum diterapkan,
 * penolakan RLS) diteruskan ke `mapRpcError`.
 */

import { mapRpcError, type AppError } from '@/features/auth/errors';

function tagOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const like = error as { detail?: unknown; details?: unknown };
  const detail = like.detail ?? like.details;
  return typeof detail === 'string' ? detail : '';
}

export const CHAT_ERROR_TAGS: Record<string, AppError> = {
  chat_unauthenticated: {
    code: 'not_authorized',
    message: 'Masuk dulu untuk membuka chat konvoi.',
    retryable: false,
  },
  chat_invalid_content: {
    code: 'chat_trim_invalid',
    message: 'Pesan harus 1–2000 karakter setelah spasi di awal/akhir dibuang.',
    retryable: false,
  },
  chat_ride_not_found: {
    code: 'not_found',
    message: 'Perjalanan ini tidak ditemukan. Kembali ke daftar perjalanan lalu buka ulang.',
    retryable: false,
  },
  chat_not_member: {
    code: 'chat_not_member',
    message:
      'Hanya peserta aktif perjalanan ini yang dapat membaca atau mengirim pesan. Bergabung dulu untuk ikut chat.',
    retryable: false,
  },
  chat_ride_final: {
    code: 'chat_ride_final',
    message:
      'Perjalanan ini sudah selesai atau dibatalkan, jadi pesan baru tidak dapat dikirim. Riwayat tetap bisa dibaca.',
    retryable: false,
  },
  chat_rate_limit: {
    code: 'chat_rate_limit',
    message:
      'Terlalu banyak pesan dalam waktu singkat (maksimal 20 per 60 detik). Tunggu sebentar, lalu kirim lagi.',
    retryable: true,
  },
  chat_message_not_found: {
    code: 'chat_message_not_found',
    message: 'Pesan ini tidak ditemukan. Muat ulang riwayat chat.',
    retryable: false,
  },
  chat_not_sender: {
    code: 'chat_not_sender',
    message: 'Hanya pengirim pesan yang dapat mengubah atau menghapus pesannya.',
    retryable: false,
  },
  chat_system_message: {
    code: 'chat_system_message',
    message: 'Pesan sistem tidak dapat diubah atau dihapus.',
    retryable: false,
  },
  chat_message_deleted: {
    code: 'chat_edit_window',
    message: 'Pesan yang sudah dihapus tidak dapat diubah lagi.',
    retryable: false,
  },
  chat_edit_window: {
    code: 'chat_edit_window',
    message:
      'Jendela pengubahan pesan sudah lewat (15 menit sejak dikirim). Kirim pesan baru bila perlu koreksi.',
    retryable: false,
  },
};

export function mapChatError(error: unknown): AppError {
  const tag = tagOf(error);
  if (tag.length === 0) return mapRpcError(error);

  for (const [key, mapped] of Object.entries(CHAT_ERROR_TAGS)) {
    if (tag.includes(key)) return mapped;
  }

  return mapRpcError(error);
}
