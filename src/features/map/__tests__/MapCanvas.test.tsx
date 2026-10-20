import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { MapCanvas } from '@/features/map/MapCanvas';
import {
  MAP_ATTRIBUTION,
  resolveMapRenderState,
  type MapMarker,
  type MapRenderer,
} from '@/features/map/provider';

const MARKER: MapMarker = {
  userId: '11111111-1111-1111-1111-111111111111',
  label: 'Budi',
  latitude: -6.2,
  longitude: 106.8,
  accuracyM: 12,
  recordedAt: '2026-10-20T09:59:40.000Z',
  freshness: 'live',
};

const STYLE_URL = 'https://api.maptiler.com/maps/streets/style.json?key=uji';

describe('MapCanvas', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('menampilkan alasan eksplisit dan tidak menggambar peta saat belum dikonfigurasi', async () => {
    await render(
      <MapCanvas markers={[MARKER]} state={resolveMapRenderState({ styleUrl: undefined })} />,
    );

    expect(screen.getByTestId('map-notice')).toBeTruthy();
    expect(screen.getByText(/Peta belum dikonfigurasi untuk build ini/)).toBeTruthy();
    expect(screen.queryByTestId('map-attribution')).toBeNull();
  });

  it('tidak menampilkan atribusi ketika gaya sudah ada tetapi renderer belum dipasang', async () => {
    await render(
      <MapCanvas markers={[MARKER]} state={resolveMapRenderState({ styleUrl: STYLE_URL })} />,
    );

    expect(screen.getByText(/renderer peta belum dipasang di build ini/)).toBeTruthy();
    // Atribusi hanya untuk tile yang benar-benar digambar.
    expect(screen.queryByTestId('map-attribution')).toBeNull();
  });

  it('meneruskan marker, region, dan atribusi ke renderer yang terdaftar', async () => {
    const renderer = jest.fn<ReturnType<MapRenderer>, Parameters<MapRenderer>>(() => null as never);
    const state = resolveMapRenderState({
      styleUrl: STYLE_URL,
      renderer: { provider: 'maptiler', renderer },
    });

    await render(<MapCanvas markers={[MARKER]} state={state} />);

    expect(renderer).toHaveBeenCalledTimes(1);
    expect(renderer).toHaveBeenCalledWith({
      styleUrl: STYLE_URL,
      markers: [MARKER],
      attribution: MAP_ATTRIBUTION.maptiler,
      initialRegion: {
        latitude: -6.2,
        longitude: 106.8,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
    });

    expect(screen.queryByTestId('map-notice')).toBeNull();
    expect(screen.getByTestId('map-attribution')).toBeTruthy();
    expect(screen.getByText('© MapTiler')).toBeTruthy();
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
  });

  it('membuka halaman lisensi saat baris atribusi ditekan', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const state = resolveMapRenderState({
      styleUrl: STYLE_URL,
      renderer: { provider: 'maptiler', renderer: () => null as never },
    });

    await render(<MapCanvas markers={[]} state={state} />);

    await fireEvent.press(screen.getByLabelText('© OpenStreetMap contributors'));

    expect(openURL).toHaveBeenCalledWith('https://www.openstreetmap.org/copyright');
  });

  it('mengirim region null bila tidak ada marker', async () => {
    const renderer = jest.fn<ReturnType<MapRenderer>, Parameters<MapRenderer>>(() => null as never);
    const state = resolveMapRenderState({
      styleUrl: STYLE_URL,
      renderer: { provider: 'maptiler', renderer },
    });

    await render(<MapCanvas markers={[]} state={state} />);

    expect(renderer).toHaveBeenCalledWith(expect.objectContaining({ initialRegion: null }));
  });
});
