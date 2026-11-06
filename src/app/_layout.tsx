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
 * terdaftar ketika identitas perangkat sudah siap, sehingga layar privat tidak
 * bisa dibuka sebelum identitas ada. Tidak ada lagi rute masuk/daftar: identitas
 * dibuat otomatis oleh `AuthSessionProvider`.
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
      {/* Gerbang awal: loading, butuh internet, identitas hilang, lalu arah tujuan. */}
      <Stack.Screen name="index" />

      <Stack.Protected guard={resolved && session !== null}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="system" />
        <Stack.Screen name="profile/edit" />
        {/* Milestone 2: garasi dan klub, semuanya di dalam penjaga sesi. */}
        <Stack.Screen name="garage" />
        <Stack.Screen name="vehicle" />
        <Stack.Screen name="club" />
        <Stack.Screen name="club-admin" />
        {/* Milestone 3: perjalanan dan berbagi lokasi opt-in. */}
        <Stack.Screen name="ride-new" />
        <Stack.Screen name="ride" />
        {/* Milestone 4: moderasi laporan penyalahgunaan (host/admin klub). */}
        <Stack.Screen name="moderation" />
      </Stack.Protected>
    </Stack>
  );
}
