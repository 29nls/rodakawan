/**
 * Orkestrasi hapus akun di sisi server.
 *
 * Modul ini sengaja tidak mengimpor Deno, Supabase, atau apa pun: seluruh I/O
 * masuk lewat `deps`, sehingga urutan langkah, idempotensi, dan perilaku gagal
 * parsial bisa diuji di Node tanpa jaringan. `index.ts` hanya menyediakan
 * implementasi Deno/Supabase dari antarmuka yang sama.
 *
 * Urutan langkah (setiap langkah idempoten):
 *   1. `media`  — baca manifest objek Storage, pindahkan logo klub yang masih
 *                 dipakai, hapus media pribadi. Kegagalan baca manifest TIDAK
 *                 boleh dianggap "tidak ada media".
 *   2. `purge`  — satu transaksi database: alihkan konten bersama ke tombstone,
 *                 hapus data pribadi dan baris profil.
 *   3. `auth`   — hapus identitas login lewat Auth Admin API, setelah tidak ada
 *                 lagi kepemilikan Storage/database yang menghalanginya.
 *
 * `lastStep` yang disimpan adalah langkah terakhir yang **selesai**. Bila proses
 * berhenti di tengah, retry melanjutkan dari langkah berikutnya; langkah yang
 * belum selesai aman diulang.
 */

export const STEPS = Object.freeze(['start', 'media', 'purge', 'auth', 'done']);

/** Galat langkah dengan kode stabil yang aman disimpan di kolom `last_error`. */
export class DeletionStepError extends Error {
  /**
   * @param {string} code kode mesin, tanpa path/email/pesan internal
   * @param {string} step langkah tempat kegagalan terjadi
   */
  constructor(code, step) {
    super(code);
    this.name = 'DeletionStepError';
    this.code = code;
    this.step = step;
  }
}

/**
 * @typedef {{ path: string, clubId: string, inUse: boolean }} ClubLogo
 * @typedef {{
 *   avatars: string[],
 *   vehiclePhotos: string[],
 *   clubLogos: ClubLogo[],
 *   profileExists?: boolean,
 * }} MediaManifest
 *
 * @typedef {{
 *   id: string,
 *   status: 'running' | 'failed' | 'completed',
 *   lastStep: string,
 *   attempts: number,
 * }} DeletionJob
 *
 * @typedef {{
 *   begin: (userId: string) => Promise<DeletionJob>,
 *   finish: (
 *     jobId: string,
 *     status: 'failed' | 'completed',
 *     step: string,
 *     error: string | null,
 *   ) => Promise<void>,
 *   manifest: (userId: string) => Promise<MediaManifest>,
 *   transferClubLogo: (logo: { path: string, clubId: string }) => Promise<void>,
 *   removeObjects: (bucket: string, paths: string[]) => Promise<number>,
 *   purge: (userId: string) => Promise<Record<string, unknown>>,
 *   deleteAuthUser: (userId: string) => Promise<void>,
 * }} DeletionDeps
 */

function normalizeStep(value) {
  return STEPS.includes(value) ? value : 'start';
}

/**
 * @param {unknown} manifest
 * @returns {MediaManifest}
 */
function parseManifest(manifest) {
  if (typeof manifest !== 'object' || manifest === null) {
    throw new DeletionStepError('media_manifest_invalid', 'media');
  }

  const source = /** @type {Record<string, unknown>} */ (manifest);

  const readPaths = (key) => {
    const value = source[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new DeletionStepError('media_manifest_invalid', 'media');
    }
    return value.map((item) => {
      if (typeof item !== 'string' || item.length === 0) {
        throw new DeletionStepError('media_manifest_invalid', 'media');
      }
      return item;
    });
  };

  const logos = source.clubLogos ?? [];
  if (!Array.isArray(logos)) {
    throw new DeletionStepError('media_manifest_invalid', 'media');
  }

  return {
    avatars: readPaths('avatars'),
    vehiclePhotos: readPaths('vehiclePhotos'),
    clubLogos: logos.map((item) => {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof /** @type {any} */ (item).path !== 'string' ||
        typeof /** @type {any} */ (item).clubId !== 'string' ||
        typeof /** @type {any} */ (item).inUse !== 'boolean'
      ) {
        throw new DeletionStepError('media_manifest_invalid', 'media');
      }
      const logo = /** @type {{ path: string, clubId: string, inUse: boolean }} */ (item);
      return { path: logo.path, clubId: logo.clubId, inUse: logo.inUse };
    }),
  };
}

/**
 * Pindahkan logo yang masih dipakai, lalu hapus objek yang tidak dirujuk.
 * Logo yang berhasil dipindahkan otomatis kehilangan kepemilikan pengguna;
 * logo yang gagal dipindahkan menggagalkan langkah ini sebelum Auth dihapus.
 *
 * @param {MediaManifest} manifest
 * @param {DeletionDeps} deps
 */
export async function cleanupMedia(manifest, deps) {
  let transferred = 0;

  for (const logo of manifest.clubLogos) {
    if (!logo.inUse) continue;
    try {
      await deps.transferClubLogo({ path: logo.path, clubId: logo.clubId });
      transferred += 1;
    } catch (error) {
      if (error instanceof DeletionStepError) throw error;
      throw new DeletionStepError('storage_club_logo_transfer_failed', 'media');
    }
  }

  const pending = manifest.clubLogos.filter((logo) => !logo.inUse).map((logo) => logo.path);

  const remove = async (bucket, paths) => {
    if (paths.length === 0) return 0;
    try {
      return await deps.removeObjects(bucket, paths);
    } catch (error) {
      if (error instanceof DeletionStepError) throw error;
      throw new DeletionStepError('storage_delete_failed', 'media');
    }
  };

  const removed = {
    avatars: await remove('avatars', manifest.avatars),
    vehiclePhotos: await remove('vehicle-photos', manifest.vehiclePhotos),
    clubLogos: await remove('club-logos', pending),
  };

  return { clubLogosTransferred: transferred, removed };
}

/**
 * Jalankan (atau lanjutkan) penghapusan akun.
 *
 * @param {{ userId: string, deps: DeletionDeps }} input
 * @returns {Promise<{
 *   status: 'completed',
 *   alreadyCompleted: boolean,
 *   media: Awaited<ReturnType<typeof cleanupMedia>> | null,
 *   purge: Record<string, unknown> | null,
 * }>}
 */
export async function runAccountDeletion({ userId, deps }) {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new DeletionStepError('account_deletion_invalid_user', 'start');
  }

  const job = await deps.begin(userId);

  if (job.status === 'completed') {
    return { status: 'completed', alreadyCompleted: true, media: null, purge: null };
  }

  let lastStep = normalizeStep(job.lastStep);
  let media = null;
  let purge = null;

  try {
    if (lastStep === 'start') {
      const manifest = parseManifest(await deps.manifest(userId));
      media = await cleanupMedia(manifest, deps);
      lastStep = 'media';
    }

    if (lastStep === 'media') {
      purge = await deps.purge(userId);
      lastStep = 'purge';
    }

    if (lastStep === 'purge') {
      try {
        await deps.deleteAuthUser(userId);
      } catch (error) {
        if (error instanceof DeletionStepError) throw error;
        throw new DeletionStepError('auth_delete_failed', 'auth');
      }
      lastStep = 'auth';
    }

    await deps.finish(job.id, 'completed', 'done', null);
    return { status: 'completed', alreadyCompleted: false, media, purge };
  } catch (error) {
    const step = error instanceof DeletionStepError ? error.step : lastStep;
    const code =
      error instanceof DeletionStepError && error.code
        ? error.code
        : 'unexpected_failure';

    // Kegagalan mencatat status tidak boleh menutupi kegagalan aslinya; status
    // yang tertinggal 'running' tetap bisa diklaim ulang lewat `begin`.
    try {
      await deps.finish(job.id, 'failed', lastStep, code);
    } catch {
      // sengaja diabaikan
    }

    const failure = error instanceof Error ? error : new Error(code);
    Object.assign(failure, { jobId: job.id, step, code });
    throw failure;
  }
}
