import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
      {/*
        Semua layar memakai header buatan sendiri (src/components/ui/ScreenHeader.tsx)
        supaya warna dan tipografi konsisten dengan design system tanpa menambah
        dependency header native.
      */}
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background.base },
          headerShown: false,
        }}
      />
    </SafeAreaProvider>
  );
}
