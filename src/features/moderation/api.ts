/**
 * Pelaporan penyalahgunaan konten (laporan bahaya dan pesan chat).
 *
 * Memakai `public.content_reports` yang sudah ada sejak skema awal dan RPC
 * `public.report_content` (20261020100000_convoy_chat_m4.sql). Tidak ada peran
 * moderator global yang dibuat di sini: aplikasi hanya mengirim laporan, dan
 * peninjauan tetap di jalur tepercaya. Laporan tidak menghapus konten otomatis.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AppError } from '@/features/auth/errors';
import { mapModerationError } from '@/features/moderation/errors';
import type { ContentReportRow, Database, ModerationReason } from '@/lib/supabase/database.types';

export type ModerationClient = SupabaseClient<Database>;

export type ContentReportTarget = 'hazard' | 'chat_message';

/**
 * Alasan laporan memakai union yang sama dengan CHECK constraint
 * `content_reports.reason` dan `moderation_actions.reason`.
 */
export type ContentReportReason = ModerationReason;

/** Bentuk baris `public.content_reports` (union sesuai CHECK constraint). */
export type { ContentReportRow };

export const CONTENT_REPORT_REASONS: readonly {
  value: ContentReportReason;
  label: string;
}[] = [
  { value: 'spam', label: 'Spam atau iklan' },
  { value: 'harassment', label: 'Pelecehan atau ancaman' },
  { value: 'false_information', label: 'Informasi menyesatkan' },
  { value: 'unsafe_content', label: 'Konten tidak aman' },
  { value: 'privacy', label: 'Membocorkan privasi' },
  { value: 'other', label: 'Alasan lain' },
];

export const MAX_REPORT_DETAILS_LENGTH = 2000;

export type ContentReportInput = {
  targetType: ContentReportTarget;
  targetId: string;
  reason: ContentReportReason;
  details?: string;
};

export type ModerationResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

/**
 * Kirim laporan penyalahgunaan. Pelapor selalu ditentukan `auth.uid()` di
 * database; fungsi ini sengaja tidak menerima identitas pelapor sebagai
 * argumen, sehingga laporan atas nama orang lain tidak mungkin dibuat.
 */
export async function reportContent(
  client: ModerationClient,
  input: ContentReportInput,
): Promise<ModerationResult<ContentReportRow>> {
  if (input.targetType !== 'hazard' && input.targetType !== 'chat_message') {
    return {
      ok: false,
      error: {
        code: 'invalid_data',
        message: 'Jenis konten yang dapat dilaporkan hanya laporan bahaya dan pesan chat.',
        retryable: false,
      },
    };
  }

  if (!CONTENT_REPORT_REASONS.some((item) => item.value === input.reason)) {
    return {
      ok: false,
      error: {
        code: 'invalid_data',
        message: 'Pilih alasan laporan yang tersedia sebelum mengirim.',
        retryable: false,
      },
    };
  }

  const details = input.details?.trim() ? input.details.trim() : null;
  if (details !== null && details.length > MAX_REPORT_DETAILS_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'invalid_data',
        message: 'Rincian laporan maksimal 2000 karakter. Pendekkan dulu, lalu kirim lagi.',
        retryable: false,
      },
    };
  }

  try {
    const { data, error } = await (client.rpc as any)('report_content', {
      p_target_type: input.targetType,
      p_target_id: input.targetId,
      p_reason: input.reason,
      p_details: details,
    });

    if (error) return { ok: false, error: mapModerationError(error) };

    if (!data) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'Laporan Anda tidak terkonfirmasi server. Coba lagi sebentar lagi.',
          retryable: true,
        },
      };
    }

    return { ok: true, data: data as ContentReportRow };
  } catch (error) {
    return { ok: false, error: mapModerationError(error) };
  }
}
