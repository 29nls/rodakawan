import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthSessionProvider, useAuthSession } from '@/features/auth/session';
import { colors } from '@/constants/theme';

/**
 * Error boundary level route: Expo Router memakai ekspor bernama `ErrorBoundary`
 * untuk menangkap error tak tertangani pada layar mana pun.
 */
export { RouteErrorBoundary as ErrorBoundary } from '@/components/feedback/RouteErrorBoundary';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthSessionProvider>
        <RootNavigator />
      </AuthSessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * Navigasi berbasis `Stack.Protected` (pola resmi Expo Router): rute privat hanya
 * terdaftar ketika sesi sudah diperiksa dan valid, sehingga pengguna tanpa sesi
 * tidak bisa berada di layar privat walaupun mengetik URL-nya.
 *
 * Proteksi ini hanya lapisan navigasi klien — otorisasi data tetap milik RLS di
 * database (docs/SECURITY_PRIVACY.md bagian 2).
 */
function RootNavigator() {
  const { status, session } = useAuthSession();
  const resolved = status === 'ready';

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background.base },
        headerShown: false,
      }}
    >
      {/* Selalu tersedia: gerbang loading/arah awal dan penerima tautan email. */}
      <Stack.Screen name="index" />
      <Stack.Screen name="auth/callback" />

      <Stack.Protected guard={resolved && session !== null}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="system" />
        <Stack.Screen name="profile/edit" />
        <Stack.Screen name="reset-password" />
      </Stack.Protected>

      <Stack.Protected guard={resolved && session === null}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
