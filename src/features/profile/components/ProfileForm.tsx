import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { spacing } from '@/constants/theme';
import {
  BIO_MAX_LENGTH,
  CITY_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  bioError,
  cityError,
  displayNameError,
  normalizeUsername,
  usernameError,
} from '@/features/profile/validation';

export type ProfileFormValues = {
  username: string;
  displayName: string;
  bio: string;
  city: string;
};

export type ProfileFormProps = {
  /** Nilai awal dari database; komponen ini sengaja di-`key` oleh pemanggil. */
  initial: ProfileFormValues;
  submitting: boolean;
  disabled?: boolean;
  onSubmit: (values: ProfileFormValues) => void;
  onCancel: () => void;
};

/**
 * Form profil yang memegang nilai field dan validasi.
 *
 * Nilai awal diterima lewat props + `key` dari pemanggil (pola React untuk
 * "menyetel ulang state saat data berubah"), sehingga tidak ada `setState` di dalam
 * effect dan form otomatis memakai data terbaru setelah profil dimuat ulang.
 */
export function ProfileForm({
  initial,
  submitting,
  disabled = false,
  onSubmit,
  onCancel,
}: ProfileFormProps) {
  const [username, setUsername] = useState(initial.username);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [city, setCity] = useState(initial.city);
  const [attempted, setAttempted] = useState(false);

  const usernameValidation = usernameError(username);
  const displayNameValidation = displayNameError(displayName);
  const bioValidation = bioError(bio);
  const cityValidation = cityError(city);
  const showValidation = attempted;

  function handleSubmit() {
    setAttempted(true);

    if (usernameValidation || displayNameValidation || bioValidation || cityValidation) return;

    onSubmit({
      username: normalizeUsername(username),
      displayName,
      bio,
      city,
    });
  }

  return (
    <View style={styles.form}>
      <TextField
        autoComplete="username-new"
        error={showValidation ? usernameValidation : undefined}
        helper="Huruf kecil, angka, dan garis bawah. Contoh: bayu_solo."
        label="Username"
        maxLength={USERNAME_MAX_LENGTH}
        onChangeText={setUsername}
        placeholder="username_unik"
        testID="profile-edit-username"
        value={username}
      />

      <TextField
        autoCapitalize="words"
        autoComplete="name"
        error={showValidation ? displayNameValidation : undefined}
        label="Nama tampilan"
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        onChangeText={setDisplayName}
        placeholder="Nama yang dilihat rider lain"
        testID="profile-edit-display-name"
        value={displayName}
      />

      <TextField
        error={showValidation ? bioValidation : undefined}
        helper={`Opsional, maksimal ${BIO_MAX_LENGTH} karakter.`}
        label="Bio"
        maxLength={BIO_MAX_LENGTH}
        multiline
        onChangeText={setBio}
        placeholder="Ceritakan gaya berkendara atau klub Anda"
        testID="profile-edit-bio"
        value={bio}
      />

      <TextField
        autoCapitalize="words"
        error={showValidation ? cityValidation : undefined}
        helper={`Opsional, maksimal ${CITY_MAX_LENGTH} karakter.`}
        label="Kota"
        maxLength={CITY_MAX_LENGTH}
        onChangeText={setCity}
        placeholder="Kota domisili"
        testID="profile-edit-city"
        value={city}
      />

      <Button
        disabled={submitting || disabled}
        fullWidth
        label={submitting ? 'Menyimpan…' : 'Simpan profil'}
        onPress={handleSubmit}
        size="lg"
        testID="profile-edit-submit"
      />

      <Button fullWidth label="Batal" onPress={onCancel} variant="ghost" />

      <AppText tone="muted" variant="caption">
        Foto profil diatur dari tab Profil, bukan dari formulir ini. Foto disimpan di bucket privat
        dan hanya akun Anda yang dapat membukanya.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
});
