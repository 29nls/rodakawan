import { Stack } from 'expo-router';

/**
 * Grup rute untuk pengguna yang belum masuk: masuk, daftar, dan lupa kata sandi.
 * Header bawaan tidak dipakai; setiap layar memakai `ScreenHeader` sendiri agar
 * konsisten dengan design system (ADR-013).
 */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
