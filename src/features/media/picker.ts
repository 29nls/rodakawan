/**
 * Pemilih foto dari galeri perangkat.
 *
 * Izin diminta hanya saat pengguna menekan tombol unggah, bukan saat layar dibuka.
 * Tidak ada akses kamera atau mikrofon: fitur ini hanya membaca foto yang dipilih
 * (plugin `expo-image-picker` di `app.json` juga mematikan izin kamera/mikrofon).
 *
 * `preferredAssetRepresentationMode: Compatible` meminta iOS memberikan representasi
 * yang kompatibel (JPEG) untuk foto HEIC. Bila perangkat tetap mengembalikan tipe
 * yang tidak didukung, `validatePhotoAsset` menolaknya dengan pesan yang jelas —
 * bucket memang hanya menerima JPEG/PNG/WEBP.
 *
 * `quality: 1` disengaja: picker hanya memilih dan memotong, sedangkan pemadatan
 * (perkecil ke batas dimensi + kompres 0.7) dilakukan sekali di
 * `imageCompression.ts` saat berkas diunggah. Bila picker ikut mengompres, foto
 * besar akan mengalami dua kali encode lossy sebelum sampai ke Storage.
 */

import * as ImagePicker from 'expo-image-picker';

import type { AppError } from '@/features/auth/errors';
import type { PhotoAsset, PhotoKind } from '@/features/media/photos';

export type PickPhotoResult =
  { ok: true; asset: PhotoAsset | null } | { ok: false; error: AppError };

const PERMISSION_DENIED: AppError = {
  code: 'not_authorized',
  message:
    'Akses galeri belum diberikan. Buka pengaturan perangkat, izinkan RodaKawan membaca foto, lalu coba lagi. Anda tetap bisa memakai aplikasi tanpa mengunggah foto.',
  retryable: false,
};

const PICKER_FAILED: AppError = {
  code: 'unknown',
  message: 'Galeri tidak dapat dibuka saat ini. Coba lagi, atau pilih foto dari aplikasi lain.',
  retryable: true,
};

export async function pickPhoto(kind: PhotoKind): Promise<PickPhotoResult> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) return { ok: false, error: PERMISSION_DENIED };

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: kind === 'vehicle' ? [4, 3] : [1, 1],
      quality: 1,
      exif: false,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });

    if (result.canceled) return { ok: true, asset: null };

    const asset = result.assets?.[0];
    if (!asset) return { ok: true, asset: null };

    return {
      ok: true,
      asset: {
        uri: asset.uri,
        mimeType: asset.mimeType ?? null,
        fileSize: asset.fileSize ?? null,
        fileName: asset.fileName ?? null,
      },
    };
  } catch {
    return { ok: false, error: PICKER_FAILED };
  }
}
