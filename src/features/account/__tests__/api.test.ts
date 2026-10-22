import {
  collectOwnMedia,
  deleteMyAccount,
  removeOwnMedia,
  type AccountClient,
} from '@/features/account/api';

type RpcResult = { data: unknown; error: unknown };

type FakeOptions = {
  profile?: { avatar_url: string | null } | null;
  profileError?: unknown;
  bikes?: { photo_path: string | null }[];
  bikesError?: unknown;
  rpc?: RpcResult;
  remove?: (bucket: string, paths: string[]) => { data: unknown; error: unknown };
};

function createClient(options: FakeOptions = {}) {
  const calls = {
    rpc: [] as { fn: string; args: unknown }[],
    remove: [] as { bucket: string; paths: string[] }[],
  };

  const client = {
    rpc: async (fn: string, args?: unknown) => {
      calls.rpc.push({ fn, args });
      return options.rpc ?? { data: null, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, _value: string) =>
          table === 'profiles'
            ? {
                maybeSingle: async () => ({
                  data: options.profile === undefined ? { avatar_url: null } : options.profile,
                  error: options.profileError ?? null,
                }),
              }
            : Promise.resolve({
                data: options.bikes ?? [],
                error: options.bikesError ?? null,
              }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.remove.push({ bucket, paths });
          if (options.remove) return options.remove(bucket, paths);
          return { data: paths.map((path) => ({ name: path })), error: null };
        },
      }),
    },
  };

  return { client: client as unknown as AccountClient, calls };
}

describe('deleteMyAccount', () => {
  it('memanggil RPC tanpa argumen sehingga identitas selalu dari sesi', async () => {
    const { client, calls } = createClient();

    const result = await deleteMyAccount(client);

    expect(result).toEqual({ ok: true, data: null });
    expect(calls.rpc).toEqual([{ fn: 'delete_my_account', args: undefined }]);
  });

  it('menerjemahkan tag account_unauthenticated menjadi sesi berakhir', async () => {
    const { client } = createClient({
      rpc: { data: null, error: { message: 'boom', details: 'account_unauthenticated' } },
    });

    const result = await deleteMyAccount(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('session_expired');
      expect(result.error.retryable).toBe(false);
      expect(result.error.message).toContain('Masuk kembali');
    }
  });

  it('menerjemahkan tag account_profile_missing dan menandainya bisa dicoba lagi', async () => {
    const { client } = createClient({
      rpc: { data: null, error: { detail: 'account_profile_missing' } },
    });

    const result = await deleteMyAccount(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('profile_missing');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('tidak menampilkan pesan mentah dari server untuk galat tak dikenal', async () => {
    const { client } = createClient({
      rpc: { data: null, error: { message: 'rahasia internal', code: 'XX000' } },
    });

    const result = await deleteMyAccount(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain('rahasia internal');
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });
});

describe('collectOwnMedia', () => {
  it('mengumpulkan avatar dan foto kendaraan dengan bucket yang benar', async () => {
    const { client } = createClient({
      profile: { avatar_url: 'u1/avatar.jpg' },
      bikes: [{ photo_path: 'u1/b1/foto.jpg' }, { photo_path: null }],
    });

    const objects = await collectOwnMedia(client, 'u1');

    expect(objects).toEqual([
      { bucket: 'avatars', path: 'u1/avatar.jpg' },
      { bucket: 'vehicle-photos', path: 'u1/b1/foto.jpg' },
    ]);
  });

  it('mengembalikan daftar kosong saat profil gagal dibaca, bukan membatalkan penghapusan', async () => {
    const { client } = createClient({ profileError: { message: 'network' } });

    await expect(collectOwnMedia(client, 'u1')).resolves.toEqual([]);
  });

  it('mengabaikan kendaraan yang gagal dibaca', async () => {
    const { client } = createClient({
      profile: { avatar_url: 'u1/avatar.jpg' },
      bikesError: { message: 'network' },
    });

    await expect(collectOwnMedia(client, 'u1')).resolves.toEqual([
      { bucket: 'avatars', path: 'u1/avatar.jpg' },
    ]);
  });
});

describe('removeOwnMedia', () => {
  it('mengelompokkan path per bucket dan menghitung hasilnya', async () => {
    const { client, calls } = createClient();

    const result = await removeOwnMedia(client, [
      { bucket: 'avatars', path: 'u1/a.jpg' },
      { bucket: 'vehicle-photos', path: 'u1/b.jpg' },
      { bucket: 'vehicle-photos', path: 'u1/c.jpg' },
    ]);

    expect(result).toEqual({ removed: 3, failed: 0 });
    expect(calls.remove).toEqual([
      { bucket: 'avatars', paths: ['u1/a.jpg'] },
      { bucket: 'vehicle-photos', paths: ['u1/b.jpg', 'u1/c.jpg'] },
    ]);
  });

  it('menghitung bucket yang gagal sebagai failed, bukan melempar', async () => {
    const { client } = createClient({
      remove: (bucket) =>
        bucket === 'vehicle-photos'
          ? { data: null, error: { message: 'denied' } }
          : { data: [{ name: 'a' }], error: null },
    });

    const result = await removeOwnMedia(client, [
      { bucket: 'avatars', path: 'u1/a.jpg' },
      { bucket: 'vehicle-photos', path: 'u1/b.jpg' },
    ]);

    expect(result).toEqual({ removed: 1, failed: 1 });
  });

  it('menangani storage yang melempar tanpa menggagalkan penghapusan akun', async () => {
    const { client } = createClient({
      remove: () => {
        throw new Error('native failure');
      },
    });

    await expect(
      removeOwnMedia(client, [{ bucket: 'avatars', path: 'u1/a.jpg' }]),
    ).resolves.toEqual({ removed: 0, failed: 1 });
  });
});
