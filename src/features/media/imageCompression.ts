/**
 * Memperkecil dan mengompres foto di perangkat sebelum diunggah.
 *
 * Kenapa ada:
 * - Foto dari galeri ponsel biasanya 12 MP (4000×3000) dan 2–5 MB. Foto itu tidak
 *   pernah ditampilkan lebih besar dari kartu foto di aplikasi, jadi mengunggahnya
 *   utuh hanya menghabiskan kuota Storage dan waktu unggah pengguna.
 * - Semua keputusan diperkecil/kompres dibuat di sini sebagai fungsi murni
 *   (`fitWithin`, `needsCompression`, `saveFormatFor`) supaya bisa diuji tanpa
 *   perangkat; hanya `compressPhoto` yang menyentuh modul native.
 *
 * Yang dipegang:
 * - Hanya memperkecil, tidak pernah memperbesar — foto 800 px tetap 800 px.
 * - Format dipertahankan (JPEG tetap JPEG, PNG tetap PNG, WEBP tetap WEBP) agar
 *   transparansi PNG/WEBP tidak berubah menjadi latar hitam/putih.
 * - Foto yang sudah kecil dan tidak perlu diperkecil tidak disentuh sama sekali;
 *   mengompres ulang hanya membuang kualitas tanpa penghematan berarti.
 * - Kegagalan manipulasi tidak pernah memblokir unggahan: berkas asli dipakai
 *   kembali, dan batas ukuran/tipenya tetap ditegakkan bucket + validasi.
 * - Berkas hasil kompresi ditulis ke cache oleh modul native; berkas asli dari
 *   galeri tidak diubah atau dihapus.
 */

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

import type { AllowedPhotoMimeType, PhotoAsset } from '@/features/media/photos';

/**
 * Sisi terpanjang setelah diperkecil. 1600 px masih tajam di layar ponsel padat
 * (kartu foto paling besar ± 400 px) tetapi memotong foto 12 MP jadi ≈ 1/6 area.
 */
export const VEHICLE_PHOTO_MAX_DIMENSION = 1600;

/** Logo klub tampil ≤ 200 px; 512 px cukup untuk layar padat dan tetap kecil. */
export const CLUB_LOGO_MAX_DIMENSION = 512;

/** Foto profil tampil ≤ 96 px (lingkaran); 512 px cukup tajam dan tetap hemat. */
export const PROFILE_AVATAR_MAX_DIMENSION = 512;

/** Kualitas JPEG/WEBP hasil kompres ulang (1 = tanpa kompresi). */
export const PHOTO_COMPRESSION_QUALITY = 0.7;

/**
 * Berkas di bawah ukuran ini dibiarkan apa adanya meski dimensinya masih besar.
 * Ambangnya sengaja jauh di bawah `file_size_limit` bucket: menghemat kuota
 * berarti memangkas berkas megabyte, bukan foto 200 KB yang sudah wajar.
 */
export const PHOTO_SKIP_COMPRESSION_BYTES = 512 * 1024;

export type PhotoDimensions = { width: number; height: number };

/**
 * Ukuran baru dengan sisi terpanjang tepat `maxDimension` dan rasio tetap.
 * Mengembalikan `null` bila foto sudah cukup kecil atau ukurannya tidak masuk akal
 * (beberapa penyedia galeri melaporkan 0×0 untuk berkas yang gagal dibaca).
 */
export function fitWithin(size: PhotoDimensions, maxDimension: number): PhotoDimensions | null {
  if (!(size.width > 0) || !(size.height > 0) || !(maxDimension > 0)) return null;

  const longest = Math.max(size.width, size.height);
  if (longest <= maxDimension) return null;

  const scale = maxDimension / longest;

  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** PNG/WEBP dipertahankan; JPEG disimpan ulang sebagai JPEG. */
export function saveFormatFor(mimeType: AllowedPhotoMimeType): SaveFormat {
  switch (mimeType) {
    case 'image/png':
      return SaveFormat.PNG;
    case 'image/webp':
      return SaveFormat.WEBP;
    default:
      return SaveFormat.JPEG;
  }
}

/**
 * Apakah berkas perlu diproses ulang? Diperkecil bila dimensinya melebihi batas;
 * dikompres ulang bila ukurannya belum diketahui atau masih di atas ambang.
 */
export function needsCompression(
  asset: PhotoAsset,
  source: PhotoDimensions | null,
  maxDimension: number,
): boolean {
  if (source && fitWithin(source, maxDimension)) return true;

  return typeof asset.fileSize !== 'number' || asset.fileSize > PHOTO_SKIP_COMPRESSION_BYTES;
}

/** Ukuran gambar dibaca dari metadata, bukan dengan mendekode seluruh berkas. */
async function readDimensions(uri: string): Promise<PhotoDimensions | null> {
  try {
    const size = await Image.getSize(uri);

    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/** Ukuran berkas hasil kompresi; `null` bila tidak dapat dibaca. */
function fileSizeOf(uri: string): number | null {
  try {
    const size = new File(uri).size;

    return typeof size === 'number' && size > 0 ? size : null;
  } catch {
    return null;
  }
}

/**
 * Menyiapkan berkas untuk diunggah: diperkecil ke `maxDimension` (sisi terpanjang)
 * dan dikompres ulang. Selalu mengembalikan `PhotoAsset` yang siap diunggah —
 * berkas asli bila memang tidak perlu diproses atau bila manipulasi gagal.
 *
 * Bila dimensi tidak terbaca (mis. URI `content://` yang tidak dikenali RN),
 * foto tetap dikompres ulang tanpa diperkecil: penghematan kualitasnya lebih
 * kecil, tetapi unggahannya tidak pernah gagal karena langkah ini.
 */
export async function compressPhoto(
  asset: PhotoAsset,
  mimeType: AllowedPhotoMimeType,
  maxDimension: number,
): Promise<PhotoAsset> {
  try {
    const source = await readDimensions(asset.uri);

    if (!needsCompression(asset, source, maxDimension)) return asset;

    const context = ImageManipulator.manipulate(asset.uri);
    const target = source ? fitWithin(source, maxDimension) : null;

    if (target) context.resize(target);

    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      compress: PHOTO_COMPRESSION_QUALITY,
      format: saveFormatFor(mimeType),
    });

    if (!saved?.uri) return asset;

    return {
      uri: saved.uri,
      mimeType,
      fileSize: fileSizeOf(saved.uri),
      fileName: null,
    };
  } catch {
    return asset;
  }
}
