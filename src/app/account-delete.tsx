import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingState } from '@/components/ui/StateView';
import { TextField } from '@/components/ui/TextField';
import { spacing } from '@/constants/theme';
import { formatErrorMessage } from '@/features/state-helper';
import { deleteMyAccount } from '@/features/account/api';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import { useProfile } from '@/features/profile/useProfile';
const SUPPORT_URL = 'https://github.com/29nls/rodakawan/issues';

/**
 * Hapus data saya (penghapusan penuh di server).
 *
 * Sejak aplikasi memakai identitas anonim per perangkat, tidak ada akun atau
 * email yang bisa disebut. Yang dihapus adalah data milik identitas perangkat
 * ini: profil, kendaraan, keanggotaan, pesan, foto, dan identitas anonimnya
 * sendiri. Edge Function tetap menjadi satu-satunya pihak yang menghapus data.
 *
 * Layar ini sengaja tidak menawarkan tombol sekali tekan: konsekuensinya tidak
 * bisa dibatalkan, jadi pengguna harus mengetik username-nya sendiri.
 * "Berhasil" hanya ditampilkan setelah server mengonfirmasi seluruh langkah
 * selesai.
 */
export default function AccountDeleteScreen() {
  const router = useRouter();
  const { backend, userId, signOut } = useAuthSession();
  const { state, reload } = useProfile();

  // Status layar dibaca dari state profil itu sendiri: `useProfile` sudah
  // menurunkan backend/sesi yang belum siap menjadi state error, jadi tidak ada
  // klasifikasi terpisah yang bisa menyimpang darinya.
  const showError = state.status === 'error';
  const errorMessage = showError ? formatErrorMessage(state.error) : undefined;

  const profile = state.status === 'ready' ? state.profile : null;
  const expectedUsername = profile?.username ?? '';

  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const matches =
    expectedUsername !== '' && confirmation.trim().toLowerCase() === expectedUsername.toLowerCase();

  async function handleDelete() {
    if (!backend.available || !userId || !matches || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await deleteMyAccount(backend.client);

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }

    setNotice(
      'Data Anda sudah dihapus dari server dan identitas perangkat ini telah berakhir. Aplikasi akan memulai identitas baru; keanggotaan dan riwayat yang lama tidak bisa dipulihkan.',
    );

    await signOut();
    router.replace('/');
  }

  return (
    <Screen
      header={<ScreenHeader showBack title="Hapus data saya" />}
      scroll
      testID="account-delete-screen"
    >
      {state.status === 'loading' ? (
        <LoadingState label="Memuat profil Anda…" testID="account-delete-loading" />
      ) : null}

      {showError && errorMessage ? (
        <>
          <Banner
            message={errorMessage}
            title="Profil belum bisa dimuat"
            tone="danger"
            testID="account-delete-error-banner"
          />
          <Button
            icon="refresh"
            label="Coba lagi"
            onPress={reload}
            variant="secondary"
            testID="account-delete-retry"
          />
        </>
      ) : null}

      <Card>
        <SectionHeader
          subtitle="Penghapusan bersifat permanen dan tidak bisa dibatalkan. Setelah selesai, perangkat ini memakai identitas baru yang belum menjadi anggota klub mana pun."
          title="Apa yang terjadi"
        />
        <View style={styles.list}>
          <AppText variant="callout">
            • Username, nama tampilan, foto profil, bio, dan kota dihapus atau diganti anonim.
          </AppText>
          <AppText variant="callout">
            • Kendaraan, nomor polisi, catatan privat, token notifikasi, lokasi terakhir, relasi
            follow, dan blokir dihapus. Identitas anonim perangkat ini juga dihapus permanen, jadi
            data lama tidak bisa dipulihkan lagi.
          </AppText>
          <AppText variant="callout">
            • Anda keluar dari klub dan perjalanan. Kepemilikan klub/perjalanan dialihkan ke
            pengelola lain; perjalanan tanpa penerus dibatalkan. Perjalanan tetap ada untuk peserta
            lain.
          </AppText>
          <AppText variant="callout">
            • Laporan bahaya tetap tersimpan untuk keselamatan peserta lain, tanpa identitas Anda.
            Pesan konvoi serta postingan/komentar Anda diredaksi dan diatribusikan ke “Pengguna
            dihapus”. Jejak audit moderasi tetap ada tanpa identitas Anda.
          </AppText>
        </View>
      </Card>

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {error ? (
        <Banner
          action="Periksa koneksi, lalu coba lagi. Bila berulang, hubungi dukungan."
          message={error.message}
          testID="account-delete-error"
          title="Data belum terhapus"
          tone="danger"
        />
      ) : null}

      {notice ? (
        <Banner
          message={notice}
          testID="account-delete-notice"
          title="Data terhapus"
          tone="success"
        />
      ) : null}

      <Card>
        <SectionHeader
          subtitle="Ketik username Anda persis seperti yang tertera di profil untuk mengaktifkan tombol."
          title="Konfirmasi"
        />
        {profile ? (
          <AppText tone="secondary" variant="callout">
            Username: <AppText variant="bodyStrong">@{profile.username}</AppText>
          </AppText>
        ) : (
          <AppText tone="secondary" variant="callout">
            Profil belum termuat. Muat ulang layar ini sebelum menghapus data.
          </AppText>
        )}

        <TextField
          autoCapitalize="none"
          editable={!busy}
          label="Username"
          onChangeText={setConfirmation}
          placeholder={expectedUsername || 'username'}
          testID="account-delete-confirm"
          value={confirmation}
        />

        <Button
          disabled={!backend.available || !matches || busy || !profile}
          fullWidth
          icon="trash-outline"
          label={busy ? 'Menghapus data…' : 'Hapus data saya'}
          onPress={() => {
            void handleDelete();
          }}
          testID="account-delete-submit"
        />

        <AppText tone="muted" variant="caption">
          Butuh bantuan sebelum menghapus? Hubungi dukungan di{' '}
          <AppText
            accessibilityRole="link"
            onPress={() => {
              void Linking.openURL(SUPPORT_URL);
            }}
            tone="accent"
            variant="caption"
          >
            {SUPPORT_URL}
          </AppText>
          . Kebijakan retensi data ada di layar Kebijakan privasi.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
});
