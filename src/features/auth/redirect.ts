/**
 * URL callback deep link untuk email konfirmasi dan pemulihan kata sandi.
 *
 * Dipisahkan dari `api.ts` supaya logika jaringan tetap bisa diuji tanpa modul
 * native. Nilai ini juga harus dicatat di daftar "Redirect URLs" project Supabase
 * (docs/SETUP_GUIDE.md bagian 4), kalau tidak email akan diarahkan ke halaman web
 * dan aplikasi tidak pernah menerima kodenya.
 */

import * as Linking from 'expo-linking';

/** Route internal yang menangani hasil tautan email. */
export const AUTH_CALLBACK_PATH = 'auth/callback';

/**
 * Contoh hasil:
 * - development build/production: `rodakawan://auth/callback`
 * - Expo Go: `exp://<host>:<port>/--/auth/callback`
 */
export function authCallbackUrl(): string {
  return Linking.createURL(AUTH_CALLBACK_PATH);
}
