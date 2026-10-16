/**
 * Lapisan API garasi.
 *
 * Batas keamanan: setiap query dibatasi pada baris milik pengguna dari sesi
 * (`owner_id = userId`), dan RLS di database tetap menjadi otoritas terakhir —
 * `motorcycles_*_owner` serta `motorcycle_private_*_owner` pada
 * `supabase/migrations/20261013022938_initial_schema.sql`.
 *
 * Catatan implementasi:
 * - `id` tidak pernah dikirim klien; kolomnya punya `default gen_random_uuid()`.
 *   Ini juga menghindari `crypto.randomUUID()`, yang tidak tersedia di Hermes —
 *   polyfill di `src/lib/crypto/webcrypto.ts` hanya memasang `getRandomValues`,
 *   `subtle`, `TextEncoder`, dan `btoa`/`atob`.
 * - `updated_at` dikirim eksplisit karena trigger `touch_updated_at` hanya
 *   dipasang pada `public.profiles`.
 * - Hasil update/delete selalu dibaca kembali supaya penolakan RLS (0 baris)
 *   tidak dilaporkan sebagai sukses.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { mapTableError, ROW_NOT_APPLIED_ERROR, type AppError } from '@/features/auth/errors';
import type { Database, MotorcycleRow } from '@/lib/supabase/database.types';

export type GarageClient = SupabaseClient<Database>;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Bentuk ringkas untuk layar; kolom snake_case tidak bocor ke komponen. */
export type MotorcycleSummary = {
  id: string;
  make: string;
  model: string;
  modelYear: number | null;
  nickname: string | null;
  isPrimary: boolean;
  isPublic: boolean;
  photoPath: string | null;
  createdAt: string;
};

export type MotorcycleFormInput = {
  make: string;
  model: string;
  modelYear: number | null;
  nickname: string | null;
  isPrimary: boolean;
};

export type MotorcyclePrivateFormInput = {
  plateNumber: string;
  privateNotes: string | null;
};

export type MotorcyclePrivateDetails = {
  plateNumber: string;
  privateNotes: string;
};

const EMPTY_PRIVATE_DETAILS: MotorcyclePrivateDetails = { plateNumber: '', privateNotes: '' };

function toSummary(row: MotorcycleRow): MotorcycleSummary {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    modelYear: row.model_year,
    nickname: row.nickname,
    isPrimary: row.is_primary,
    isPublic: row.is_public,
    photoPath: row.photo_path,
    createdAt: row.created_at,
  };
}

function toPrivateDetails(row: { plate_number: string | null; private_notes: string | null }) {
  return {
    plateNumber: row.plate_number ?? '',
    privateNotes: row.private_notes ?? '',
  };
}

/**
 * Menurunkan kendaraan primary yang sedang aktif sebelum kendaraan lain
 * dijadikan primary, supaya tidak pernah ada dua primary sekaligus.
 */
async function clearPrimary(client: GarageClient, userId: string): Promise<AppError | null> {
  const { error } = await client
    .from('motorcycles')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq('owner_id', userId)
    .eq('is_primary', true);

  return error ? mapTableError(error) : null;
}

/** Daftar kendaraan milik pengguna yang sedang masuk. */
export async function listOwnMotorcycles(
  client: GarageClient,
  userId: string,
): Promise<ApiResult<MotorcycleSummary[]>> {
  const { data, error } = await client
    .from('motorcycles')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data: data.map(toSummary) };
}

/** Kendaraan publik milik siapa pun, untuk halaman profil publik. */
export async function listPublicMotorcycles(
  client: GarageClient,
): Promise<ApiResult<MotorcycleSummary[]>> {
  const { data, error } = await client
    .from('motorcycles')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data: data.map(toSummary) };
}

/** Menambah kendaraan untuk pengguna yang sedang masuk. */
export async function createMotorcycle(
  client: GarageClient,
  userId: string,
  input: MotorcycleFormInput,
): Promise<ApiResult<MotorcycleSummary>> {
  if (input.isPrimary) {
    const clearError = await clearPrimary(client, userId);
    if (clearError) return { ok: false, error: clearError };
  }

  // `is_public` sengaja tidak dikirim: nilai default kolomnya `true`, dan sampai
  // ada kontrol visibilitas di layar, biarkan database yang menentukan.
  const { data, error } = await client
    .from('motorcycles')
    .insert({
      owner_id: userId,
      make: input.make,
      model: input.model,
      model_year: input.modelYear,
      nickname: input.nickname,
      is_primary: input.isPrimary,
    })
    .select('*')
    .single();

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data: toSummary(data) };
}

/** Mengubah kendaraan milik pengguna yang sedang masuk. */
export async function updateMotorcycle(
  client: GarageClient,
  userId: string,
  motorcycleId: string,
  input: MotorcycleFormInput,
): Promise<ApiResult<MotorcycleSummary>> {
  if (input.isPrimary) {
    const clearError = await clearPrimary(client, userId);
    if (clearError) return { ok: false, error: clearError };
  }

  const { data, error } = await client
    .from('motorcycles')
    .update({
      make: input.make,
      model: input.model,
      model_year: input.modelYear,
      nickname: input.nickname,
      is_primary: input.isPrimary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', motorcycleId)
    .eq('owner_id', userId)
    .select('*')
    .single();

  if (error) {
    // PGRST116 = 0 baris terpengaruh: kendaraan tidak ada atau bukan milik sesi.
    if (error.code === 'PGRST116') return { ok: false, error: ROW_NOT_APPLIED_ERROR };

    return { ok: false, error: mapTableError(error) };
  }

  return { ok: true, data: toSummary(data) };
}

/**
 * Menjadikan satu kendaraan sebagai primary. Kendaraan primary sebelumnya
 * diturunkan lebih dulu, dan id-nya dikembalikan sebagai `previous` supaya
 * pemanggil bisa memberi tahu pengguna apa yang berubah.
 */
export async function setPrimaryMotorcycle(
  client: GarageClient,
  userId: string,
  motorcycleId: string,
): Promise<ApiResult<{ set: string; previous: string | null }>> {
  const { data: current, error: readError } = await client
    .from('motorcycles')
    .select('id')
    .eq('owner_id', userId)
    .eq('is_primary', true)
    .maybeSingle();

  if (readError) return { ok: false, error: mapTableError(readError) };

  const previous = current?.id ?? null;

  if (previous === motorcycleId) {
    return { ok: true, data: { set: motorcycleId, previous } };
  }

  const clearError = await clearPrimary(client, userId);
  if (clearError) return { ok: false, error: clearError };

  const { data, error } = await client
    .from('motorcycles')
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq('id', motorcycleId)
    .eq('owner_id', userId)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return { ok: false, error: ROW_NOT_APPLIED_ERROR };

    return { ok: false, error: mapTableError(error) };
  }

  return { ok: true, data: { set: data.id, previous } };
}

/**
 * Detail privat kendaraan (plat dan catatan) milik pengguna yang sedang masuk.
 * Bila barisnya belum ada, hasilnya kosong — bukan error — supaya formulir bisa
 * ditampilkan kosong tanpa memperlakukan "belum diisi" sebagai kegagalan.
 */
export async function getPrivateMotorcycleDetails(
  client: GarageClient,
  userId: string,
  motorcycleId: string,
): Promise<ApiResult<MotorcyclePrivateDetails>> {
  const { data, error } = await client
    .from('motorcycle_private_details')
    .select('*')
    .eq('motorcycle_id', motorcycleId)
    .eq('owner_id', userId)
    .maybeSingle();

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data: data ? toPrivateDetails(data) : EMPTY_PRIVATE_DETAILS };
}

/**
 * Menyimpan detail privat kendaraan. Memakai `upsert` pada primary key
 * `motorcycle_id` supaya tidak ada balapan antara "cek lalu tulis".
 */
export async function savePrivateMotorcycleDetails(
  client: GarageClient,
  userId: string,
  motorcycleId: string,
  input: MotorcyclePrivateFormInput,
): Promise<ApiResult<MotorcyclePrivateDetails>> {
  const { data, error } = await client
    .from('motorcycle_private_details')
    .upsert(
      {
        motorcycle_id: motorcycleId,
        owner_id: userId,
        plate_number: input.plateNumber,
        private_notes: input.privateNotes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'motorcycle_id' },
    )
    .select('*')
    .single();

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data: toPrivateDetails(data) };
}

/**
 * Menghapus detail privat kendaraan. `deleted: false` berarti tidak ada baris
 * yang perlu dihapus (termasuk bila baris itu bukan milik akun ini), sehingga
 * penghapusan tetap idempoten.
 */
export async function deletePrivateMotorcycleDetails(
  client: GarageClient,
  userId: string,
  motorcycleId: string,
): Promise<ApiResult<{ deleted: boolean }>> {
  const { data, error } = await client
    .from('motorcycle_private_details')
    .delete()
    .eq('motorcycle_id', motorcycleId)
    .eq('owner_id', userId)
    .select('motorcycle_id');

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data: { deleted: data.length > 0 } };
}

/**
 * Menghapus kendaraan milik pengguna yang sedang masuk. Detail privatnya ikut
 * terhapus lewat `on delete cascade` pada `motorcycle_private_details`, jadi tidak
 * ada penghapusan terpisah yang bisa gagal diam-diam.
 */
export async function deleteMotorcycle(
  client: GarageClient,
  userId: string,
  motorcycleId: string,
): Promise<ApiResult<{ deleted: true }>> {
  const { data, error } = await client
    .from('motorcycles')
    .delete()
    .eq('id', motorcycleId)
    .eq('owner_id', userId)
    .select('id');

  if (error) return { ok: false, error: mapTableError(error) };

  if (data.length === 0) return { ok: false, error: ROW_NOT_APPLIED_ERROR };

  return { ok: true, data: { deleted: true } };
}
