import {
  createMotorcycle,
  deleteMotorcycle,
  deletePrivateMotorcycleDetails,
  getPrivateMotorcycleDetails,
  listOwnMotorcycles,
  listPublicMotorcycles,
  savePrivateMotorcycleDetails,
  setPrimaryMotorcycle,
  updateMotorcycle,
  type MotorcycleFormInput,
} from '@/features/garage/api';
import type { MotorcyclePrivateDetailsRow, MotorcycleRow } from '@/lib/supabase/database.types';
import { createQueryClient } from '@/test-support/fakeSupabase';

const SESSION_USER_ID = '11111111-1111-1111-1111-111111111111';
const BIKE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_BIKE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const FORM: MotorcycleFormInput = {
  make: 'Honda',
  model: 'Vario 125',
  modelYear: 2023,
  nickname: null,
  isPrimary: false,
};

function buildMotorcycle(overrides: Partial<MotorcycleRow> = {}): MotorcycleRow {
  return {
    id: BIKE_ID,
    owner_id: SESSION_USER_ID,
    nickname: null,
    make: 'Honda',
    model: 'Vario 125',
    model_year: 2023,
    photo_path: null,
    description: null,
    is_public: true,
    is_primary: false,
    created_at: '2026-10-15T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

function buildPrivateDetails(
  overrides: Partial<MotorcyclePrivateDetailsRow> = {},
): MotorcyclePrivateDetailsRow {
  return {
    motorcycle_id: BIKE_ID,
    owner_id: SESSION_USER_ID,
    plate_number: 'B 1234 XYZ',
    private_notes: null,
    updated_at: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('listOwnMotorcycles', () => {
  it('membatasi query pada owner_id milik sesi dan memetakan ke bentuk ringkas', async () => {
    const { client, log } = createQueryClient({ data: [buildMotorcycle({ is_primary: true })] });

    const result = await listOwnMotorcycles(client, SESSION_USER_ID);

    expect(log.queries[0].table).toBe('motorcycles');
    expect(log.queries[0].filters).toEqual([{ column: 'owner_id', value: SESSION_USER_ID }]);
    expect(log.queries[0].order).toEqual([{ column: 'created_at', ascending: false }]);
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: BIKE_ID,
          make: 'Honda',
          model: 'Vario 125',
          modelYear: 2023,
          nickname: null,
          isPrimary: true,
          isPublic: true,
          photoPath: null,
          createdAt: '2026-10-15T00:00:00.000Z',
        },
      ],
    });
  });
});

describe('listPublicMotorcycles', () => {
  it('hanya mengambil kendaraan yang publik', async () => {
    const { client, log } = createQueryClient({ data: [] });

    await listPublicMotorcycles(client);

    expect(log.queries[0].filters).toEqual([{ column: 'is_public', value: true }]);
  });
});

describe('createMotorcycle', () => {
  it('tidak mengirim id maupun is_public, dan memakai owner dari sesi', async () => {
    const { client, log } = createQueryClient({ data: buildMotorcycle() });

    const result = await createMotorcycle(client, SESSION_USER_ID, FORM);

    expect(log.queries).toHaveLength(1);
    expect(log.queries[0].op).toBe('insert');
    expect(log.queries[0].values).toEqual({
      owner_id: SESSION_USER_ID,
      make: 'Honda',
      model: 'Vario 125',
      model_year: 2023,
      nickname: null,
      is_primary: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(BIKE_ID);
  });

  it('menurunkan primary lama lebih dulu supaya tidak ada dua primary', async () => {
    const { client, log } = createQueryClient([
      { data: null },
      { data: buildMotorcycle({ is_primary: true }) },
    ]);

    await createMotorcycle(client, SESSION_USER_ID, { ...FORM, isPrimary: true });

    expect(log.queries).toHaveLength(2);
    expect(log.queries[0].op).toBe('update');
    expect(log.queries[0].values).toEqual({ is_primary: false, updated_at: expect.any(String) });
    expect(log.queries[0].filters).toEqual([
      { column: 'owner_id', value: SESSION_USER_ID },
      { column: 'is_primary', value: true },
    ]);
    expect(log.queries[1].op).toBe('insert');
    expect(log.queries[1].values).toMatchObject({ is_primary: true });
  });
});

describe('updateMotorcycle', () => {
  it('membatasi update pada id dan owner_id milik sesi', async () => {
    const { client, log } = createQueryClient({ data: buildMotorcycle({ make: 'Yamaha' }) });

    const result = await updateMotorcycle(client, SESSION_USER_ID, BIKE_ID, {
      ...FORM,
      make: 'Yamaha',
    });

    expect(log.queries[0].op).toBe('update');
    expect(log.queries[0].filters).toEqual([
      { column: 'id', value: BIKE_ID },
      { column: 'owner_id', value: SESSION_USER_ID },
    ]);
    expect(log.queries[0].values).toEqual({
      make: 'Yamaha',
      model: 'Vario 125',
      model_year: 2023,
      nickname: null,
      is_primary: false,
      updated_at: expect.any(String),
    });
    expect(result.ok).toBe(true);
  });

  it('melaporkan kendaraan yang bukan milik sesi sebagai error', async () => {
    const { client } = createQueryClient({ error: { code: 'PGRST116', message: 'no rows' } });

    const result = await updateMotorcycle(client, SESSION_USER_ID, OTHER_BIKE_ID, FORM);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
  });
});

describe('setPrimaryMotorcycle', () => {
  it('mengembalikan primary sebelumnya dan menurunkan kendaraan itu lebih dulu', async () => {
    const { client, log } = createQueryClient([
      { data: { id: OTHER_BIKE_ID } },
      { data: null },
      { data: { id: BIKE_ID } },
    ]);

    const result = await setPrimaryMotorcycle(client, SESSION_USER_ID, BIKE_ID);

    expect(log.queries).toHaveLength(3);
    expect(log.queries[0].filters).toEqual([
      { column: 'owner_id', value: SESSION_USER_ID },
      { column: 'is_primary', value: true },
    ]);
    expect(log.queries[1].values).toEqual({ is_primary: false, updated_at: expect.any(String) });
    expect(log.queries[2].filters).toEqual([
      { column: 'id', value: BIKE_ID },
      { column: 'owner_id', value: SESSION_USER_ID },
    ]);
    expect(result).toEqual({ ok: true, data: { set: BIKE_ID, previous: OTHER_BIKE_ID } });
  });

  it('tidak menulis apa pun bila kendaraan itu sudah primary', async () => {
    const { client, log } = createQueryClient({ data: { id: BIKE_ID } });

    const result = await setPrimaryMotorcycle(client, SESSION_USER_ID, BIKE_ID);

    expect(log.queries).toHaveLength(1);
    expect(result).toEqual({ ok: true, data: { set: BIKE_ID, previous: BIKE_ID } });
  });
});

describe('getPrivateMotorcycleDetails', () => {
  it('mengembalikan nilai kosong bila detail belum pernah diisi', async () => {
    const { client, log } = createQueryClient({ data: null });

    const result = await getPrivateMotorcycleDetails(client, SESSION_USER_ID, BIKE_ID);

    expect(log.queries[0].filters).toEqual([
      { column: 'motorcycle_id', value: BIKE_ID },
      { column: 'owner_id', value: SESSION_USER_ID },
    ]);
    expect(result).toEqual({ ok: true, data: { plateNumber: '', privateNotes: '' } });
  });

  it('mengubah kolom null menjadi string kosong', async () => {
    const { client } = createQueryClient({
      data: buildPrivateDetails({ plate_number: null, private_notes: null }),
    });

    const result = await getPrivateMotorcycleDetails(client, SESSION_USER_ID, BIKE_ID);

    expect(result).toEqual({ ok: true, data: { plateNumber: '', privateNotes: '' } });
  });
});

describe('savePrivateMotorcycleDetails', () => {
  it('menyimpan lewat upsert pada motorcycle_id', async () => {
    const { client, log } = createQueryClient({
      data: buildPrivateDetails({ plate_number: null, private_notes: 'Servis rutin' }),
    });

    const result = await savePrivateMotorcycleDetails(client, SESSION_USER_ID, BIKE_ID, {
      plateNumber: '',
      privateNotes: 'Servis rutin',
    });

    expect(log.queries[0].op).toBe('upsert');
    expect(log.queries[0].onConflict).toBe('motorcycle_id');
    expect(log.queries[0].values).toEqual({
      motorcycle_id: BIKE_ID,
      owner_id: SESSION_USER_ID,
      plate_number: '',
      private_notes: 'Servis rutin',
      updated_at: expect.any(String),
    });
    expect(result).toEqual({ ok: true, data: { plateNumber: '', privateNotes: 'Servis rutin' } });
  });
});

describe('deleteMotorcycle', () => {
  it('melaporkan kegagalan bila tidak ada baris yang terhapus', async () => {
    const { client } = createQueryClient({ data: [] });

    const result = await deleteMotorcycle(client, SESSION_USER_ID, OTHER_BIKE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
  });

  it('berhasil bila baris milik sesi benar-benar terhapus', async () => {
    const { client, log } = createQueryClient({ data: [{ id: BIKE_ID }] });

    const result = await deleteMotorcycle(client, SESSION_USER_ID, BIKE_ID);

    expect(log.queries[0].op).toBe('delete');
    expect(log.queries[0].filters).toEqual([
      { column: 'id', value: BIKE_ID },
      { column: 'owner_id', value: SESSION_USER_ID },
    ]);
    expect(result).toEqual({ ok: true, data: { deleted: true } });
  });
});

describe('deletePrivateMotorcycleDetails', () => {
  it('idempoten: tidak ada baris berarti tidak ada yang perlu dihapus', async () => {
    const { client } = createQueryClient({ data: [] });

    const result = await deletePrivateMotorcycleDetails(client, SESSION_USER_ID, BIKE_ID);

    expect(result).toEqual({ ok: true, data: { deleted: false } });
  });

  it('menandai deleted true bila barisnya memang terhapus', async () => {
    const { client } = createQueryClient({ data: [{ motorcycle_id: BIKE_ID }] });

    const result = await deletePrivateMotorcycleDetails(client, SESSION_USER_ID, BIKE_ID);

    expect(result).toEqual({ ok: true, data: { deleted: true } });
  });
});
