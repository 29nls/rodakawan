import type { SupabaseClient } from '@supabase/supabase-js';
import { Image } from 'react-native';

import {
  CLUB_LOGO_MAX_DIMENSION,
  PROFILE_AVATAR_MAX_DIMENSION,
  VEHICLE_PHOTO_MAX_DIMENSION,
} from '@/features/media/imageCompression';
import {
  CLUB_LOGO_BUCKET,
  PROFILE_AVATAR_BUCKET,
  VEHICLE_PHOTO_BUCKET,
  buildClubLogoPath,
  buildProfileAvatarPath,
  buildVehiclePhotoPath,
  createPhotoFileName,
  deleteClubLogo,
  deleteProfileAvatar,
  deleteVehiclePhoto,
  getPhotoSignedUrl,
  isOwnProfileAvatarPath,
  uploadClubLogo,
  uploadProfileAvatar,
  uploadVehiclePhoto,
  validatePhotoAsset,
} from '@/features/media/photos';
import type { Database } from '@/lib/supabase/database.types';
import { createQueryClient, type QueryResponse, type QueryLog } from '@/test-support/fakeSupabase';

const mockResize = jest.fn();
const mockRenderAsync = jest.fn();
const mockSaveAsync = jest.fn();
const mockManipulate = jest.fn();
/**
 * URI berkas yang benar-benar dibaca untuk diunggah (dipanggil dari `arrayBuffer`,
 * bukan saat `File` dibuat — `fileSizeOf` juga membuat `File` tanpa membacanya):
 * dipakai membuktikan yang dikirim ke Storage adalah hasil kompresi.
 */
const mockReadUris: string[] = [];
const COMPRESSED_URI = 'file:///cache/foto-kecil.jpg';

jest.mock('expo-file-system', () => ({
  File: class {
    size = 200_000;
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    async arrayBuffer() {
      mockReadUris.push(this.uri);
      return new ArrayBuffer(8);
    }
  },
}));

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

/** Bentuk Promise dari `Image.getSize` disediakan shim Jest (lihat jest.config.js). */
const getSize = jest.spyOn(Image, 'getSize');

beforeEach(() => {
  jest.clearAllMocks();
  mockReadUris.length = 0;
  (getSize as unknown as jest.Mock).mockResolvedValue({ width: 1200, height: 900 });
  mockManipulate.mockReturnValue({ resize: mockResize, renderAsync: mockRenderAsync });
  mockRenderAsync.mockResolvedValue({ width: 1600, height: 1200, saveAsync: mockSaveAsync });
  mockSaveAsync.mockResolvedValue({ uri: COMPRESSED_URI, width: 1600, height: 1200 });
});

const USER_ID = '11111111-1111-1111-1111-111111111111';
const VEHICLE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLUB_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OLD_PATH = `${USER_ID}/${VEHICLE_ID}/lama.jpg`;
const OLD_AVATAR_PATH = `${USER_ID}/lama.jpg`;

type StorageCall = {
  op: 'upload' | 'remove' | 'createSignedUrl';
  bucket: string;
  path?: string;
  paths?: string[];
  fileBody?: unknown;
  options?: Record<string, unknown>;
  expiresIn?: number;
};

type StorageBehavior = {
  uploadError?: { status?: number; message?: string } | null;
  signedUrl?: string | null;
  signedError?: { status?: number; message?: string } | null;
};

function createMediaClient(
  responses: QueryResponse | QueryResponse[],
  behavior: StorageBehavior = {},
) {
  const { client, log } = createQueryClient(responses);
  const calls: StorageCall[] = [];

  const storage = {
    from(bucket: string) {
      return {
        async upload(path: string, fileBody: unknown, options?: Record<string, unknown>) {
          calls.push({ op: 'upload', bucket, path, fileBody, options });
          return {
            data: behavior.uploadError ? null : { path },
            error: behavior.uploadError ?? null,
          };
        },
        async remove(paths: string[]) {
          calls.push({ op: 'remove', bucket, paths });
          return { data: [], error: null };
        },
        async createSignedUrl(path: string, expiresIn: number) {
          calls.push({ op: 'createSignedUrl', bucket, path, expiresIn });
          return {
            data: behavior.signedError
              ? null
              : { signedUrl: behavior.signedUrl ?? 'https://contoh.test/signed' },
            error: behavior.signedError ?? null,
          };
        },
      };
    },
  };

  (client as unknown as { storage: typeof storage }).storage = storage;

  return { client: client as SupabaseClient<Database>, log, calls };
}

const noRow = { data: null };

function updateValues(log: QueryLog, index: number): Record<string, unknown> {
  return (log.queries[index]?.values ?? {}) as Record<string, unknown>;
}

describe('validatePhotoAsset', () => {
  it('menerima MIME dengan parameter dan menormalkannya', () => {
    const result = validatePhotoAsset(
      { uri: 'file:///foto.jpg', mimeType: 'IMAGE/JPEG; charset=binary', fileSize: 1000 },
      5 * 1024 * 1024,
    );

    expect(result).toEqual({
      ok: true,
      data: { mimeType: 'image/jpeg', extension: 'jpg', size: 1000 },
    });
  });

  it('menebak tipe dari nama berkas bila picker tidak memberi MIME', () => {
    const result = validatePhotoAsset({ uri: 'file:///foto', fileName: 'logo.PNG' }, 1024);

    expect(result.ok && result.data.mimeType).toBe('image/png');
  });

  it('menolak HEIC dan tipe lain yang tidak didukung bucket', () => {
    const result = validatePhotoAsset(
      { uri: 'file:///foto.heic', mimeType: 'image/heic', fileSize: 1000 },
      1024 * 1024,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_data');
      expect(result.error.message).toContain('JPG, PNG, atau WEBP');
    }
  });

  it('menolak berkas yang melebihi batas dan menyebut batasnya', () => {
    const result = validatePhotoAsset(
      { uri: 'file:///foto.jpg', mimeType: 'image/jpeg', fileSize: 3 * 1024 * 1024 },
      2 * 1024 * 1024,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('2 MB');
  });

  it('membiarkan ukuran tidak diketahui agar bucket yang memutuskan', () => {
    const result = validatePhotoAsset({ uri: 'file:///foto.webp', mimeType: 'image/webp' }, 1024);

    expect(result.ok && result.data.size).toBeNull();
  });
});

describe('path foto', () => {
  it('menempatkan kendaraan di bawah pemilik dan id kendaraannya', () => {
    expect(buildVehiclePhotoPath(USER_ID, VEHICLE_ID, 'baru.jpg')).toBe(
      `${USER_ID}/${VEHICLE_ID}/baru.jpg`,
    );
  });

  it('menempatkan logo di bawah id klub', () => {
    expect(buildClubLogoPath(CLUB_ID, 'logo.png')).toBe(`${CLUB_ID}/logo.png`);
  });

  it('membuat nama berkas unik dengan ekstensi dari MIME', () => {
    expect(createPhotoFileName('webp', 1_700_000_000_000, 'abc123')).toBe('loyw3v28-abc123.webp');
    expect(createPhotoFileName('jpg', 1_700_000_000_000, 'abc123')).not.toBe(
      createPhotoFileName('jpg', 1_700_000_001_000, 'abc123'),
    );
  });
});

describe('uploadVehiclePhoto', () => {
  it('mengunggah ke folder sesi lalu menyimpan path pada baris kendaraan', async () => {
    const { client, log, calls } = createMediaClient([
      { data: { photo_path: null } },
      { data: { id: VEHICLE_ID } },
    ]);

    const result = await uploadVehiclePhoto(client, USER_ID, VEHICLE_ID, {
      uri: 'file:///foto.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.path.startsWith(`${USER_ID}/${VEHICLE_ID}/`)).toBe(true);
    expect(result.data.path.endsWith('.jpg')).toBe(true);

    const upload = calls.find((call) => call.op === 'upload');
    expect(upload?.bucket).toBe(VEHICLE_PHOTO_BUCKET);
    expect(upload?.path).toBe(result.data.path);
    expect(upload?.options).toMatchObject({
      contentType: 'image/jpeg',
      upsert: false,
    });

    expect(log.queries.map((query) => query.op)).toEqual(['select', 'update']);
    expect(updateValues(log, 1).photo_path).toBe(result.data.path);
  });

  it('menghapus objek lama setelah path baru tersimpan', async () => {
    const { client, calls } = createMediaClient([
      { data: { photo_path: OLD_PATH } },
      { data: { id: VEHICLE_ID } },
    ]);

    const result = await uploadVehiclePhoto(client, USER_ID, VEHICLE_ID, {
      uri: 'file:///foto.png',
      mimeType: 'image/png',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const remove = calls.find((call) => call.op === 'remove');
    expect(remove?.bucket).toBe(VEHICLE_PHOTO_BUCKET);
    expect(remove?.paths).toEqual([OLD_PATH]);
  });

  it('tidak menyentuh baris bila unggahan ditolak Storage', async () => {
    const { client, log, calls } = createMediaClient(
      [{ data: { photo_path: null } }, { data: { id: VEHICLE_ID } }],
      { uploadError: { status: 403, message: 'new row violates row-level security policy' } },
    );

    const result = await uploadVehiclePhoto(client, USER_ID, VEHICLE_ID, {
      uri: 'file:///foto.jpg',
      mimeType: 'image/jpeg',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
    expect(log.queries).toHaveLength(1);
    expect(calls.some((call) => call.op === 'remove')).toBe(false);
  });

  it('membersihkan objek baru bila baris gagal diperbarui', async () => {
    const { client, calls } = createMediaClient([
      { data: { photo_path: null } },
      { error: { code: 'PGRST116', message: 'no rows returned' } },
    ]);

    const result = await uploadVehiclePhoto(client, USER_ID, VEHICLE_ID, {
      uri: 'file:///foto.jpg',
      mimeType: 'image/jpeg',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');

    const uploadedPath = calls.find((call) => call.op === 'upload')?.path;
    const removed = calls.find((call) => call.op === 'remove');
    expect(uploadedPath).toBeDefined();
    expect(removed?.paths).toEqual([uploadedPath]);
  });

  it('menolak kendaraan yang bukan milik sesi sebelum mengunggah', async () => {
    const { client, log, calls } = createMediaClient([noRow]);

    const result = await uploadVehiclePhoto(client, USER_ID, VEHICLE_ID, {
      uri: 'file:///foto.jpg',
      mimeType: 'image/jpeg',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeDefined();
    expect(log.queries).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});

describe('kompresi sebelum unggah', () => {
  it('mengirim berkas hasil kompresi, bukan foto 12 MP dari galeri', async () => {
    (getSize as unknown as jest.Mock).mockResolvedValue({ width: 4000, height: 3000 });
    const { client, calls } = createMediaClient([
      { data: { photo_path: null } },
      { data: { id: VEHICLE_ID } },
    ]);

    const result = await uploadVehiclePhoto(client, USER_ID, VEHICLE_ID, {
      uri: 'file:///galeri/foto-12mp.jpg',
      mimeType: 'image/jpeg',
      fileSize: 6 * 1024 * 1024,
    });

    // Foto 6 MB melewati batas 5 MB bucket, tetapi diterima setelah diperkecil —
    // itulah penghematan kuota yang dimaksud, dan unggahannya tetap satu kali.
    expect(result.ok).toBe(true);
    expect(mockResize).toHaveBeenCalledWith({ width: VEHICLE_PHOTO_MAX_DIMENSION, height: 1200 });
    expect(mockReadUris).toEqual([COMPRESSED_URI]);
    expect(calls.filter((call) => call.op === 'upload')).toHaveLength(1);
  });

  it('memperkecil logo klub ke batas 512 px dan menyimpannya sebagai PNG', async () => {
    (getSize as unknown as jest.Mock).mockResolvedValue({ width: 4000, height: 4000 });
    const { client } = createMediaClient([
      { data: { logo_path: null } },
      { data: { id: CLUB_ID } },
    ]);

    const result = await uploadClubLogo(client, CLUB_ID, {
      uri: 'file:///galeri/logo-besar.png',
      mimeType: 'image/png',
      fileSize: 3 * 1024 * 1024,
    });

    expect(result.ok).toBe(true);
    expect(mockResize).toHaveBeenCalledWith({
      width: CLUB_LOGO_MAX_DIMENSION,
      height: CLUB_LOGO_MAX_DIMENSION,
    });
    expect(mockSaveAsync).toHaveBeenCalledWith({ compress: expect.any(Number), format: 'png' });
    expect(mockReadUris).toEqual([COMPRESSED_URI]);
  });

  it('mengunggah berkas asli bila foto sudah kecil', async () => {
    // Ukuran 1200×900 (shim) dan berkas 200 KB: tidak ada alasan mengompres ulang.
    const { client } = createMediaClient([
      { data: { photo_path: null } },
      { data: { id: VEHICLE_ID } },
    ]);

    const result = await uploadVehiclePhoto(client, USER_ID, VEHICLE_ID, {
      uri: 'file:///galeri/foto-kecil.jpg',
      mimeType: 'image/jpeg',
      fileSize: 200 * 1024,
    });

    expect(result.ok).toBe(true);
    expect(mockManipulate).not.toHaveBeenCalled();
    expect(mockReadUris).toEqual(['file:///galeri/foto-kecil.jpg']);
  });
});

describe('deleteVehiclePhoto', () => {
  it('mengosongkan kolom lalu menghapus objek', async () => {
    const { client, log, calls } = createMediaClient([
      { data: { photo_path: OLD_PATH } },
      { data: { id: VEHICLE_ID } },
    ]);

    const result = await deleteVehiclePhoto(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ ok: true, data: { deleted: true } });
    expect(updateValues(log, 1).photo_path).toBeNull();
    expect(calls.find((call) => call.op === 'remove')?.paths).toEqual([OLD_PATH]);
  });

  it('idempoten bila kendaraan belum punya foto', async () => {
    const { client, log, calls } = createMediaClient([{ data: { photo_path: null } }]);

    const result = await deleteVehiclePhoto(client, USER_ID, VEHICLE_ID);

    expect(result).toEqual({ ok: true, data: { deleted: false } });
    expect(log.queries).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});

describe('logo klub', () => {
  it('mengunggah logo dengan batas 2 MB dan MIME yang benar', async () => {
    const { client, log, calls } = createMediaClient([
      { data: { logo_path: null } },
      { data: { id: CLUB_ID } },
    ]);

    const result = await uploadClubLogo(client, CLUB_ID, {
      uri: 'file:///logo.png',
      mimeType: 'image/png',
      fileSize: 1024,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.path.startsWith(`${CLUB_ID}/`)).toBe(true);
    expect(result.data.path.endsWith('.png')).toBe(true);
    expect(calls.find((call) => call.op === 'upload')?.bucket).toBe(CLUB_LOGO_BUCKET);
    expect(updateValues(log, 1).logo_path).toBe(result.data.path);
  });

  it('tetap menolak logo lebih dari 2 MB bila kompresi tidak dapat mengecilkannya', async () => {
    // Manipulasi native gagal (mis. format tidak terbaca modul): berkas asli dipakai,
    // lalu batas bucket tetap menolaknya dengan pesan yang menyebut batasnya.
    mockRenderAsync.mockRejectedValue(new Error('native gagal'));
    const { client, calls } = createMediaClient([]);

    const result = await uploadClubLogo(client, CLUB_ID, {
      uri: 'file:///logo.png',
      mimeType: 'image/png',
      fileSize: 3 * 1024 * 1024,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('2 MB');
    expect(calls).toHaveLength(0);
  });

  it('menghapus logo setelah kolom dikosongkan', async () => {
    const logoPath = `${CLUB_ID}/logo.png`;
    const { client, log, calls } = createMediaClient([
      { data: { logo_path: logoPath } },
      { data: { id: CLUB_ID } },
    ]);

    const result = await deleteClubLogo(client, CLUB_ID);

    expect(result).toEqual({ ok: true, data: { deleted: true } });
    expect(updateValues(log, 1).logo_path).toBeNull();
    expect(calls.find((call) => call.op === 'remove')?.paths).toEqual([logoPath]);
  });
});

describe('foto profil', () => {
  it('menempatkan avatar di bawah folder pemilik', () => {
    expect(buildProfileAvatarPath(USER_ID, 'foto.jpg')).toBe(`${USER_ID}/foto.jpg`);
  });

  it('hanya menerima path di folder pengguna itu sendiri', () => {
    expect(isOwnProfileAvatarPath(USER_ID, OLD_AVATAR_PATH)).toBe(true);
    expect(isOwnProfileAvatarPath(USER_ID, `${CLUB_ID}/foto.jpg`)).toBe(false);
    expect(isOwnProfileAvatarPath(USER_ID, `${USER_ID}/`)).toBe(false);
    expect(isOwnProfileAvatarPath(USER_ID, 'https://contoh.test/foto.jpg')).toBe(false);
    expect(isOwnProfileAvatarPath(USER_ID, null)).toBe(false);
  });

  it('mengunggah ke bucket privat avatars lalu menyimpan path pada baris profil', async () => {
    const { client, log, calls } = createMediaClient([
      { data: { avatar_url: null } },
      { data: { id: USER_ID } },
    ]);

    const result = await uploadProfileAvatar(client, USER_ID, {
      uri: 'file:///foto.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.path.startsWith(`${USER_ID}/`)).toBe(true);
    expect(result.data.path.endsWith('.jpg')).toBe(true);

    const upload = calls.find((call) => call.op === 'upload');
    expect(upload?.bucket).toBe(PROFILE_AVATAR_BUCKET);
    expect(upload?.path).toBe(result.data.path);
    expect(upload?.options).toMatchObject({ contentType: 'image/jpeg', upsert: false });

    expect(log.queries.map((query) => query.op)).toEqual(['select', 'update']);
    expect(log.queries[0]?.filters).toEqual([{ column: 'id', value: USER_ID }]);
    expect(updateValues(log, 1).avatar_url).toBe(result.data.path);
  });

  it('menghapus objek avatar lama setelah path baru tersimpan', async () => {
    const { client, calls } = createMediaClient([
      { data: { avatar_url: OLD_AVATAR_PATH } },
      { data: { id: USER_ID } },
    ]);

    const result = await uploadProfileAvatar(client, USER_ID, {
      uri: 'file:///foto.png',
      mimeType: 'image/png',
    });

    expect(result.ok).toBe(true);
    expect(calls.find((call) => call.op === 'remove')).toMatchObject({
      bucket: PROFILE_AVATAR_BUCKET,
      paths: [OLD_AVATAR_PATH],
    });
  });

  it('tidak mengirim berkas bila baris profil belum ada', async () => {
    const { client, log, calls } = createMediaClient([noRow]);

    const result = await uploadProfileAvatar(client, USER_ID, {
      uri: 'file:///foto.jpg',
      mimeType: 'image/jpeg',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_found');
      expect(result.error.message).toContain('Lengkapi profil');
    }
    expect(log.queries).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it('membersihkan objek baru bila baris profil gagal diperbarui', async () => {
    const { client, calls } = createMediaClient([
      { data: { avatar_url: null } },
      { error: { code: 'PGRST116', message: 'no rows returned' } },
    ]);

    const result = await uploadProfileAvatar(client, USER_ID, {
      uri: 'file:///foto.jpg',
      mimeType: 'image/jpeg',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');

    const uploadedPath = calls.find((call) => call.op === 'upload')?.path;
    expect(calls.find((call) => call.op === 'remove')?.paths).toEqual([uploadedPath]);
  });

  it('tidak menyentuh baris profil bila unggahan ditolak Storage', async () => {
    const { client, log } = createMediaClient([{ data: { avatar_url: null } }], {
      uploadError: { status: 403, message: 'new row violates row-level security policy' },
    });

    const result = await uploadProfileAvatar(client, USER_ID, {
      uri: 'file:///foto.jpg',
      mimeType: 'image/jpeg',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
    expect(log.queries.map((query) => query.op)).toEqual(['select']);
  });

  it('memperkecil avatar persegi ke batas 512 px dan mempertahankan PNG', async () => {
    (getSize as unknown as jest.Mock).mockResolvedValue({ width: 4000, height: 4000 });
    const { client } = createMediaClient([
      { data: { avatar_url: null } },
      { data: { id: USER_ID } },
    ]);

    const result = await uploadProfileAvatar(client, USER_ID, {
      uri: 'file:///galeri/avatar-besar.png',
      mimeType: 'image/png',
      fileSize: 4 * 1024 * 1024,
    });

    expect(result.ok).toBe(true);
    expect(mockResize).toHaveBeenCalledWith({
      width: PROFILE_AVATAR_MAX_DIMENSION,
      height: PROFILE_AVATAR_MAX_DIMENSION,
    });
    expect(mockSaveAsync).toHaveBeenCalledWith({ compress: expect.any(Number), format: 'png' });
    expect(mockReadUris).toEqual([COMPRESSED_URI]);
  });

  it('mengosongkan kolom lalu menghapus objek avatar', async () => {
    const { client, log, calls } = createMediaClient([
      { data: { avatar_url: OLD_AVATAR_PATH } },
      { data: { id: USER_ID } },
    ]);

    const result = await deleteProfileAvatar(client, USER_ID);

    expect(result).toEqual({ ok: true, data: { deleted: true } });
    expect(updateValues(log, 1).avatar_url).toBeNull();
    expect(calls.find((call) => call.op === 'remove')?.paths).toEqual([OLD_AVATAR_PATH]);
  });

  it('idempoten bila profil belum punya foto', async () => {
    const { client, log, calls } = createMediaClient([{ data: { avatar_url: null } }]);

    const result = await deleteProfileAvatar(client, USER_ID);

    expect(result).toEqual({ ok: true, data: { deleted: false } });
    expect(log.queries).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it('mengosongkan nilai lama yang bukan path milik sesi tanpa menghapus objek', async () => {
    const { client, log, calls } = createMediaClient([
      { data: { avatar_url: 'https://contoh.test/avatar.png' } },
      { data: { id: USER_ID } },
    ]);

    const result = await deleteProfileAvatar(client, USER_ID);

    expect(result).toEqual({ ok: true, data: { deleted: true } });
    expect(updateValues(log, 1).avatar_url).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('menolak hapus bila baris profil tidak terlihat oleh sesi', async () => {
    const { client, calls } = createMediaClient([noRow]);

    const result = await deleteProfileAvatar(client, USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
    expect(calls).toHaveLength(0);
  });
});

describe('getPhotoSignedUrl', () => {
  it('meminta URL berumur terbatas, bukan URL publik', async () => {
    const { client, calls } = createMediaClient([], {
      signedUrl: 'https://contoh.test/object/sign/foto',
    });

    const result = await getPhotoSignedUrl(client, VEHICLE_PHOTO_BUCKET, OLD_PATH, 600);

    expect(result).toEqual({
      ok: true,
      data: 'https://contoh.test/object/sign/foto',
    });
    expect(calls[0]).toMatchObject({
      op: 'createSignedUrl',
      bucket: VEHICLE_PHOTO_BUCKET,
      path: OLD_PATH,
      expiresIn: 600,
    });
  });

  it('memetakan penolakan Storage ke pesan yang bisa ditindaklanjuti', async () => {
    const { client } = createMediaClient([], {
      signedError: { status: 403, message: 'AccessDenied' },
    });

    const result = await getPhotoSignedUrl(client, CLUB_LOGO_BUCKET, `${CLUB_ID}/logo.png`);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
  });
});
