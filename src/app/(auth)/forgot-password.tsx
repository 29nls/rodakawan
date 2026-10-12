import { useRouter } from 'expo-router';
import { useState } from 'react';

import { AppText } from '@/components/ui/AppText';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { requestPasswordReset } from '@/features/auth/api';
import { AuthScaffold } from '@/features/auth/components/AuthScaffold';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { authCallbackUrl } from '@/features/auth/redirect';
import { useAuthSession } from '@/features/auth/session';
import { emailError, normalizeEmail } from '@/features/auth/validation';

/**
 * Meminta tautan pemulihan kata sandi.
 *
 * Pesan sukses selalu netral: Supabase tidak memberi tahu apakah email terdaftar,
 * dan aplikasi tidak boleh memberi sinyal tambahan (mencegah enumerasi akun).
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { backend } = useAuthSession();

  const [email, setEmail] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const emailValidation = emailError(email);
  const showValidation = attempted;

  async function handleSubmit() {
    if (submitting) return;

    setAttempted(true);
    setError(null);

    if (emailValidation) return;
    if (!backend.available) return;

    const normalizedEmail = normalizeEmail(email);
    setSubmitting(true);
    const result = await requestPasswordReset(backend.client, {
      email: normalizedEmail,
      redirectTo: authCallbackUrl(),
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSentTo(normalizedEmail);
  }

  if (sentTo) {
    return (
      <AuthScaffold
        description="Periksa email Anda untuk melanjutkan."
        showBack
        testID="forgot-password-sent"
        title="Tautan pemulihan dikirim"
        footer={
          <Button
            fullWidth
            label="Kembali ke halaman masuk"
            onPress={() => router.replace('/sign-in')}
            variant="secondary"
          />
        }
      >
        <Banner
          message={`Bila ${sentTo} terdaftar, kami sudah mengirim tautan untuk membuat kata sandi baru. Tautan itu berlaku sekali dan kedaluwarsa setelah beberapa menit.`}
          title="Periksa kotak masuk & folder spam"
          tone="success"
        />
        <AppText tone="secondary" variant="callout">
          Buka tautan tersebut di perangkat ini agar aplikasi dapat menyelesaikan pemulihan secara
          aman (kode pemulihan terikat pada perangkat yang memintanya).
        </AppText>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      description="Masukkan email akun Anda. Kami akan mengirim tautan untuk membuat kata sandi baru."
      showBack
      testID="forgot-password-screen"
      title="Lupa kata sandi"
    >
      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {error ? <Banner message={error.message} title="Gagal mengirim" tone="danger" /> : null}

      <TextField
        autoComplete="email"
        error={showValidation ? emailValidation : undefined}
        keyboardType="email-address"
        label="Email"
        onChangeText={setEmail}
        onSubmitEditing={handleSubmit}
        placeholder="nama@contoh.com"
        returnKeyType="done"
        testID="forgot-password-email"
        textContentType="emailAddress"
        value={email}
      />

      <Button
        disabled={!backend.available || submitting}
        fullWidth
        label={submitting ? 'Mengirim…' : 'Kirim tautan pemulihan'}
        onPress={handleSubmit}
        size="lg"
        testID="forgot-password-submit"
      />
    </AuthScaffold>
  );
}
