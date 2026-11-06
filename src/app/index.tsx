import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { LoadingState } from '@/components/ui/StateView';
import { spacing } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/session';
import { isGeneratedUsername } from '@/features/profile/validation';
import { useProfile } from '@/features/profile/useProfile';

/**
 * Gerbang awal aplikasi.
 *
 * Urutan yang dijaga:
 * 1. identitas sedang disiapkan → loading (bukan langsung dianggap "belum masuk");
 * 2. perangkat belum pernah punya identitas dan tidak ada internet → layar
 *    "butuh internet untuk memulai" dengan tombol coba lagi;
 * 3. identitas lama tidak dapat dipulihkan → penjelasan bahwa keanggotaan lama
 *    tidak terjangkau, lalu tombol membuat identitas baru;
 * 4. profil belum lengkap / masih username sementara → onboarding satu layar;
 * 5. selain itu → Ringkasan.
 */
export default function AuthGateScreen() {
  const { status, startupError, retryIdentity, startFreshIdentity } = useAuthSession();
  const { state } = useProfile();

  if (status === 'loading') {
    return (
      <Screen testID="auth-gate-loading">
        <View style={styles.center}>
          <AppText align="center" tone="accent" variant="overline">
            RodaKawan
          </AppText>
          <LoadingState label="Menyiapkan identitas perangkat…" />
          <AppText align="center" tone="muted" variant="caption">
            Identitas dibuat sekali di perangkat ini; tidak ada email atau kata sandi.
          </AppText>
        </View>
      </Screen>
    );
  }

  if (status === 'offline') {
    return (
      <Screen testID="auth-gate-offline">
        <View style={styles.center}>
          <AppText tone="accent" variant="overline">
            RodaKawan
          </AppText>
          <AppText variant="titleLg">Butuh internet untuk memulai</AppText>
          <AppText tone="secondary" variant="callout">
            Aplikasi membuat identitas perangkat sekali saat pertama dibuka. Sambungkan internet,
            lalu coba lagi. Setelah itu aplikasi bisa dibuka tanpa koneksi.
          </AppText>
          {startupError ? (
            <Banner message={startupError.message} title="Identitas belum dibuat" tone="danger" />
          ) : null}
          <Button
            fullWidth
            icon="refresh"
            label="Coba lagi"
            onPress={() => {
              void retryIdentity();
            }}
            size="lg"
            testID="auth-gate-retry"
          />
        </View>
      </Screen>
    );
  }

  if (status === 'identity_lost') {
    return (
      <Screen testID="auth-gate-identity-lost">
        <View style={styles.center}>
          <AppText tone="accent" variant="overline">
            RodaKawan
          </AppText>
          <AppText variant="titleLg">Identitas lama tidak bisa dipulihkan</AppText>
          <AppText tone="secondary" variant="callout">
            Identitas RodaKawan terikat pada perangkat ini dan tidak punya email atau kata sandi,
            jadi tidak ada cara memulihkannya setelah sesi hilang. Anda bisa membuat identitas baru,
            tetapi keanggotaan klub dan riwayat perjalanan yang lama tidak akan terbawa. Minta
            undangan ulang kepada admin klub.
          </AppText>
          <Button
            fullWidth
            icon="person-add-outline"
            label="Buat identitas baru"
            onPress={() => {
              void startFreshIdentity();
            }}
            size="lg"
            testID="auth-gate-new-identity"
          />
        </View>
      </Screen>
    );
  }

  if (state.status === 'loading') {
    return (
      <Screen testID="auth-gate-profile-loading">
        <View style={styles.center}>
          <LoadingState label="Memuat profil…" />
        </View>
      </Screen>
    );
  }

  // Profil gagal dimuat: jangan memaksa onboarding yang bisa menimpa data. Tab Profil
  // punya tombol "Coba lagi" sendiri, jadi pengguna diarahkan ke area aplikasi.
  if (state.status === 'error') {
    return <Redirect href="/ringkasan" />;
  }

  if (state.profile === null || isGeneratedUsername(state.profile.username)) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/ringkasan" />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
  },
});
