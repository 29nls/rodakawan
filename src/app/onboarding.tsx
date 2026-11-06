import { useRouter } from 'expo-router';
import { useState } from 'react';

import { AppText } from '@/components/ui/AppText';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { TextField } from '@/components/ui/TextField';
import { AuthScaffold } from '@/features/auth/components/AuthScaffold';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import { createOwnProfile, updateOwnProfile } from '@/features/profile/api';
import {
  DISPLAY_NAME_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  displayNameError,
  isGeneratedUsername,
  normalizeUsername,
  usernameError,
} from '@/features/profile/validation';
import { useProfile } from '@/features/profile/useProfile';

/**
 * Onboarding satu layar pengganti pendaftaran.
 *
 * Identitas perangkat sudah dibuat oleh `AuthSessionProvider` sebelum layar ini
 * tampil, jadi yang tersisa hanya memilih username unik dan nama tampilan.
 * Bootstrap trigger sudah membuat profil sementara (`rider_<acak>`); layar ini
 * memperbarui baris itu, atau membuatnya bila trigger belum terpasang.
 *
 * Keunikan username tetap diputuskan database (unique index). Bila dua perangkat
 * memilih username yang sama, yang kalah menerima error `username_taken` dan
 * diminta memilih nama lain — bukan diam-diam diganti.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const { backend, userId } = useAuthSession();
  const { state, reload } = useProfile();

  const profile = state.status === 'ready' ? state.profile : null;
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const usernameValidation = usernameError(username);
  const displayNameValidation = displayNameError(displayName);

  async function handleSubmit() {
    if (submitting) return;

    setAttempted(true);
    setError(null);

    if (usernameValidation || displayNameValidation) return;
    if (!backend.available || !userId) return;

    setSubmitting(true);
    const input = { username: normalizeUsername(username), displayName, bio: '', city: '' };
    const result = profile
      ? await updateOwnProfile(backend.client, userId, input)
      : await createOwnProfile(backend.client, userId, input);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    reload();
    router.replace('/ringkasan');
  }

  // Profil sementara hasil bootstrap sudah ada: tampilkan sebagai konteks, bukan
  // sebagai isian, supaya pengguna tidak mengira username acak itu pilihannya.
  const temporaryUsername =
    profile && isGeneratedUsername(profile.username) ? profile.username : null;

  return (
    <AuthScaffold
      description="Pilih nama panggilan dan username. Tidak ada email, kata sandi, atau kode verifikasi."
      testID="onboarding-screen"
      title="Kenalan dulu"
      footer={
        <AppText tone="muted" variant="caption">
          Identitas ini tersimpan di perangkat. Ganti HP, hapus data aplikasi, atau pasang ulang
          aplikasi berarti memulai identitas baru dan harus diundang ulang ke klub.
        </AppText>
      }
    >
      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {error ? (
        <Banner message={error.message} title="Profil belum tersimpan" tone="danger" />
      ) : null}

      {temporaryUsername ? (
        <Banner
          message={`Profil sementara @${temporaryUsername} sudah dibuat otomatis. Pilih username sendiri di bawah untuk menggantinya.`}
          title="Username sementara"
          tone="info"
        />
      ) : null}

      <TextField
        autoCapitalize="words"
        autoComplete="name"
        error={attempted ? displayNameValidation : undefined}
        label="Nama panggilan"
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        onChangeText={setDisplayName}
        placeholder="Nama yang dilihat rider lain"
        testID="onboarding-display-name"
        value={displayName}
      />

      <TextField
        autoCapitalize="none"
        autoComplete="username-new"
        error={attempted ? usernameValidation : undefined}
        helper="Huruf kecil, angka, dan garis bawah. Contoh: bayu_solo. Username harus unik."
        label="Username"
        maxLength={USERNAME_MAX_LENGTH}
        onChangeText={setUsername}
        placeholder="username_unik"
        testID="onboarding-username"
        value={username}
      />

      <Button
        disabled={!backend.available || submitting || !userId}
        fullWidth
        label={submitting ? 'Menyimpan…' : 'Mulai pakai RodaKawan'}
        onPress={() => {
          void handleSubmit();
        }}
        size="lg"
        testID="onboarding-submit"
      />

      <Divider />

      <AppText tone="muted" variant="caption">
        Profil publik hanya berisi username, nama tampilan, foto, bio, dan kota. Tidak ada email
        atau nomor telepon yang diminta.
      </AppText>
    </AuthScaffold>
  );
}
