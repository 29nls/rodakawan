import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { TextField } from '@/components/ui/TextField';
import { resendSignUpEmail, signUpWithEmail } from '@/features/auth/api';
import { AuthScaffold } from '@/features/auth/components/AuthScaffold';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { authCallbackUrl } from '@/features/auth/redirect';
import { useAuthSession } from '@/features/auth/session';
import {
  describePasswordPolicy,
  emailError,
  normalizeEmail,
  passwordConfirmationError,
  passwordError,
} from '@/features/auth/validation';
import {
  DISPLAY_NAME_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  displayNameError,
  normalizeUsername,
  usernameError,
} from '@/features/profile/validation';
import { spacing } from '@/constants/theme';

const styles = StyleSheet.create({
  footerActions: {
    gap: spacing.sm,
  },
});

/**
 * Pendaftaran akun baru: email, kata sandi, nama tampilan, dan username.
 *
 * Username dan nama tampilan dikirim sebagai metadata; bootstrap trigger Supabase
 * (migration bootstrap profil) memakai metadata itu untuk membuat baris `public.profiles`.
 * Bila username sudah dipakai, trigger memakai username sementara berawalan
 * `rider_` dan aplikasi memberi tahu pengguna di layar Profil.
 */
export default function SignUpScreen() {
  const router = useRouter();
  const { backend } = useAuthSession();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  const displayNameValidation = displayNameError(displayName);
  const usernameValidation = usernameError(username);
  const emailValidation = emailError(email);
  const passwordValidation = passwordError(password);
  const confirmationValidation = passwordConfirmationError(password, confirmation);
  const showValidation = attempted;

  async function handleSubmit() {
    if (submitting) return;

    setAttempted(true);
    setError(null);
    setResendNotice(null);

    const invalid =
      displayNameValidation ||
      usernameValidation ||
      emailValidation ||
      passwordValidation ||
      confirmationValidation;
    if (invalid) return;
    if (!backend.available) return;

    setSubmitting(true);
    const result = await signUpWithEmail(backend.client, {
      email: normalizeEmail(email),
      password,
      username: normalizeUsername(username),
      displayName,
      emailRedirectTo: authCallbackUrl(),
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (result.data.sessionCreated) {
      // Konfirmasi email dimatikan di project: guard navigasi langsung membawa
      // pengguna ke area aplikasi.
      return;
    }

    setAwaitingConfirmation(normalizeEmail(email));
  }

  async function handleResend() {
    if (resending || !awaitingConfirmation || !backend.available) return;

    setResending(true);
    setResendNotice(null);
    const result = await resendSignUpEmail(backend.client, {
      email: awaitingConfirmation,
      emailRedirectTo: authCallbackUrl(),
    });
    setResending(false);

    setResendNotice(
      result.ok
        ? 'Email konfirmasi dikirim ulang. Periksa kotak masuk dan folder spam.'
        : result.error.message,
    );
  }

  if (awaitingConfirmation) {
    return (
      <AuthScaffold
        description="Satu langkah lagi sebelum akun aktif."
        testID="sign-up-confirmation"
        title="Konfirmasi email Anda"
        footer={
          <View style={styles.footerActions}>
            <Button
              fullWidth
              label={resending ? 'Mengirim…' : 'Kirim ulang email konfirmasi'}
              onPress={handleResend}
              variant="secondary"
            />
            <Button
              fullWidth
              label="Kembali ke halaman masuk"
              onPress={() => router.push('/sign-in')}
              variant="ghost"
            />
          </View>
        }
      >
        <Banner
          message={`Kami mengirim tautan konfirmasi ke ${awaitingConfirmation}. Buka tautan itu di perangkat ini agar aplikasi bisa menyelesaikan pendaftaran.`}
          title="Periksa email Anda"
          tone="success"
        />
        <AppText tone="secondary" variant="callout">
          Bila alamat email sudah pernah terdaftar, Supabase mengirim email pemberitahuan akun yang
          sudah ada. Dalam hal itu, gunakan “Lupa kata sandi” untuk memulihkan akses.
        </AppText>
        {resendNotice ? (
          <Banner message={resendNotice} title="Status kirim ulang" tone="info" />
        ) : null}
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      description="Buat akun dengan email. Username unik dipakai rider lain untuk mengenali Anda."
      showBack
      testID="sign-up-screen"
      title="Daftar akun RodaKawan"
      footer={
        <Button
          fullWidth
          label="Sudah punya akun? Masuk"
          onPress={() => router.push('/sign-in')}
          variant="ghost"
        />
      }
    >
      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {error ? <Banner message={error.message} title="Pendaftaran gagal" tone="danger" /> : null}

      <TextField
        autoCapitalize="words"
        autoComplete="name"
        error={showValidation ? displayNameValidation : undefined}
        label="Nama tampilan"
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        onChangeText={setDisplayName}
        placeholder="Nama yang dilihat rider lain"
        testID="sign-up-display-name"
        value={displayName}
      />

      <TextField
        autoComplete="username-new"
        error={showValidation ? usernameValidation : undefined}
        helper="Huruf kecil, angka, dan garis bawah. Contoh: bayu_solo."
        label="Username"
        maxLength={USERNAME_MAX_LENGTH}
        onChangeText={setUsername}
        placeholder="username_unik"
        testID="sign-up-username"
        value={username}
      />

      <TextField
        autoComplete="email"
        error={showValidation ? emailValidation : undefined}
        keyboardType="email-address"
        label="Email"
        onChangeText={setEmail}
        placeholder="nama@contoh.com"
        testID="sign-up-email"
        textContentType="emailAddress"
        value={email}
      />

      <TextField
        autoComplete="password-new"
        error={showValidation ? passwordValidation : undefined}
        helper={describePasswordPolicy()}
        label="Kata sandi"
        onChangeText={setPassword}
        secure
        testID="sign-up-password"
        textContentType="newPassword"
        value={password}
      />

      <TextField
        autoComplete="password-new"
        error={showValidation ? confirmationValidation : undefined}
        label="Ulangi kata sandi"
        onChangeText={setConfirmation}
        onSubmitEditing={handleSubmit}
        returnKeyType="done"
        secure
        testID="sign-up-password-confirmation"
        value={confirmation}
      />

      <Button
        disabled={!backend.available || submitting}
        fullWidth
        label={submitting ? 'Mendaftarkan…' : 'Daftar'}
        onPress={handleSubmit}
        size="lg"
        testID="sign-up-submit"
      />

      <Divider />

      <AppText tone="muted" variant="caption">
        Data profil publik hanya berisi username, nama tampilan, foto, bio, dan kota. Data sensitif
        tidak pernah dicampur ke profil publik (docs/SECURITY_PRIVACY.md bagian 4).
      </AppText>
    </AuthScaffold>
  );
}
