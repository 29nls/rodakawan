import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { InfoRow } from '@/components/ui/InfoRow';
import { LinkRow } from '@/components/ui/LinkRow';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingState } from '@/components/ui/StateView';
import { safetyCopy, unavailableCopy } from '@/constants/strings';
import { spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import { isGeneratedUsername } from '@/features/profile/validation';
import { useProfile } from '@/features/profile/useProfile';
import { useAppStatus } from '@/hooks/useAppStatus';

/**
 * Tab Profil: identitas akun, profil publik, dan pengaturan sesi.
 *
 * Semua aksi di layar ini benar-benar berfungsi (edit profil, keluar). Fitur yang
 * belum dibangun (foto profil, hapus akun) dinyatakan jelas sebagai belum tersedia.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { appInfo, backend: envBackend } = useAppStatus();
  const { backend, email, requestedUsername, signOut } = useAuthSession();
  const { state, reload } = useProfile();

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<AppError | null>(null);
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);

  const profile = state.status === 'ready' ? state.profile : null;
  const showGeneratedNotice = profile !== null && isGeneratedUsername(profile.username);

  async function handleSignOut() {
    if (signingOut) return;

    setSigningOut(true);
    setSignOutError(null);
    setSignOutNotice(null);

    const result = await signOut();
    setSigningOut(false);

    if (!result.ok) {
      setSignOutError(result.error);
      return;
    }
    if (!result.data.revokedRemotely) {
      setSignOutNotice(
        'Perangkat ini sudah keluar. Karena server tidak dapat dihubungi, sesi akan dicabut sepenuhnya saat perangkat kembali online.',
      );
    }
  }

  return (
    <Screen scroll testID="profile-screen">
      <View style={styles.header}>
        <AppText variant="overline" tone="accent">
          Profil
        </AppText>
        <AppText variant="titleLg">Akun &amp; pengaturan</AppText>
      </View>

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {signOutError ? (
        <Banner message={signOutError.message} title="Gagal keluar" tone="danger" />
      ) : null}

      {signOutNotice ? (
        <Banner message={signOutNotice} title="Keluar tanpa koneksi" tone="warning" />
      ) : null}

      <Card>
        <SectionHeader
          subtitle="Terlihat oleh pengguna terautentikasi sesuai visibilitas profil."
          title="Profil rider"
        />
        <Divider />

        {state.status === 'loading' ? <LoadingState label="Memuat profil…" /> : null}

        {state.status === 'error' ? (
          <>
            <AppText tone="secondary" variant="callout">
              {state.error.message}
            </AppText>
            <Button icon="refresh" label="Coba lagi" onPress={reload} variant="secondary" />
          </>
        ) : null}

        {state.status === 'ready' && profile === null ? (
          <>
            <AppText tone="secondary" variant="callout">
              Akun Anda belum memiliki profil. Lengkapi username dan nama tampilan supaya rider lain
              dapat mengenali Anda dalam perjalanan.
            </AppText>
            <Badge icon="construct-outline" label="Profil belum ada" />
            <Button
              icon="create-outline"
              label="Lengkapi profil"
              onPress={() => router.push('/profile/edit')}
            />
          </>
        ) : null}

        {profile ? (
          <>
            {showGeneratedNotice ? (
              <Banner
                action="Buka “Edit profil” untuk memilih username baru."
                message={`Username "${profile.username}" dibuat otomatis karena ${
                  requestedUsername ? `"${requestedUsername}"` : 'pilihan Anda sebelumnya'
                } sudah dipakai akun lain atau tidak valid.`}
                title="Username masih sementara"
                tone="warning"
              />
            ) : null}

            <InfoRow label="Nama tampilan" value={profile.display_name} />
            <InfoRow
              detail="Dipakai untuk menyebut Anda di klub dan perjalanan."
              label="Username"
              value={`@${profile.username}`}
            />
            <InfoRow label="Kota" value={profile.city ?? 'Belum diisi'} />
            <InfoRow label="Bio" value={profile.bio ?? 'Belum diisi'} />
            <InfoRow
              badge={{
                label: profile.is_private ? 'Privat' : 'Publik',
                tone: profile.is_private ? 'neutral' : 'success',
              }}
              detail={
                profile.is_private
                  ? 'Profil privat hanya terlihat oleh Anda dan pengguna yang Anda izinkan.'
                  : 'Profil publik dapat dilihat pengguna terautentikasi lain, tanpa data sensitif.'
              }
              label="Visibilitas profil"
            />
            <Button
              fullWidth
              icon="create-outline"
              label="Edit profil"
              onPress={() => router.push('/profile/edit')}
              variant="secondary"
            />
            <AppText tone="muted" variant="caption">
              Unggah foto profil belum tersedia karena bucket Storage beserta policy-nya belum
              dibuat (Milestone 2). Tombol palsu sengaja tidak ditampilkan.
            </AppText>
          </>
        ) : null}
      </Card>

      <Card>
        <SectionHeader
          subtitle="Sesi disimpan di perangkat, bukan di server RodaKawan."
          title="Sesi & akun"
        />
        <Divider />
        <InfoRow label="Email" value={email ?? 'Tidak tersedia'} />
        <AppText tone="secondary" variant="callout">
          Keluar akan menghapus sesi di perangkat ini dan meminta server mencabut token.
        </AppText>
        <Button
          disabled={signingOut}
          icon="log-out-outline"
          label={signingOut ? 'Memproses…' : 'Keluar dari akun'}
          onPress={handleSignOut}
          variant="secondary"
          fullWidth
          testID="profile-sign-out"
        />
        <AppText tone="muted" variant="caption">
          Penghapusan akun dan pengaturan privasi lanjutan dibangun pada Milestone 5.
        </AppText>
      </Card>

      <Card>
        <SectionHeader
          subtitle="Diambil langsung dari konfigurasi build ini."
          title="Status perangkat & build"
        />
        <Divider />
        <InfoRow label="Aplikasi" value={appInfo.name} />
        <InfoRow detail={appInfo.buildLabel} label="Versi" value={appInfo.version} />
        <InfoRow label="Expo SDK" value={appInfo.expoSdkVersion ?? 'Belum terbaca'} />
        <InfoRow label="Paket Android" value={appInfo.androidPackage ?? 'Belum diset'} />
        <InfoRow
          badge={{ label: envBackend.label, tone: envBackend.tone }}
          detail={envBackend.detail}
          label="Backend"
        />
        <InfoRow
          badge={{
            label: appInfo.easProjectId ? 'Terdaftar' : 'Belum terdaftar',
            tone: appInfo.easProjectId ? 'success' : 'neutral',
          }}
          detail={
            appInfo.easProjectId
              ? 'Project EAS sudah terhubung, siap untuk cloud build.'
              : 'Jalankan "eas init" dari PowerShell untuk menghubungkan project ke akun Expo Anda.'
          }
          label="EAS project"
        />
      </Card>

      <Card padding="none">
        <LinkRow
          detail="Token desain, komponen dasar, dan status pemeriksaan."
          href="/system"
          icon="construct-outline"
          label="Fondasi & sistem"
        />
      </Card>

      <Card>
        <AppText variant="bodyStrong">Privasi &amp; keselamatan</AppText>
        <AppText variant="callout" tone="secondary">
          {safetyCopy.noTrackingYet}
        </AppText>
        <AppText variant="caption" tone="muted">
          {unavailableCopy.foundationNote}
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
});
