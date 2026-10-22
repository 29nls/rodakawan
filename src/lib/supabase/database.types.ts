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
 * Tabel laporan bahaya (`hazard_reports`), chat konvoi (`chat_messages`), dan
 * moderasi (`content_reports`, `moderation_actions`) ikut dipersempit di sini
 * memakai union yang sama persis dengan `CHECK` constraint-nya.
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

/* --------------------------------------------------------------- perjalanan */

export type RideStatus = 'planned' | 'active' | 'completed' | 'cancelled';
export type RideVisibility = 'club' | 'invite_only' | 'public';
export type RideActivityType = 'motorcycle' | 'cycling' | 'mixed' | 'other';
export type RideMemberRole = 'host' | 'sweeper' | 'rider';
export type RideMemberStatus = 'invited' | 'joined' | 'left' | 'removed';

/** Baris `public.rides` dengan union yang sebenarnya dijaga CHECK constraint. */
export type RideRow = Omit<
  GeneratedTables['rides']['Row'],
  'activity_type' | 'status' | 'visibility'
> & {
  activity_type: RideActivityType;
  status: RideStatus;
  visibility: RideVisibility;
};

export type RideMemberRow = Omit<
  GeneratedTables['ride_members']['Row'],
  'role' | 'status'
> & {
  role: RideMemberRole;
  status: RideMemberStatus;
};

export type RideLocationRow = GeneratedTables['ride_locations']['Row'];

/* ------------------------------------------------------------- laporan bahaya */

/**
 * Nilai yang sebenarnya dijaga `CHECK` constraint di database.
 *
 * `supabase gen types` hanya melihat kolom `text`, jadi daftar yang sah ditulis
 * di sini; sumbernya `supabase/migrations/20261013022938_initial_schema.sql`
 * (CHECK `category`, `severity`, dan `status` pada `public.hazard_reports`).
 */
export type HazardCategory =
  | 'pothole'
  | 'crash'
  | 'traffic'
  | 'weather'
  | 'flood'
  | 'road_block'
  | 'traffic_enforcement'
  | 'other';

export type HazardSeverity = 'info' | 'moderate' | 'high' | 'critical';

export type HazardStatus = 'active' | 'expired' | 'dismissed' | 'removed' | 'resolved';

/** Baris `public.hazard_reports` dengan union yang dijaga CHECK constraint. */
export type HazardRow = Omit<
  GeneratedTables['hazard_reports']['Row'],
  'category' | 'severity' | 'status'
> & {
  category: HazardCategory;
  severity: HazardSeverity;
  status: HazardStatus;
};

export type HazardInsert = Omit<
  GeneratedTables['hazard_reports']['Insert'],
  'category' | 'severity' | 'status'
> & {
  category: HazardCategory;
  severity?: HazardSeverity;
  status?: HazardStatus;
};

export type HazardUpdate = Omit<
  GeneratedTables['hazard_reports']['Update'],
  'category' | 'severity' | 'status'
> & {
  category?: HazardCategory;
  severity?: HazardSeverity;
  status?: HazardStatus;
};

/* --------------------------------------------------------------- chat konvoi */

/** CHECK `message_type` pada `public.chat_messages` (`text` atau `system`). */
export type ChatMessageType = 'text' | 'system';

export type ChatMessageRow = Omit<
  GeneratedTables['chat_messages']['Row'],
  'message_type'
> & {
  message_type: ChatMessageType;
};

export type ChatMessageInsert = Omit<
  GeneratedTables['chat_messages']['Insert'],
  'message_type'
> & {
  message_type?: ChatMessageType;
};

export type ChatMessageUpdate = Omit<
  GeneratedTables['chat_messages']['Update'],
  'message_type'
> & {
  message_type?: ChatMessageType;
};

/* ------------------------------------------------------------------ moderasi */

/**
 * Semua jenis konten yang boleh dilaporkan menurut CHECK `content_reports.target_type`.
 *
 * Aplikasi hanya melaporkan dua jenis terakhir; sisanya tetap sah menurut
 * database dan deshalb tidak boleh disempitkan di sini.
 */
export type ContentReportTargetType =
  | 'user'
  | 'club'
  | 'post'
  | 'comment'
  | 'hazard'
  | 'chat_message';

/**
 * Alasan penyalahgunaan.
 *
 * CHECK yang sama dipakai dua kolom: `content_reports.reason` dan
 * `moderation_actions.reason`.
 */
export type ModerationReason =
  | 'spam'
  | 'harassment'
  | 'false_information'
  | 'unsafe_content'
  | 'privacy'
  | 'other';

export type ContentReportStatus = 'open' | 'reviewed' | 'removed' | 'dismissed';

export type ContentReportRow = Omit<
  GeneratedTables['content_reports']['Row'],
  'target_type' | 'reason' | 'status'
> & {
  target_type: ContentReportTargetType;
  reason: ModerationReason;
  status: ContentReportStatus;
};

export type ContentReportInsert = Omit<
  GeneratedTables['content_reports']['Insert'],
  'target_type' | 'reason' | 'status'
> & {
  target_type: ContentReportTargetType;
  reason: ModerationReason;
  status?: ContentReportStatus;
};

export type ContentReportUpdate = Omit<
  GeneratedTables['content_reports']['Update'],
  'target_type' | 'reason' | 'status'
> & {
  target_type?: ContentReportTargetType;
  reason?: ModerationReason;
  status?: ContentReportStatus;
};

/** CHECK `target_type` pada `public.moderation_actions`. */
export type ModerationTargetType = 'hazard' | 'chat_message' | 'content_report';

/** CHECK `action` pada `public.moderation_actions`. */
export type ModerationAction = 'remove' | 'dismiss' | 'review';

export type ModerationActionRow = Omit<
  GeneratedTables['moderation_actions']['Row'],
  'target_type' | 'action' | 'reason'
> & {
  target_type: ModerationTargetType;
  action: ModerationAction;
  reason: ModerationReason;
};

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

type HazardReportsTable = {
  Row: HazardRow;
  Insert: HazardInsert;
  Update: HazardUpdate;
  Relationships: GeneratedTables['hazard_reports']['Relationships'];
};

type ChatMessagesTable = {
  Row: ChatMessageRow;
  Insert: ChatMessageInsert;
  Update: ChatMessageUpdate;
  Relationships: GeneratedTables['chat_messages']['Relationships'];
};

type ContentReportsTable = {
  Row: ContentReportRow;
  Insert: ContentReportInsert;
  Update: ContentReportUpdate;
  Relationships: GeneratedTables['content_reports']['Relationships'];
};

/**
 * Jejak audit moderasi.
 *
 * Tabel ini **tidak** punya policy INSERT/UPDATE/DELETE: barisnya hanya ditulis
 * RPC keamanan-definer (`moderate_hazard`, `moderate_chat_message`,
 * `review_content_report`), dan satu-satunya jalan membacanya adalah RPC
 * `list_moderation_actions`. Karena itu `Insert`/`Update` sengaja `never`.
 */
type ModerationActionsTable = {
  Row: ModerationActionRow;
  Insert: never;
  Update: never;
  Relationships: GeneratedTables['moderation_actions']['Relationships'];
};

type RidesTable = {
  Row: RideRow;
  Insert: GeneratedTables['rides']['Insert'];
  Update: GeneratedTables['rides']['Update'];
  Relationships: GeneratedTables['rides']['Relationships'];
};

type RideMembersTable = {
  Row: RideMemberRow;
  Insert: GeneratedTables['ride_members']['Insert'];
  Update: GeneratedTables['ride_members']['Update'];
  Relationships: GeneratedTables['ride_members']['Relationships'];
};

type Tables = Omit<
  GeneratedTables,
  | 'clubs'
  | 'club_members'
  | 'club_role_audit'
  | 'rides'
  | 'ride_members'
  | 'hazard_reports'
  | 'chat_messages'
  | 'content_reports'
  | 'moderation_actions'
> & {
  clubs: ClubsTable;
  club_members: ClubMembersTable;
  club_role_audit: ClubRoleAuditTable;
  rides: RidesTable;
  ride_members: RideMembersTable;
  hazard_reports: HazardReportsTable;
  chat_messages: ChatMessagesTable;
  content_reports: ContentReportsTable;
  moderation_actions: ModerationActionsTable;
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
  | 'create_ride'
  | 'update_ride'
  | 'invite_ride_member'
  | 'accept_ride_invite'
  | 'join_ride'
  | 'leave_ride'
  | 'remove_ride_member'
  | 'transition_ride'
  | 'set_ride_location_sharing'
  | 'publish_ride_location'
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

  /* -------------------------------------------------------------- perjalanan */

  create_ride: {
    Args: {
      p_club_id: string;
      p_title: string;
      p_starts_at?: string | null;
      p_description?: string | null;
      p_meeting_label?: string | null;
      p_destination_label?: string | null;
      p_visibility?: RideVisibility;
    };
    Returns: RideRow;
  };
  update_ride: {
    Args: {
      p_ride_id: string;
      p_title: string;
      p_description?: string | null;
      p_starts_at?: string | null;
      p_meeting_label?: string | null;
      p_destination_label?: string | null;
    };
    Returns: RideRow;
  };
  invite_ride_member: {
    Args: { p_ride_id: string; p_user_id: string };
    Returns: RideMemberStatus;
  };
  accept_ride_invite: {
    Args: { p_ride_id: string };
    Returns: 'joined';
  };
  join_ride: {
    Args: { p_ride_id: string };
    Returns: 'joined';
  };
  leave_ride: {
    Args: { p_ride_id: string };
    Returns: 'left';
  };
  remove_ride_member: {
    Args: { p_ride_id: string; p_user_id: string };
    Returns: 'removed';
  };
  transition_ride: {
    Args: { p_ride_id: string; p_next: 'active' | 'completed' | 'cancelled' };
    Returns: RideRow;
  };
  set_ride_location_sharing: {
    Args: { p_ride_id: string; p_enabled: boolean };
    Returns: boolean;
  };
  publish_ride_location: {
    Args: {
      p_ride_id: string;
      p_latitude: number;
      p_longitude: number;
      p_accuracy_m?: number | null;
      p_heading_deg?: number | null;
      p_speed_mps?: number | null;
      p_recorded_at?: string | null;
    };
    Returns: RideLocationRow;
  };
};

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedPublic, 'Tables' | 'Functions'> & {
    Tables: Tables;
    Functions: Functions;
  };
};

export type DatabaseSchemaName = keyof Database;
