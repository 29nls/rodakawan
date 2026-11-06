/**
 * Lapisan API identitas perangkat.
 *
 * RodaKawan tidak punya akun: identitas dibuat sekali per perangkat lewat
 * Supabase Anonymous Sign-In, lalu dipakai seperti sesi biasa (`authenticated`).
 * Tidak ada email, kata sandi, atau tautan konfirmasi di lapisan ini.
 *
 * Aturan:
 * - Semua fungsi menerima client sebagai argumen sehingga mudah diuji dengan client palsu.
 * - Tidak ada `throw` untuk kegagalan yang bisa diprediksi: hasil selalu
 *   `ApiResult` dengan pesan Bahasa Indonesia dari `mapAuthError`.
 * - Tidak ada penyimpanan token manual: session dikelola `@supabase/supabase-js`.
 */

import type { Session, SupabaseClient } from '@supabase/supabase-js';

import { mapAuthError, type AppError } from '@/features/auth/errors';
import type { Database } from '@/lib/supabase/database.types';

export type AuthClient = SupabaseClient<Database>;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

/**
 * Membuat identitas anonim baru untuk perangkat ini.
 *
 * Metadata sengaja kosong: username dipilih pengguna di layar onboarding setelah
 * identitas ada, sehingga bootstrap trigger membuat profil sementara lebih dulu.
 * Metadata tidak pernah dipakai untuk otorisasi.
 */
export async function signInAnonymously(
  client: AuthClient,
): Promise<ApiResult<{ userId: string; session: Session }>> {
  const { data, error } = await client.auth.signInAnonymously();

  if (error) return { ok: false, error: mapAuthError(error) };

  const session = data.session ?? null;
  const userId = session?.user.id ?? data.user?.id;
  if (!userId || !session) {
    return {
      ok: false,
      error: {
        code: 'unknown',
        message: 'Server menerima permintaan, tetapi tidak mengirim identitas. Coba lagi.',
        retryable: true,
      },
    };
  }

  return { ok: true, data: { userId, session } };
}

export type SignOutOutcome = {
  /** Session lokal selalu dibersihkan oleh SDK. */
  signedOut: true;
  /** `false` bila server tidak dapat dihubungi sehingga pencabutan sesi tertunda. */
  revokedRemotely: boolean;
};

/**
 * Mencabut sesi perangkat ini. Dipakai setelah "Hapus data saya" dan saat
 * identitas perlu diganti; bukan tombol "keluar" biasa karena identitas anonim
 * tidak bisa dipulihkan tanpa sesi yang tersimpan.
 *
 * Perilaku SDK (diverifikasi di `@supabase/auth-js`): walaupun panggilan
 * pencabutan ke server gagal karena jaringan, session lokal tetap dihapus dan
 * error jaringan dikembalikan. Karena itu kegagalan jaringan di sini bukan
 * kegagalan logout, hanya pencabutan di sisi server yang tertunda.
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

export async function readCurrentSession(
  client: AuthClient,
): Promise<ApiResult<{ session: Session | null }>> {
  const { data, error } = await client.auth.getSession();

  if (error) return { ok: false, error: mapAuthError(error) };

  return { ok: true, data: { session: data.session } };
}
