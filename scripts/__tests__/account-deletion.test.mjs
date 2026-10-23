import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DeletionStepError,
  cleanupMedia,
  runAccountDeletion,
} from '../../supabase/functions/delete-account/orchestrator.mjs';

function createDeps(overrides = {}) {
  const calls = [];

  const deps = {
    begin: async () => {
      calls.push(['begin']);
      return { id: 'job-1', status: 'running', lastStep: 'start', attempts: 1 };
    },
    finish: async (jobId, status, step, error) => {
      calls.push(['finish', jobId, status, step, error]);
    },
    manifest: async () => {
      calls.push(['manifest']);
      return { avatars: [], vehiclePhotos: [], clubLogos: [] };
    },
    transferClubLogo: async (logo) => {
      calls.push(['transfer', logo.path]);
    },
    removeObjects: async (bucket, paths) => {
      calls.push(['remove', bucket, paths]);
      return paths.length;
    },
    purge: async () => {
      calls.push(['purge']);
      return { profileDeleted: true };
    },
    deleteAuthUser: async () => {
      calls.push(['auth']);
    },
    ...overrides,
  };

  return { deps, calls };
}

describe('runAccountDeletion', () => {
  it('menjalankan media → purge → auth, memindahkan logo yang dipakai, lalu menutup job', async () => {
    const { deps, calls } = createDeps({
      manifest: async () => {
        calls.push(['manifest']);
        return {
          avatars: ['u1/avatar.jpg'],
          vehiclePhotos: ['u1/m1/foto.jpg'],
          clubLogos: [
            { path: 'c1/logo.png', clubId: 'c1', inUse: true },
            { path: 'c1/lama.png', clubId: 'c1', inUse: false },
          ],
        };
      },
    });

    const result = await runAccountDeletion({ userId: 'u1', deps });

    assert.equal(result.status, 'completed');
    assert.equal(result.alreadyCompleted, false);
    assert.deepEqual(
      calls.map((call) => call[0]),
      ['begin', 'manifest', 'transfer', 'remove', 'remove', 'remove', 'purge', 'auth', 'finish'],
    );
    assert.deepEqual(
      calls.filter((call) => call[0] === 'transfer').map((call) => call[1]),
      ['c1/logo.png'],
    );
    assert.deepEqual(calls.find((call) => call[0] === 'remove' && call[1] === 'club-logos')[2], [
      'c1/lama.png',
    ]);
    assert.deepEqual(calls.at(-1), ['finish', 'job-1', 'completed', 'done', null]);
  });

  it('job yang sudah selesai tidak memanggil langkah lain', async () => {
    const { deps, calls } = createDeps({
      begin: async () => {
        calls.push(['begin']);
        return { id: 'job-1', status: 'completed', lastStep: 'done', attempts: 1 };
      },
    });

    const result = await runAccountDeletion({ userId: 'u1', deps });

    assert.equal(result.alreadyCompleted, true);
    assert.deepEqual(
      calls.map((call) => call[0]),
      ['begin'],
    );
  });

  it('gagal membaca manifest bukan berarti tidak ada media: purge dan auth tidak dijalankan', async () => {
    const { deps, calls } = createDeps({
      manifest: async () => {
        throw new DeletionStepError('media_manifest_unavailable', 'media');
      },
    });

    await assert.rejects(runAccountDeletion({ userId: 'u1', deps }), (error) => {
      assert.equal(error.code, 'media_manifest_unavailable');
      assert.equal(error.step, 'media');
      return true;
    });

    const kinds = calls.map((call) => call[0]);
    assert.ok(!kinds.includes('purge'));
    assert.ok(!kinds.includes('auth'));
    assert.deepEqual(calls.at(-1), [
      'finish',
      'job-1',
      'failed',
      'start',
      'media_manifest_unavailable',
    ]);
  });

  it('manifest berbentuk salah ditolak sebelum ada penghapusan', async () => {
    const { deps, calls } = createDeps({
      manifest: async () => ({ avatars: 'bukan-array', vehiclePhotos: [], clubLogos: [] }),
    });

    await assert.rejects(runAccountDeletion({ userId: 'u1', deps }), /media_manifest_invalid/);

    const kinds = calls.map((call) => call[0]);
    assert.ok(!kinds.includes('remove'));
    assert.ok(!kinds.includes('purge'));
  });

  it('gagal memindahkan logo klub menghentikan proses sebelum purge/auth', async () => {
    const { deps, calls } = createDeps({
      manifest: async () => ({
        avatars: [],
        vehiclePhotos: [],
        clubLogos: [{ path: 'c1/logo.png', clubId: 'c1', inUse: true }],
      }),
      transferClubLogo: async () => {
        throw new DeletionStepError('storage_club_logo_download_failed', 'media');
      },
    });

    await assert.rejects(runAccountDeletion({ userId: 'u1', deps }));

    const kinds = calls.map((call) => call[0]);
    assert.ok(!kinds.includes('purge'));
    assert.ok(!kinds.includes('auth'));
  });

  it('retry setelah purge gagal melanjutkan dari purge tanpa mengulang media', async () => {
    const { deps, calls } = createDeps({
      begin: async () => {
        calls.push(['begin']);
        return { id: 'job-1', status: 'failed', lastStep: 'media', attempts: 2 };
      },
      purge: async () => {
        throw new DeletionStepError('db_purge_failed', 'purge');
      },
    });

    await assert.rejects(runAccountDeletion({ userId: 'u1', deps }));

    const kinds = calls.map((call) => call[0]);
    assert.ok(!kinds.includes('manifest'));
    assert.ok(!kinds.includes('auth'));
    assert.deepEqual(calls.at(-1), ['finish', 'job-1', 'failed', 'media', 'db_purge_failed']);
  });

  it('retry setelah Auth gagal hanya mengulang Auth dan tidak menghapus ulang database', async () => {
    const { deps, calls } = createDeps({
      begin: async () => {
        calls.push(['begin']);
        return { id: 'job-1', status: 'failed', lastStep: 'purge', attempts: 2 };
      },
    });

    const result = await runAccountDeletion({ userId: 'u1', deps });

    assert.equal(result.status, 'completed');
    assert.deepEqual(
      calls.map((call) => call[0]),
      ['begin', 'auth', 'finish'],
    );
  });

  it('kegagalan Auth dicatat pada langkah purge agar retry tidak mengulang database', async () => {
    const { deps, calls } = createDeps({
      deleteAuthUser: async () => {
        throw new Error('network');
      },
    });

    await assert.rejects(runAccountDeletion({ userId: 'u1', deps }), (error) => {
      assert.equal(error.code, 'auth_delete_failed');
      assert.equal(error.step, 'auth');
      return true;
    });

    assert.deepEqual(calls.at(-1), ['finish', 'job-1', 'failed', 'purge', 'auth_delete_failed']);
  });

  it('tidak memanggil Storage saat manifest kosong', async () => {
    const { deps, calls } = createDeps();

    await runAccountDeletion({ userId: 'u1', deps });

    assert.equal(calls.filter((call) => call[0] === 'remove').length, 0);
    assert.equal(calls.filter((call) => call[0] === 'transfer').length, 0);
  });
});

describe('cleanupMedia', () => {
  it('menghapus per bucket dan melaporkan jumlah objek', async () => {
    const removed = [];
    const result = await cleanupMedia(
      {
        avatars: ['u/a.jpg'],
        vehiclePhotos: ['u/m/f.jpg'],
        clubLogos: [],
      },
      {
        transferClubLogo: async () => assert.fail('tidak ada logo yang dipindahkan'),
        removeObjects: async (bucket, paths) => {
          removed.push([bucket, paths]);
          return paths.length;
        },
      },
    );

    assert.deepEqual(removed, [
      ['avatars', ['u/a.jpg']],
      ['vehicle-photos', ['u/m/f.jpg']],
    ]);
    assert.deepEqual(result.removed, { avatars: 1, vehiclePhotos: 1, clubLogos: 0 });
  });
});
