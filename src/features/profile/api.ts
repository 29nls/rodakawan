/**
 * Lapisan API profil.
 *
 * Batas keamanan: setiap query selalu difilter dengan `id` pengguna dari sesi
 * (argumen `userId` yang diambil pemanggil dari `useAuthSession`), dan RLS di
 * database tetap menjadi otoritas terakhir — user A tidak bisa membaca atau
 * mengubah baris user B walau `userId` dimanipulasi di memori aplikasi.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { mapProfileError, type AppError } from '@/features/auth/errors';
import { normalizeUsername, optionalText } from '@/features/profile/validation';
import type { Database, ProfileRow } from '@/lib/supabase/database.types';

export type ProfileClient = SupabaseClient<Database>;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

export type ProfileInput = {
  username: string;
  displayName: string;
  bio: string;
  city: string;
};

type ProfileWritePayload = {
  username: string;
  display_name: string;
  bio: string | null;
  city: string | null;
};

function toPayload(input: ProfileInput): ProfileWritePayload {
  return {
    username: normalizeUsername(input.username),
    display_name: input.displayName.trim(),
    bio: optionalText(input.bio),
    city: optionalText(input.city),
  };
}

/** Membaca profil milik pengguna yang sedang masuk. `null` = profil belum ada. */
export async function fetchOwnProfile(
  client: ProfileClient,
  userId: string,
): Promise<ApiResult<ProfileRow | null>> {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();

  if (error) return { ok: false, error: mapProfileError(error) };

  return { ok: true, data: data ?? null };
}

/**
 * Membuat profil untuk pengguna yang sudah terautentikasi tetapi belum punya baris
 * profil (mis. bootstrap trigger belum terpasang). `id` diambil dari sesi sehingga
 * tidak mungkin membuat profil milik orang lain.
 */
export async function createOwnProfile(
  client: ProfileClient,
  userId: string,
  input: ProfileInput,
): Promise<ApiResult<ProfileRow>> {
  const { data, error } = await client
    .from('profiles')
    .insert({ id: userId, ...toPayload(input) })
    .select('*')
    .single();

  if (error) return { ok: false, error: mapProfileError(error) };

  return { ok: true, data };
}

/**
 * Mengubah profil milik pengguna yang sedang masuk.
 * Bila baris tidak ditemukan (0 baris terpengaruh, mis. id bukan milik sesi),
 * PostgREST mengembalikan PGRST116 dan pemanggil menerima error — bukan sukses palsu.
 */
export async function updateOwnProfile(
  client: ProfileClient,
  userId: string,
  input: ProfileInput,
): Promise<ApiResult<ProfileRow>> {
  const { data, error } = await client
    .from('profiles')
    .update(toPayload(input))
    .eq('id', userId)
    .select('*')
    .single();

  if (error) return { ok: false, error: mapProfileError(error) };

  return { ok: true, data };
}
