import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { TextField } from '@/components/ui/TextField';
import { updatePassword } from '@/features/auth/api';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import {
  describePasswordPolicy,
  passwordConfirmationError,
  passwordError,
} from '@/features/auth/validation';
import { spacing } from '@/constants/theme';

/**
 * Menetapkan kata sandi baru. Dipakai oleh alur pemulihan (`PASSWORD_RECOVERY`)
 * maupun oleh pengguna yang sudah masuk dan ingin mengganti kata sandinya sendiri.
 * Route ini terlindungi: harus ada sesi yang valid.
 */
export default function ResetPasswordScreen() {
  const { backend, signOut } = useAuthSession();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [updated, setUpdated] = useState(false);

  const passwordValidation = passwordError(password);
  const confirmationValidation = passwordConfirmationError(password, confirmation);
  const showValidation = attempted;

  async function handleSubmit() {
    if (submitting) return;

    setAttempted(true);
    setError(null);

    if (passwordValidation || confirmationValidation) return;
    if (!backend.available) return;

    setSubmitting(true);
    const result = await updatePassword(backend.client, { password });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setUpdated(true);
    setPassword('');
    setConfirmation('');
  }

  return (
    <Screen scroll testID="reset-password-screen">
      <ScreenHeader
        subtitle="Kata sandi baru langsung aktif untuk akun ini."
        title="Atur kata sandi baru"
      />

      <View style={styles.block}>
        {updated ? (
          <>
            <Banner
              message="Kata sandi sudah diperbarui. Gunakan kata sandi baru pada saat masuk berikutnya."
              title="Kata sandi tersimpan"
              tone="success"
            />
            <Button
              fullWidth
              label="Lanjut ke Ringkasan"
              onPress={() => router.replace('/')}
              size="lg"
            />
            <Button
              fullWidth
              label="Keluar dari akun ini"
              onPress={async () => {
                await signOut();
                router.replace('/sign-in');
              }}
              variant="ghost"
            />
          </>
        ) : (
          <>
            {error ? (
              <Banner message={error.message} title="Gagal menyimpan" tone="danger" />
            ) : null}

            <TextField
              autoComplete="password-new"
              error={showValidation ? passwordValidation : undefined}
              helper={describePasswordPolicy()}
              label="Kata sandi baru"
              onChangeText={setPassword}
              secure
              testID="reset-password-password"
              textContentType="newPassword"
              value={password}
            />

            <TextField
              autoComplete="password-new"
              error={showValidation ? confirmationValidation : undefined}
              label="Ulangi kata sandi baru"
              onChangeText={setConfirmation}
              onSubmitEditing={handleSubmit}
              returnKeyType="done"
              secure
              testID="reset-password-confirmation"
              value={confirmation}
            />

            <Button
              disabled={submitting}
              fullWidth
              label={submitting ? 'Menyimpan…' : 'Simpan kata sandi baru'}
              onPress={handleSubmit}
              size="lg"
              testID="reset-password-submit"
            />

            <AppText tone="muted" variant="caption">
              Kata sandi lama tidak bisa dilihat siapa pun, termasuk pengembang. Bila Anda tidak
              merasa mengganti kata sandi, segera ubah kembali dan hentikan sesi lain dari menu
              Profil.
            </AppText>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.md,
  },
});
