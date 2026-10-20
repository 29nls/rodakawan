/**
 * Pemetaan galat RPC `public.report_content` (20261020100000_convoy_chat_m4.sql).
 *
 * Kontraknya sama dengan modul lain: `detail` berisi tag mesin, dan pesan yang
 * dilihat pengguna berasal dari tabel di bawah — bukan teks `raise exception`
 * yang bisa berubah kapan saja.
 */

import { mapRpcError, type AppError } from '@/features/auth/errors';

function tagOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const like = error as { detail?: unknown; details?: unknown };
  const detail = like.detail ?? like.details;
  return typeof detail === 'string' ? detail : '';
}

export const MODERATION_ERROR_TAGS: Record<string, AppError> = {
  report_unauthenticated: {
    code: 'not_authorized',
    message: 'Masuk dulu untuk melaporkan konten.',
    retryable: false,
  },
  report_invalid_target_type: {
    code: 'invalid_data',
    message: 'Jenis konten yang dapat dilaporkan hanya laporan bahaya dan pesan chat.',
    retryable: false,
  },
  report_invalid_reason: {
    code: 'invalid_data',
    message: 'Alasan laporan tidak dikenal. Pilih salah satu alasan yang tersedia.',
    retryable: false,
  },
  report_invalid_details: {
    code: 'invalid_data',
    message: 'Rincian laporan maksimal 2000 karakter. Pendekkan dulu, lalu kirim lagi.',
    retryable: false,
  },
  report_target_not_found: {
    code: 'not_found',
    message: 'Konten yang ingin Anda laporkan sudah tidak ditemukan. Muat ulang lalu coba lagi.',
    retryable: false,
  },
};

export function mapModerationError(error: unknown): AppError {
  const tag = tagOf(error);
  if (tag.length === 0) return mapRpcError(error);

  for (const [key, mapped] of Object.entries(MODERATION_ERROR_TAGS)) {
    if (tag.includes(key)) return mapped;
  }

  return mapRpcError(error);
}
