import { render, screen } from '@testing-library/react-native';

import { MapStatusCard } from '@/features/map/MapStatusCard';
import type { MapRenderer } from '@/features/map/provider';

jest.mock('@maplibre/maplibre-react-native', () =>
  jest.requireActual('@/test-support/mapLibreMock'),
);
const STYLE_URL = 'https://api.maptiler.com/maps/streets/style.json?key=uji';

describe('MapStatusCard', () => {
  it('menandai keadaan belum dikonfigurasi tanpa URL gaya', async () => {
    await render(<MapStatusCard styleUrl={undefined} />);

    expect(screen.getByText('Belum dikonfigurasi')).toBeTruthy();
    expect(screen.getByText(/Peta belum dikonfigurasi untuk build ini/)).toBeTruthy();
    expect(screen.queryByText('Penyedia tile')).toBeNull();
    expect(screen.queryByText('Renderer tidak cocok')).toBeNull();
  });

  it('mengenali renderer MapLibre bawaan pada konfigurasi MapTiler', async () => {
    await render(<MapStatusCard styleUrl={STYLE_URL} />);

    expect(screen.getByText('Siap menggambar')).toBeTruthy();
    expect(screen.getByText('MapTiler')).toBeTruthy();
    expect(screen.getByText('Terdaftar')).toBeTruthy();
  });

  it('menandai renderer berbeda yang tidak cocok dengan provider konfigurasi', async () => {
    const renderer: MapRenderer = () => null as never;
    await render(
      <MapStatusCard styleUrl={STYLE_URL} renderer={{ provider: 'stadia', renderer }} />,
    );

    expect(screen.getByText('Renderer tidak cocok')).toBeTruthy();
    expect(screen.getByText(/renderer yang cocok belum terdaftar pada layar ini/)).toBeTruthy();
    expect(screen.getByText('MapTiler')).toBeTruthy();
    expect(screen.getByText('Atribusi wajib')).toBeTruthy();
  });

  it('menandai siap menggambar saat renderer dengan provider cocok terdaftar', async () => {
    const renderer: MapRenderer = () => null as never;
    await render(
      <MapStatusCard styleUrl={STYLE_URL} renderer={{ provider: 'maptiler', renderer }} />,
    );

    expect(screen.getByText('Siap menggambar')).toBeTruthy();
    expect(screen.getByText('Terdaftar')).toBeTruthy();
    expect(screen.queryByText(/renderer peta belum dipasang/)).toBeNull();
  });

  it('menandai URL gaya yang bukan https', async () => {
    await render(<MapStatusCard styleUrl="http://api.maptiler.com/style.json" />);

    expect(screen.getByText('URL gaya tidak sah')).toBeTruthy();
    expect(screen.getByText(/EXPO_PUBLIC_MAP_STYLE_URL harus berupa URL https/)).toBeTruthy();
  });

  it('menandai penyedia yang tidak dikenal', async () => {
    await render(<MapStatusCard styleUrl="https://tiles.example.com/style.json" />);

    expect(screen.getByText('Penyedia tidak dikenal')).toBeTruthy();
    expect(screen.getByText(/atribusi wajibnya tidak dapat ditentukan/)).toBeTruthy();
    expect(screen.queryByText('Penyedia tile')).toBeNull();
  });
});
