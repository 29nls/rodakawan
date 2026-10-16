/**
 * Lapisan API klub.
 *
 * Batas keamanan: RLS di database tetap menjadi otoritas terakhir — pengguna A
 * tidak bisa membaca atau mengubah data pengguna B walau argumen di memori
 * aplikasi dimanipulasi.
 *
 * Pembagian operasinya:
 *
 * - DML langsung hanya untuk yang memang punya policy:
 *   - `clubs_select_public_or_member` — baca klub publik atau klub yang diikuti
 *     (keanggotaan `active`); sejak `20261016100000` klausa `created_by` dihapus,
 *     jadi mantan anggota tidak lagi mempertahankan akses;
 *   - `clubs_update_admin` — ubah klub oleh owner/admin aktif (`is_club_admin`);
 *   - `club_members_select_self_or_member` — baca baris keanggotaan sendiri atau
 *     baris anggota klub yang diikuti.
 * - Mutasi keanggotaan **hanya** lewat RPC `security definer`
 *   (`20261016093000_club_membership_rpc.sql`): `create_club`,
 *   `request_club_membership`, `review_club_membership`, `set_club_member_role`,
 *   `remove_club_member`, `leave_club`. Tidak ada policy INSERT/UPDATE/DELETE pada
 *   `public.club_members` (dan tidak ada policy INSERT pada `public.clubs`),
 *   sehingga klien tidak punya jalur tulis langsung — jangan menambahkannya di
 *   sini. Aturan otorisasi (owner terakhir, hanya owner yang mengubah peran,
 *   `invite_only`, dll.) dijaga di database dan dilaporkan sebagai
 *   `AppError` lewat `mapRpcError`, bukan sebagai sukses palsu.
 *
 * Hasil RPC dibaca sebagai nilai balik fungsi: status keanggotaan (`text`) atau
 * baris klub (`jsonb` untuk `create_club`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  mapRpcError,
  mapTableError,
  ROW_NOT_APPLIED_ERROR,
  type AppError,
} from '@/features/auth/errors';
import {
  clubSlugFromName,
  descriptionError,
  nameError,
  normalizeClubName,
} from '@/features/clubs/validation';
import type {
  ClubJoinPolicy,
  ClubMemberRole,
  ClubMemberRow,
  ClubMemberStatus,
  ClubMembershipOutcome,
  ClubRow,
  ClubVisibility,
  Database,
} from '@/lib/supabase/database.types';

export type ClubClient = SupabaseClient<Database>;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Baris `public.clubs` apa adanya; kolomnya sudah sama dengan yang dipakai layar. */
export type Club = ClubRow;

export type ClubFormInput = {
  name: string;
  description: string | null;
  visibility: ClubVisibility;
  join_policy: ClubJoinPolicy;
};

export type ClubDetail = {
  club: Club;
  /** `true` hanya bila keanggotaan sudah berstatus `active`. */
  isMember: boolean;
  /** `true` bila keanggotaan `active` dan perannya owner/admin. */
  isAdmin: boolean;
  myRole: ClubMemberRole | null;
  memberStatus: ClubMemberStatus | null;
};

function invalidData(message: string): AppError {
  return { code: 'invalid_data', message, retryable: false };
}

/** Daftar klub publik, terbaru lebih dulu. */
export async function listClubs(client: ClubClient): Promise<ApiResult<Club[]>> {
  const { data, error } = await client
    .from('clubs')
    .select('*')
    .eq('visibility', 'public')
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data };
}

/**
 * Detail klub beserta status keanggotaan pengguna yang sedang masuk.
 * `userId` `null` berarti belum masuk: hanya klub publik yang bisa dibaca.
 */
export async function getClubDetails(
  client: ClubClient,
  clubId: string,
  userId: string | null,
): Promise<ApiResult<ClubDetail>> {
  const { data: club, error } = await client
    .from('clubs')
    .select('*')
    .eq('id', clubId)
    .maybeSingle();

  if (error) return { ok: false, error: mapTableError(error) };

  if (!club) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message:
          'Klub ini tidak ditemukan, atau bersifat privat dan bukan klub Anda. Periksa kembali tautannya.',
        retryable: false,
      },
    };
  }

  let membership: Pick<ClubMemberRow, 'role' | 'status'> | null = null;

  if (userId) {
    const { data, error: membershipError } = await client
      .from('club_members')
      .select('role, status')
      .eq('club_id', clubId)
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipError) return { ok: false, error: mapTableError(membershipError) };

    membership = data;
  }

  const memberStatus = membership?.status ?? null;
  const isMember = memberStatus === 'active';

  return {
    ok: true,
    data: {
      club,
      isMember,
      isAdmin: isMember && (membership?.role === 'owner' || membership?.role === 'admin'),
      myRole: membership?.role ?? null,
      memberStatus,
    },
  };
}

/** Anggota sebuah klub; hanya terbaca bila pemanggil anggota/admin klub tersebut. */
export async function listClubMembers(
  client: ClubClient,
  clubId: string,
): Promise<ApiResult<ClubMemberRow[]>> {
  const { data, error } = await client
    .from('club_members')
    .select('*')
    .eq('club_id', clubId)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data };
}

/**
 * Mengubah data klub. Hanya berlaku bagi admin/owner; policy
 * `clubs_update_admin` menolak pengguna lain, dan penolakan itu dilaporkan
 * sebagai error (bukan sukses palsu) karena baris hasil ditunggu.
 *
 * `slug` sengaja tidak ikut berubah saat nama diganti supaya tautan lama tetap
 * berfungsi; `updated_at` dikirim eksplisit karena trigger `touch_updated_at`
 * hanya dipasang pada `public.profiles`.
 */
export async function updateClub(
  client: ClubClient,
  clubId: string,
  input: Partial<ClubFormInput>,
): Promise<ApiResult<Club>> {
  const payload: {
    name?: string;
    description?: string | null;
    visibility?: ClubVisibility;
    join_policy?: ClubJoinPolicy;
    updated_at?: string;
  } = {};

  if (input.name !== undefined) {
    const problem = nameError(input.name);
    if (problem) return { ok: false, error: invalidData(problem) };

    payload.name = normalizeClubName(input.name);
  }

  if (input.description !== undefined) {
    const problem = descriptionError(input.description);
    if (problem) return { ok: false, error: invalidData(problem) };

    payload.description = input.description === null ? null : input.description.trim();
  }

  if (input.visibility !== undefined) payload.visibility = input.visibility;
  if (input.join_policy !== undefined) payload.join_policy = input.join_policy;

  if (Object.keys(payload).length === 0) {
    return { ok: false, error: invalidData('Tidak ada perubahan yang dikirim untuk klub ini.') };
  }

  payload.updated_at = new Date().toISOString();

  const { data, error } = await client
    .from('clubs')
    .update(payload)
    .eq('id', clubId)
    .select('*')
    .single();

  if (error) {
    // PGRST116 = 0 baris terpengaruh. Untuk update klub artinya policy menolak.
    if (error.code === 'PGRST116') return { ok: false, error: ROW_NOT_APPLIED_ERROR };

    return { ok: false, error: mapTableError(error) };
  }

  return { ok: true, data };
}

/* ------------------------------------------------------------------ mutasi RPC */

/** Hasil satu operasi keanggotaan yang dikembalikan RPC. */
export type MembershipOutcome = ClubMembershipOutcome;

/**
 * Keanggotaan pengguna yang sedang masuk pada semua klub.
 *
 * Dipakai layar jelajah untuk membedakan "belum bergabung", "menunggu", dan
 * "anggota" tanpa harus memanggil detail satu per satu. Policy
 * `club_members_select_self_or_member` mengizinkan baris ini dibaca, dan filter
 * `user_id` di bawah selalu diisi dari sesi — bukan dari masukan UI.
 */
export async function listMyClubMemberships(
  client: ClubClient,
  userId: string,
): Promise<ApiResult<ClubMemberRow[]>> {
  const { data, error } = await client.from('club_members').select('*').eq('user_id', userId);

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data };
}

/**
 * Membuat klub baru. Slug diturunkan dari nama memakai validator yang sudah diuji
 * (`clubSlugFromName`); bila slug itu sudah dipakai, database menambahkan akhiran
 * angka sendiri sehingga nama klub yang sama tidak menimpa klub lama.
 */
export async function createClub(
  client: ClubClient,
  input: ClubFormInput,
): Promise<ApiResult<Club>> {
  const problem = nameError(input.name);
  if (problem) return { ok: false, error: invalidData(problem) };

  const descriptionProblem = descriptionError(input.description);
  if (descriptionProblem) return { ok: false, error: invalidData(descriptionProblem) };

  const { data, error } = await client.rpc('create_club', {
    p_name: normalizeClubName(input.name),
    p_slug: clubSlugFromName(input.name),
    p_description: input.description === null ? null : input.description.trim(),
    p_visibility: input.visibility,
    p_join_policy: input.join_policy,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  if (!data || typeof data.id !== 'string') {
    return {
      ok: false,
      error: invalidData('Backend tidak mengembalikan data klub yang baru dibuat.'),
    };
  }

  return { ok: true, data };
}

/**
 * Mengajukan keanggotaan ke sebuah klub.
 *
 * Hasilnya ditentukan database: `active` (klub publik dengan kebijakan `open`),
 * `pending` (perlu persetujuan, termasuk klub privat), atau `active` juga bila
 * pengguna memang sudah menjadi anggota. Klub `invite_only` ditolak sebagai
 * `not_authorized`, bukan dipaksa menjadi `pending`.
 */
export async function requestClubMembership(
  client: ClubClient,
  clubId: string,
): Promise<ApiResult<MembershipOutcome>> {
  const { data, error } = await client.rpc('request_club_membership', { p_club_id: clubId });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

/** Menyetujui atau menolak permintaan gabung. Hanya owner/admin aktif klub itu. */
export async function reviewClubMembership(
  client: ClubClient,
  clubId: string,
  userId: string,
  approve: boolean,
): Promise<ApiResult<MembershipOutcome>> {
  const { data, error } = await client.rpc('review_club_membership', {
    p_club_id: clubId,
    p_user_id: userId,
    p_approve: approve,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

/** Mengubah peran anggota. Hanya owner; owner terakhir tidak dapat diturunkan. */
export async function setClubMemberRole(
  client: ClubClient,
  clubId: string,
  userId: string,
  role: ClubMemberRole,
): Promise<ApiResult<ClubMemberRole>> {
  const { data, error } = await client.rpc('set_club_member_role', {
    p_club_id: clubId,
    p_user_id: userId,
    p_role: role,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

/** Mengeluarkan anggota aktif. Owner tidak dapat dikeluarkan; admin hanya oleh owner. */
export async function removeClubMember(
  client: ClubClient,
  clubId: string,
  userId: string,
): Promise<ApiResult<MembershipOutcome>> {
  const { data, error } = await client.rpc('remove_club_member', {
    p_club_id: clubId,
    p_user_id: userId,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}

/**
 * Keluar dari klub (atau membatalkan permintaan yang masih menunggu).
 * Mengembalikan `cancelled` saat permintaan dibatalkan dan `left` saat
 * keanggotaan aktif berakhir; owner selalu diminta mengalihkan kepemilikan dulu.
 */
export async function leaveClub(
  client: ClubClient,
  clubId: string,
): Promise<ApiResult<MembershipOutcome>> {
  const { data, error } = await client.rpc('leave_club', { p_club_id: clubId });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data };
}
