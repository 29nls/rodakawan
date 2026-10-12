import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { TextField } from '@/components/ui/TextField';
import { AppText } from '@/components/ui/AppText';
import { signInWithEmail } from '@/features/auth/api';
import { AuthScaffold } from '@/features/auth/components/AuthScaffold';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import { emailError, normalizeEmail, signInPasswordError } from '@/features/auth/validation';

/**
 * Masuk dengan email dan kata sandi.
 *
 * Setelah berhasil, pengguna tidak dinavigasi manual: guard `Stack.Protected` di
 * `_layout.tsx` otomatis menampilkan area aplikasi begitu sesi tersedia, sehingga
 * tidak ada dua sumber kebenaran navigasi.
 */
export default function SignInScreen() {
  const router = useRouter();
  const { backend } = useAuthSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const emailValidation = emailError(email);
  const passwordValidation = signInPasswordError(password);
  const showValidation = attempted;
  const canSubmit = backend.available && !submitting;

  async function handleSubmit() {
    if (submitting) return;

    setAttempted(true);
    setError(null);

    if (emailValidation || passwordValidation) return;
    if (!backend.available) return;

    setSubmitting(true);
    const result = await signInWithEmail(backend.client, {
      email: normalizeEmail(email),
      password,
    });
    setSubmitting(false);

    if (!result.ok) setError(result.error);
  }

  return (
    <AuthScaffold
      description="Masuk untuk melanjutkan ke perjalanan, klub, dan profil Anda."
      testID="sign-in-screen"
      title="Masuk ke RodaKawan"
      footer={
        <View>
          <Button
            fullWidth
            label="Belum punya akun? Daftar"
            onPress={() => router.push('/sign-up')}
            variant="secondary"
          />
          <Button
            fullWidth
            label="Lupa kata sandi"
            onPress={() => router.push('/forgot-password')}
            variant="ghost"
          />
        </View>
      }
    >
      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {error ? <Banner message={error.message} title="Gagal masuk" tone="danger" /> : null}

      <TextField
        autoComplete="email"
        error={showValidation ? emailValidation : undefined}
        keyboardType="email-address"
        label="Email"
        onChangeText={setEmail}
        placeholder="nama@contoh.com"
        returnKeyType="next"
        testID="sign-in-email"
        textContentType="emailAddress"
        value={email}
      />

      <TextField
        autoComplete="current-password"
        error={showValidation ? passwordValidation : undefined}
        label="Kata sandi"
        onChangeText={setPassword}
        onSubmitEditing={handleSubmit}
        placeholder="Kata sandi Anda"
        returnKeyType="done"
        secure
        testID="sign-in-password"
        value={password}
      />

      <Button
        disabled={!canSubmit}
        fullWidth
        label={submitting ? 'Memproses…' : 'Masuk'}
        onPress={handleSubmit}
        size="lg"
        testID="sign-in-submit"
      />

      <Divider />

      <AppText tone="muted" variant="caption">
        Aplikasi tidak pernah menampilkan atau mengirim kata sandi Anda. Sesi disimpan di
        penyimpanan aplikasi dan dapat diakhiri kapan saja dari tab Profil.
      </AppText>
    </AuthScaffold>
  );
}
