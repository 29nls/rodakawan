/**
 * Pembersihan objek Storage yatim untuk foto kendaraan.
 *
 * Kenapa ada:
 * - Penghapusan objek lama bersifat best-effort (`photos.ts`): bila perangkat
 *   offline, aplikasi ditutup di tengah jalan, atau baris kendaraan dihapus lebih
 *   dulu, objek lama bisa tertinggal di bucket tanpa satu pun baris yang
 *   menunjuknya. Objek seperti itu tidak pernah lagi terlihat di UI, tetapi tetap
 *   memakan kuota dan masih bisa dibuka lewat signed URL yang belum kedaluwarsa.
 * - `delete from storage.objects` langsung diblokir Supabase ("Direct deletion from
 *   storage tables is not allowed") dan service_role sengaja tidak disimpan di repo
 *   ini, jadi satu-satunya jalur sah adalah Storage API dengan sesi pemilik:
 *   `list` folder milik sesi, bandingkan dengan `photo_path` baris kendaraan yang
 *   benar-benar ada, lalu hapus yang tidak dirujuk siapa pun. Policy `SELECT` dan
 *   `DELETE` bucket `vehicle-photos` memang hanya mengizinkan folder pemiliknya,
 *   sehingga sapuan ini tidak pernah bisa menyentuh folder pengguna lain.
 * - Jendela tenggang (`ORPHAN_PHOTO_GRACE_MS`, 1 jam): objek yang baru dibuat belum
 *   tentu yatim. Unggahan selalu menulis objek lebih dulu, baru memperbarui barisnya,
 *   dan perangkat/sesi lain bisa sedang berada di tengah alur itu — atau barisnya
 *   belum sempat dibaca sapuan ini. Objek yang belum cukup tua dibiarkan dan
 *   diperiksa lagi pada sapuan berikutnya.
 *
 * Sapuan ini optimasi, bukan penegakan keamanan: objek yatim hanya bisa dibaca
 * pemiliknya, dan kegagalannya tidak pernah menggagalkan aksi utama pengguna.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { mapStorageError, type AppError } from '@/features/auth/errors';
import type { ApiResult } from '@/features/media/photos';
import { removePhotoObject, VEHICLE_PHOTO_BUCKET } from '@/features/media/photos';
import type { Database } from '@/lib/supabase/database.types';

export type PhotoCleanupClient = SupabaseClient<Database>;

/** Umur minimum sebelum objek tanpa rujukan boleh dihapus; lihat catatan modul. */
export const ORPHAN_PHOTO_GRACE_MS = 60 * 60 * 1000;

/** Batas satu halaman listing Storage API; sisanya diambil per halaman. */
const LIST_PAGE_SIZE = 100;

/**
 * Pengaman jumlah halaman per folder (1000 entri). Folder kendaraan normalnya
 * berisi satu berkas; batas ini hanya mencegah sapuan berjalan tanpa henti bila
 * ada sesuatu yang tidak terduga di bucket.
 */
const LIST_MAX_PAGES = 10;

/** Entri `list()` yang dibutuhkan sapuan; bentuk aslinya `FileObject`. */
export type StoredPhotoObject = {
  /** Nama berkas relatif terhadap folder. */
  name: string;
  /** `created_at` dari Storage; `null` di entri folder. */
  createdAt: string | null;
};

/** Isi satu folder (relatif terhadap root bucket), lengkap dengan nama foldernya. */
export type PhotoFolderListing = {
  /** Folder tempat objek berada, mis. `<user_id>` atau `<user_id>/<vehicle_id>`. */
  folder: string;
  objects: StoredPhotoObject[];
};

/**
 * Kegagalan tak terduga (mis. klien tanpa `storage`, atau error runtime di
 * perangkat) tidak boleh melempar: sapuan dipanggil dengan `void` dari layar,
 * sehingga lemparan di sini menjadi unhandled rejection tanpa manfaat. Bentuk
 * `AppError` ini tetap dilaporkan kepada pemanggil yang memeriksa hasilnya.
 */
const CLEANUP_UNEXPECTED_ERROR: AppError = {
  code: 'unknown',
  message:
    'Pembersihan foto lama tidak dapat dijalankan saat ini. Foto yang tersimpan tetap aman; pembersihan dicoba lagi lain kali.',
  retryable: true,
};

export type PhotoCleanupSummary = {
  /** Objek (bukan folder) yang diperiksa pada sapuan ini. */
  checked: number;
  /** Path yang benar-benar dihapus, terurut. */
  removed: string[];
  /** Objek yang sengaja dibiarkan: masih dirujuk baris, atau belum cukup tua. */
  kept: number;
};

/** Baris kendaraan yang menyimpan path foto; cukup bagian yang dipakai sapuan. */
export type PhotoPathRef = { photoPath: string | null };

export type PhotoCleanupOptions = {
  /** Waktu acuan `Date.now()`; dapat diisi pada pengujian. */
  now?: number;
  /** Umur minimum objek yatim; default `ORPHAN_PHOTO_GRACE_MS`. */
  graceMs?: number;
};

/**
 * Usia objek dipastikan lebih tua dari tenggang. Timestamp yang tidak ada atau
 * tidak terbaca **tidak** dianggap cukup tua: tanpa bukti, objek dibiarkan.
 */
function isOlderThanGrace(createdAt: string | null, now: number, graceMs: number): boolean {
  if (!createdAt) return false;

  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;

  return now - created >= graceMs;
}

/**
 * Path objek yatim: tidak dirujuk baris mana pun **dan** sudah lebih tua dari
 * tenggang. Fungsi murni supaya aturannya (dan bukan hanya efek sampingnya) bisa
 * diuji tanpa perangkat maupun jaringan.
 */
export function findOrphanPhotoPaths(
  listings: PhotoFolderListing[],
  referencedPaths: readonly string[],
  { now = Date.now(), graceMs = ORPHAN_PHOTO_GRACE_MS }: PhotoCleanupOptions = {},
): string[] {
  const referenced = new Set(referencedPaths);
  const orphans = new Set<string>();

  for (const listing of listings) {
    for (const object of listing.objects) {
      const path = `${listing.folder}/${object.name}`;

      if (referenced.has(path)) continue;
      if (!isOlderThanGrace(object.createdAt, now, graceMs)) continue;

      orphans.add(path);
    }
  }

  return [...orphans].sort();
}

type ListEntry = { name: string; id: string | null; created_at: string | null };

/**
 * Mengambil seluruh entri satu folder, per halaman. Kegagalan `SELECT` (mis.
 * policy menolak, atau sesi kedaluwarsa) dipetakan menjadi `AppError` yang sama
 * dengan operasi media lain, sehingga pemanggil bisa memutuskan menampilkannya
 * atau mengabaikannya.
 */
async function listFolder(
  client: PhotoCleanupClient,
  prefix: string,
): Promise<ApiResult<ListEntry[]>> {
  const entries: ListEntry[] = [];

  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const { data, error } = await client.storage
      .from(VEHICLE_PHOTO_BUCKET)
      .list(prefix, { limit: LIST_PAGE_SIZE, offset: page * LIST_PAGE_SIZE });

    if (error) return { ok: false, error: mapStorageError(error) };

    const rows = (data ?? []) as ListEntry[];
    entries.push(...rows);

    if (rows.length < LIST_PAGE_SIZE) break;
  }

  return { ok: true, data: entries };
}

/** Entri folder dikenali dari `id` yang `null` (konvensi Storage API). */
function isFolderEntry(entry: ListEntry): boolean {
  return entry.id === null;
}

function toStoredObject(entry: ListEntry): StoredPhotoObject {
  return { name: entry.name, createdAt: entry.created_at };
}

/**
 * Menyapu objek yatim di seluruh folder foto milik pengguna: folder
 * `<user_id>/` (berkas yang tertinggal langsung di akarnya), setiap folder
 * kendaraan yang masih ada, dan folder kendaraan yang barisnya sudah tidak ada.
 *
 * Yang dirujuk `photoPaths` tidak pernah dihapus; sisanya hanya dihapus bila
 * sudah melewati jendela tenggang. Semua kandidat dikirim dalam **satu** panggilan
 * `remove` supaya objek yatim dibersihkan dalam satu perjalanan jaringan.
 *
 * `photoPaths` **wajib berisi seluruh kendaraan pengguna** saat sapuan berjalan:
 * daftar yang tidak lengkap membuat foto kendaraan yang tidak disebut dianggap
 * yatim dan terhapus. Itulah sebabnya pemanggilnya adalah layar yang memang
 * memegang daftar lengkap garasi (`garage.tsx`), bukan layar detail kendaraan.
 */
async function sweepVehiclePhotoFolders(
  client: PhotoCleanupClient,
  userId: string,
  photoPaths: readonly PhotoPathRef[],
  options: PhotoCleanupOptions,
): Promise<ApiResult<PhotoCleanupSummary>> {
  const root = await listFolder(client, userId);
  if (!root.ok) return root;

  const listings: PhotoFolderListing[] = [
    {
      folder: userId,
      objects: root.data.filter((entry) => !isFolderEntry(entry)).map(toStoredObject),
    },
  ];

  for (const entry of root.data.filter(isFolderEntry)) {
    const folder = `${userId}/${entry.name}`;
    const contents = await listFolder(client, folder);
    if (!contents.ok) return contents;

    listings.push({
      folder,
      objects: contents.data.filter((entry) => !isFolderEntry(entry)).map(toStoredObject),
    });
  }

  const checked = listings.reduce((total, listing) => total + listing.objects.length, 0);

  // Hanya path di folder pengguna ini yang boleh dianggap rujukan; baris yang
  // menyimpan path aneh (kalau ada) tidak boleh melindungi objek di folder lain.
  const referenced = photoPaths
    .map((row) => row.photoPath)
    .filter((path): path is string => typeof path === 'string' && path.startsWith(`${userId}/`));

  const orphans = findOrphanPhotoPaths(listings, referenced, options);

  if (orphans.length === 0) {
    return { ok: true, data: { checked, removed: [], kept: checked } };
  }

  const { error } = await client.storage.from(VEHICLE_PHOTO_BUCKET).remove(orphans);
  if (error) return { ok: false, error: mapStorageError(error) };

  return {
    ok: true,
    data: { checked, removed: orphans, kept: checked - orphans.length },
  };
}

/** Pembungkus publik `sweepVehiclePhotoFolders` yang tidak pernah melempar. */
export async function sweepOrphanVehiclePhotos(
  client: PhotoCleanupClient,
  userId: string,
  photoPaths: readonly PhotoPathRef[],
  options: PhotoCleanupOptions = {},
): Promise<ApiResult<PhotoCleanupSummary>> {
  try {
    return await sweepVehiclePhotoFolders(client, userId, photoPaths, options);
  } catch {
    return { ok: false, error: CLEANUP_UNEXPECTED_ERROR };
  }
}

/**
 * Pembersihan setelah kendaraan dihapus: objek yang path-nya masih diketahui
 * dihapus lebih dulu tanpa menunggu tenggang — barisnya sudah tidak ada, jadi
 * tidak ada lagi yang bisa melindunginya dan pengguna baru saja meminta
 * penghapusan. Setelah itu sisa folder disapu seperti biasa. Kegagalan langkah
 * pertama sengaja tidak menggagalkan sapuan: keduanya best-effort, dan hasil
 * akhir yang dikejar sama — objek yatim tidak lagi tertinggal.
 */
export async function cleanUpVehiclePhotosAfterDelete(
  client: PhotoCleanupClient,
  userId: string,
  deletedPhotoPath: string | null,
  remainingPhotos: readonly PhotoPathRef[],
  options: PhotoCleanupOptions = {},
): Promise<ApiResult<PhotoCleanupSummary>> {
  try {
    if (deletedPhotoPath) {
      await removePhotoObject(client, VEHICLE_PHOTO_BUCKET, deletedPhotoPath);
    }

    return await sweepVehiclePhotoFolders(client, userId, remainingPhotos, options);
  } catch {
    return { ok: false, error: CLEANUP_UNEXPECTED_ERROR };
  }
}
