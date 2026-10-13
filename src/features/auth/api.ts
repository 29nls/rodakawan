/**
 * Lapisan API autentikasi.
 *
 * Aturan:
 * - Semua fungsi menerima client sebagai argumen sehingga mudah diuji dengan client palsu.
 * - Tidak ada `throw` untuk kegagalan yang bisa diprediksi: hasil selalu
 *   `ApiResult` dengan pesan Bahasa Indonesia dari `mapAuthError`.
 * - Tidak ada penyimpanan token manual: session dikelola `@supabase/supabase-js`.
 */

import type { Session, SupabaseClient } from '@supabase/supabase-js';

import { mapAuthError, type AppError } from '@/features/auth/errors';
import { normalizeEmail } from '@/features/auth/validation';
import { normalizeUsername } from '@/features/profile/validation';
import type { Database } from '@/lib/supabase/database.types';

export type AuthClient = SupabaseClient<Database>;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

export type SignUpInput = {
  email: string;
  password: string;
  username: string;
  displayName: string;
  /** URL deep link yang menerima hasil konfirmasi email. */
  emailRedirectTo: string;
};

export type SignUpOutcome = {
  userId: string | null;
  /** `false` berarti Supabase meminta konfirmasi email sebelum sesi dibuat. */
  sessionCreated: boolean;
};

/**
 * Mendaftarkan akun baru. Username dan nama tampilan ikut dikirim sebagai metadata
 * agar bootstrap trigger bisa membuat baris `public.profiles` (migration bootstrap profil).
 * Metadata tidak dipakai untuk otorisasi apa pun.
 */
export async function signUpWithEmail(
  client: AuthClient,
  input: SignUpInput,
): Promise<ApiResult<SignUpOutcome>> {
  const username = normalizeUsername(input.username);

  const { data, error } = await client.auth.signUp({
    email: normalizeEmail(input.email),
    password: input.password,
    options: {
      emailRedirectTo: input.emailRedirectTo,
      data: {
        username,
        display_name: input.displayName.trim(),
        requested_username: username,
      },
    },
  });

  if (error) return { ok: false, error: mapAuthError(error) };

  return {
    ok: true,
    data: { userId: data.user?.id ?? null, sessionCreated: data.session !== null },
  };
}

/** Mengirim ulang email konfirmasi pendaftaran (tombol di layar "cek email"). */
export async function resendSignUpEmail(
  client: AuthClient,
  input: { email: string; emailRedirectTo: string },
): Promise<ApiResult<{ requested: true }>> {
  const { error } = await client.auth.resend({
    type: 'signup',
    email: normalizeEmail(input.email),
    options: { emailRedirectTo: input.emailRedirectTo },
  });

  if (error) return { ok: false, error: mapAuthError(error) };

  return { ok: true, data: { requested: true } };
}

export async function signInWithEmail(
  client: AuthClient,
  input: { email: string; password: string },
): Promise<ApiResult<{ userId: string }>> {
  const { data, error } = await client.auth.signInWithPassword({
    email: normalizeEmail(input.email),
    password: input.password,
  });

  if (error) return { ok: false, error: mapAuthError(error) };

  const userId = data.user?.id ?? data.session?.user.id;
  if (!userId) {
    return {
      ok: false,
      error: {
        code: 'unknown',
        message: 'Server menerima permintaan, tetapi tidak mengirim data pengguna. Coba lagi.',
        retryable: true,
      },
    };
  }

  return { ok: true, data: { userId } };
}

export type SignOutOutcome = {
  /** Session lokal selalu dibersihkan oleh SDK. */
  signedOut: true;
  /** `false` bila server tidak dapat dihubungi sehingga pencabutan sesi tertunda. */
  revokedRemotely: boolean;
};

/**
 * Keluar dari akun. Perilaku SDK (diverifikasi di `@supabase/auth-js`): walaupun
 * panggilan pencabutan ke server gagal karena jaringan, session lokal tetap
 * dihapus dan error jaringan dikembalikan. Karena itu kegagalan jaringan di sini
 * bukan kegagalan logout, hanya pencabutan di sisi server yang tertunda.
 */
export async function signOut(client: AuthClient): Promise<ApiResult<SignOutOutcome>> {
  const { error } = await client.auth.signOut();

  if (error) {
    const mapped = mapAuthError(error);
    if (mapped.code === 'network') {
      return { ok: true, data: { signedOut: true, revokedRemotely: false } };
    }
    return { ok: false, error: mapped };
  }

  return { ok: true, data: { signedOut: true, revokedRemotely: true } };
}

/**
 * Mengirim email pemulihan kata sandi. Supabase tidak memberi tahu apakah email
 * terdaftar (untuk mencegah enumerasi akun), jadi pemanggil harus menampilkan pesan
 * netral yang sama untuk kedua kemungkinan.
 */
export async function requestPasswordReset(
  client: AuthClient,
  input: { email: string; redirectTo: string },
): Promise<ApiResult<{ requested: true }>> {
  const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(input.email), {
    redirectTo: input.redirectTo,
  });

  if (error) return { ok: false, error: mapAuthError(error) };

  return { ok: true, data: { requested: true } };
}

/** Mengubah kata sandi pengguna yang sedang masuk (termasuk hasil tautan pemulihan). */
export async function updatePassword(
  client: AuthClient,
  input: { password: string },
): Promise<ApiResult<{ updated: true }>> {
  const { error } = await client.auth.updateUser({ password: input.password });

  if (error) return { ok: false, error: mapAuthError(error) };

  return { ok: true, data: { updated: true } };
}

export type EmailLinkParams = {
  code?: string;
  tokenHash?: string;
  type?: string;
  errorCode?: string;
  errorDescription?: string;
  /** Hanya terisi pada tautan gaya implicit-flow (tanpa PKCE). */
  accessToken?: string;
  refreshToken?: string;
};

export type EmailLinkOutcome =
  | { status: 'signed-in' }
  | { status: 'recovery' }
  | { status: 'none' }
  | { status: 'failed'; error: AppError };

const RECOVERY_LINK_TYPES = new Set(['recovery']);
const EMAIL_LINK_TYPES = new Set([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

/**
 * Menyelesaikan tautan email (konfirmasi pendaftaran, pemulihan kata sandi).
 *
 * Bentuk tautan yang ditangani:
 * - `?code=...` → PKCE (konfigurasi aplikasi ini).
 * - `?token_hash=...&type=...` → template email Supabase yang memakai token hash.
 * - `?error=...&error_description=...` → tautan kedaluwarsa/sudah dipakai.
 */
export async function completeEmailLink(
  client: AuthClient,
  params: EmailLinkParams,
): Promise<EmailLinkOutcome> {
  if (params.errorCode) {
    return {
      status: 'failed',
      error: mapAuthError({ code: params.errorCode, message: params.errorDescription }),
    };
  }

  if (params.code) {
    const { data, error } = await client.auth.exchangeCodeForSession(params.code);
    if (error) return { status: 'failed', error: mapAuthError(error) };
    if (!data.session) return { status: 'none' };

    // `redirectType` hanya dideklarasikan pada sebagian tipe SDK, jadi dibaca defensif.
    const redirectType = (data as { redirectType?: string | null }).redirectType ?? null;
    return { status: RECOVERY_LINK_TYPES.has(redirectType ?? '') ? 'recovery' : 'signed-in' };
  }

  if (params.accessToken && params.refreshToken) {
    const { error } = await client.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });

    if (error) return { status: 'failed', error: mapAuthError(error) };

    return { status: RECOVERY_LINK_TYPES.has(params.type ?? '') ? 'recovery' : 'signed-in' };
  }

  if (params.tokenHash) {
    const linkType = params.type && EMAIL_LINK_TYPES.has(params.type) ? params.type : 'email';
    const { data, error } = await client.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: linkType as Parameters<AuthClient['auth']['verifyOtp']>[0]['type'],
    });

    if (error) return { status: 'failed', error: mapAuthError(error) };
    if (!data.session) return { status: 'none' };

    return { status: RECOVERY_LINK_TYPES.has(linkType) ? 'recovery' : 'signed-in' };
  }

  return { status: 'none' };
}

export async function readCurrentSession(
  client: AuthClient,
): Promise<ApiResult<{ session: Session | null }>> {
  const { data, error } = await client.auth.getSession();

  if (error) return { ok: false, error: mapAuthError(error) };

  return { ok: true, data: { session: data.session } };
}
