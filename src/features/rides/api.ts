/**
 * Lapisan API perjalanan.
 *
 * Batas keamanan tetap RLS/RPC di database. Fungsi di sini tidak pernah
 * mengirim `user_id` untuk lokasi (server memakai `auth.uid()`), tidak pernah
 * mengaktifkan consent secara otomatis, dan tidak menyembunyikan kegagalan RPC
 * sebagai sukses palsu.
 *
 * Lokasi dibaca lewat `ride_locations` yang policy SELECT-nya hanya terbuka
 * untuk anggota aktif ride. Realtime memakai Postgres Changes pada tabel itu,
 * sehingga baris yang tidak boleh dibaca tidak pernah terkirim ke perangkat.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { mapRpcError, mapTableError, type AppError } from '@/features/auth/errors';
import { rideDescriptionError, rideLabelError, rideTitleError } from '@/features/rides/validation';
import type {
  ClubVisibility,
  Database,
  ProfileRow,
  RideLocationRow,
  RideMemberRow,
  RideMemberStatus,
  RideRow,
  RideVisibility,
} from '@/lib/supabase/database.types';

export type RideClient = SupabaseClient<Database>;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

export type RideClubSummary = {
  id: string;
  name: string;
  visibility: ClubVisibility;
};

export type RideWithClub = RideRow & { clubs: RideClubSummary | null };

export type RideMemberWithProfile = RideMemberRow & {
  profiles: Pick<ProfileRow, 'id' | 'username' | 'display_name' | 'avatar_url'> | null;
};

export type RideDetails = {
  ride: RideWithClub;
  members: RideMemberWithProfile[];
  locations: RideLocationRow[];
  myMembership: RideMemberWithProfile | null;
};

export type RideFormInput = {
  clubId: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  meetingLabel: string | null;
  destinationLabel: string | null;
  visibility: RideVisibility;
};

export type MembershipOutcome = Extract<
  RideMemberStatus,
  'joined' | 'invited' | 'left' | 'removed'
>;

function invalidData(message: string): AppError {
  return { code: 'invalid_data', message, retryable: false };
}

function validateRideInput(input: RideFormInput): AppError | null {
  const title = rideTitleError(input.title);
  if (title) return invalidData(title);

  if (input.clubId.trim().length === 0) {
    return invalidData('Pilih klub untuk perjalanan ini.');
  }

  if (input.description) {
    const description = rideDescriptionError(input.description);
    if (description) return invalidData(description);
  }

  if (input.meetingLabel) {
    const meeting = rideLabelError(input.meetingLabel, 'Titik kumpul');
    if (meeting) return invalidData(meeting);
  }

  if (input.destinationLabel) {
    const destination = rideLabelError(input.destinationLabel, 'Tujuan');
    if (destination) return invalidData(destination);
  }

  if (input.startsAt !== null && Number.isNaN(Date.parse(input.startsAt))) {
    return invalidData('Jadwal perjalanan tidak valid.');
  }

  return null;
}

/** Perjalanan yang terlihat oleh sesi ini (RLS), terbaru lebih dulu. */
export async function listRides(client: RideClient): Promise<ApiResult<RideWithClub[]>> {
  const { data, error } = await client
    .from('rides')
    .select('*, clubs(id, name, visibility)')
    .order('starts_at', { ascending: true, nullsFirst: false })
    .limit(50);

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data: (data ?? []) as unknown as RideWithClub[] };
}

/** Klub tempat pengguna aktif — sumber pilihan pada formulir buat perjalanan. */
export async function listMyActiveClubs(
  client: RideClient,
  userId: string,
): Promise<ApiResult<RideClubSummary[]>> {
  const { data: memberships, error } = await client
    .from('club_members')
    .select('club_id')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) return { ok: false, error: mapTableError(error) };

  const ids = (memberships ?? []).map((row) => row.club_id);
  if (ids.length === 0) return { ok: true, data: [] };

  const { data, error: clubsError } = await client
    .from('clubs')
    .select('id, name, visibility')
    .in('id', ids)
    .order('name', { ascending: true });

  if (clubsError) return { ok: false, error: mapTableError(clubsError) };

  return {
    ok: true,
    data: (data ?? []).map((club) => ({
      id: club.id,
      name: club.name,
      visibility: club.visibility as ClubVisibility,
    })),
  };
}

/** Detail lengkap: perjalanan, peserta, lokasi terakhir, dan keanggotaan saya. */
export async function getRideDetails(
  client: RideClient,
  rideId: string,
  userId: string,
): Promise<ApiResult<RideDetails>> {
  const { data: ride, error } = await client
    .from('rides')
    .select('*, clubs(id, name, visibility)')
    .eq('id', rideId)
    .maybeSingle();

  if (error) return { ok: false, error: mapTableError(error) };

  if (!ride) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message:
          'Perjalanan ini tidak ditemukan, atau bukan perjalanan klub yang boleh Anda lihat. Periksa kembali tautannya.',
        retryable: false,
      },
    };
  }

  const { data: members, error: membersError } = await client
    .from('ride_members')
    .select('*, profiles(id, username, display_name, avatar_url)')
    .eq('ride_id', rideId)
    .order('joined_at', { ascending: true, nullsFirst: false });

  if (membersError) return { ok: false, error: mapTableError(membersError) };

  const { data: locations, error: locationsError } = await client
    .from('ride_locations')
    .select('*')
    .eq('ride_id', rideId);

  if (locationsError) return { ok: false, error: mapTableError(locationsError) };

  const typedMembers = (members ?? []) as unknown as RideMemberWithProfile[];

  return {
    ok: true,
    data: {
      ride: ride as unknown as RideWithClub,
      members: typedMembers,
      locations: locations ?? [],
      myMembership: typedMembers.find((member) => member.user_id === userId) ?? null,
    },
  };
}

export async function createRide(
  client: RideClient,
  input: RideFormInput,
): Promise<ApiResult<RideRow>> {
  const problem = validateRideInput(input);
  if (problem) return { ok: false, error: problem };

  const { data, error } = await client.rpc('create_ride', {
    p_club_id: input.clubId,
    p_title: input.title.trim(),
    p_starts_at: input.startsAt,
    p_description: input.description?.trim() || null,
    p_meeting_label: input.meetingLabel?.trim() || null,
    p_destination_label: input.destinationLabel?.trim() || null,
    p_visibility: input.visibility,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

export async function updateRide(
  client: RideClient,
  rideId: string,
  input: Omit<RideFormInput, 'clubId' | 'visibility'>,
): Promise<ApiResult<RideRow>> {
  const title = rideTitleError(input.title);
  if (title) return { ok: false, error: invalidData(title) };

  const { data, error } = await client.rpc('update_ride', {
    p_ride_id: rideId,
    p_title: input.title.trim(),
    p_starts_at: input.startsAt,
    p_description: input.description?.trim() || null,
    p_meeting_label: input.meetingLabel?.trim() || null,
    p_destination_label: input.destinationLabel?.trim() || null,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

export async function transitionRide(
  client: RideClient,
  rideId: string,
  next: 'active' | 'completed' | 'cancelled',
): Promise<ApiResult<RideRow>> {
  const { data, error } = await client.rpc('transition_ride', {
    p_ride_id: rideId,
    p_next: next,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

export async function joinRide(
  client: RideClient,
  rideId: string,
): Promise<ApiResult<MembershipOutcome>> {
  const { data, error } = await client.rpc('join_ride', { p_ride_id: rideId });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

export async function leaveRide(
  client: RideClient,
  rideId: string,
): Promise<ApiResult<MembershipOutcome>> {
  const { data, error } = await client.rpc('leave_ride', { p_ride_id: rideId });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

export async function inviteRideMember(
  client: RideClient,
  rideId: string,
  userId: string,
): Promise<ApiResult<MembershipOutcome>> {
  const { data, error } = await client.rpc('invite_ride_member', {
    p_ride_id: rideId,
    p_user_id: userId,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

export async function acceptRideInvite(
  client: RideClient,
  rideId: string,
): Promise<ApiResult<MembershipOutcome>> {
  const { data, error } = await client.rpc('accept_ride_invite', { p_ride_id: rideId });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

export async function removeRideMember(
  client: RideClient,
  rideId: string,
  userId: string,
): Promise<ApiResult<MembershipOutcome>> {
  const { data, error } = await client.rpc('remove_ride_member', {
    p_ride_id: rideId,
    p_user_id: userId,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

/** Consent per perjalanan. Bukan izin OS — keduanya diperiksa terpisah. */
export async function setRideLocationSharing(
  client: RideClient,
  rideId: string,
  enabled: boolean,
): Promise<ApiResult<boolean>> {
  const { data, error } = await client.rpc('set_ride_location_sharing', {
    p_ride_id: rideId,
    p_enabled: enabled,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

export type PublishLocationInput = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
};

export async function publishRideLocation(
  client: RideClient,
  rideId: string,
  input: PublishLocationInput,
): Promise<ApiResult<RideLocationRow>> {
  const { data, error } = await client.rpc('publish_ride_location', {
    p_ride_id: rideId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_accuracy_m: input.accuracy,
    p_heading_deg: input.heading,
    p_speed_mps: input.speed,
    p_recorded_at: input.recordedAt,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

export async function listRideLocations(
  client: RideClient,
  rideId: string,
): Promise<ApiResult<RideLocationRow[]>> {
  const { data, error } = await client.from('ride_locations').select('*').eq('ride_id', rideId);

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data: data ?? [] };
}

/** Cari profil berdasarkan username untuk diundang. Profil privat tidak terlihat. */
export async function findRideInvitee(
  client: RideClient,
  username: string,
): Promise<ApiResult<Pick<ProfileRow, 'id' | 'username' | 'display_name'> | null>> {
  const normalized = username.trim().toLowerCase().replace(/^@/, '');
  if (normalized.length === 0) return { ok: true, data: null };

  const { data, error } = await client
    .from('profiles')
    .select('id, username, display_name')
    .eq('username', normalized)
    .maybeSingle();

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data };
}

export type RideLocationSubscription = {
  unsubscribe: () => void;
};

/**
 * Langganan Postgres Changes untuk satu perjalanan.
 *
 * RLS `ride_locations_select_active_member` menjadi gerbangnya: non-anggota,
 * peserta yang keluar, dan `anon` tidak menerima baris. Tidak ada kanal publik
 * dan tidak ada Broadcast koordinat.
 */
export function subscribeRideLocations(
  client: RideClient,
  rideId: string,
  onLocation: (location: RideLocationRow) => void,
  onStatusChange?: (status: string) => void,
): RideLocationSubscription {
  const channel = client
    .channel(`ride-locations:${rideId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'ride_locations',
        filter: `ride_id=eq.${rideId}`,
      },
      (payload) => {
        const next = payload.new as RideLocationRow | undefined;
        if (next && next.ride_id === rideId) onLocation(next);
      },
    )
    .subscribe((status) => onStatusChange?.(status));

  return {
    unsubscribe: () => {
      void client.removeChannel(channel);
    },
  };
}
