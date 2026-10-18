import { Image } from 'react-native';

import {
  CLUB_LOGO_MAX_DIMENSION,
  PHOTO_COMPRESSION_QUALITY,
  PHOTO_SKIP_COMPRESSION_BYTES,
  VEHICLE_PHOTO_MAX_DIMENSION,
  compressPhoto,
  fitWithin,
  needsCompression,
  saveFormatFor,
} from '@/features/media/imageCompression';

const mockResize = jest.fn();
const mockRenderAsync = jest.fn();
const mockSaveAsync = jest.fn();
const mockManipulate = jest.fn();
const mockCompressedSize = { value: 200_000 as number | null };

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

jest.mock('expo-file-system', () => ({
  File: class {
    get size() {
      return mockCompressedSize.value;
    }
  },
}));

/** Bentuk Promise dari `Image.getSize` disediakan shim Jest (lihat jest.config.js). */
const getSize = jest.spyOn(Image, 'getSize');

const COMPRESSED_URI = 'file:///cache/foto-kecil.jpg';

function mockSourceDimensions(width: number, height: number) {
  (getSize as unknown as jest.Mock).mockResolvedValue({ width, height });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCompressedSize.value = 200_000;
  mockSourceDimensions(4000, 3000);
  mockManipulate.mockReturnValue({ resize: mockResize, renderAsync: mockRenderAsync });
  mockRenderAsync.mockResolvedValue({ width: 1600, height: 1200, saveAsync: mockSaveAsync });
  mockSaveAsync.mockResolvedValue({ uri: COMPRESSED_URI, width: 1600, height: 1200 });
});

describe('fitWithin', () => {
  it('memperkecil sisi terpanjang dan mempertahankan rasio', () => {
    expect(fitWithin({ width: 4000, height: 3000 }, VEHICLE_PHOTO_MAX_DIMENSION)).toEqual({
      width: 1600,
      height: 1200,
    });
  });

  it('menangani foto potret tanpa memotong', () => {
    expect(fitWithin({ width: 3000, height: 4000 }, VEHICLE_PHOTO_MAX_DIMENSION)).toEqual({
      width: 1200,
      height: 1600,
    });
  });

  it('memakai batas logo klub untuk foto persegi', () => {
    expect(fitWithin({ width: 4000, height: 4000 }, CLUB_LOGO_MAX_DIMENSION)).toEqual({
      width: 512,
      height: 512,
    });
  });

  it('tidak memperbesar foto yang sudah cukup kecil', () => {
    expect(fitWithin({ width: 800, height: 600 }, VEHICLE_PHOTO_MAX_DIMENSION)).toBeNull();
    expect(fitWithin({ width: 1600, height: 1200 }, VEHICLE_PHOTO_MAX_DIMENSION)).toBeNull();
  });

  it('memangkas luas piksel foto 12 MP jauh lebih dari separuh', () => {
    // Sumber 4000×3000 (12 MP) → 1600×1200 adalah 16% piksel; itulah penghematan
    // kuota yang jadi alasan fitur ini ada, bukan sekadar penurunan angka kualitas.
    const target = fitWithin({ width: 4000, height: 3000 }, VEHICLE_PHOTO_MAX_DIMENSION);

    expect(target).not.toBeNull();
    if (!target) return;

    const sourceArea = 4000 * 3000;
    expect((target.width * target.height) / sourceArea).toBeLessThanOrEqual(0.2);
  });

  it('mengabaikan ukuran yang tidak masuk akal', () => {
    expect(fitWithin({ width: 0, height: 0 }, VEHICLE_PHOTO_MAX_DIMENSION)).toBeNull();
    expect(fitWithin({ width: 4000, height: 3000 }, 0)).toBeNull();
  });

  it('tidak pernah menghasilkan sisi 0 px', () => {
    expect(fitWithin({ width: 4001, height: 3 }, 1000)).toEqual({ width: 1000, height: 1 });
  });
});

describe('saveFormatFor', () => {
  it('mempertahankan format sumber', () => {
    expect(saveFormatFor('image/jpeg')).toBe('jpeg');
    expect(saveFormatFor('image/png')).toBe('png');
    expect(saveFormatFor('image/webp')).toBe('webp');
  });
});

describe('needsCompression', () => {
  const smallAsset = { uri: 'file:///foto.jpg', mimeType: 'image/jpeg', fileSize: 100 * 1024 };

  it('melewati foto kecil yang dimensinya sudah cukup', () => {
    expect(needsCompression(smallAsset, { width: 1200, height: 900 }, 1600)).toBe(false);
  });

  it('memproses foto yang dimensinya melebihi batas walau berkasnya kecil', () => {
    expect(needsCompression(smallAsset, { width: 4000, height: 3000 }, 1600)).toBe(true);
  });

  it('memproses berkas yang ukurannya belum diketahui', () => {
    expect(needsCompression({ uri: 'file:///foto.jpg' }, { width: 1200, height: 900 }, 1600)).toBe(
      true,
    );
  });

  it('memproses berkas di atas ambang meski dimensinya sudah cukup', () => {
    const heavy = { ...smallAsset, fileSize: PHOTO_SKIP_COMPRESSION_BYTES + 1 };
    expect(needsCompression(heavy, { width: 1200, height: 900 }, 1600)).toBe(true);
  });
});

describe('compressPhoto', () => {
  const bigAsset = {
    uri: 'file:///galeri/foto-asli.jpg',
    mimeType: 'image/jpeg',
    fileSize: 4 * 1024 * 1024,
    fileName: 'foto-asli.jpg',
  };

  it('memperkecil, mengompres, dan melaporkan ukuran berkas hasil', async () => {
    const result = await compressPhoto(bigAsset, 'image/jpeg', VEHICLE_PHOTO_MAX_DIMENSION);

    expect(mockManipulate).toHaveBeenCalledWith(bigAsset.uri);
    expect(mockResize).toHaveBeenCalledWith({ width: 1600, height: 1200 });
    expect(mockSaveAsync).toHaveBeenCalledWith({
      compress: PHOTO_COMPRESSION_QUALITY,
      format: 'jpeg',
    });
    expect(result).toEqual({
      uri: COMPRESSED_URI,
      mimeType: 'image/jpeg',
      fileSize: 200_000,
      fileName: null,
    });
  });

  it('tidak menyentuh foto kecil yang sudah cukup kecil', async () => {
    const small = { ...bigAsset, fileSize: 100 * 1024 };
    mockSourceDimensions(1200, 900);

    const result = await compressPhoto(small, 'image/jpeg', VEHICLE_PHOTO_MAX_DIMENSION);

    expect(result).toBe(small);
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('mempertahankan PNG sebagai PNG', async () => {
    await compressPhoto(
      { ...bigAsset, uri: 'file:///galeri/logo.png', mimeType: 'image/png' },
      'image/png',
      CLUB_LOGO_MAX_DIMENSION,
    );

    expect(mockResize).toHaveBeenCalledWith({ width: 512, height: 384 });
    expect(mockSaveAsync).toHaveBeenCalledWith({
      compress: PHOTO_COMPRESSION_QUALITY,
      format: 'png',
    });
  });

  it('tetap mengompres tanpa memperkecil bila dimensi tidak terbaca', async () => {
    (getSize as unknown as jest.Mock).mockRejectedValue(new Error('tidak dikenal'));

    const result = await compressPhoto(
      { uri: 'content://media/foto.jpg', mimeType: 'image/jpeg' },
      'image/jpeg',
      VEHICLE_PHOTO_MAX_DIMENSION,
    );

    expect(mockResize).not.toHaveBeenCalled();
    expect(mockSaveAsync).toHaveBeenCalled();
    expect(result.uri).toBe(COMPRESSED_URI);
  });

  it('kembali ke berkas asli bila manipulasi gagal', async () => {
    mockRenderAsync.mockRejectedValue(new Error('native gagal'));

    const result = await compressPhoto(bigAsset, 'image/jpeg', VEHICLE_PHOTO_MAX_DIMENSION);

    expect(result).toBe(bigAsset);
  });

  it('melaporkan ukuran null bila berkas hasil tidak dapat dibaca', async () => {
    mockCompressedSize.value = null;

    const result = await compressPhoto(bigAsset, 'image/jpeg', VEHICLE_PHOTO_MAX_DIMENSION);

    expect(result.fileSize).toBeNull();
    expect(result.uri).toBe(COMPRESSED_URI);
  });
});
