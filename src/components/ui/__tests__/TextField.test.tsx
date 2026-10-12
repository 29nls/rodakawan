import { fireEvent, render, screen } from '@testing-library/react-native';

import { Banner } from '@/components/ui/Banner';
import { TextField } from '@/components/ui/TextField';

describe('TextField', () => {
  it('menampilkan label dan meneruskan perubahan teks', async () => {
    const onChangeText = jest.fn();
    await render(<TextField label="Username" onChangeText={onChangeText} value="" />);

    await fireEvent.changeText(screen.getByLabelText('Username'), 'budi_solo');

    expect(onChangeText).toHaveBeenCalledWith('budi_solo');
  });

  it('menampilkan pesan kesalahan sebagai teks, bukan hanya warna', async () => {
    await render(
      <TextField
        error="Username sudah dipakai."
        label="Username"
        onChangeText={() => {}}
        value="budi"
      />,
    );

    expect(screen.getByText('Username sudah dipakai.')).toBeTruthy();
    expect(screen.getByLabelText('Username')).toHaveProp(
      'accessibilityHint',
      'Username sudah dipakai.',
    );
  });

  it('menampilkan teks bantuan bila tidak ada kesalahan', async () => {
    await render(
      <TextField
        helper="Huruf kecil dan angka."
        label="Username"
        onChangeText={() => {}}
        value="budi"
      />,
    );

    expect(screen.getByText('Huruf kecil dan angka.')).toBeTruthy();
  });

  it('menyembunyikan kata sandi dan dapat ditampilkan kembali', async () => {
    await render(
      <TextField label="Kata sandi" onChangeText={() => {}} secure value="rahasia123" />,
    );

    expect(screen.getByLabelText('Kata sandi')).toHaveProp('secureTextEntry', true);

    await fireEvent.press(screen.getByLabelText('Tampilkan kata sandi'));
    expect(screen.getByLabelText('Kata sandi')).toHaveProp('secureTextEntry', false);

    await fireEvent.press(screen.getByLabelText('Sembunyikan kata sandi'));
    expect(screen.getByLabelText('Kata sandi')).toHaveProp('secureTextEntry', true);
  });

  it('tidak dapat diubah ketika dinonaktifkan', async () => {
    await render(
      <TextField editable={false} label="Email" onChangeText={() => {}} value="rider@contoh.com" />,
    );

    expect(screen.getByLabelText('Email')).toHaveProp('editable', false);
  });
});

describe('Banner', () => {
  it('menampilkan judul, pesan, dan langkah pemulihan', async () => {
    await render(
      <Banner
        action="Minta tautan baru."
        message="Tautan sudah kedaluwarsa."
        title="Tautan tidak dapat dipakai"
        tone="danger"
      />,
    );

    expect(screen.getByText('Tautan tidak dapat dipakai')).toBeTruthy();
    expect(screen.getByText('Tautan sudah kedaluwarsa.')).toBeTruthy();
    expect(screen.getByText('Minta tautan baru.')).toBeTruthy();
  });

  it('diumumkan sebagai alert untuk keadaan bahaya', async () => {
    await render(
      <Banner message="Kredensial salah." testID="banner" title="Gagal masuk" tone="danger" />,
    );

    const banner = screen.getByTestId('banner');
    expect(banner).toHaveProp('accessibilityRole', 'alert');
    expect(banner).toHaveProp('accessibilityLiveRegion', 'assertive');
  });

  it('memakai pengumuman halus untuk informasi biasa', async () => {
    await render(
      <Banner message="Sudah terkirim." testID="banner" title="Email dikirim" tone="success" />,
    );

    const banner = screen.getByTestId('banner');
    expect(banner).toHaveProp('accessibilityRole', 'text');
    expect(banner).toHaveProp('accessibilityLiveRegion', 'polite');
  });
});
