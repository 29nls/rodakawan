/**
 * Foto privat kendaraan, logo klub, dan foto profil di Supabase Storage.
 *
 * Batas keamanan:
 * - Bucket `vehicle-photos`, `club-logos`, dan `avatars` bersifat privat. Aplikasi
 *   tidak pernah menyimpan URL publik; tampilan memakai signed URL berumur pendek.
 * - Path adalah bagian otorisasi: `<owner_id>/<motorcycle_id>/<berkas>` untuk
 *   kendaraan, `<club_id>/<berkas>` untuk klub, dan `<user_id>/<berkas>` untuk foto
 *   profil. Policy Storage
 *   (`supabase/migrations/20261017120000_private_photo_storage.sql` dan
 *   `20261018120000_profile_avatar_storage.sql`) menolak folder pengguna/klub lain,
 *   dan kolom `photo_path`/`logo_path`/`avatar_url` dijaga CHECK agar tidak bisa
 *   menautkan objek orang lain walau argumen di memori dimanipulasi.
 * - `profiles.avatar_url` menyimpan **path**, bukan URL: namanya warisan skema awal,
 *   dan CHECK di database menahan bentuknya. Jangan pernah merendernya sebagai URL.
 * - Validasi di sini hanya untuk pengalaman pengguna. Batas ukuran/tipenya juga
 *   ditegakkan bucket; jangan menghapus salah satunya dengan asumsi yang lain
 *   sudah cukup.
 *
 * Alur ganti foto: perkecil/kompres di perangkat -> unggah objek baru -> perbarui
 * baris -> hapus objek lama. Bila update baris gagal (mis. RLS menolak karena bukan
 * pemilik), objek baru dihapus kembali supaya tidak meninggalkan file yatim.
 * Penghapusan objek lama bersifat best-effort: baris sudah tidak menunjuknya, dan
 * hanya pemilik yang bisa membacanya.
 */

import { File } from 'expo-file-system';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  mapStorageError,
  mapTableError,
  ROW_NOT_APPLIED_ERROR,
  type AppError,
} from '@/features/auth/errors';
import {
  CLUB_LOGO_MAX_DIMENSION,
  PROFILE_AVATAR_MAX_DIMENSION,
  VEHICLE_PHOTO_MAX_DIMENSION,
  compressPhoto,
} from '@/features/media/imageCompression';
import type { Database } from '@/lib/supabase/database.types';

export type MediaClient = SupabaseClient<Database>;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

export const VEHICLE_PHOTO_BUCKET = 'vehicle-photos';
export const CLUB_LOGO_BUCKET = 'club-logos';
export const PROFILE_AVATAR_BUCKET = 'avatars';

/** Mengikuti `file_size_limit` bucket; jangan hanya mengandalkan nilai ini. */
export const VEHICLE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const CLUB_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const PROFILE_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Signed URL cukup lama untuk satu sesi melihat halaman, lalu kedaluwarsa. */
export const PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 60;

export const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedPhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<AllowedPhotoMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Foto yang dipilih dari galeri; hanya metadata yang dibutuhkan unggahan. */
export type PhotoAsset = {
  uri: string;
  mimeType?: string | null;
  fileSize?: number | null;
  fileName?: string | null;
};

export type ValidatedPhoto = {
  mimeType: AllowedPhotoMimeType;
  extension: string;
  size: number | null;
};

export type PhotoKind = 'vehicle' | 'club' | 'avatar';

function invalidData(message: string): AppError {
  return { code: 'invalid_data', message, retryable: false };
}

function normalizeMime(value: string | null | undefined): string | undefined {
  const mime = value?.split(';')[0]?.trim().toLowerCase();
  return mime && mime.length > 0 ? mime : undefined;
}

/** Tebak MIME dari nama/URI hanya bila picker tidak memberi `mimeType`. */
function mimeFromFileName(value: string | null | undefined): string | undefined {
  const extension = value?.split('?')[0]?.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

function isAllowedMime(value: string): value is AllowedPhotoMimeType {
  return (ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Tipe berkas yang dipakai untuk validasi dan pemilihan format kompresi. Picker
 * kadang tidak mengisi `mimeType`, jadi nama/URI dipakai sebagai cadangan.
 */
export function inferPhotoMime(asset: PhotoAsset): string | undefined {
  return (
    normalizeMime(asset.mimeType) ?? mimeFromFileName(asset.fileName) ?? mimeFromFileName(asset.uri)
  );
}

/**
 * Menyiapkan berkas sebelum diunggah: diperkecil dan dikompres di perangkat.
 *
 * Dipanggil SEBELUM validasi ukuran supaya foto besar tidak ditolak hanya karena
 * ukuran aslinya — itu inti penghematan kuota. Tipe yang tidak didukung dibiarkan
 * lewat tanpa diproses agar `validatePhotoAsset` yang menolaknya dengan pesan jelas.
 */
async function preparePhotoAsset(asset: PhotoAsset, maxDimension: number): Promise<PhotoAsset> {
  const inferred = inferPhotoMime(asset);

  if (!inferred || !isAllowedMime(inferred)) return asset;

  return compressPhoto(asset, inferred, maxDimension);
}

/**
 * Memeriksa tipe dan ukuran sebelum menyentuh jaringan. `fileSize` yang tidak
 * tersedia (beberapa penyedia galeri tidak melaporkannya) tidak dianggap gagal;
 * bucket tetap menolak berkas yang melebihi batas.
 */
export function validatePhotoAsset(asset: PhotoAsset, maxBytes: number): ApiResult<ValidatedPhoto> {
  const mimeType = inferPhotoMime(asset);

  if (!mimeType || !isAllowedMime(mimeType)) {
    return {
      ok: false,
      error: invalidData('Format foto harus JPG, PNG, atau WEBP. Pilih foto lain dari galeri.'),
    };
  }

  const size = typeof asset.fileSize === 'number' ? asset.fileSize : null;
  const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;

  if (size !== null && size > maxBytes) {
    return {
      ok: false,
      error: invalidData(`Ukuran foto maksimal ${maxMb} MB. Pilih foto lain atau perkecil dulu.`),
    };
  }

  return { ok: true, data: { mimeType, extension: EXTENSION_BY_MIME[mimeType], size } };
}

export function buildVehiclePhotoPath(userId: string, vehicleId: string, fileName: string): string {
  return `${userId}/${vehicleId}/${fileName}`;
}

export function buildClubLogoPath(clubId: string, fileName: string): string {
  return `${clubId}/${fileName}`;
}

export function buildProfileAvatarPath(userId: string, fileName: string): string {
  return `${userId}/${fileName}`;
}

/**
 * Nama berkas baru untuk setiap unggahan. Tidak memakai nama asli dari galeri:
 * nama itu bisa memuat karakter path, dan setiap ganti foto harus menjadi objek
 * baru supaya unggahan berikutnya tidak bergantung pada policy UPDATE/upsert.
 * `token` dapat diisi pada pengujian agar hasilnya deterministik.
 */
export function createPhotoFileName(
  extension: string,
  now: number = Date.now(),
  token: string = Math.random().toString(36).slice(2, 10),
): string {
  return `${now.toString(36)}-${token}.${extension}`;
}

/** Membaca isi berkas lokal sebagai ArrayBuffer (didukung storage-js di RN). */
async function readFileBytes(uri: string): Promise<ArrayBuffer> {
  return new File(uri).arrayBuffer();
}

async function uploadObject(
  client: MediaClient,
  bucket: string,
  path: string,
  mimeType: AllowedPhotoMimeType,
  uri: string,
): Promise<AppError | null> {
  let bytes: ArrayBuffer;

  try {
    bytes = await readFileBytes(uri);
  } catch {
    return invalidData(
      'Foto tidak dapat dibaca dari perangkat. Pilih ulang foto dari galeri, lalu coba lagi.',
    );
  }

  if (bytes.byteLength === 0) {
    return invalidData('Berkas foto kosong. Pilih foto lain dari galeri.');
  }

  const { error } = await client.storage.from(bucket).upload(path, bytes, {
    contentType: mimeType,
    cacheControl: '3600',
    upsert: false,
  });

  return error ? mapStorageError(error) : null;
}

/** Penghapusan objek lama tidak boleh menggagalkan aksi yang sudah tersimpan. */
async function removeObjectBestEffort(
  client: MediaClient,
  bucket: string,
  path: string,
): Promise<void> {
  await client.storage
    .from(bucket)
    .remove([path])
    .catch(() => undefined);
}

/**
 * Menghapus objek tanpa menyentuh baris database. Dipakai setelah baris induk
 * dihapus (kendaraan), saat path lama sudah tidak bisa dibaca lagi dari tabel.
 * Kegagalan di sini tidak dilaporkan sebagai kegagalan aksi utama: objek tetap
 * hanya bisa dibaca pemiliknya dan tidak lagi dirujuk aplikasi.
 */
export async function removePhotoObject(
  client: MediaClient,
  bucket: string,
  path: string,
): Promise<void> {
  await removeObjectBestEffort(client, bucket, path);
}

/** Signed URL untuk menampilkan objek privat; URL-nya tidak disimpan permanen. */
export async function getPhotoSignedUrl(
  client: MediaClient,
  bucket: string,
  path: string,
  expiresIn: number = PHOTO_SIGNED_URL_TTL_SECONDS,
): Promise<ApiResult<string>> {
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);

  if (error) return { ok: false, error: mapStorageError(error) };

  if (!data?.signedUrl) {
    return {
      ok: false,
      error: {
        code: 'unknown',
        message: 'Penyimpanan tidak mengembalikan tautan foto. Muat ulang halaman lalu coba lagi.',
        retryable: true,
      },
    };
  }

  return { ok: true, data: data.signedUrl };
}

/* ------------------------------------------------------------------ kendaraan */

export type VehiclePhoto = { path: string };

/**
 * Mengunggah atau mengganti foto kendaraan milik pengguna yang sedang masuk.
 * Membaca baris lebih dulu membuktikan kepemilikan sebelum berkas dikirim, dan
 * menyediakan path lama untuk dibersihkan setelah baris berhasil diperbarui.
 */
export async function uploadVehiclePhoto(
  client: MediaClient,
  userId: string,
  vehicleId: string,
  asset: PhotoAsset,
): Promise<ApiResult<VehiclePhoto>> {
  const prepared = await preparePhotoAsset(asset, VEHICLE_PHOTO_MAX_DIMENSION);
  const checked = validatePhotoAsset(prepared, VEHICLE_PHOTO_MAX_BYTES);
  if (!checked.ok) return checked;

  const { data: current, error: readError } = await client
    .from('motorcycles')
    .select('photo_path')
    .eq('id', vehicleId)
    .eq('owner_id', userId)
    .maybeSingle();

  if (readError) return { ok: false, error: mapTableError(readError) };
  if (!current) return { ok: false, error: ROW_NOT_APPLIED_ERROR };

  const path = buildVehiclePhotoPath(
    userId,
    vehicleId,
    createPhotoFileName(checked.data.extension),
  );

  const uploadError = await uploadObject(
    client,
    VEHICLE_PHOTO_BUCKET,
    path,
    checked.data.mimeType,
    prepared.uri,
  );
  if (uploadError) return { ok: false, error: uploadError };

  const { error: updateError } = await client
    .from('motorcycles')
    .update({ photo_path: path, updated_at: new Date().toISOString() })
    .eq('id', vehicleId)
    .eq('owner_id', userId)
    .select('id')
    .single();

  if (updateError) {
    // Baris tidak ikut berubah: jangan tinggalkan objek yang tidak dirujuk siapa pun.
    await removeObjectBestEffort(client, VEHICLE_PHOTO_BUCKET, path);

    if (updateError.code === 'PGRST116') return { ok: false, error: ROW_NOT_APPLIED_ERROR };

    return { ok: false, error: mapTableError(updateError) };
  }

  if (current.photo_path && current.photo_path !== path) {
    await removeObjectBestEffort(client, VEHICLE_PHOTO_BUCKET, current.photo_path);
  }

  return { ok: true, data: { path } };
}

/**
 * Menghapus foto kendaraan. Kolom dikosongkan lebih dulu agar aplikasi tidak
 * pernah menampilkan path yang objeknya sudah hilang; objeknya lalu dibersihkan.
 */
export async function deleteVehiclePhoto(
  client: MediaClient,
  userId: string,
  vehicleId: string,
): Promise<ApiResult<{ deleted: boolean }>> {
  const { data: current, error: readError } = await client
    .from('motorcycles')
    .select('photo_path')
    .eq('id', vehicleId)
    .eq('owner_id', userId)
    .maybeSingle();

  if (readError) return { ok: false, error: mapTableError(readError) };
  if (!current) return { ok: false, error: ROW_NOT_APPLIED_ERROR };

  if (!current.photo_path) return { ok: true, data: { deleted: false } };

  const { error: updateError } = await client
    .from('motorcycles')
    .update({ photo_path: null, updated_at: new Date().toISOString() })
    .eq('id', vehicleId)
    .eq('owner_id', userId)
    .select('id')
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') return { ok: false, error: ROW_NOT_APPLIED_ERROR };

    return { ok: false, error: mapTableError(updateError) };
  }

  await removeObjectBestEffort(client, VEHICLE_PHOTO_BUCKET, current.photo_path);

  return { ok: true, data: { deleted: true } };
}

/* ----------------------------------------------------------------------- klub */

export type ClubLogo = { path: string };

/**
 * Mengunggah atau mengganti logo klub. Hanya owner/admin aktif yang dapat
 * melakukannya; policy Storage dan policy UPDATE `clubs` menolak peran lain,
 * termasuk anggota biasa.
 */
export async function uploadClubLogo(
  client: MediaClient,
  clubId: string,
  asset: PhotoAsset,
): Promise<ApiResult<ClubLogo>> {
  const prepared = await preparePhotoAsset(asset, CLUB_LOGO_MAX_DIMENSION);
  const checked = validatePhotoAsset(prepared, CLUB_LOGO_MAX_BYTES);
  if (!checked.ok) return checked;

  const { data: current, error: readError } = await client
    .from('clubs')
    .select('logo_path')
    .eq('id', clubId)
    .maybeSingle();

  if (readError) return { ok: false, error: mapTableError(readError) };

  if (!current) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: 'Klub tidak ditemukan, atau Anda bukan anggotanya. Muat ulang halaman klub.',
        retryable: false,
      },
    };
  }

  const path = buildClubLogoPath(clubId, createPhotoFileName(checked.data.extension));

  const uploadError = await uploadObject(
    client,
    CLUB_LOGO_BUCKET,
    path,
    checked.data.mimeType,
    prepared.uri,
  );
  if (uploadError) return { ok: false, error: uploadError };

  const { error: updateError } = await client
    .from('clubs')
    .update({ logo_path: path, updated_at: new Date().toISOString() })
    .eq('id', clubId)
    .select('id')
    .single();

  if (updateError) {
    await removeObjectBestEffort(client, CLUB_LOGO_BUCKET, path);

    if (updateError.code === 'PGRST116') return { ok: false, error: ROW_NOT_APPLIED_ERROR };

    return { ok: false, error: mapTableError(updateError) };
  }

  if (current.logo_path && current.logo_path !== path) {
    await removeObjectBestEffort(client, CLUB_LOGO_BUCKET, current.logo_path);
  }

  return { ok: true, data: { path } };
}

/** Menghapus logo klub. Sama seperti foto kendaraan: baris dulu, objek kemudian. */
export async function deleteClubLogo(
  client: MediaClient,
  clubId: string,
): Promise<ApiResult<{ deleted: boolean }>> {
  const { data: current, error: readError } = await client
    .from('clubs')
    .select('logo_path')
    .eq('id', clubId)
    .maybeSingle();

  if (readError) return { ok: false, error: mapTableError(readError) };
  if (!current) return { ok: false, error: ROW_NOT_APPLIED_ERROR };

  if (!current.logo_path) return { ok: true, data: { deleted: false } };

  const { error: updateError } = await client
    .from('clubs')
    .update({ logo_path: null, updated_at: new Date().toISOString() })
    .eq('id', clubId)
    .select('id')
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') return { ok: false, error: ROW_NOT_APPLIED_ERROR };

    return { ok: false, error: mapTableError(updateError) };
  }

  await removeObjectBestEffort(client, CLUB_LOGO_BUCKET, current.logo_path);

  return { ok: true, data: { deleted: true } };
}

/* --------------------------------------------------------------------- profil */

export type ProfileAvatar = { path: string };

const PROFILE_MISSING_ERROR: AppError = {
  code: 'not_found',
  message: 'Profil belum ada di server. Lengkapi profil terlebih dahulu, lalu unggah foto profil.',
  retryable: false,
};

/**
 * Nilai `avatar_url` hanya dipakai sebagai path bila berbentuk `<user_id>/<berkas>`
 * milik pengguna ini. Kolomnya bertipe teks bebas secara historis, jadi nilai lain
 * (mis. URL lama) tidak boleh dipakai untuk meminta atau menghapus objek di bucket.
 */
export function isOwnProfileAvatarPath(userId: string, value: string | null): value is string {
  if (!value) return false;

  const separator = value.indexOf('/');
  if (separator <= 0) return false;

  return value.slice(0, separator) === userId && value.slice(separator + 1).length > 0;
}

/**
 * Mengunggah atau mengganti foto profil milik pengguna yang sedang masuk.
 *
 * Membaca baris `profiles` lebih dulu: tanpa baris itu tidak ada tempat menyimpan
 * path, dan berkas tidak boleh dikirim ke bucket lebih dulu. Alurnya sama dengan
 * foto kendaraan — objek baru diunggah, baris diperbarui, objek lama dihapus
 * best-effort; bila baris gagal diperbarui, objek baru dibersihkan kembali.
 */
export async function uploadProfileAvatar(
  client: MediaClient,
  userId: string,
  asset: PhotoAsset,
): Promise<ApiResult<ProfileAvatar>> {
  const prepared = await preparePhotoAsset(asset, PROFILE_AVATAR_MAX_DIMENSION);
  const checked = validatePhotoAsset(prepared, PROFILE_AVATAR_MAX_BYTES);
  if (!checked.ok) return checked;

  const { data: current, error: readError } = await client
    .from('profiles')
    .select('avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (readError) return { ok: false, error: mapTableError(readError) };
  if (!current) return { ok: false, error: PROFILE_MISSING_ERROR };

  const path = buildProfileAvatarPath(userId, createPhotoFileName(checked.data.extension));

  const uploadError = await uploadObject(
    client,
    PROFILE_AVATAR_BUCKET,
    path,
    checked.data.mimeType,
    prepared.uri,
  );
  if (uploadError) return { ok: false, error: uploadError };

  const { error: updateError } = await client
    .from('profiles')
    .update({ avatar_url: path })
    .eq('id', userId)
    .select('id')
    .single();

  if (updateError) {
    // Baris tidak ikut berubah: jangan tinggalkan objek yang tidak dirujuk siapa pun.
    await removeObjectBestEffort(client, PROFILE_AVATAR_BUCKET, path);

    if (updateError.code === 'PGRST116') return { ok: false, error: ROW_NOT_APPLIED_ERROR };

    return { ok: false, error: mapTableError(updateError) };
  }

  if (isOwnProfileAvatarPath(userId, current.avatar_url) && current.avatar_url !== path) {
    await removeObjectBestEffort(client, PROFILE_AVATAR_BUCKET, current.avatar_url);
  }

  return { ok: true, data: { path } };
}

/**
 * Menghapus foto profil. Kolom dikosongkan lebih dulu agar aplikasi tidak pernah
 * menampilkan path yang objeknya sudah hilang; objeknya lalu dibersihkan.
 * Idempoten: profil tanpa foto tetap dianggap berhasil.
 */
export async function deleteProfileAvatar(
  client: MediaClient,
  userId: string,
): Promise<ApiResult<{ deleted: boolean }>> {
  const { data: current, error: readError } = await client
    .from('profiles')
    .select('avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (readError) return { ok: false, error: mapTableError(readError) };
  if (!current) return { ok: false, error: PROFILE_MISSING_ERROR };
  if (!current.avatar_url) return { ok: true, data: { deleted: false } };

  const { error: updateError } = await client
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', userId)
    .select('id')
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') return { ok: false, error: ROW_NOT_APPLIED_ERROR };

    return { ok: false, error: mapTableError(updateError) };
  }

  if (isOwnProfileAvatarPath(userId, current.avatar_url)) {
    await removeObjectBestEffort(client, PROFILE_AVATAR_BUCKET, current.avatar_url);
  }

  return { ok: true, data: { deleted: true } };
}
