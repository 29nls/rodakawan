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
import { TextField } from '@/components/ui/TextField';
import { spacing } from '@/constants/theme';
import { deleteMyAccount, collectOwnMedia, removeOwnMedia } from '@/features/account/api';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import { useProfile } from '@/features/profile/useProfile';

const SUPPORT_URL = 'https://github.com/29nls/rodakawan/issues';

/**
 * Hapus akun (anonimisasi).
 *
 * Layar ini sengaja tidak menawarkan tombol sekali tekan: konsekuensinya tidak
 * bisa dibatalkan, jadi pengguna harus mengetik username-nya sendiri. Yang
 * ditampilkan sebagai "berhasil" hanya setelah server menerima RPC — kegagalan
 * Storage dilaporkan terpisah dan tidak dipalsukan menjadi sukses.
 */
export default function AccountDeleteScreen() {
  const router = useRouter();
  const { backend, userId, signOut } = useAuthSession();
  const { state } = useProfile();

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

    // 1. Kumpulkan rujukan media sebelum baris database hilang.
    const media = await collectOwnMedia(backend.client, userId);

    // 2. Hapus objek Storage lewat Storage API (best effort, tidak memblokir).
    const cleanup = media.length > 0 ? await removeOwnMedia(backend.client, media) : null;

    // 3. Anonimkan akun di server.
    const result = await deleteMyAccount(backend.client);

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }

    setNotice(
      cleanup && cleanup.failed > 0
        ? 'Akun Anda sudah dianonimkan. Sebagian foto tidak dapat dihapus otomatis dan akan dibersihkan oleh pengelola; foto itu tidak lagi dapat dibuka siapa pun karena tidak ada sesi yang memiliki foldernya.'
        : 'Akun Anda sudah dianonimkan dan Anda telah keluar dari perangkat ini.',
    );

    await signOut();
    router.replace('/sign-in');
  }

  return (
    <Screen
      header={<ScreenHeader showBack title="Hapus akun" />}
      scroll
      testID="account-delete-screen"
    >
      <Card>
        <SectionHeader
          subtitle="Penghapusan bersifat permanen dan tidak bisa dibatalkan. Anda akan keluar dari perangkat ini."
          title="Apa yang terjadi"
        />
        <View style={styles.list}>
          <AppText variant="callout">
            • Username, nama tampilan, foto profil, bio, dan kota dihapus atau diganti anonim.
          </AppText>
          <AppText variant="callout">
            • Kendaraan, nomor polisi, catatan privat, token notifikasi, relasi follow, dan blokir
            dihapus.
          </AppText>
          <AppText variant="callout">
            • Anda keluar dari klub dan perjalanan. Perjalanan yang pernah Anda ikuti tetap ada
            untuk peserta lain.
          </AppText>
          <AppText variant="callout">
            • Laporan bahaya dan pesan konvoi tetap tersimpan untuk keselamatan peserta lain, tetapi
            tanpa identitas Anda.
          </AppText>
        </View>
      </Card>

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {error ? (
        <Banner
          action="Periksa koneksi, lalu coba lagi. Bila berulang, hubungi dukungan."
          message={error.message}
          testID="account-delete-error"
          title="Akun belum dihapus"
          tone="danger"
        />
      ) : null}

      {notice ? (
        <Banner
          message={notice}
          testID="account-delete-notice"
          title="Akun dihapus"
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
            Profil belum termuat. Muat ulang layar ini sebelum menghapus akun.
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
          label={busy ? 'Menghapus akun…' : 'Hapus akun saya'}
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
