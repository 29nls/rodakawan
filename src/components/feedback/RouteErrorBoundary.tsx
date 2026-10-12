import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/Screen';
import { ErrorState } from '@/components/ui/StateView';
import { colors, radii, spacing } from '@/constants/theme';

export type RouteErrorBoundaryProps = {
  error: Error;
  retry: () => Promise<void>;
};

/**
 * Error boundary level route (dipakai oleh Expo Router lewat ekspor `ErrorBoundary`
 * di src/app/_layout.tsx). Menampilkan pesan ramah pengguna; detail teknis hanya
 * muncul pada build pengembangan dan tidak pernah memuat data lokasi atau kredensial.
 */
export function RouteErrorBoundary({ error, retry }: RouteErrorBoundaryProps) {
  return (
    <Screen scroll>
      <ErrorState
        description="Aplikasi gagal menampilkan bagian ini. Tekan coba lagi; bila tetap gagal, tutup dan buka kembali aplikasi."
        onRetry={() => {
          void retry();
        }}
      />
      {__DEV__ ? (
        <View style={styles.debug}>
          <AppText variant="label" tone="danger">
            Detail pengembangan
          </AppText>
          <AppText variant="caption" tone="muted">
            {error.message}
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  debug: {
    backgroundColor: colors.background.elevated,
    borderColor: colors.border.subtle,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing.sm,
    padding: spacing.lg,
  },
});
