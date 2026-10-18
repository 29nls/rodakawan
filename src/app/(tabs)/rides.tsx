import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateView';
import { spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import { listRides, type RideWithClub } from '@/features/rides/api';
import { RideCard } from '@/features/rides/components/RideCard';
import type { RideStatus } from '@/lib/supabase/database.types';

type RidesState =
  | { status: 'loading' }
  | { status: 'ready'; rides: RideWithClub[] }
  | { status: 'error'; error: AppError };

const SECTIONS: { status: RideStatus; title: string; subtitle: string }[] = [
  {
    status: 'active',
    title: 'Sedang berlangsung',
    subtitle: 'Posisi hanya terlihat bila peserta menyalakan berbagi.',
  },
  {
    status: 'planned',
    title: 'Akan datang',
    subtitle: 'Perjalanan yang sudah dijadwalkan klub Anda.',
  },
  {
    status: 'completed',
    title: 'Selesai',
    subtitle: 'Riwayat perjalanan; lokasi peserta sudah dihapus.',
  },
  { status: 'cancelled', title: 'Dibatalkan', subtitle: 'Perjalanan yang tidak dilanjutkan.' },
];

/**
 * Tab Perjalanan: daftar perjalanan yang boleh dibaca sesi ini (RLS).
 *
 * Layar ini tidak menampilkan data contoh. Bila belum ada perjalanan, pengguna
 * diarahkan membuat perjalanan baru dari klub tempat ia aktif.
 */
export default function RidesScreen() {
  const router = useRouter();
  const { backend, userId } = useAuthSession();
  const [state, setState] = useState<RidesState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useFocusEffect(
    useCallback(() => {
      // Nilai ini sengaja direferensikan agar perubahan token benar-benar
      // memicu muat ulang; isinya sendiri tidak dipakai untuk keputusan lain.
      void reloadToken;

      if (!backend.available || !userId) {
        setState({ status: 'ready', rides: [] });
        return;
      }

      const client = backend.client;
      let active = true;

      void (async () => {
        const result = await listRides(client);
        if (!active) return;

        if (!result.ok) {
          setState({ status: 'error', error: result.error });
          return;
        }

        setState({ status: 'ready', rides: result.data });
      })();

      return () => {
        active = false;
      };
    }, [backend, reloadToken, userId]),
  );

  const rides = state.status === 'ready' ? state.rides : [];

  return (
    <Screen scroll>
      <View style={styles.header}>
        <AppText variant="overline" tone="accent">
          Perjalanan
        </AppText>
        <AppText variant="titleLg">Touring &amp; konvoi</AppText>
        <AppText tone="secondary" variant="callout">
          Buat perjalanan dari klub Anda, atur peserta, lalu nyalakan berbagi lokasi hanya bila Anda
          mau. Bergabung tidak pernah otomatis membagikan posisi.
        </AppText>
      </View>

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      <Button
        icon="add-circle-outline"
        label="Buat perjalanan"
        onPress={() => router.push('/ride-new')}
        variant="primary"
      />

      {state.status === 'loading' ? <LoadingState label="Memuat perjalanan…" /> : null}

      {state.status === 'error' ? (
        <ErrorState description={state.error.message} onRetry={reload} />
      ) : null}

      {state.status === 'ready' && rides.length === 0 ? (
        <EmptyState
          action={{
            label: 'Buat perjalanan pertama',
            onPress: () => router.push('/ride-new'),
            icon: 'add-circle-outline',
          }}
          description="Belum ada perjalanan yang bisa Anda lihat. Buat perjalanan dari klub tempat Anda menjadi anggota aktif, atau minta host mengundang Anda."
          icon="navigate-outline"
          title="Belum ada perjalanan"
        />
      ) : null}

      {state.status === 'ready'
        ? SECTIONS.map((section) => {
            const items = rides.filter((ride) => ride.status === section.status);
            if (items.length === 0) return null;

            return (
              <View key={section.status} style={styles.section}>
                <SectionHeader subtitle={section.subtitle} title={section.title} />
                <View style={styles.list}>
                  {items.map((ride) => (
                    <RideCard key={ride.id} ride={ride} />
                  ))}
                </View>
              </View>
            );
          })
        : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  section: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.md,
  },
});
