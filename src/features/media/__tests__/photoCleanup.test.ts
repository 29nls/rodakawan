import {
  ORPHAN_PHOTO_GRACE_MS,
  cleanUpVehiclePhotosAfterDelete,
  findOrphanPhotoPaths,
  sweepOrphanVehiclePhotos,
  type PhotoCleanupClient,
} from '@/features/media/photoCleanup';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const VEHICLE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_USER_ID = '99999999-9999-9999-9999-999999999999';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const OLD = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
const FRESH = new Date(NOW - 60 * 1000).toISOString();

const VEHICLE_FOLDER = `${USER_ID}/${VEHICLE_ID}`;
const PHOTO_PATH = `${VEHICLE_FOLDER}/baru.jpg`;

type Entry = { name: string; id?: string | null; created_at?: string | null };

type CleanupBehavior = {
  /** prefix → daftar halaman; halaman dipilih dari `offset`. */
  pages?: Record<string, Entry[][]>;
  listError?: { status?: number; message?: string } | null;
  removeError?: { status?: number; message?: string } | null;
};

type CleanupCall =
  | { op: 'list'; prefix: string; options?: { limit?: number; offset?: number } }
  | { op: 'remove'; bucket: string; paths: string[] };

/** Entri folder dari Storage API: `id`, `created_at`, dan metadata-nya `null`. */
function folderEntry(name: string): Entry {
  return { name, id: null, created_at: null };
}

function fileEntry(name: string, createdAt: string | null): Entry {
  return { name, id: `obj-${name}`, created_at: createdAt };
}

/**
 * Meniru efek `remove`: objek yang dihapus juga hilang dari listing berikutnya.
 * Tanpa ini, sapuan setelah penghapusan eksplisit akan "menemukan" objek yang
 * sebenarnya sudah tidak ada dan pengujiannya tidak lagi mencerminkan Storage.
 */
function removeFromPages(pages: Record<string, Entry[][]>, paths: string[]) {
  const removed = new Set(paths);

  for (const [prefix, pagesOfFolder] of Object.entries(pages)) {
    for (const page of pagesOfFolder) {
      for (let index = page.length - 1; index >= 0; index -= 1) {
        if (removed.has(`${prefix}/${page[index].name}`)) page.splice(index, 1);
      }
    }
  }
}

function createCleanupClient(behavior: CleanupBehavior = {}) {
  const calls: CleanupCall[] = [];
  const pages = behavior.pages ?? {};

  const storage = {
    from(bucket: string) {
      return {
        async list(prefix: string, options?: { limit?: number; offset?: number }) {
          calls.push({ op: 'list', prefix, options });

          if (behavior.listError) return { data: null, error: behavior.listError };

          const limit = options?.limit ?? 100;
          const offset = options?.offset ?? 0;
          const pageIndex = Math.floor(offset / limit);

          return { data: pages[prefix]?.[pageIndex] ?? [], error: null };
        },
        async remove(paths: string[]) {
          calls.push({ op: 'remove', bucket, paths });

          const error = behavior.removeError ?? null;
          if (!error) removeFromPages(pages, paths);

          return { data: [], error };
        },
      };
    },
  };

  return { client: { storage } as unknown as PhotoCleanupClient, calls };
}

function removeCalls(calls: CleanupCall[]): string[][] {
  return calls.flatMap((call) => (call.op === 'remove' ? [call.paths] : []));
}

function listPrefixes(calls: CleanupCall[]): string[] {
  return calls.flatMap((call) => (call.op === 'list' ? [call.prefix] : []));
}

describe('findOrphanPhotoPaths', () => {
  it('menyimpan objek yang masih dirujuk baris kendaraan', () => {
    const orphans = findOrphanPhotoPaths(
      [{ folder: VEHICLE_FOLDER, objects: [{ name: 'baru.jpg', createdAt: OLD }] }],
      [PHOTO_PATH],
      { now: NOW },
    );

    expect(orphans).toEqual([]);
  });

  it('menghapus objek lama yang tidak dirujuk baris mana pun', () => {
    const orphans = findOrphanPhotoPaths(
      [
        {
          folder: VEHICLE_FOLDER,
          objects: [
            { name: 'baru.jpg', createdAt: OLD },
            { name: 'lama.jpg', createdAt: OLD },
          ],
        },
      ],
      [PHOTO_PATH],
      { now: NOW },
    );

    expect(orphans).toEqual([`${VEHICLE_FOLDER}/lama.jpg`]);
  });

  it('membiarkan objek yang baru dibuat karena barisnya belum sempat tertaut', () => {
    const orphans = findOrphanPhotoPaths(
      [{ folder: VEHICLE_FOLDER, objects: [{ name: 'baru.jpg', createdAt: FRESH }] }],
      [],
      { now: NOW },
    );

    expect(orphans).toEqual([]);
  });

  it('membiarkan objek tanpa timestamp yang bisa dibaca', () => {
    const orphans = findOrphanPhotoPaths(
      [
        {
          folder: VEHICLE_FOLDER,
          objects: [
            { name: 'tanpa-waktu.jpg', createdAt: null },
            { name: 'waktu-rusak.jpg', createdAt: 'bukan-tanggal' },
          ],
        },
      ],
      [],
      { now: NOW },
    );

    expect(orphans).toEqual([]);
  });

  it('membersihkan seluruh isi folder kendaraan yang barisnya sudah dihapus', () => {
    const orphans = findOrphanPhotoPaths(
      [
        {
          folder: VEHICLE_FOLDER,
          objects: [
            { name: 'a.jpg', createdAt: OLD },
            { name: 'b.jpg', createdAt: OLD },
          ],
        },
      ],
      [],
      { now: NOW },
    );

    expect(orphans).toEqual([`${VEHICLE_FOLDER}/a.jpg`, `${VEHICLE_FOLDER}/b.jpg`]);
  });

  it('membersihkan berkas yang tertinggal langsung di folder pengguna', () => {
    const orphans = findOrphanPhotoPaths(
      [{ folder: USER_ID, objects: [{ name: 'nyasar.jpg', createdAt: OLD }] }],
      [PHOTO_PATH],
      { now: NOW },
    );

    expect(orphans).toEqual([`${USER_ID}/nyasar.jpg`]);
  });

  it('memakai tenggang yang diberikan pemanggil', () => {
    const objects = [{ name: 'baru.jpg', createdAt: FRESH }];

    expect(findOrphanPhotoPaths([{ folder: VEHICLE_FOLDER, objects }], [], { now: NOW })).toEqual(
      [],
    );
    expect(
      findOrphanPhotoPaths([{ folder: VEHICLE_FOLDER, objects }], [], { now: NOW, graceMs: 0 }),
    ).toEqual([`${VEHICLE_FOLDER}/baru.jpg`]);
  });

  it('mengembalikan path terurut dan tanpa duplikat', () => {
    const listing = {
      folder: VEHICLE_FOLDER,
      objects: [
        { name: 'c.jpg', createdAt: OLD },
        { name: 'a.jpg', createdAt: OLD },
      ],
    };

    expect(findOrphanPhotoPaths([listing, listing], [], { now: NOW })).toEqual([
      `${VEHICLE_FOLDER}/a.jpg`,
      `${VEHICLE_FOLDER}/c.jpg`,
    ]);
  });

  it('memakai tenggang satu jam sebagai default', () => {
    expect(ORPHAN_PHOTO_GRACE_MS).toBe(60 * 60 * 1000);
  });
});

describe('sweepOrphanVehiclePhotos', () => {
  it('menyapu folder pengguna dan setiap folder kendaraan lalu menghapus yatim dalam satu batch', async () => {
    const { client, calls } = createCleanupClient({
      pages: {
        [USER_ID]: [[folderEntry(VEHICLE_ID), fileEntry('nyasar.jpg', OLD)]],
        [VEHICLE_FOLDER]: [[fileEntry('baru.jpg', OLD), fileEntry('lama.jpg', OLD)]],
      },
    });

    const result = await sweepOrphanVehiclePhotos(client, USER_ID, [{ photoPath: PHOTO_PATH }], {
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Urutannya alfabetis: folder kendaraan mendahului berkas di akar folder.
    expect(result.data).toEqual({
      checked: 3,
      removed: [`${VEHICLE_FOLDER}/lama.jpg`, `${USER_ID}/nyasar.jpg`],
      kept: 1,
    });
    expect(listPrefixes(calls)).toEqual([USER_ID, VEHICLE_FOLDER]);
    expect(removeCalls(calls)).toEqual([[`${VEHICLE_FOLDER}/lama.jpg`, `${USER_ID}/nyasar.jpg`]]);
  });

  it('tidak memanggil remove sama sekali bila tidak ada objek yatim', async () => {
    const { client, calls } = createCleanupClient({
      pages: {
        [USER_ID]: [[folderEntry(VEHICLE_ID)]],
        [VEHICLE_FOLDER]: [[fileEntry('baru.jpg', OLD), fileEntry('baru-banget.jpg', FRESH)]],
      },
    });

    const result = await sweepOrphanVehiclePhotos(client, USER_ID, [{ photoPath: PHOTO_PATH }], {
      now: NOW,
    });

    expect(result.ok && result.data).toEqual({ checked: 2, removed: [], kept: 2 });
    expect(removeCalls(calls)).toEqual([]);
  });

  it('mengambil halaman berikutnya bila satu halaman penuh', async () => {
    const penuh = Array.from({ length: 100 }, (_, index) => fileEntry(`fresh-${index}.jpg`, FRESH));
    const { client, calls } = createCleanupClient({
      pages: {
        [USER_ID]: [[folderEntry(VEHICLE_ID)]],
        [VEHICLE_FOLDER]: [[...penuh], [fileEntry('lama.jpg', OLD)]],
      },
    });

    const result = await sweepOrphanVehiclePhotos(client, USER_ID, [{ photoPath: PHOTO_PATH }], {
      now: NOW,
    });

    expect(result.ok && result.data.removed).toEqual([`${VEHICLE_FOLDER}/lama.jpg`]);

    const vehicleLists = calls.filter(
      (call) => call.op === 'list' && call.prefix === VEHICLE_FOLDER,
    );
    expect(vehicleLists).toHaveLength(2);
    expect(
      vehicleLists.map((call) => (call.op === 'list' ? call.options?.offset : undefined)),
    ).toEqual([0, 100]);
  });

  it('mengembalikan error yang dipetakan dan tidak menghapus apa pun bila listing ditolak', async () => {
    const { client, calls } = createCleanupClient({
      listError: { status: 403, message: 'AccessDenied' },
    });

    const result = await sweepOrphanVehiclePhotos(client, USER_ID, [{ photoPath: PHOTO_PATH }], {
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
    expect(removeCalls(calls)).toEqual([]);
  });

  it('hanya menyentuh folder sesi walaupun baris memuat path folder lain', async () => {
    const asing = `${OTHER_USER_ID}/${VEHICLE_ID}/punya-orang-lain.jpg`;
    const { client, calls } = createCleanupClient({
      pages: {
        [USER_ID]: [[folderEntry(VEHICLE_ID)]],
        [VEHICLE_FOLDER]: [[fileEntry('lama.jpg', OLD)]],
      },
    });

    const result = await sweepOrphanVehiclePhotos(client, USER_ID, [{ photoPath: asing }], {
      now: NOW,
    });

    expect(result.ok && result.data.removed).toEqual([`${VEHICLE_FOLDER}/lama.jpg`]);
    expect(
      listPrefixes(calls).every((prefix) => prefix === USER_ID || prefix.startsWith(`${USER_ID}/`)),
    ).toBe(true);
  });

  it('melaporkan kegagalan remove tanpa berpura-pura berhasil', async () => {
    const { client } = createCleanupClient({
      pages: {
        [USER_ID]: [[folderEntry(VEHICLE_ID)]],
        [VEHICLE_FOLDER]: [[fileEntry('lama.jpg', OLD)]],
      },
      removeError: { status: 403, message: 'AccessDenied' },
    });

    const result = await sweepOrphanVehiclePhotos(client, USER_ID, [], { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
  });
});

describe('cleanUpVehiclePhotosAfterDelete', () => {
  it('menghapus objek kendaraan yang dihapus lebih dulu, lalu menyapu sisanya', async () => {
    const { client, calls } = createCleanupClient({
      pages: {
        [USER_ID]: [[folderEntry(VEHICLE_ID)]],
        [VEHICLE_FOLDER]: [[fileEntry('baru.jpg', OLD), fileEntry('lama.jpg', OLD)]],
      },
    });

    const result = await cleanUpVehiclePhotosAfterDelete(client, USER_ID, PHOTO_PATH, [], {
      now: NOW,
    });

    expect(result.ok && result.data.removed).toEqual([`${VEHICLE_FOLDER}/lama.jpg`]);
    expect(removeCalls(calls)).toEqual([[PHOTO_PATH], [`${VEHICLE_FOLDER}/lama.jpg`]]);
  });

  it('tetap menyapu walau path eksplisit tidak diberikan', async () => {
    const { client, calls } = createCleanupClient({
      pages: {
        [USER_ID]: [[folderEntry(VEHICLE_ID)]],
        [VEHICLE_FOLDER]: [[fileEntry('lama.jpg', OLD)]],
      },
    });

    const result = await cleanUpVehiclePhotosAfterDelete(client, USER_ID, null, [], { now: NOW });

    expect(result.ok && result.data.removed).toEqual([`${VEHICLE_FOLDER}/lama.jpg`]);
    expect(removeCalls(calls)).toEqual([[`${VEHICLE_FOLDER}/lama.jpg`]]);
  });

  it('tidak melempar saat klien tidak punya storage sehingga pemanggil `void` tetap aman', async () => {
    // Layar memanggil pembersihan dengan `void`; lemparan di sini akan menjadi
    // unhandled rejection yang mematikan alur hapus kendaraan di perangkat.
    const broken = {} as PhotoCleanupClient;

    await expect(cleanUpVehiclePhotosAfterDelete(broken, USER_ID, PHOTO_PATH, [])).resolves.toEqual(
      {
        ok: false,
        error: expect.objectContaining({ code: 'unknown', retryable: true }),
      },
    );
    await expect(sweepOrphanVehiclePhotos(broken, USER_ID, [])).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'unknown' }),
    });
  });
});
