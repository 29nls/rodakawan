/**
 * Tipe database Supabase untuk kebutuhan aplikasi.
 *
 * Cakupan saat ini: `public.profiles` (Milestone 1) ditambah tabel yang dipakai
 * lapisan API Milestone 2 — `public.clubs`, `public.club_members`,
 * `public.motorcycles`, dan `public.motorcycle_private_details`.
 *
 * Setelah project Supabase development tersedia, tipe lengkap sebaiknya
 * dihasilkan dari skema dengan Supabase CLI:
 *
 *   npx supabase gen types typescript --project-id <project-id> > src/lib/supabase/database.types.ts
 *
 * Selama belum dijalankan, tipe manual ini harus tetap sinkron dengan
 * `supabase/migrations/*.sql`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/* ------------------------------------------------------------------ profiles */

export type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  is_private: boolean;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  bio?: string | null;
  city?: string | null;
  is_private?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ProfileUpdate = {
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  bio?: string | null;
  city?: string | null;
  is_private?: boolean;
  updated_at?: string;
};

/* --------------------------------------------------------------------- clubs */

export type ClubVisibility = 'public' | 'private';
export type ClubJoinPolicy = 'open' | 'approval' | 'invite_only';

export type ClubRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_path: string | null;
  visibility: ClubVisibility;
  join_policy: ClubJoinPolicy;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ClubInsert = {
  id?: string;
  name: string;
  slug: string;
  description?: string | null;
  logo_path?: string | null;
  visibility?: ClubVisibility;
  join_policy?: ClubJoinPolicy;
  created_by: string;
  created_at?: string;
  updated_at?: string;
};

export type ClubUpdate = {
  name?: string;
  slug?: string;
  description?: string | null;
  logo_path?: string | null;
  visibility?: ClubVisibility;
  join_policy?: ClubJoinPolicy;
  updated_at?: string;
};

export type ClubMemberRole = 'owner' | 'admin' | 'member';
export type ClubMemberStatus = 'pending' | 'active' | 'rejected' | 'removed' | 'left';

export type ClubMemberRow = {
  club_id: string;
  user_id: string;
  role: ClubMemberRole;
  status: ClubMemberStatus;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClubMemberInsert = {
  club_id: string;
  user_id: string;
  role?: ClubMemberRole;
  status?: ClubMemberStatus;
  joined_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ClubMemberUpdate = {
  role?: ClubMemberRole;
  status?: ClubMemberStatus;
  joined_at?: string | null;
  updated_at?: string;
};

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

export type ClubRoleAuditRow = {
  id: string;
  club_id: string;
  actor_id: string | null;
  subject_id: string | null;
  action: ClubAuditAction;
  old_role: ClubMemberRole | null;
  new_role: ClubMemberRole | null;
  old_status: ClubMemberStatus | null;
  new_status: ClubMemberStatus | null;
  created_at: string;
};

/** Jawaban status hasil RPC keanggotaan (bukan enum database). */
export type ClubMembershipOutcome =
  | 'active'
  | 'pending'
  | 'rejected'
  | 'removed'
  | 'left'
  | 'cancelled';

/* ------------------------------------------------------------------- garasi */

export type MotorcycleRow = {
  id: string;
  owner_id: string;
  nickname: string | null;
  make: string;
  model: string;
  model_year: number | null;
  photo_path: string | null;
  description: string | null;
  is_public: boolean;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};

export type MotorcycleInsert = {
  id?: string;
  owner_id: string;
  nickname?: string | null;
  make: string;
  model: string;
  model_year?: number | null;
  photo_path?: string | null;
  description?: string | null;
  is_public?: boolean;
  is_primary?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type MotorcycleUpdate = {
  nickname?: string | null;
  make?: string;
  model?: string;
  model_year?: number | null;
  photo_path?: string | null;
  description?: string | null;
  is_public?: boolean;
  is_primary?: boolean;
  updated_at?: string;
};

export type MotorcyclePrivateDetailsRow = {
  motorcycle_id: string;
  owner_id: string;
  plate_number: string | null;
  private_notes: string | null;
  updated_at: string;
};

export type MotorcyclePrivateDetailsInsert = {
  motorcycle_id: string;
  owner_id: string;
  plate_number?: string | null;
  private_notes?: string | null;
  updated_at?: string;
};

export type MotorcyclePrivateDetailsUpdate = {
  plate_number?: string | null;
  private_notes?: string | null;
  updated_at?: string;
};

/* ------------------------------------------------------------------ database */

export type Database = {
  public: {
    Tables: {
      club_role_audit: {
        Row: ClubRoleAuditRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      club_members: {
        Row: ClubMemberRow;
        Insert: ClubMemberInsert;
        Update: ClubMemberUpdate;
        Relationships: [];
      };
      clubs: {
        Row: ClubRow;
        Insert: ClubInsert;
        Update: ClubUpdate;
        Relationships: [];
      };
      motorcycle_private_details: {
        Row: MotorcyclePrivateDetailsRow;
        Insert: MotorcyclePrivateDetailsInsert;
        Update: MotorcyclePrivateDetailsUpdate;
        Relationships: [];
      };
      motorcycles: {
        Row: MotorcycleRow;
        Insert: MotorcycleInsert;
        Update: MotorcycleUpdate;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    /**
     * RPC Milestone 2 dari `20261016093000_club_membership_rpc.sql`.
     *
     * Semuanya `security definer` dan hanya dieksekusi peran `authenticated`;
     * `create_club` mengembalikan baris klub yang baru dibuat sebagai jsonb.
     */
    Functions: {
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
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type DatabaseSchemaName = keyof Database;
