import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { LoadingState } from '@/components/ui/StateView';
import { spacing } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/session';

/**
 * Gerbang awal aplikasi.
 *
 * - Selama session awal diperiksa: menampilkan loading (bukan langsung menganggap
 *   pengguna belum masuk, agar tidak terjadi redirect loop saat sesi dipulihkan).
 * - Setelah sesi jelas: diarahkan ke area aplikasi atau ke alur masuk.
 */
export default function AuthGateScreen() {
  const { status, session } = useAuthSession();

  if (status === 'loading') {
    return (
      <Screen testID="auth-gate-loading">
        <View style={styles.center}>
          <AppText align="center" tone="accent" variant="overline">
            RodaKawan
          </AppText>
          <LoadingState label="Memeriksa sesi…" />
          <AppText align="center" tone="muted" variant="caption">
            Sesi disimpan aman di perangkat ini dan diperbarui otomatis.
          </AppText>
        </View>
      </Screen>
    );
  }

  return <Redirect href={session ? '/ringkasan' : '/sign-in'} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
  },
});
