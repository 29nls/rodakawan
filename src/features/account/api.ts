/**
 * Layanan hapus akun (anonimisasi).
 *
 * Urutan yang benar, dan alasannya:
 *
 *   1. **Kumpulkan** rujukan media milik pengguna (avatar + foto kendaraan) dari
 *      database. Setelah RPC berjalan, baris kendaraan dan `avatar_url` sudah
 *      hilang, jadi daftar path tidak bisa disusun lagi.
 *   2. **Hapus objek Storage** lewat Storage API. RPC sengaja tidak melakukannya:
 *      Supabase menolak DELETE langsung ke `storage.objects` (ADR-076).
 *      Kegagalan langkah ini tidak menghalangi hak pengguna menghapus akunnya —
 *      hasilnya dilaporkan supaya UI bisa memberi tahu, bukan disembunyikan.
 *   3. **Panggil RPC** `delete_my_account()`, yang menganonimkan profil dan
 *      menghapus seluruh data pribadi lain dalam satu transaksi.
 *
 * RPC tidak menerima parameter: identitas selalu `auth.uid()`, jadi tidak ada
 * jalan untuk menghapus akun orang lain dari aplikasi.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ApiResult } from '@/features/auth/api';
import { mapAccountError } from '@/features/account/errors';
import { PROFILE_AVATAR_BUCKET, VEHICLE_PHOTO_BUCKET } from '@/features/media/photos';
import type { Database } from '@/lib/supabase/database.types';

export type AccountClient = SupabaseClient<Database>;

export type MediaObject = {
  bucket: typeof PROFILE_AVATAR_BUCKET | typeof VEHICLE_PHOTO_BUCKET;
  path: string;
};

export type MediaCleanup = {
  /** Objek yang benar-benar dihapus Storage API. */
  removed: number;
  /** Objek yang gagal dihapus; pembersihan operator diperlukan. */
  failed: number;
};

/**
 * Rujukan media milik pengguna. Kegagalan baca dikembalikan sebagai daftar
 * kosong: media yang tidak terbaca tidak boleh membatalkan penghapusan akun.
 */
export async function collectOwnMedia(
  client: AccountClient,
  userId: string,
): Promise<MediaObject[]> {
  const objects: MediaObject[] = [];

  const profile = await client.from('profiles').select('avatar_url').eq('id', userId).maybeSingle();

  if (!profile.error && profile.data?.avatar_url) {
    objects.push({ bucket: PROFILE_AVATAR_BUCKET, path: profile.data.avatar_url });
  }

  const bikes = await client.from('motorcycles').select('photo_path').eq('owner_id', userId);

  if (!bikes.error) {
    for (const bike of bikes.data ?? []) {
      if (bike.photo_path) objects.push({ bucket: VEHICLE_PHOTO_BUCKET, path: bike.photo_path });
    }
  }

  return objects;
}

/** Hapus objek Storage per bucket, tanpa melempar galat ke pemanggil. */
export async function removeOwnMedia(
  client: AccountClient,
  objects: MediaObject[],
): Promise<MediaCleanup> {
  const grouped = new Map<MediaObject['bucket'], string[]>();

  for (const object of objects) {
    const paths = grouped.get(object.bucket) ?? [];
    paths.push(object.path);
    grouped.set(object.bucket, paths);
  }

  let removed = 0;
  let failed = 0;

  for (const [bucket, paths] of grouped) {
    if (paths.length === 0) continue;

    try {
      const { data, error } = await client.storage.from(bucket).remove(paths);

      if (error) {
        failed += paths.length;
        continue;
      }

      removed += data?.length ?? paths.length;
    } catch {
      failed += paths.length;
    }
  }

  return { removed, failed };
}

/** Menganonimkan akun pemanggil. Idempoten di server. */
export async function deleteMyAccount(client: AccountClient): Promise<ApiResult<null>> {
  const { error } = await client.rpc('delete_my_account');

  if (error) return { ok: false, error: mapAccountError(error) };

  return { ok: true, data: null };
}
