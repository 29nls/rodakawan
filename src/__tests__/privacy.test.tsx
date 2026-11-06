import { render, screen } from '@testing-library/react-native';

import PrivacyScreen from '@/app/privacy';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true) },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true }),
}));

/**
 * Kebijakan privasi harus menggambarkan aplikasi tanpa akun: identitas anonim
 * per perangkat, berbagi lokasi yang opt-in, dan jalur hapus data yang benar.
 * Uji ini menjaga agar teks lama ("akun", "email") tidak kembali.
 */
describe('PrivacyScreen', () => {
  it('menjelaskan identitas anonim perangkat, bukan akun email', async () => {
    await render(<PrivacyScreen />);

    expect(screen.getByTestId('privacy-screen')).toBeTruthy();
    expect(screen.getByText(/tidak meminta email, nomor HP, atau kata sandi/)).toBeTruthy();
    expect(
      screen.getByText(/membuat satu identitas anonim \(ID acak\) yang mewakili perangkat/),
    ).toBeTruthy();
  });

  it('menyebut lokasi opt-in dan jalur hapus data yang benar', async () => {
    await render(<PrivacyScreen />);

    expect(screen.getByText(/opt-in, mati secara bawaan/)).toBeTruthy();
    expect(screen.getByText(/Profil → Hapus data saya/)).toBeTruthy();
    expect(screen.queryByText(/Hapus akun/)).toBeNull();
  });
});
