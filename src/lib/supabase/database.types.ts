/**
 * Tipe database Supabase untuk kebutuhan aplikasi.
 *
 * `./database.generated.ts` adalah hasil `supabase gen types` dan menjadi satu-satunya
 * sumber kebenaran bentuk tabel, kolom, dan signature RPC. Jangan menulis tabel atau
 * RPC manual di sini.
 *
 * Berkas ini hanya menambahkan hal yang tidak bisa diketahui generator:
 * - union nilai yang sebenarnya dijaga `CHECK` constraint di database (visibilitas,
 *   kebijakan gabung, peran, status, aksi audit) — generator melihatnya sebagai `text`;
 * - bentuk balik RPC yang dipakai aplikasi (status keanggotaan, baris klub);
 * - `club_role_audit` yang tidak punya jalur tulis klien, sehingga `Insert`/`Update`
 *   sengaja dibuat `never` walau generator menghasilkan bentuk tabel biasa.
 *
 * Setelah mengubah skema (`supabase/migrations/**`):
 *
 *   npm run db:types          # tulis ulang database.generated.ts
 *   npm run typecheck         # pastikan pemakaian di aplikasi masih cocok
 *
 * `npm run db:types:check` dijalankan CI dan gagal bila berkas generated tertinggal
 * dari skema database.
 */

import type { Database as GeneratedDatabase, Json } from './database.generated';

export type { Json };

type GeneratedPublic = GeneratedDatabase['public'];
type GeneratedTables = GeneratedPublic['Tables'];
type GeneratedFunctions = GeneratedPublic['Functions'];

/* ------------------------------------------------------------------ profiles */

export type ProfileRow = GeneratedTables['profiles']['Row'];
export type ProfileInsert = GeneratedTables['profiles']['Insert'];
export type ProfileUpdate = GeneratedTables['profiles']['Update'];

/* --------------------------------------------------------------------- clubs */

export type ClubVisibility = 'public' | 'private';
export type ClubJoinPolicy = 'open' | 'approval' | 'invite_only';
export type ClubMemberRole = 'owner' | 'admin' | 'member';
export type ClubMemberStatus = 'pending' | 'active' | 'rejected' | 'removed' | 'left';

/**
 * Jejak audit perubahan keanggotaan klub (Milestone 2).
 *
 * Tabel ini tidak punya policy INSERT/UPDATE/DELETE: barisnya hanya ditulis oleh
 * fungsi RPC keamanan-definer di `20261016093000_club_membership_rpc.sql`, dan
 * hanya owner/admin klub yang dapat membacanya.
 */
export type ClubAuditAction =
  | 'club_created'
  | 'join'
  | 'request'
  | 'request_cancelled'
  | 'approve'
  | 'reject'
  | 'role_change'
  | 'remove'
  | 'leave';

/**
 * Jawaban status hasil RPC keanggotaan (bukan enum database).
 *
 * `cancelled` hanya dikembalikan `leave_club` saat yang dibatalkan adalah
 * permintaan yang masih `pending`.
 */
export type ClubMembershipOutcome =
  | 'active'
  | 'pending'
  | 'rejected'
  | 'removed'
  | 'left'
  | 'cancelled';

export type ClubRow = Omit<
  GeneratedTables['clubs']['Row'],
  'visibility' | 'join_policy'
> & {
  visibility: ClubVisibility;
  join_policy: ClubJoinPolicy;
};

export type ClubInsert = Omit<
  GeneratedTables['clubs']['Insert'],
  'visibility' | 'join_policy'
> & {
  visibility?: ClubVisibility;
  join_policy?: ClubJoinPolicy;
};

export type ClubUpdate = Omit<
  GeneratedTables['clubs']['Update'],
  'visibility' | 'join_policy'
> & {
  visibility?: ClubVisibility;
  join_policy?: ClubJoinPolicy;
};

export type ClubMemberRow = Omit<GeneratedTables['club_members']['Row'], 'role' | 'status'> & {
  role: ClubMemberRole;
  status: ClubMemberStatus;
};

export type ClubMemberInsert = Omit<
  GeneratedTables['club_members']['Insert'],
  'role' | 'status'
> & {
  role?: ClubMemberRole;
  status?: ClubMemberStatus;
};

export type ClubMemberUpdate = Omit<
  GeneratedTables['club_members']['Update'],
  'role' | 'status'
> & {
  role?: ClubMemberRole;
  status?: ClubMemberStatus;
};

export type ClubRoleAuditRow = Omit<
  GeneratedTables['club_role_audit']['Row'],
  'action' | 'old_role' | 'new_role' | 'old_status' | 'new_status'
> & {
  action: ClubAuditAction;
  old_role: ClubMemberRole | null;
  new_role: ClubMemberRole | null;
  old_status: ClubMemberStatus | null;
  new_status: ClubMemberStatus | null;
};

/* ------------------------------------------------------------------- garasi */

export type MotorcycleRow = GeneratedTables['motorcycles']['Row'];
export type MotorcycleInsert = GeneratedTables['motorcycles']['Insert'];
export type MotorcycleUpdate = GeneratedTables['motorcycles']['Update'];

export type MotorcyclePrivateDetailsRow = GeneratedTables['motorcycle_private_details']['Row'];
export type MotorcyclePrivateDetailsInsert =
  GeneratedTables['motorcycle_private_details']['Insert'];
export type MotorcyclePrivateDetailsUpdate =
  GeneratedTables['motorcycle_private_details']['Update'];

/* ------------------------------------------------------------------ database */

type ClubsTable = {
  Row: ClubRow;
  Insert: ClubInsert;
  Update: ClubUpdate;
  Relationships: GeneratedTables['clubs']['Relationships'];
};

type ClubMembersTable = {
  Row: ClubMemberRow;
  Insert: ClubMemberInsert;
  Update: ClubMemberUpdate;
  Relationships: GeneratedTables['club_members']['Relationships'];
};

type ClubRoleAuditTable = {
  Row: ClubRoleAuditRow;
  Insert: never;
  Update: never;
  Relationships: GeneratedTables['club_role_audit']['Relationships'];
};

type Tables = Omit<GeneratedTables, 'clubs' | 'club_members' | 'club_role_audit'> & {
  clubs: ClubsTable;
  club_members: ClubMembersTable;
  club_role_audit: ClubRoleAuditTable;
};

/**
 * RPC Milestone 2 dari `20261016093000_club_membership_rpc.sql`.
 *
 * Semuanya `security definer` dan hanya dieksekusi peran `authenticated`.
 * Generator hanya melihat `text`/`jsonb`, jadi bentuk balik di sini dikurasi:
 * `create_club` mengembalikan baris klub, operasi lain mengembalikan status
 * keanggotaan atau peran.
 */
type Functions = Omit<
  GeneratedFunctions,
  | 'create_club'
  | 'request_club_membership'
  | 'review_club_membership'
  | 'set_club_member_role'
  | 'remove_club_member'
  | 'leave_club'
> & {
  create_club: {
    Args: {
      p_name: string;
      p_slug?: string | null;
      p_description?: string | null;
      p_visibility?: ClubVisibility;
      p_join_policy?: ClubJoinPolicy;
    };
    Returns: ClubRow;
  };
  request_club_membership: {
    Args: { p_club_id: string };
    Returns: ClubMembershipOutcome;
  };
  review_club_membership: {
    Args: { p_club_id: string; p_user_id: string; p_approve: boolean };
    Returns: ClubMembershipOutcome;
  };
  set_club_member_role: {
    Args: { p_club_id: string; p_user_id: string; p_role: ClubMemberRole };
    Returns: ClubMemberRole;
  };
  remove_club_member: {
    Args: { p_club_id: string; p_user_id: string };
    Returns: ClubMembershipOutcome;
  };
  leave_club: {
    Args: { p_club_id: string };
    Returns: ClubMembershipOutcome;
  };
};

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedPublic, 'Tables' | 'Functions'> & {
    Tables: Tables;
    Functions: Functions;
  };
};

export type DatabaseSchemaName = keyof Database;
