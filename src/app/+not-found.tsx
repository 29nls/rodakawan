import { router } from 'expo-router';

import { Screen } from '@/components/ui/Screen';
import { EmptyState } from '@/components/ui/StateView';

export default function NotFoundScreen() {
  return (
    <Screen scroll>
      <EmptyState
        description="Tautan yang Anda buka tidak dikenali aplikasi. Kembali ke ringkasan untuk melanjutkan."
        icon="help-circle-outline"
        title="Halaman tidak ditemukan"
        action={{
          icon: 'arrow-back',
          label: 'Kembali ke ringkasan',
          onPress: () => router.replace('/'),
          variant: 'secondary',
        }}
      />
    </Screen>
  );
}
