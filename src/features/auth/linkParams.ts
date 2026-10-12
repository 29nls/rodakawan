/**
 * Parser parameter tautan email Supabase.
 *
 * Tautan dapat membawa parameter di query string (`?code=...`) atau di fragment
 * (`#access_token=...`), dan `expo-router` hanya memetakan query string menjadi
 * route params. Fungsi murni ini memeriksa keduanya sehingga layar callback tetap
 * bekerja untuk tautan konfirmasi, pemulihan, maupun tautan kedaluwarsa.
 */

import type { EmailLinkParams } from '@/features/auth/api';

function readSegment(segment: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of new URLSearchParams(segment)) {
    if (value.length > 0) result[key] = value;
  }

  return result;
}

function pick(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** @returns parameter tautan yang dikenali; nilai kosong berarti tautan tidak lengkap. */
export function extractEmailLinkParams(url: string | null | undefined): EmailLinkParams {
  if (typeof url !== 'string' || url.length === 0) return {};

  const queryStart = url.indexOf('?');
  const hashStart = url.indexOf('#');

  const queryEnd = hashStart > queryStart && queryStart >= 0 ? hashStart : undefined;
  const query = queryStart >= 0 ? url.slice(queryStart + 1, queryEnd) : '';
  const fragment = hashStart >= 0 ? url.slice(hashStart + 1) : '';

  const values: Record<string, string> = { ...readSegment(query), ...readSegment(fragment) };

  return {
    code: values.code,
    tokenHash: values.token_hash,
    type: values.type,
    errorCode: pick(values.error_code, values.error),
    errorDescription: values.error_description,
    accessToken: values.access_token,
    refreshToken: values.refresh_token,
  };
}

export function hasCompletableParams(params: EmailLinkParams): boolean {
  return Boolean(
    params.errorCode ||
    params.code ||
    params.tokenHash ||
    (params.accessToken && params.refreshToken),
  );
}
