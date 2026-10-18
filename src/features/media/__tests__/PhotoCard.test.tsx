import { fireEvent, render, screen } from '@testing-library/react-native';

import { PhotoCard } from '@/features/media/components/PhotoCard';

const baseProps = {
  title: 'Foto kendaraan',
  subtitle: 'JPG, PNG, atau WEBP; maksimal 5 MB.',
  hint: 'Foto hanya dapat dibaca pemilik kendaraan.',
  emptyText: 'Belum ada foto.',
  busy: false,
  onPick: jest.fn(),
  onRemove: jest.fn(),
};

describe('PhotoCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('menampilkan tombol unggah saja saat belum ada foto', async () => {
    await render(
      <PhotoCard {...baseProps} photoUrl={null} pickLabel="Unggah foto" testID="foto" />,
    );

    expect(screen.getByText('Unggah foto')).toBeTruthy();
    expect(screen.queryByText('Hapus foto')).toBeNull();

    await fireEvent.press(screen.getByTestId('foto-pick'));

    expect(baseProps.onPick).toHaveBeenCalledTimes(1);
  });

  it('menampilkan foto, tombol ganti, dan hapus saat foto tersedia', async () => {
    await render(
      <PhotoCard
        {...baseProps}
        photoUrl="https://contoh.test/signed"
        pickLabel="Ganti foto"
        testID="foto"
      />,
    );

    expect(screen.getByText('Ganti foto')).toBeTruthy();
    expect(screen.getByText('Hapus foto')).toBeTruthy();
    expect(screen.getByLabelText('Foto kendaraan')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('foto-remove'));

    expect(baseProps.onRemove).toHaveBeenCalledTimes(1);
  });

  it('tetap menyediakan hapus saat foto tersimpan tetapi preview gagal dimuat', async () => {
    await render(
      <PhotoCard {...baseProps} hasPhoto photoUrl={null} pickLabel="Ganti foto" testID="foto" />,
    );

    expect(screen.getByText('Ganti foto')).toBeTruthy();
    expect(screen.getByText(/Foto tersimpan, tetapi pratinjau tidak dapat dimuat/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('foto-remove'));

    expect(baseProps.onRemove).toHaveBeenCalledTimes(1);
  });

  it('menonaktifkan tombol saat unggahan sedang berjalan', async () => {
    await render(
      <PhotoCard {...baseProps} busy photoUrl={null} pickLabel="Unggah foto" testID="foto" />,
    );

    expect(screen.getByText('Memproses…')).toBeTruthy();
    expect(screen.queryByText('Unggah foto')).toBeNull();
  });
});
