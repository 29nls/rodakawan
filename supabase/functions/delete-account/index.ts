/**
 * Supabase Edge Function: `delete-account`.
 *
 * Satu-satunya jalur penghapusan penuh. Identitas **selalu** diambil dari access
 * token yang diverifikasi Supabase, tidak pernah dari body/query — jadi tidak ada
 * bentuk permintaan yang bisa menghapus akun orang lain.
 *
 * Urutan dan alasan keamanannya ada di `orchestrator.mjs` dan ADR-077:
 * media Storage lebih dulu (logo klub dipindahkan, bukan dihapus), lalu database
 * dalam satu transaksi, lalu Auth Admin API. Status disimpan di
 * `public.account_deletion_jobs` sehingga retry melanjutkan langkah yang gagal.
 *
 * Variabel lingkungan yang disediakan Supabase otomatis:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Tidak ada rahasia yang ditulis ke kode, log, atau respons.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

import { handleCors, parseAllowedOrigins } from './cors.mjs';
import { DeletionStepError, runAccountDeletion } from './orchestrator.mjs';

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function failure(error: unknown, corsHeaders: Record<string, string>) {
  const code =
    error instanceof DeletionStepError
      ? error.code
      : typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'unexpected_failure';

  if (code === 'account_deletion_rate_limited') {
    return json(
      {
        error: 'account_deletion_rate_limited',
        message: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.',
      },
      429,
      corsHeaders,
    );
  }

  if (code === 'account_deletion_in_progress') {
    return json(
      {
        error: 'account_deletion_in_progress',
        message: 'Penghapusan sedang diproses di server. Tunggu sebentar lalu coba lagi.',
      },
      409,
      corsHeaders,
    );
  }

  if (code === 'account_deletion_invalid_user' || code === 'account_deletion_unauthenticated') {
    return json({ error: 'account_deletion_unauthenticated' }, 401, corsHeaders);
  }

  return json(
    {
      error: 'account_deletion_incomplete',
      message:
        'Penghapusan belum selesai sepenuhnya. Data Anda tidak dipakai lagi, tetapi proses perlu diulang. Coba lagi; bila berulang, hubungi dukungan.',
    },
    502,
    corsHeaders,
  );
}

function detailsOf(error: { details?: unknown; message?: unknown } | null): string {
  if (!error) return '';
  if (typeof error.details === 'string') return error.details;
  if (typeof error.message === 'string') return error.message;
  return '';
}

Deno.serve(async (request: Request) => {
  // Allowlist per-origin: hanya halaman yang terdaftar boleh memanggil dari
  // browser; permintaan native tanpa `Origin` tetap dilayani. Default-nya
  // fail-closed sampai WEB_ALLOWED_ORIGINS diisi (lihat cors.mjs).
  const cors = handleCors(request, parseAllowedOrigins(Deno.env.get('WEB_ALLOWED_ORIGINS')));

  if (cors.response) {
    return cors.response;
  }

  const corsHeaders = cors.headers;

  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, corsHeaders);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceKey) {
    // Konfigurasi platform, bukan kesalahan pengguna. Jangan bocorkan nama nilai.
    console.error('[delete-account] konfigurasi platform tidak lengkap');
    return json({ error: 'account_deletion_unavailable' }, 503, corsHeaders);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!token) {
    return json({ error: 'account_deletion_unauthenticated' }, 401, corsHeaders);
  }

  // Body tidak pernah dipakai untuk menentukan target. Terima objek kosong saja;
  // field `userId` dari klien sengaja diabaikan bila ada.
  if (request.headers.get('Content-Length') !== '0') {
    const raw = await request.text();
    if (raw.trim().length > 0) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return json({ error: 'invalid_body' }, 400, corsHeaders);
        }
      } catch {
        return json({ error: 'invalid_body' }, 400, corsHeaders);
      }
    }
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);

  if (userError || !userData.user) {
    return json({ error: 'account_deletion_unauthenticated' }, 401, corsHeaders);
  }

  const userId = userData.user.id;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Lease klaim eksklusif: setiap pemanggilan memperoleh token baru sehingga
  // dua permintaan bersamaan untuk pengguna yang sama tidak bisa menjalankan
  // tahap yang sama dua kali. Lihat ADR-078.
  const lease = crypto.randomUUID();

  const deps = {
    begin: async (target: string, leaseToken: string) => {
      const { data, error } = await admin.rpc('begin_account_deletion_claim', {
        p_user: target,
        p_lease: leaseToken,
      });

      if (error) {
        const detail = detailsOf(error);
        if (detail.includes('account_deletion_in_progress')) {
          throw new DeletionStepError('account_deletion_in_progress', 'start');
        }
        if (detail.includes('account_deletion_rate_limited') || error.code === '54000') {
          throw new DeletionStepError('account_deletion_rate_limited', 'start');
        }
        throw new DeletionStepError('account_deletion_job_failed', 'start');
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new DeletionStepError('account_deletion_job_failed', 'start');

      return {
        id: String(row.job_id),
        status: row.status as 'running' | 'failed' | 'completed',
        lastStep: String(row.last_step),
        attempts: Number(row.attempts),
      };
    },

    checkpoint: async (jobId: string, step: string, leaseToken: string) => {
      const { error } = await admin.rpc('checkpoint_account_deletion', {
        p_job: jobId,
        p_lease: leaseToken,
        p_step: step,
      });

      if (error) {
        throw new DeletionStepError('account_deletion_status_failed', step);
      }
    },

    finish: async (
      jobId: string,
      status: 'failed' | 'completed',
      step: string,
      error: string | null,
      leaseToken: string,
    ) => {
      const { error: finishError } = await admin.rpc('finish_account_deletion_claim', {
        p_job: jobId,
        p_lease: leaseToken,
        p_status: status,
        p_step: step,
        p_error: error,
      });

      if (finishError) {
        throw new DeletionStepError('account_deletion_status_failed', step);
      }
    },

    manifest: async (target: string) => {
      const { data, error } = await admin.rpc('account_media_manifest', { p_user: target });

      if (error || data === null) {
        throw new DeletionStepError('media_manifest_unavailable', 'media');
      }

      return data as {
        avatars: string[];
        vehiclePhotos: string[];
        clubLogos: { path: string; clubId: string; inUse: boolean }[];
      };
    },

    transferClubLogo: async ({ path, clubId }: { path: string; clubId: string }) => {
      const bucket = admin.storage.from('club-logos');

      const { data: blob, error: downloadError } = await bucket.download(path);
      if (downloadError || !blob) {
        throw new DeletionStepError('storage_club_logo_download_failed', 'media');
      }

      const extension = path.includes('.') ? path.split('.').pop()!.toLowerCase() : '';
      const safeExtension = ['jpg', 'jpeg', 'png', 'webp'].includes(extension) ? extension : 'webp';
      const contentType =
        safeExtension === 'png'
          ? 'image/png'
          : safeExtension === 'webp'
            ? 'image/webp'
            : 'image/jpeg';

      // Path baru harus tetap berada di folder klub (CHECK `clubs_logo_path_owner`).
      const newPath = `${clubId}/logo-${crypto.randomUUID()}.${safeExtension}`;

      const { error: uploadError } = await bucket.upload(newPath, blob, {
        contentType,
        upsert: false,
      });

      if (uploadError) {
        throw new DeletionStepError('storage_club_logo_upload_failed', 'media');
      }

      const { data: updated, error: updateError } = await admin
        .from('clubs')
        .update({ logo_path: newPath })
        .eq('id', clubId)
        .select('id')
        .maybeSingle();

      if (updateError || !updated) {
        await bucket.remove([newPath]);
        throw new DeletionStepError('storage_club_logo_reference_failed', 'media');
      }

      const { error: removeError } = await bucket.remove([path]);

      if (removeError) {
        // Baris klub sudah menunjuk path baru; objek lama masih dimiliki
        // pengguna. Retry akan menghapusnya sebagai objek tak terpakai sebelum
        // Auth dihapus, jadi jangan lanjut ke langkah berikutnya sekarang.
        throw new DeletionStepError('storage_club_logo_old_delete_failed', 'media');
      }
    },

    removeObjects: async (bucketName: string, paths: string[]) => {
      if (paths.length === 0) return 0;

      const { data, error } = await admin.storage.from(bucketName).remove(paths);

      if (error) {
        throw new DeletionStepError('storage_delete_failed', 'media');
      }

      return data?.length ?? 0;
    },

    purge: async (target: string) => {
      const { data, error } = await admin.rpc('purge_account_data', { p_user: target });

      if (error) {
        throw new DeletionStepError('db_purge_failed', 'purge');
      }

      return (data ?? {}) as Record<string, unknown>;
    },

    deleteAuthUser: async (target: string) => {
      const { error } = await admin.auth.admin.deleteUser(target);

      if (!error) return;

      const status = (error as { status?: number }).status;
      const code = (error as { code?: string }).code;

      // Idempoten: user yang sudah tidak ada dianggap selesai.
      if (status === 404 || code === 'user_not_found') return;

      throw new DeletionStepError('auth_delete_failed', 'auth');
    },
  };

  try {
    const result = await runAccountDeletion({ userId, lease, deps });
    return json(
      { status: 'completed', alreadyCompleted: result.alreadyCompleted },
      200,
      corsHeaders,
    );
  } catch (error) {
    const jobId = (error as { jobId?: string }).jobId;
    const step = (error as { step?: string }).step;
    console.error('[delete-account] gagal', {
      jobId: jobId ?? 'baru',
      step: step ?? 'unknown',
      code:
        error instanceof DeletionStepError
          ? error.code
          : typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : 'unexpected_failure',
    });

    return failure(error, corsHeaders);
  }
});
