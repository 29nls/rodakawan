/**
 * Pemetaan galat RPC moderasi.
 *
 * Dua sumber tag:
 * - `public.report_content` (20261020100000_convoy_chat_m4.sql) untuk pelaporan;
 * - `moderate_hazard`/`moderate_chat_message`/`review_content_report`
 *   (20261021120000_moderation_dashboard.sql) untuk dashboard moderasi.
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
  moderation_unauthenticated: {
    code: 'not_authorized',
    message: 'Masuk dulu untuk meninjau laporan penyalahgunaan.',
    retryable: false,
  },
  moderation_invalid_action: {
    code: 'invalid_data',
    message: 'Tindakan moderasi tidak dikenal. Muat ulang antrean lalu pilih tindakan lagi.',
    retryable: false,
  },
  moderation_invalid_reason: {
    code: 'invalid_data',
    message: 'Alasan moderasi tidak dikenal. Muat ulang antrean lalu coba lagi.',
    retryable: false,
  },
  moderation_invalid_note: {
    code: 'invalid_data',
    message: 'Catatan moderasi maksimal 1000 karakter. Pendekkan dulu, lalu simpan.',
    retryable: false,
  },
  moderation_target_not_found: {
    code: 'not_found',
    message: 'Konten atau laporan ini sudah tidak ditemukan. Muat ulang antrean.',
    retryable: false,
  },
  moderation_target_final: {
    code: 'conflict',
    message:
      'Konten ini sudah final (dilepas, diabaikan, atau kedaluwarsa), jadi tidak bisa dimoderasi lagi.',
    retryable: false,
  },
  moderation_report_closed: {
    code: 'conflict',
    message:
      'Laporan ini sudah ditinjau sebelumnya. Muat ulang antrean untuk melihat status terbaru.',
    retryable: false,
  },
  moderation_not_allowed: {
    code: 'not_authorized',
    message:
      'Hanya host perjalanan atau admin klub pemilik perjalanan yang dapat memoderasi konten ini.',
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
