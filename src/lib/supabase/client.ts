/**
 * Supabase client terpusat untuk aplikasi mobile.
 *
 * Aturan yang dipegang file ini (docs/SECURITY_PRIVACY.md bagian 5,
 * docs/ARCHITECTURE.md bagian 8):
 * - Hanya key publik yang boleh dipakai; service role key selalu ditolak.
 * - Konfigurasi yang belum tersedia tidak membuat aplikasi crash: status
 *   dikembalikan ke pemanggil untuk ditampilkan sebagai pesan yang jelas.
 * - Satu instance client saja, dibuat malas (lazy) dan dipakai bersama.
 *
 * Session persistence memakai `localStorage` dari expo-sqlite, mengikuti panduan
 * resmi Supabase "Use Supabase with Expo React Native" (lihat ADR-017 di
 * docs/PROJECT_DECISIONS.md). URL polyfill tidak diperlukan karena Expo SDK 57
 * sudah menyediakan global `URL`/`URLSearchParams`.
 */

import 'expo-sqlite/localStorage/install';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';

import { installWebCrypto } from '@/lib/crypto/webcrypto';
import { isHttpsUrl, looksLikePrivilegedKey, readPublicEnv } from '@/lib/env';
import type { Database } from '@/lib/supabase/database.types';

export type RodaKawanSupabaseClient = SupabaseClient<Database>;

export type SupabaseUnavailableReason =
  | 'not_configured'
  | 'invalid_url'
  | 'privileged_key';

export type SupabaseClientState =
  | { available: true; client: RodaKawanSupabaseClient }
  | { available: false; reason: SupabaseUnavailableReason };

let cachedState: SupabaseClientState | undefined;
let detachAutoRefreshListener: (() => void) | undefined;

/** Penjelasan singkat kenapa backend tidak dapat dipakai (ditampilkan ke pengguna). */
export function describeUnavailableReason(reason: SupabaseUnavailableReason): string {
  switch (reason) {
    case 'privileged_key':
      return 'Kunci Supabase yang terpasang terlihat seperti service role key. Kunci itu memberi akses penuh dan tidak boleh ada di aplikasi mobile; ganti dengan publishable/anon key.';
    case 'invalid_url':
      return 'EXPO_PUBLIC_SUPABASE_URL bukan URL https yang valid, jadi aplikasi tidak menghubungi backend.';
    case 'not_configured':
    default:
      return 'Belum ada konfigurasi Supabase (EXPO_PUBLIC_SUPABASE_URL dan EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY). Isi .env.local lalu jalankan ulang aplikasi.';
  }
}

/**
 * Menyalakan/mematikan refresh token sesuai status aplikasi (pola resmi Supabase
 * untuk React Native).
 *
 * Tiga detail yang mudah terlewat dan sudah ditangani di sini:
 *
 * 1. `auth-js` menyalakan ticker auto-refresh sendiri saat client dibuat pada
 *    lingkungan non-browser (`_handleVisibilityChange()` menganggap React Native
 *    selalu foreground), dan itu terjadi **setelah** pemulihan session selesai.
 *    Karena itu penyesuaian pertama harus menunggu `initialize()` selesai — kalau
 *    tidak, ticker yang dinyalakan SDK sesudahnya akan tetap berjalan di background.
 * 2. `startAutoRefresh()`/`stopAutoRefresh()` mengembalikan Promise. Promise-nya
 *    sengaja *dihandle* (bukan dibiarkan menggantung) supaya tidak menjadi unhandled
 *    rejection yang bisa memicu peringatan/crash di React Native. Kegagalan ticker
 *    tidak punya tindakan pemulihan di sini: tick berikutnya dan event foreground
 *    berikutnya akan mencoba lagi.
 * 3. Listener dikembalikan sebagai fungsi pembersih agar client lama tidak
 *    meninggalkan handler yang menunjuk ke client yang sudah tidak dipakai.
 */
function applyAppStateToAutoRefresh(
  client: RodaKawanSupabaseClient,
  state: AppStateStatus | null | undefined,
): void {
  const action =
    state === 'active'
      ? () => client.auth.startAutoRefresh()
      : () => client.auth.stopAutoRefresh();

  void action().catch(() => undefined);
}

/** Menunggu SDK selesai inisialisasi, lalu menyamakan ticker dengan status aplikasi. */
async function syncAutoRefreshWithAppState(client: RodaKawanSupabaseClient): Promise<void> {
  await client.auth.initialize().catch(() => undefined);
  applyAppStateToAutoRefresh(client, AppState.currentState);
}

/** @returns fungsi pembersih listener. */
function attachAutoRefreshListener(client: RodaKawanSupabaseClient): () => void {
  const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    applyAppStateToAutoRefresh(client, state);
  });

  void syncAutoRefreshWithAppState(client);

  return () => subscription.remove();
}

/**
 * Mengembalikan status client: siap dipakai, atau tidak tersedia beserta alasannya.
 * Fungsi ini tidak pernah melempar error konfigurasi.
 */
export function getSupabaseState(): SupabaseClientState {
  if (cachedState) return cachedState;

  const env = readPublicEnv();

  if (!env.EXPO_PUBLIC_SUPABASE_URL || !env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    cachedState = { available: false, reason: 'not_configured' };
    return cachedState;
  }

  if (!isHttpsUrl(env.EXPO_PUBLIC_SUPABASE_URL)) {
    cachedState = { available: false, reason: 'invalid_url' };
    return cachedState;
  }

  if (looksLikePrivilegedKey(env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    cachedState = { available: false, reason: 'privileged_key' };
    return cachedState;
  }

  // PKCE membutuhkan crypto.getRandomValues/TextEncoder/btoa yang tidak ada di Hermes.
  installWebCrypto();

  const client = createClient<Database>(
    env.EXPO_PUBLIC_SUPABASE_URL,
    env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    },
  );

  detachAutoRefreshListener = attachAutoRefreshListener(client);
  cachedState = { available: true, client };
  return cachedState;
}

/** Client siap pakai, atau `null` bila konfigurasi backend belum lengkap. */
export function getSupabaseClient(): RodaKawanSupabaseClient | null {
  const state = getSupabaseState();
  return state.available ? state.client : null;
}

/**
 * Mengosongkan cache client beserta listener auto-refresh-nya. Hanya dipakai
 * pengujian dan pemulihan konfigurasi; aplikasi normal cukup memakai
 * `getSupabaseClient()`.
 */
export function resetSupabaseClientForTests(): void {
  cachedState = undefined;
  detachAutoRefreshListener?.();
  detachAutoRefreshListener = undefined;
}
