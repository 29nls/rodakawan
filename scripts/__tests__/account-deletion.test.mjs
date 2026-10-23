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

/* ========================================================================== */
/* Reliabilitas (ADR-078): checkpoint tahan-gagal, lease eksklusif, pemulihan. */
/*
 * Kedua harness di bawah meniru semantik SQL yang sesungguhnya (kolom lease,
 * checkpoint antar tahap, penutupan berversi lease, serta model objek Storage),
 * sehingga tes membuktikan **state akhir** — bukan sekadar urutan pemanggilan.
 * failure-injection mensimulasikan crash di setiap batas tahap.
 */

/** Job-db tiruan: meniru `begin_account_deletion_claim` + checkpoint + finish. */
function createJobDb({ authExists = true } = {}) {
  const jobs = new Map();
  let tick = 0;
  const now = () => ++tick;

  return {
    setAuthExists(value) {
      authExists = value;
    },
    get(user) {
      return jobs.get(user);
    },
    expireLease(user) {
      const job = jobs.get(user);
      if (job) job.leaseExpires = 0;
    },
    begin(user, lease, ttl = 10) {
      let job = jobs.get(user);

      if (job && job.status === 'completed') {
        return { id: user, status: job.status, lastStep: job.lastStep, attempts: job.attempts };
      }

      if (job) {
        // Pemulihan: identitas hilang + sudah mencapai auth → selesaikan.
        if (!authExists && ['auth', 'done'].includes(job.lastStep)) {
          Object.assign(job, {
            status: 'completed',
            lastStep: 'done',
            lastError: null,
            lease: null,
            leaseExpires: null,
            completedAt: job.completedAt ?? now(),
          });
          return { id: user, status: job.status, lastStep: job.lastStep, attempts: job.attempts };
        }

        if (job.status === 'running' && job.leaseExpires > now() && job.lease !== lease) {
          const error = new Error('in_progress');
          error.code = 'account_deletion_in_progress';
          throw error;
        }

        if (job.attempts >= 5 && job.updatedAt > now() - 15) {
          const error = new Error('rate');
          error.code = 'account_deletion_rate_limited';
          throw error;
        }

        Object.assign(job, {
          status: 'running',
          attempts: job.attempts + 1,
          lastError: null,
          lease,
          leaseExpires: now() + ttl,
          updatedAt: now(),
        });
      } else {
        job = {
          status: 'running',
          attempts: 1,
          lastStep: 'start',
          lastError: null,
          lease,
          leaseExpires: now() + ttl,
          updatedAt: now(),
          completedAt: null,
        };
        jobs.set(user, job);
      }

      return { id: user, status: job.status, lastStep: job.lastStep, attempts: job.attempts };
    },
    checkpoint(jobId, step, lease) {
      const job = jobs.get(jobId);
      if (!job || job.lease !== lease || job.status !== 'running') {
        const error = new Error('lease_lost');
        error.code = 'account_deletion_lease_lost';
        throw error;
      }
      job.lastStep = step;
      job.updatedAt = now();
      job.leaseExpires = Math.max(job.leaseExpires, now() + 10);
    },
    finish(jobId, status, step, error, lease) {
      const job = jobs.get(jobId);
      if (job && job.status === 'completed') return; // idempoten
      if (!job || job.lease !== lease) {
        const leaseError = new Error('lease_lost');
        leaseError.code = 'account_deletion_lease_lost';
        throw leaseError;
      }
      job.status = status;
      job.lastStep = step;
      job.lastError = error;
      job.lease = null;
      job.leaseExpires = null;
      job.updatedAt = now();
      if (status === 'completed') job.completedAt = now();
    },
  };
}

/** Model objek Storage + klub: memungkinkan asersi state akhir yang nyata. */
function createStorage({ objects = [], clubs = new Map() } = {}) {
  const state = { objects: objects.map((object) => ({ ...object })), clubs, failOldRemove: false };

  return {
    state,
    clubs,
    has(bucket, path) {
      return state.objects.some((object) => object.bucket === bucket && object.path === path);
    },
    manifest(user) {
      const owned = (bucket) =>
        state.objects.filter((o) => o.bucket === bucket && o.owner === user);
      return {
        avatars: owned('avatars').map((o) => o.path),
        vehiclePhotos: owned('vehicle-photos').map((o) => o.path),
        clubLogos: owned('club-logos').map((o) => {
          const clubId = o.path.split('/')[0];
          return { path: o.path, clubId, inUse: clubs.get(clubId) === o.path };
        }),
      };
    },
    transfer({ path, clubId }) {
      const newPath = `${clubId}/logo-baru.png`;
      state.objects.push({ bucket: 'club-logos', path: newPath, owner: 'service' });
      clubs.set(clubId, newPath);
      // Meniru deps.transferClubLogo: setelah referensi pindah, objek lama
      // dihapus; bila penghapusan itu gagal, operasi melempar setelah transfer.
      if (state.failOldRemove) {
        state.failOldRemove = false;
        throw new DeletionStepError('storage_club_logo_old_delete_failed', 'media');
      }
      state.objects = state.objects.filter((object) => object.path !== path);
    },
    remove(bucket, paths) {
      state.objects = state.objects.filter(
        (object) => !(object.bucket === bucket && paths.includes(object.path)),
      );
      return paths.length;
    },
  };
}

function createReliableDeps(db, storage, calls, failures = {}) {
  return {
    begin: async (user, lease) => {
      calls.push(['begin', user, lease]);
      if (failures.onBegin) failures.onBegin();
      return db.begin(user, lease);
    },
    checkpoint: async (jobId, step, lease) => {
      calls.push(['checkpoint', step]);
      if (failures.checkpoint) throw failures.checkpoint();
      return db.checkpoint(jobId, step, lease);
    },
    finish: async (jobId, status, step, error, lease) => {
      calls.push(['finish', status, step]);
      if (failures.finish) throw failures.finish(status);
      return db.finish(jobId, status, step, error, lease);
    },
    manifest: async (user) => {
      calls.push(['manifest']);
      if (failures.manifest) throw failures.manifest();
      return storage.manifest(user);
    },
    transferClubLogo: async (logo) => {
      calls.push(['transfer', logo.path]);
      return storage.transfer(logo);
    },
    removeObjects: async (bucket, paths) => {
      calls.push(['remove', bucket, paths]);
      if (failures.remove) failures.remove(bucket, paths);
      return storage.remove(bucket, paths);
    },
    purge: async () => {
      calls.push(['purge']);
      if (failures.purge) {
        const out = failures.purge();
        // Gerbang async (resolve sebuah nilai) vs kegagalan sinkron (melempar Error).
        if (out && typeof out.then === 'function') return await out;
        throw out;
      }
      return { profileDeleted: true };
    },
    deleteAuthUser: async (user) => {
      calls.push(['auth']);
      if (failures.auth) throw failures.auth();
      db.setAuthExists(false);
    },
  };
}

describe('runAccountDeletion — reliabilitas (ADR-078)', () => {
  it('dua permintaan bersamaan: hanya satu worker yang menjalankan tahap', async () => {
    const db = createJobDb();
    const storage = createStorage({
      objects: [{ bucket: 'avatars', path: 'u1/a.jpg', owner: 'u1' }],
    });
    const calls = [];

    let releasePurge;
    const gate = new Promise((resolve) => {
      releasePurge = resolve;
    });
    let markClaimed;
    const claimed = new Promise((resolve) => {
      markClaimed = resolve;
    });

    const depsA = createReliableDeps(db, storage, calls, {
      onBegin: markClaimed,
      purge: async () => {
        await gate;
        return { profileDeleted: true };
      },
    });
    const pA = runAccountDeletion({ userId: 'u1', lease: 'L-A', deps: depsA });
    await claimed; // A sudah mengklaim lease

    const callsB = [];
    const depsB = createReliableDeps(db, storage, callsB, {});
    await assert.rejects(
      runAccountDeletion({ userId: 'u1', lease: 'L-B', deps: depsB }),
      (error) => {
        assert.equal(error.code, 'account_deletion_in_progress');
        return true;
      },
    );
    assert.deepEqual(
      callsB.map((call) => call[0]),
      ['begin'],
    ); // B tidak menjalankan apa pun

    releasePurge({ profileDeleted: true });
    const resultA = await pA;
    assert.equal(resultA.status, 'completed');
    assert.equal(calls.filter((call) => call[0] === 'purge').length, 1);
    assert.equal(calls.filter((call) => call[0] === 'auth').length, 1);
    assert.equal(db.get('u1').status, 'completed');
  });

  it('crash setelah media: retry melanjutkan dari purge tanpa mengulang media', async () => {
    const db = createJobDb();
    const storage = createStorage({
      objects: [{ bucket: 'avatars', path: 'u1/a.jpg', owner: 'u1' }],
    });
    const calls = [];
    const deps1 = createReliableDeps(db, storage, calls, {
      purge: () => new Error('jaringan mati'),
      finish: () => new Error('jaringan mati'), // status tidak tertulis (crash)
    });

    await assert.rejects(runAccountDeletion({ userId: 'u1', lease: 'L1', deps: deps1 }));
    assert.equal(db.get('u1').status, 'running');
    assert.equal(db.get('u1').lastStep, 'media'); // checkpoint media tersistir durable

    db.expireLease('u1');
    const calls2 = [];
    const deps2 = createReliableDeps(db, storage, calls2, {});
    const result = await runAccountDeletion({ userId: 'u1', lease: 'L2', deps: deps2 });

    assert.equal(result.status, 'completed');
    const kinds2 = calls2.map((call) => call[0]);
    assert.ok(!kinds2.includes('manifest'));
    assert.ok(!kinds2.includes('remove'));
    assert.equal(calls2.filter((call) => call[0] === 'purge').length, 1);
    assert.equal(calls2.filter((call) => call[0] === 'auth').length, 1);
    assert.equal(db.get('u1').status, 'completed');
  });

  it('crash setelah purge: retry hanya menjalankan Auth', async () => {
    const db = createJobDb();
    const storage = createStorage({});
    const calls = [];
    const deps1 = createReliableDeps(db, storage, calls, {
      auth: () => new Error('jaringan mati'),
      finish: () => new Error('jaringan mati'),
    });

    await assert.rejects(runAccountDeletion({ userId: 'u1', lease: 'L1', deps: deps1 }));
    assert.equal(db.get('u1').lastStep, 'purge');

    db.expireLease('u1');
    const calls2 = [];
    const deps2 = createReliableDeps(db, storage, calls2, {});
    const result = await runAccountDeletion({ userId: 'u1', lease: 'L2', deps: deps2 });

    assert.equal(result.status, 'completed');
    const kinds2 = calls2.map((call) => call[0]);
    assert.ok(!kinds2.includes('manifest'));
    assert.ok(!kinds2.includes('purge'));
    assert.equal(calls2.filter((call) => call[0] === 'auth').length, 1);
    assert.equal(db.get('u1').status, 'completed');
  });

  it('crash setelah Auth sebelum finish: pemulihan menyelesaikan tanpa mengulang', async () => {
    const db = createJobDb();
    const storage = createStorage({});
    const calls = [];
    const deps1 = createReliableDeps(db, storage, calls, {
      finish: () => new Error('jaringan mati'), // finish completed & failed sama-sama gagal
    });

    await assert.rejects(runAccountDeletion({ userId: 'u1', lease: 'L1', deps: deps1 }));
    // Auth sudah terhapus, checkpoint 'auth' tersistir, tapi job belum ditutup.
    assert.equal(db.get('u1').lastStep, 'auth');
    assert.equal(db.get('u1').status, 'running');

    const calls2 = [];
    const deps2 = createReliableDeps(db, storage, calls2, {});
    const result = await runAccountDeletion({ userId: 'u1', lease: 'L2', deps: deps2 });

    assert.equal(result.status, 'completed');
    assert.equal(result.alreadyCompleted, true);
    assert.deepEqual(
      calls2.map((call) => call[0]),
      ['begin'],
    ); // tidak ada operasi ulang
    assert.equal(db.get('u1').status, 'completed');
  });

  it('retry setelah penghapusan Storage separuh: objek tersisa bersih, purge/auth tetap sekali', async () => {
    const db = createJobDb();
    const storage = createStorage({
      objects: [
        { bucket: 'avatars', path: 'u1/a.jpg', owner: 'u1' },
        { bucket: 'vehicle-photos', path: 'u1/m/f.jpg', owner: 'u1' },
      ],
    });
    const calls = [];
    let failedOnce = false;
    const deps1 = createReliableDeps(db, storage, calls, {
      remove: (bucket) => {
        if (bucket === 'vehicle-photos' && !failedOnce) {
          failedOnce = true;
          throw new Error('jaringan mati');
        }
      },
    });

    await assert.rejects(runAccountDeletion({ userId: 'u1', lease: 'L1', deps: deps1 }));
    assert.equal(storage.has('avatars', 'u1/a.jpg'), false); // bucket pertama bersih
    assert.equal(storage.has('vehicle-photos', 'u1/m/f.jpg'), true); // bucket kedua tertinggal
    assert.equal(db.get('u1').status, 'failed');

    db.expireLease('u1');
    const calls2 = [];
    const deps2 = createReliableDeps(db, storage, calls2, {});
    const result = await runAccountDeletion({ userId: 'u1', lease: 'L2', deps: deps2 });

    assert.equal(result.status, 'completed');
    assert.equal(storage.has('vehicle-photos', 'u1/m/f.jpg'), false);
    const all = calls.concat(calls2);
    assert.equal(all.filter((call) => call[0] === 'purge').length, 1); // tidak dobel
    assert.equal(all.filter((call) => call[0] === 'auth').length, 1);
  });

  it('retry setelah logo klub dipindah tapi penghapusan objek lama gagal: transfer tidak diulang', async () => {
    const db = createJobDb();
    const clubs = new Map([['c1', 'c1/logo.png']]);
    const storage = createStorage({
      objects: [{ bucket: 'club-logos', path: 'c1/logo.png', owner: 'u1' }],
      clubs,
    });
    storage.state.failOldRemove = true;
    const calls = [];
    const deps1 = createReliableDeps(db, storage, calls, {});

    await assert.rejects(runAccountDeletion({ userId: 'u1', lease: 'L1', deps: deps1 }));
    const newPath = clubs.get('c1');
    assert.notEqual(newPath, 'c1/logo.png'); // referensi sudah pindah
    assert.equal(storage.has('club-logos', 'c1/logo.png'), true); // objek lama tertinggal
    assert.equal(db.get('u1').status, 'failed');

    db.expireLease('u1');
    const calls2 = [];
    const deps2 = createReliableDeps(db, storage, calls2, {});
    const result = await runAccountDeletion({ userId: 'u1', lease: 'L2', deps: deps2 });

    assert.equal(result.status, 'completed');
    assert.equal(storage.has('club-logos', 'c1/logo.png'), false); // lama kini yatim → bersih
    assert.equal(storage.has('club-logos', newPath), true); // aset bersama tetap ada
    assert.equal(clubs.get('c1'), newPath); // referensi konsisten
    const all = calls.concat(calls2);
    assert.equal(all.filter((call) => call[0] === 'transfer').length, 1); // transfer sekali saja
  });

  it('kegagalan menulis checkpoint menghentikan proses sebelum purge dan tidak mengaku sukses', async () => {
    const db = createJobDb();
    const storage = createStorage({
      objects: [{ bucket: 'avatars', path: 'u1/a.jpg', owner: 'u1' }],
    });
    const calls = [];
    const deps = createReliableDeps(db, storage, calls, {
      checkpoint: () => new Error('jaringan mati'),
    });

    await assert.rejects(runAccountDeletion({ userId: 'u1', lease: 'L1', deps }), (error) => {
      assert.equal(error.code, 'account_deletion_status_failed');
      return true;
    });

    assert.ok(!calls.some((call) => call[0] === 'purge' || call[0] === 'auth'));
    // Media fisik boleh saja sudah tersentuh, tetapi TIDAK boleh dianggap tuntas:
    // checkpoint gagal → lastStep tetap 'start', jadi purge/auth tidak pernah jalan.
    assert.equal(db.get('u1').lastStep, 'start');
    assert.equal(db.get('u1').status, 'failed');
  });

  it('lease kedaluwarsa diklaim ulang dengan aman; worker basi tidak bisa menutupi hasil', async () => {
    const db = createJobDb();
    const storage = createStorage({});
    const calls = [];

    let releasePurge;
    const gate = new Promise((resolve) => {
      releasePurge = resolve;
    });
    const depsA = createReliableDeps(db, storage, calls, {
      purge: async () => {
        await gate;
        return { profileDeleted: true };
      },
    });
    const pA = runAccountDeletion({ userId: 'u1', lease: 'L-A', deps: depsA });
    await new Promise((resolve) => setTimeout(resolve, 0)); // A sampai di purge

    db.expireLease('u1');
    const callsB = [];
    const depsB = createReliableDeps(db, storage, callsB, {});
    const resultB = await runAccountDeletion({ userId: 'u1', lease: 'L-B', deps: depsB });
    assert.equal(resultB.status, 'completed');

    releasePurge();
    await assert.rejects(pA, (error) => {
      assert.ok(
        ['account_deletion_status_failed', 'account_deletion_lease_lost'].includes(error.code),
      );
      return true;
    });
    assert.equal(db.get('u1').status, 'completed'); // tetap hasil milik B
  });

  it('job yang sudah completed tidak menjalankan operasi penghapusan ulang', async () => {
    const db = createJobDb();
    const storage = createStorage({});
    const calls = [];
    await runAccountDeletion({
      userId: 'u1',
      lease: 'L1',
      deps: createReliableDeps(db, storage, calls, {}),
    });
    assert.equal(db.get('u1').status, 'completed');

    const calls2 = [];
    const deps2 = createReliableDeps(db, storage, calls2, {});
    const result = await runAccountDeletion({ userId: 'u1', lease: 'L2', deps: deps2 });

    assert.equal(result.alreadyCompleted, true);
    assert.deepEqual(
      calls2.map((call) => call[0]),
      ['begin'],
    );
  });
});
