import type { SupabaseClient } from '@supabase/supabase-js';

import { mapRpcError, mapTableError, type AppError } from '@/features/auth/errors';
import type { Database } from '@/lib/supabase/database.types';

export type HazardClient = SupabaseClient<Database>;
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };
export type HazardRow = {
  id: string;
  reporter_id: string;
  ride_id: string | null;
  category: string;
  description: string | null;
  severity: string;
  latitude: number;
  longitude: number;
  expires_at: string;
  status: string;
  created_at: string;
  client_report_id: string | null;
  updated_at: string | null;
};
export type HazardSummary = {
  id: string;
  category: string;
  severity: string;
  status: string;
  created_at: string;
};
export type HazardCreateInput = {
  category: string;
  severity: string;
  latitude: number;
  longitude: number;
  description?: string;
  rideId?: string;
  clientReportId?: string;
};
export type HazardUpdateInput = {
  severity?: string;
  description?: string;
};
export type HazardFilters = {
  category?: string;
  severity?: string;
  status?: string;
  searchLat?: number;
  searchLng?: number;
  radiusM?: number;
};

function hazardInvalidCategory(message: string): AppError {
  return { code: 'invalid_category', message, retryable: false };
}

function hazardInvalidSeverity(message: string): AppError {
  return { code: 'invalid_severity', message, retryable: false };
}

function hazardInvalidCoordinates(message: string): AppError {
  return { code: 'invalid_coordinates', message, retryable: false };
}

function hazardInvalidDescription(message: string): AppError {
  return { code: 'invalid_description', message, retryable: false };
}

function hazardRateLimitMessage(): string {
  return 'Terlalu banyak laporan dalam waktu singkat. Coba lagi nanti.';
}

function hazardDuplicateNearbyMessage(): string {
  return 'Laporan serupa baru saja dikirim di sekitar titik ini.';
}

export async function createHazard(
  client: HazardClient,
  input: HazardCreateInput,
): Promise<ApiResult<HazardRow>> {
  const validCategories = [
    'pothole', 'crash', 'traffic', 'weather', 'flood', 'road_block',
    'traffic_enforcement', 'other'
  ];
  if (!validCategories.includes(input.category)) {
    return { ok: false, error: hazardInvalidCategory('Kategori laporan tidak dikenal: ' + input.category) };
  }

  const validSeverities = ['info', 'moderate', 'high', 'critical'];
  if (!validSeverities.includes(input.severity)) {
    return { ok: false, error: hazardInvalidSeverity('Tingkat keparahan tidak dikenal: ' + input.severity) };
  }

  if (input.latitude < -90 || input.latitude > 90) {
    return { ok: false, error: hazardInvalidCoordinates('Lintang laporan tidak valid') };
  }
  if (input.longitude < -180 || input.longitude > 180) {
    return { ok: false, error: hazardInvalidCoordinates('Bujur laporan tidak valid') };
  }

  if (input.description && input.description.length > 1000) {
    return { ok: false, error: hazardInvalidDescription('Deskripsi laporan maksimal 1000 karakter') };
  }

  if (input.rideId) {
    const { data, error } = await client
      .from('rides')
      .select('id')
      .eq('id', input.rideId)
      .maybeSingle();

    if (error) return { ok: false, error: mapTableError(error) };
    if (!data) {
      return { ok: false, error: { code: 'not_found', message: 'Perjalanan untuk laporan ini tidak ditemukan', retryable: false } };
    }

    const { data: userData } = await client.auth.getUser();
    if (!userData?.user?.id) {
      return { ok: false, error: { code: 'chat_unauthenticated', message: 'Mengirim laporan membutuhkan sesi', retryable: false } };
    }

    const { data: member, error: memberError } = await client
      .from('ride_members')
      .select('role, status')
      .eq('ride_id', input.rideId)
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (memberError) return { ok: false, error: mapTableError(memberError) };
    if (!member || ((member as any).role !== 'host' && (member as any).status !== 'joined')) {
      return { ok: false, error: { code: 'not_authorized', message: 'Hanya peserta perjalanan yang dapat menautkan laporan ke perjalanan itu', retryable: false } };
    }
  }

  const { data, error } = await (client.rpc as any)('create_hazard', {
    p_category: input.category,
    p_severity: input.severity,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_description: input.description ?? null,
    p_ride_id: input.rideId ?? null,
    p_client_report_id: input.clientReportId ?? null,
  });

  if (error) {
    const detail = (error as any).details || (error as any).detail || '';
    if (typeof detail === 'string' && detail.includes('hazard_rate_limit')) {
      return { ok: false, error: { code: 'rate_limited', message: hazardRateLimitMessage(), retryable: true } };
    }
    if (typeof detail === 'string' && detail.includes('hazard_duplicate_nearby')) {
      return { ok: false, error: { code: 'duplicate', message: hazardDuplicateNearbyMessage(), retryable: false } };
    }
    return { ok: false, error: mapRpcError(error) };
  }

  return { ok: true, data: data as HazardRow };
}

export async function updateHazard(
  client: HazardClient,
  hazardId: string,
  input: HazardUpdateInput,
): Promise<ApiResult<HazardRow>> {
  const { data, error } = await (client.rpc as any)('update_hazard', {
    p_hazard_id: hazardId,
    p_severity: input.severity,
    p_description: input.description ?? null,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data: data as HazardRow };
}

export async function removeHazard(
  client: HazardClient,
  hazardId: string,
): Promise<ApiResult<HazardRow>> {
  const { data, error } = await (client.rpc as any)('remove_hazard', {
    p_hazard_id: hazardId,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data: data as HazardRow };
}

export async function confirmHazard(
  client: HazardClient,
  hazardId: string,
): Promise<ApiResult<{ total: number }>> {
  const { data, error } = await (client.rpc as any)('confirm_hazard', {
    p_hazard_id: hazardId,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data: { total: (data as number) || 0 } };
}

export async function expireHazardReports(
  client: HazardClient,
): Promise<ApiResult<{ count: number }>> {
  const { data, error } = await (client.rpc as any)('expire_hazard_reports', {});

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data: { count: (data as number) || 0 } };
}

export async function getActiveHazards(
  client: HazardClient,
  filters: HazardFilters = {},
): Promise<ApiResult<HazardRow[]>> {
  let query = client
    .from('hazard_reports')
    .select('*')
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (filters.category) {
    query = query.eq('category', filters.category);
  }
  if (filters.severity) {
    query = query.eq('severity', filters.severity);
  }

  const { data, error } = await query;

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data: (data || []) as HazardRow[] };
}