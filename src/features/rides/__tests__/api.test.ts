import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createRide,
  findRideInvitee,
  getRideDetails,
  listRides,
  publishRideLocation,
  setRideLocationSharing,
  subscribeRideLocations,
  type RideClient,
} from '@/features/rides/api';
import type {
  Database,
  RideLocationRow,
  RideMemberRow,
  RideRow,
} from '@/lib/supabase/database.types';
import { createQueryClient } from '@/test-support/fakeSupabase';

const RIDE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLUB_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_ID = '11111111-1111-1111-1111-111111111111';

function buildRide(overrides: Partial<RideRow> = {}): RideRow {
  return {
    id: RIDE_ID,
    club_id: CLUB_ID,
    created_by: USER_ID,
    title: 'Kopdar Sabtu',
    description: null,
    activity_type: 'motorcycle',
    status: 'planned',
    visibility: 'club',
    starts_at: '2026-10-20T12:30:00.000Z',
    meeting_label: 'Alun-alun',
    meeting_lat: null,
    meeting_lng: null,
    destination_label: 'Puncak',
    destination_lat: null,
    destination_lng: null,
    invite_code: null,
    started_at: null,
    ended_at: null,
    created_at: '2026-10-19T00:00:00.000Z',
    updated_at: '2026-10-19T00:00:00.000Z',
    ...overrides,
  };
}

function buildMember(overrides: Partial<RideMemberRow> = {}): RideMemberRow {
  return {
    ride_id: RIDE_ID,
    user_id: USER_ID,
    role: 'host',
    status: 'joined',
    joined_at: '2026-10-19T00:00:00.000Z',
    last_seen_at: null,
    sharing_location: false,
    created_at: '2026-10-19T00:00:00.000Z',
    updated_at: '2026-10-19T00:00:00.000Z',
    ...overrides,
  };
}

function buildLocation(overrides: Partial<RideLocationRow> = {}): RideLocationRow {
  return {
    ride_id: RIDE_ID,
    user_id: USER_ID,
    latitude: -6.2,
    longitude: 106.8,
    accuracy_m: 12,
    heading_deg: null,
    speed_mps: null,
    recorded_at: '2026-10-19T10:00:00.000Z',
    updated_at: '2026-10-19T10:00:00.000Z',
    ...overrides,
  };
}

function attachRpc(
  client: SupabaseClient<Database>,
  implementation: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): jest.Mock {
  const rpc = jest.fn(implementation);
  (client as unknown as { rpc: jest.Mock }).rpc = rpc;
  return rpc;
}

describe('listRides', () => {
  it('membaca perjalanan beserta klub dan mengurutkan jadwal', async () => {
    const ride = {
      ...buildRide(),
      clubs: { id: CLUB_ID, name: 'Touring Malam', visibility: 'public' },
    };
    const { client, log } = createQueryClient({ data: [ride] });

    const result = await listRides(client as RideClient);

    expect(log.queries[0]).toEqual({
      table: 'rides',
      op: 'select',
      columns: '*, clubs(id, name, visibility)',
      values: null,
      onConflict: null,
      filters: [],
      order: [{ column: 'starts_at', ascending: true }],
    });
    expect(result).toEqual({ ok: true, data: [ride] });
  });

  it('memetakan penolakan RLS menjadi error yang jelas', async () => {
    const { client } = createQueryClient({ error: { code: '42501', message: 'denied' } });

    const result = await listRides(client as RideClient);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
  });
});

describe('getRideDetails', () => {
  it('menggabungkan perjalanan, peserta, lokasi, dan keanggotaan sesi', async () => {
    const ride = {
      ...buildRide(),
      clubs: { id: CLUB_ID, name: 'Touring Malam', visibility: 'public' },
    };
    const member = {
      ...buildMember({ sharing_location: true }),
      profiles: { id: USER_ID, username: 'uji_user', display_name: 'Uji User', avatar_url: null },
    };
    const location = buildLocation();
    const { client, log } = createQueryClient([
      { data: ride },
      { data: [member] },
      { data: [location] },
    ]);

    const result = await getRideDetails(client as RideClient, RIDE_ID, USER_ID);

    expect(log.queries[1].table).toBe('ride_members');
    expect(log.queries[1].filters).toEqual([{ column: 'ride_id', value: RIDE_ID }]);
    expect(log.queries[2].table).toBe('ride_locations');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.myMembership?.user_id).toBe(USER_ID);
      expect(result.data.locations).toEqual([location]);
    }
  });

  it('mengembalikan not_found bila perjalanan tidak terlihat', async () => {
    const { client } = createQueryClient({ data: null });

    const result = await getRideDetails(client as RideClient, RIDE_ID, USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });
});

describe('createRide', () => {
  it('menolak judul pendek tanpa memanggil backend', async () => {
    const { client } = createQueryClient({ data: null });
    const rpc = attachRpc(client, async () => ({ data: null, error: null }));

    const result = await createRide(client as RideClient, {
      clubId: CLUB_ID,
      title: 'ab',
      description: null,
      startsAt: null,
      meetingLabel: null,
      destinationLabel: null,
      visibility: 'club',
    });

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('memanggil RPC dengan nilai yang sudah dirapikan', async () => {
    const ride = buildRide();
    const { client } = createQueryClient({ data: null });
    const rpc = attachRpc(client, async () => ({ data: ride, error: null }));

    const result = await createRide(client as RideClient, {
      clubId: CLUB_ID,
      title: '  Kopdar Sabtu  ',
      description: '  Kumpul pagi  ',
      startsAt: '2026-10-20T12:30:00.000Z',
      meetingLabel: '  Alun-alun  ',
      destinationLabel: '  Puncak  ',
      visibility: 'club',
    });

    expect(rpc).toHaveBeenCalledWith('create_ride', {
      p_club_id: CLUB_ID,
      p_title: 'Kopdar Sabtu',
      p_starts_at: '2026-10-20T12:30:00.000Z',
      p_description: 'Kumpul pagi',
      p_meeting_label: 'Alun-alun',
      p_destination_label: 'Puncak',
      p_visibility: 'club',
    });
    expect(result).toEqual({ ok: true, data: ride });
  });
});

describe('publishRideLocation', () => {
  it('memakai auth.uid di server dan tidak mengirim user_id dari klien', async () => {
    const location = buildLocation();
    const { client } = createQueryClient({ data: null });
    const rpc = attachRpc(client, async () => ({ data: location, error: null }));

    const result = await publishRideLocation(client as RideClient, RIDE_ID, {
      latitude: -6.2,
      longitude: 106.8,
      accuracy: 12,
      heading: null,
      speed: null,
      recordedAt: '2026-10-19T10:00:00.000Z',
    });

    expect(rpc).toHaveBeenCalledWith('publish_ride_location', {
      p_ride_id: RIDE_ID,
      p_latitude: -6.2,
      p_longitude: 106.8,
      p_accuracy_m: 12,
      p_heading_deg: null,
      p_speed_mps: null,
      p_recorded_at: '2026-10-19T10:00:00.000Z',
    });
    expect(result.ok).toBe(true);
  });
});

describe('setRideLocationSharing', () => {
  it('mengirim consent eksplisit untuk perjalanan', async () => {
    const { client } = createQueryClient({ data: null });
    const rpc = attachRpc(client, async () => ({ data: true, error: null }));

    const result = await setRideLocationSharing(client as RideClient, RIDE_ID, true);

    expect(rpc).toHaveBeenCalledWith('set_ride_location_sharing', {
      p_ride_id: RIDE_ID,
      p_enabled: true,
    });
    expect(result).toEqual({ ok: true, data: true });
  });
});

describe('findRideInvitee', () => {
  it('menormalkan username dan tidak mencari bila kosong', async () => {
    const { client, log } = createQueryClient({ data: null });

    const empty = await findRideInvitee(client as RideClient, '  ');
    expect(empty).toEqual({ ok: true, data: null });
    expect(log.queries).toHaveLength(0);

    await findRideInvitee(client as RideClient, ' @Budi_Solo ');
    expect(log.queries[0].filters).toEqual([{ column: 'username', value: 'budi_solo' }]);
  });
});

describe('subscribeRideLocations', () => {
  it('berlangganan Postgres Changes pada ride_id dan dapat berhenti', () => {
    let handler: ((payload: { new: RideLocationRow }) => void) | undefined;
    const channel: { on: jest.Mock; subscribe: jest.Mock } = {
      on: jest.fn((_event: string, _config: unknown, callback: typeof handler) => {
        handler = callback;
        return channel;
      }),
      subscribe: jest.fn((callback?: (status: string) => void) => {
        callback?.('SUBSCRIBED');
        return channel;
      }),
    };
    const removeChannel = jest.fn(async () => 'ok');
    const client = {
      channel: jest.fn(() => channel),
      removeChannel,
    } as unknown as RideClient;

    const onLocation = jest.fn();
    const onStatus = jest.fn();
    const subscription = subscribeRideLocations(client, RIDE_ID, onLocation, onStatus);

    expect(client.channel).toHaveBeenCalledWith(`ride-locations:${RIDE_ID}`);
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'ride_locations',
        filter: `ride_id=eq.${RIDE_ID}`,
      },
      expect.any(Function),
    );
    expect(onStatus).toHaveBeenCalledWith('SUBSCRIBED');

    const location = buildLocation();
    handler?.({ new: location });
    expect(onLocation).toHaveBeenCalledWith(location);

    subscription.unsubscribe();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
