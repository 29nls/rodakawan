/**
 * Layanan laporan bahaya jalan (Milestone 4).
 *
 * Aturan penting:
 * - identitas pelapor tidak pernah dikirim dari sini; database memakai `auth.uid()`;
 * - `expires_at` tidak pernah dikirim klien — server menghitungnya dari
 *   `created_at` lewat trigger `hazard_reports_expiry_guard`;
 * - jalur tulis hanya RPC `create_hazard`/`update_hazard`/`remove_hazard`/
 *   `confirm_hazard`, karena INSERT/UPDATE/DELETE langsung sudah dicabut
 *   (ADR-066). Validasi di sini hanya untuk umpan balik cepat; database tetap
 *   memeriksa ulang semuanya.
 * - `clientReportId` dipakai sebagai kunci idempotensi: percobaan ulang setelah
 *   jaringan putus mengembalikan laporan yang sama, bukan laporan kedua.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { NETWORK_APP_ERROR, type AppError } from '@/features/auth/errors';
import { mapHazardError } from '@/features/hazards/errors';
import { isHazardActive } from '@/features/hazards/geo';
import {
  HAZARD_CATEGORIES,
  HAZARD_SEVERITIES,
  type HazardCategory,
  type HazardSeverity,
} from '@/features/hazards/labels';
import type { Database } from '@/lib/supabase/database.types';

export type HazardClient = SupabaseClient<Database>;

export type HazardResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

export type HazardRow = {
  id: string;
  reporter_id: string;
  ride_id: string | null;
  category: string;
  description: string | null;
  severity: string;
  latitude: number;
  longitude: number;
  status: string;
  expires_at: string;
  created_at: string;
  updated_at: string | null;
  client_report_id: string | null;
};

export type HazardCreateInput = {
  category: HazardCategory;
  severity: HazardSeverity;
  latitude: number;
  longitude: number;
  description?: string;
  rideId?: string;
  /** UUID dari aplikasi; dipertahankan saat pengiriman diulang. */
  clientReportId?: string;
};

export type HazardUpdateInput = {
  severity: HazardSeverity;
  description?: string;
};

export type HazardFilters = {
  category?: HazardCategory | 'all';
  severity?: HazardSeverity | 'all';
};

export const MAX_HAZARD_DESCRIPTION_LENGTH = 1000;
/** Selaras dengan jendela edit di `update_hazard`/`remove_hazard`. */
export const HAZARD_EDIT_WINDOW_MS = 15 * 60 * 1000;
export const HAZARD_LIST_LIMIT = 50;

const ACTIVE_HAZARD_COLUMNS =
  'id, reporter_id, ride_id, category, description, severity, latitude, longitude, status, expires_at, created_at, updated_at, client_report_id';

function invalidCoordinates(): AppError {
  return {
    code: 'invalid_coordinates',
    message:
      'Koordinat laporan tidak valid. Isi lintang antara -90 dan 90 serta bujur antara -180 dan 180, atau pakai lokasi saat ini.',
    retryable: false,
  };
}

/** Bungkus pemanggilan Supabase supaya kegagalan jaringan tidak menjadi exception. */
async function call<T>(
  action: () => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<HazardResult<T>> {
  try {
    const { data, error } = await action();
    if (error) return { ok: false, error: mapHazardError(error) };
    if (data === null || data === undefined) return { ok: false, error: NETWORK_APP_ERROR };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapHazardError(error) };
  }
}

/** Apakah pelapor masih boleh mengubah/melepas laporan (status + jendela 15 menit). */
export function canEditHazard(
  hazard: Pick<HazardRow, 'status' | 'created_at'>,
  now: number = Date.now(),
): boolean {
  if (hazard.status !== 'active') return false;
  const createdAt = Date.parse(hazard.created_at);
  if (Number.isNaN(createdAt)) return false;
  return now - createdAt <= HAZARD_EDIT_WINDOW_MS;
}

/**
 * Daftar laporan aktif. Laporan kedaluwarsa disaring di query (`status` dan
 * `expires_at`), jadi laporan yang sapuan `expire_hazard_reports` belum
 * menyentuhnya tetap tidak pernah tampil sebagai aktif.
 */
export async function getActiveHazards(
  client: HazardClient,
  filters: HazardFilters = {},
): Promise<HazardResult<HazardRow[]>> {
  try {
    let query = client
      .from('hazard_reports')
      .select(ACTIVE_HAZARD_COLUMNS)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(HAZARD_LIST_LIMIT);

    if (filters.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }
    if (filters.severity && filters.severity !== 'all') {
      query = query.eq('severity', filters.severity);
    }

    const { data, error } = await query;
    if (error) return { ok: false, error: mapHazardError(error) };

    const rows = ((data ?? []) as unknown as HazardRow[]).filter((row) => isHazardActive(row));
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, error: mapHazardError(error) };
  }
}

export async function createHazard(
  client: HazardClient,
  input: HazardCreateInput,
): Promise<HazardResult<HazardRow>> {
  if (!HAZARD_CATEGORIES.some((item) => item.value === input.category)) {
    return {
      ok: false,
      error: {
        code: 'invalid_category',
        message: 'Kategori laporan tidak dikenal. Pilih salah satu kategori yang tersedia.',
        retryable: false,
      },
    };
  }

  if (!HAZARD_SEVERITIES.some((item) => item.value === input.severity)) {
    return {
      ok: false,
      error: {
        code: 'invalid_severity',
        message: 'Tingkat keparahan tidak dikenal. Pilih Info, Sedang, Tinggi, atau Kritis.',
        retryable: false,
      },
    };
  }

  if (
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    return { ok: false, error: invalidCoordinates() };
  }

  const description = input.description?.trim() ? input.description.trim() : null;
  if (description !== null && description.length > MAX_HAZARD_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'invalid_description',
        message: 'Deskripsi laporan maksimal 1000 karakter. Pendekkan dulu, lalu kirim lagi.',
        retryable: false,
      },
    };
  }

  return call(async () =>
    (client.rpc as any)('create_hazard', {
      p_category: input.category,
      p_severity: input.severity,
      p_latitude: input.latitude,
      p_longitude: input.longitude,
      p_description: description,
      p_ride_id: input.rideId ?? null,
      p_client_report_id: input.clientReportId ?? null,
    }),
  ) as Promise<HazardResult<HazardRow>>;
}

export async function updateHazard(
  client: HazardClient,
  hazardId: string,
  input: HazardUpdateInput,
): Promise<HazardResult<HazardRow>> {
  if (!HAZARD_SEVERITIES.some((item) => item.value === input.severity)) {
    return {
      ok: false,
      error: {
        code: 'invalid_severity',
        message: 'Tingkat keparahan tidak dikenal. Pilih Info, Sedang, Tinggi, atau Kritis.',
        retryable: false,
      },
    };
  }

  const description = input.description?.trim() ? input.description.trim() : null;
  if (description !== null && description.length > MAX_HAZARD_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'invalid_description',
        message: 'Deskripsi laporan maksimal 1000 karakter. Pendekkan dulu, lalu kirim lagi.',
        retryable: false,
      },
    };
  }

  return call(async () =>
    (client.rpc as any)('update_hazard', {
      p_hazard_id: hazardId,
      p_severity: input.severity,
      p_description: description,
    }),
  ) as Promise<HazardResult<HazardRow>>;
}

/** Lepas laporan (status `removed`, bukan hapus baris) sesuai kebijakan server. */
export async function removeHazard(
  client: HazardClient,
  hazardId: string,
): Promise<HazardResult<HazardRow>> {
  return call(async () =>
    (client.rpc as any)('remove_hazard', { p_hazard_id: hazardId }),
  ) as Promise<HazardResult<HazardRow>>;
}

/** Konfirmasi "masih ada"; server menolak konfirmasi ganda dan laporan kedaluwarsa. */
export async function confirmHazard(
  client: HazardClient,
  hazardId: string,
): Promise<HazardResult<{ total: number }>> {
  const result = await call<number>(async () =>
    (client.rpc as any)('confirm_hazard', { p_hazard_id: hazardId }),
  );

  if (!result.ok) return result;
  return { ok: true, data: { total: typeof result.data === 'number' ? result.data : 0 } };
}

/**
 * Sapuan laporan kedaluwarsa (maintenance). Aman dipanggil kapan pun: pembacaan
 * sudah menyaring `expires_at`, dan fungsi ini hanya merapikan `status`.
 */
export async function expireHazardReports(
  client: HazardClient,
): Promise<HazardResult<{ count: number }>> {
  const result = await call<number>(async () => (client.rpc as any)('expire_hazard_reports', {}));

  if (!result.ok) return result;
  return { ok: true, data: { count: typeof result.data === 'number' ? result.data : 0 } };
}
