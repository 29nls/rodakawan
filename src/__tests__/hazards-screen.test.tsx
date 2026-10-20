import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import HazardsScreen from '@/app/(tabs)/hazards';
import type { HazardRow } from '@/features/hazards/api';
import { createFakeChatClient } from '@/test-support/fakeChatClient';

/**
 * Pengujian layar peringatan.
 *
 * Yang dibuktikan: laporan aktif ditampilkan dengan label area dari koordinat
 * (bukan peta atau nama tempat karangan), filter benar-benar mengubah query,
 * formulir menolak koordinat tidak valid sebelum memanggil backend, dan
 * pengiriman membawa idempotency key tanpa pernah mengirim `expires_at`.
 */

jest.mock('expo-crypto', () => ({ randomUUID: () => 'client-uuid-1' }));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 0, longitude: 0 } })),
}));

// `useFocusEffect` butuh konteks navigator; di sini cukup perilaku muat ulangnya.
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
  };
});

jest.mock('@/features/auth/session', () => {
  // Objek sesi harus stabil: identitas `backend` baru tiap render akan memicu
  // efek muat ulang tanpa henti. Client diambil lewat getter supaya test bisa
  // mengganti isinya sebelum render.
  const backend = {
    available: true as const,
    get client() {
      return globalThis.__fakeChatClient;
    },
  };

  return { useAuthSession: () => ({ backend, userId: 'user-1' }) };
});

declare global {
  // Dipakai oleh mock di atas; diisi di `setup()`.
  var __fakeChatClient: ReturnType<typeof createFakeChatClient>['client'];
}

const NOW = Date.parse('2026-10-20T10:00:00.000Z');

function buildRow(overrides: Partial<HazardRow> = {}): HazardRow {
  return {
    id: 'hazard-1',
    reporter_id: 'user-2',
    ride_id: null,
    category: 'pothole',
    description: 'Lubang besar di lajur kanan',
    severity: 'high',
    latitude: -6.2,
    longitude: 106.8166,
    status: 'active',
    expires_at: '2026-10-20T11:00:00.000Z',
    created_at: '2026-10-20T09:30:00.000Z',
    updated_at: null,
    client_report_id: null,
    ...overrides,
  };
}

function setup(
  options: {
    rows?: HazardRow[];
    rpc?: (call: {
      name: string;
      args: Record<string, unknown>;
    }) => { data?: unknown; error?: unknown } | Promise<{ data?: unknown; error?: unknown }>;
  } = {},
) {
  const fake = createFakeChatClient({
    rows: { hazard_reports: options.rows ?? [] },
    rpc: options.rpc,
  });
  globalThis.__fakeChatClient = fake.client;
  return fake;
}

describe('HazardsScreen', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('menampilkan laporan aktif dengan label area dan menyembunyikan yang kedaluwarsa', async () => {
    setup({
      rows: [
        buildRow(),
        buildRow({
          id: 'hazard-expired',
          description: 'Laporan lama yang sudah lewat',
          expires_at: '2026-10-20T09:31:00.000Z',
        }),
      ],
    });

    await render(<HazardsScreen />);

    expect(await screen.findByText('Lubang besar di lajur kanan')).toBeTruthy();
    expect(screen.getByText(/Area ±1 km · 6,20° LS 106,82° BT/)).toBeTruthy();
    // "Tinggi" muncul di badge kartu dan di pil filter keparahan.
    expect(screen.getAllByText('Tinggi').length).toBeGreaterThan(0);
    expect(screen.getByText('Berakhir dalam 1 jam 0 menit')).toBeTruthy();
    expect(screen.queryByText('Laporan lama yang sudah lewat')).toBeNull();
  });

  it('menerapkan filter kategori ke query berikutnya', async () => {
    const fake = setup({ rows: [buildRow()] });

    await render(<HazardsScreen />);
    await screen.findByText('Lubang besar di lajur kanan');

    await fireEvent.press(screen.getByText('Banjir'));

    await waitFor(() =>
      expect(
        fake.queryCalls.some((call) =>
          call.filters.some((filter) => filter.column === 'category' && filter.value === 'flood'),
        ),
      ).toBe(true),
    );
  });

  it('menolak koordinat tidak valid tanpa memanggil backend', async () => {
    const fake = setup({ rows: [] });

    await render(<HazardsScreen />);
    await fireEvent.press(screen.getByText('Laporkan bahaya jalan'));

    await fireEvent.changeText(screen.getByLabelText('Lintang'), 'bukan-angka');
    await fireEvent.changeText(screen.getByLabelText('Bujur'), '106.8');
    await fireEvent.press(screen.getByText('Kirim laporan'));

    expect(screen.getByText(/Lintang dan bujur harus berupa angka/, { exact: false })).toBeTruthy();
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('mengirim laporan dengan idempotency key dan tanpa expires_at dari klien', async () => {
    const fake = setup({
      rows: [],
      rpc: () => ({ data: buildRow({ reporter_id: 'user-1' }), error: null }),
    });

    await render(<HazardsScreen />);
    await fireEvent.press(screen.getByText('Laporkan bahaya jalan'));

    await fireEvent.changeText(screen.getByLabelText('Lintang'), '-6.2');
    await fireEvent.changeText(screen.getByLabelText('Bujur'), '106.8166');
    await fireEvent.changeText(screen.getByLabelText('Deskripsi (opsional)'), '  Lubang dalam  ');
    await fireEvent.press(screen.getByText('Kirim laporan'));

    await waitFor(() => expect(fake.rpcCalls).toHaveLength(1));
    expect(fake.rpcCalls[0].name).toBe('create_hazard');
    expect(fake.rpcCalls[0].args).toMatchObject({
      p_category: 'pothole',
      p_latitude: -6.2,
      p_longitude: 106.8166,
      p_description: 'Lubang dalam',
      p_client_report_id: 'client-uuid-1',
    });
    expect(Object.keys(fake.rpcCalls[0].args)).not.toContain('p_expires_at');
    expect(await screen.findByText(/Laporan terkirim/)).toBeTruthy();
  });

  it('mengonfirmasi laporan lewat RPC dan menampilkan jumlah konfirmasi', async () => {
    const fake = setup({
      rows: [buildRow()],
      rpc: () => ({ data: 4, error: null }),
    });

    await render(<HazardsScreen />);
    await screen.findByText('Lubang besar di lajur kanan');

    await fireEvent.press(screen.getByText('Masih ada'));

    await waitFor(() => expect(fake.rpcCalls).toHaveLength(1));
    expect(fake.rpcCalls[0]).toEqual({
      name: 'confirm_hazard',
      args: { p_hazard_id: 'hazard-1' },
    });
    expect(await screen.findByText(/Konfirmasi tercatat/)).toBeTruthy();
    expect(screen.getByText(/4 konfirmasi/)).toBeTruthy();
  });

  it('melaporkan penolakan server sebagai banner, bukan sukses', async () => {
    setup({
      rows: [buildRow()],
      rpc: () => ({ data: null, error: { detail: 'hazard_already_confirmed' } }),
    });

    await render(<HazardsScreen />);
    await screen.findByText('Lubang besar di lajur kanan');

    await fireEvent.press(screen.getByText('Masih ada'));

    expect(await screen.findByText('Aksi tidak selesai')).toBeTruthy();
    expect(screen.getByText(/sudah mengonfirmasi/)).toBeTruthy();
  });
});
