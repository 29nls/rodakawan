import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

// Membangun ulang router lengkap (semua rute + ikon) butuh waktu lebih dari batas default.
jest.setTimeout(30_000);

/**
 * Pengujian navigasi nyata: menjalankan rute Expo Router dari src/app, memeriksa
 * halaman awal, perpindahan tab, rute tidak dikenal, dan aturan "tidak ada tombol
 * yang berpura-pura berfungsi" (docs/AI_CODING_AGENT_PROMPT.md aturan 9).
 *
 * Catatan: pada @testing-library/react-native 14 `render` bersifat asynchronous.
 * `renderRouter` mengembalikan thenable yang juga membawa helper rute
 * (getPathname dan sejenisnya), jadi nilai itu harus di-await tanpa dibungkus ulang.
 */
async function renderApp(initialUrl: string) {
  const app = renderRouter('src/app', { initialUrl });
  await app;
  return { app };
}

describe('navigasi aplikasi', () => {
  it('menampilkan layar Ringkasan pada rute awal', async () => {
    const { app } = await renderApp('/');

    expect(app.getPathname()).toBe('/');
    expect(screen.getByText('Pendamping touring & konvoi')).toBeTruthy();
  });

  it('berpindah ke tab Perjalanan lewat tab bar', async () => {
    const { app } = await renderApp('/');

    await fireEvent.press(screen.getByLabelText('Perjalanan'));

    expect(app.getPathname()).toBe('/rides');
    expect(screen.getByText('Touring & konvoi')).toBeTruthy();
  });

  it('berpindah ke tab Komunitas dan Peringatan', async () => {
    const { app } = await renderApp('/');

    await fireEvent.press(screen.getByLabelText('Komunitas'));
    expect(app.getPathname()).toBe('/community');
    expect(screen.getByText('Klub & anggota')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Peringatan'));
    expect(app.getPathname()).toBe('/hazards');
    expect(screen.getByText('Kondisi di jalan')).toBeTruthy();
  });

  it('menonaktifkan aksi fitur yang belum dibangun pada Ringkasan', async () => {
    await renderApp('/');

    expect(screen.getByRole('button', { name: 'Buat perjalanan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gabung perjalanan' })).toBeDisabled();
  });

  it('membuka layar Fondasi & sistem dari Ringkasan', async () => {
    const { app } = await renderApp('/');

    await fireEvent.press(screen.getByLabelText('Lihat fondasi & sistem'));

    await waitFor(() => expect(app.getPathname()).toBe('/system'));
    expect(screen.getByText('Checklist Milestone 0')).toBeTruthy();
  });

  it('menampilkan layar tidak ditemukan untuk rute asing', async () => {
    await renderApp('/rute-yang-tidak-ada');

    expect(screen.getByText('Halaman tidak ditemukan')).toBeTruthy();
  });
});
