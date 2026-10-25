import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Banner } from '@/components/ui/Banner';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { LoadingState } from '@/components/ui/StateView';
import { spacing } from '@/constants/theme';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import { createOwnProfile, updateOwnProfile } from '@/features/profile/api';
import { ProfileForm, type ProfileFormValues } from '@/features/profile/components/ProfileForm';
import { useProfile } from '@/features/profile/useProfile';
import { isGeneratedUsername } from '@/features/profile/validation';
import { formatErrorMessage } from '@/features/state-helper';

/**
 * Mengubah profil sendiri, dan membuat baris profil bila belum ada
 * (mis. bootstrap trigger belum terpasang di project Supabase).
 *
 * `id` baris selalu diambil dari sesi, dan database tetap menolak perubahan milik
 * pengguna lain lewat RLS (`profiles_update_self`).
 */
export default function ProfileEditScreen() {
  const { backend, userId, requestedUsername } = useAuthSession();
  const { state, reload } = useProfile();

  // Status layar dibaca dari state profil itu sendiri: `useProfile` sudah
  // menurunkan backend/sesi yang belum siap menjadi state error, jadi tidak ada
  // klasifikasi terpisah yang bisa menyimpang darinya.
  const showError = state.status === 'error';
  const showEmpty = state.status === 'ready';
  const errorMessage = showError ? formatErrorMessage(state.error) : undefined;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [saved, setSaved] = useState(false);

  const profile = state.status === 'ready' ? state.profile : null;
  const isCreating = state.status === 'ready' && state.profile === null;

  const initialValues: ProfileFormValues = {
    username: profile?.username ?? requestedUsername ?? '',
    displayName: profile?.display_name ?? '',
    bio: profile?.bio ?? '',
    city: profile?.city ?? '',
  };

  // `key` membuat form menyetel ulang nilainya saat profil dimuat/diubah dari server,
  // tanpa perlu menyalin props ke state lewat effect.
  const formKey = profile
    ? `${profile.id}:${profile.updated_at}:${saved ? 'saved' : 'edit'}`
    : 'new';

  const generatedUsernameNotice =
    profile && isGeneratedUsername(profile.username) && !saved
      ? `Username "${profile.username}" dibuat otomatis karena ${
          requestedUsername ? `"${requestedUsername}"` : 'pilihan Anda sebelumnya'
        } tidak tersedia. Pilih username baru di bawah agar rider lain mudah mengenali Anda.`
      : null;

  async function handleSubmit(values: ProfileFormValues) {
    if (submitting || !backend.available || !userId) return;

    setSubmitting(true);
    setError(null);
    setSaved(false);

    const result = isCreating
      ? await createOwnProfile(backend.client, userId, values)
      : await updateOwnProfile(backend.client, userId, values);

    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSaved(true);
    reload();
  }

  return (
    <Screen scroll testID="profile-edit-screen">
      <ScreenHeader
        subtitle="Data ini terlihat oleh pengguna terautentikasi lain sesuai aturan privasi profil."
        title={isCreating ? 'Lengkapi profil' : 'Edit profil'}
      />

      {showError ? (
        <Banner
          action="Muat ulang halaman ini setelah koneksi kembali."
          message={errorMessage}
          title="Profil belum bisa dimuat"
          tone="danger"
        />
      ) : null}

      {showEmpty && profile === null ? (
        <AppText tone="muted" variant="caption">
          Profil belum terisi. Lengkapi data di bawah untuk memulai.
        </AppText>
      ) : null}

      {/* Indikator muat dan galat dimiliki `useProfile`; formulir hanya tampil saat profil siap. */}
      {/* Notice username otomatis dan banner "tersimpan" sedang dinonaktifkan. */}

      {error ? <Banner message={error.message} title="Gagal menyimpan" tone="danger" /> : null}

      {state.status === 'ready' ? (
        <View style={styles.form}>
          <ProfileForm
            disabled={!backend.available}
            initial={initialValues}
            key={formKey}
            onCancel={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/profile');
            }}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
});
