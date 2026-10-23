/**
 * Layanan hapus akun.
 *
 * Sejak ADR-077 penghapusan **tidak** lagi dilakukan bertahap dari aplikasi.
 * Klien hanya memanggil Edge Function `delete-account` dengan access token
 * sesinya; server memverifikasi token itu, menangani Storage (termasuk logo klub
 * milik pengguna), memurnikan database dalam satu transaksi, lalu menghapus
 * identitas login lewat Auth Admin API.
 *
 * Pembagian ini penting:
 *   * Klien tidak pernah mengirim `userId` — target selalu `auth.uid()` hasil
 *     verifikasi server, jadi tidak ada jalur untuk menghapus akun orang lain.
 *   * Klien tidak bisa melaporkan sukses sebelum server menyelesaikan seluruh
 *     langkah. Kegagalan sebagian dikembalikan sebagai error yang bisa diulang,
 *     bukan sebagai "akun dihapus" palsu.
 *   * Service role tidak pernah masuk ke bundel aplikasi.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ApiResult } from '@/features/auth/api';
import { mapAccountError, mapAccountFunctionError } from '@/features/account/errors';
import type { Database } from '@/lib/supabase/database.types';

export type AccountClient = SupabaseClient<Database>;

export type AccountDeletionResult = {
  status: 'completed';
  alreadyCompleted: boolean;
};

type FunctionInvokeResult = {
  data: unknown;
  error: unknown;
};

/**
 * Ekstrak kode galat dari `FunctionsHttpError`. Isi respons server adalah
 * `{ error: '<tag>' }`; `context.json()` hanya bisa dibaca sekali, jadi jangan
 * memanggilnya di tempat lain.
 */
async function readFunctionErrorCode(error: unknown): Promise<string> {
  if (typeof error !== 'object' || error === null) return '';

  const context = (error as { context?: unknown }).context;

  if (typeof context === 'object' && context !== null) {
    const json = (context as { json?: unknown }).json;

    if (typeof json === 'function') {
      try {
        const body: unknown = await (json as () => Promise<unknown>).call(context);
        if (typeof body === 'object' && body !== null) {
          const tag = (body as { error?: unknown }).error;
          if (typeof tag === 'string') return tag;
        }
      } catch {
        // Respons bukan JSON; jatuh ke pencarian kode di bawah.
      }
    }
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function isCompletedResult(
  data: unknown,
): data is { status: 'completed'; alreadyCompleted?: boolean } {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { status?: unknown }).status === 'completed'
  );
}

/**
 * Meminta server menghapus akun pemanggil.
 *
 * Hasil `ok: true` hanya diberikan bila server menyatakan seluruh langkah
 * selesai (termasuk Auth Admin API). Pemanggil boleh `signOut()` setelahnya.
 */
export async function deleteMyAccount(
  client: AccountClient,
): Promise<ApiResult<AccountDeletionResult>> {
  let result: FunctionInvokeResult;

  try {
    result = (await client.functions.invoke('delete-account', {
      body: {},
    })) as FunctionInvokeResult;
  } catch (error) {
    return { ok: false, error: mapAccountError(error) };
  }

  if (result.error) {
    const code = await readFunctionErrorCode(result.error);
    return { ok: false, error: mapAccountFunctionError(code) };
  }

  if (!isCompletedResult(result.data)) {
    return {
      ok: false,
      error: {
        code: 'deletion_incomplete',
        message:
          'Server belum mengonfirmasi bahwa akun benar-benar terhapus. Coba lagi; bila berulang, hubungi dukungan sebelum menganggap akun hilang.',
        retryable: true,
      },
    };
  }

  return {
    ok: true,
    data: {
      status: 'completed',
      alreadyCompleted: result.data.alreadyCompleted === true,
    },
  };
}
