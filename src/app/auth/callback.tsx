import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { LoadingState } from '@/components/ui/StateView';
import { completeEmailLink, type EmailLinkParams } from '@/features/auth/api';
import type { AppError } from '@/features/auth/errors';
import { extractEmailLinkParams, hasCompletableParams } from '@/features/auth/linkParams';
import { useAuthSession } from '@/features/auth/session';
import { describeUnavailableReason } from '@/lib/supabase/client';
import { spacing } from '@/constants/theme';

type CallbackState =
  | { status: 'working' }
  | { status: 'signed-in' }
  | { status: 'recovery' }
  | { status: 'incomplete' }
  | { status: 'failed'; error: AppError };

type RouteParams = Record<string, string>;

function firstString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0];
  return undefined;
}

/**
 * Menggabungkan parameter dari `expo-router` (query string) dengan hasil pembacaan
 * URL penuh (fragment), supaya tautan gaya apa pun tetap terbaca.
 */
function mergeParams(routeParams: RouteParams, linkingUrl: string | null): EmailLinkParams {
  const fromUrl = extractEmailLinkParams(linkingUrl);

  return {
    code: firstString(routeParams.code) ?? fromUrl.code,
    tokenHash: firstString(routeParams.token_hash) ?? fromUrl.tokenHash,
    type: firstString(routeParams.type) ?? fromUrl.type,
    errorCode:
      firstString(routeParams.error_code) ?? firstString(routeParams.error) ?? fromUrl.errorCode,
    errorDescription: firstString(routeParams.error_description) ?? fromUrl.errorDescription,
    accessToken: firstString(routeParams.access_token) ?? fromUrl.accessToken,
    refreshToken: firstString(routeParams.refresh_token) ?? fromUrl.refreshToken,
  };
}

/**
 * Menyelesaikan tautan email (konfirmasi pendaftaran atau pemulihan kata sandi).
 *
 * Route ini sengaja publik (di luar grup terlindungi) supaya tautan yang datang
 * saat aplikasi masih memeriksa sesi tidak diarahkan ke layar lain sebelum kodenya
 * sempat ditukar. Pengguna tetap tidak bisa mengakses data privat tanpa sesi.
 */
export default function AuthCallbackScreen() {
  const routeParams = useLocalSearchParams<RouteParams>();
  const linkingUrl = Linking.useLinkingURL();
  const { backend } = useAuthSession();
  const [state, setState] = useState<CallbackState>({ status: 'working' });
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    async function run() {
      const params = mergeParams(routeParams, linkingUrl);

      if (!hasCompletableParams(params)) {
        setState({ status: 'incomplete' });
        return;
      }

      if (!backend.available) {
        setState({
          status: 'failed',
          error: {
            code: 'backend_not_configured',
            message: describeUnavailableReason(backend.reason),
            retryable: false,
          },
        });
        return;
      }

      const outcome = await completeEmailLink(backend.client, params);
      processed.current = true;

      switch (outcome.status) {
        case 'recovery':
          setState({ status: 'recovery' });
          return;
        case 'signed-in':
          setState({ status: 'signed-in' });
          return;
        case 'failed':
          setState({ status: 'failed', error: outcome.error });
          return;
        default:
          setState({ status: 'incomplete' });
      }
    }

    void run();
  }, [backend, linkingUrl, routeParams]);

  return (
    <Screen scroll testID="auth-callback-screen">
      <ScreenHeader
        subtitle="Aplikasi menyelesaikan tautan dari email Anda."
        title="Menyelesaikan tautan"
      />

      {state.status === 'working' ? <LoadingState label="Memverifikasi tautan…" /> : null}

      {state.status === 'signed-in' ? (
        <View style={styles.block}>
          <Banner
            message="Email Anda sudah terverifikasi dan sesi sudah aktif di perangkat ini."
            title="Berhasil masuk"
            tone="success"
          />
          <Button
            fullWidth
            label="Lanjut ke Ringkasan"
            onPress={() => router.replace('/')}
            size="lg"
          />
        </View>
      ) : null}

      {state.status === 'recovery' ? (
        <View style={styles.block}>
          <Banner
            message="Tautan pemulihan berhasil diverifikasi. Sekarang buat kata sandi baru untuk akun Anda."
            title="Tautan pemulihan valid"
            tone="success"
          />
          <Button
            fullWidth
            label="Atur kata sandi baru"
            onPress={() => router.replace('/reset-password')}
            size="lg"
          />
        </View>
      ) : null}

      {state.status === 'incomplete' ? (
        <View style={styles.block}>
          <Banner
            action="Minta tautan baru dari aplikasi, lalu buka tautan itu di perangkat ini."
            message="Tautan tidak memuat kode yang bisa diproses. Kemungkinan tautan sudah dipakai, kedaluwarsa, atau disalin sebagian."
            title="Tautan tidak lengkap"
            tone="warning"
          />
          <Button
            fullWidth
            label="Buka halaman masuk"
            onPress={() => router.replace('/sign-in')}
            variant="secondary"
          />
        </View>
      ) : null}

      {state.status === 'failed' ? (
        <View style={styles.block}>
          <Banner
            action="Minta tautan baru, lalu buka tautan terbaru di perangkat ini."
            message={state.error.message}
            title="Tautan tidak dapat dipakai"
            tone="danger"
          />
          <Button
            fullWidth
            label="Buka halaman masuk"
            onPress={() => router.replace('/sign-in')}
            variant="secondary"
          />
        </View>
      ) : null}

      <AppText align="center" tone="muted" variant="caption">
        Jika Anda tidak merasa meminta tautan ini, abaikan saja — tanpa tindakan, tidak ada yang
        berubah pada akun Anda.
      </AppText>
    </Screen>
  );
}

const styles = {
  block: {
    gap: spacing.md,
  },
} as const;
