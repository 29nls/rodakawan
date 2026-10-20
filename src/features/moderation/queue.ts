/**
 * Dashboard moderasi: antrean laporan penyalahgunaan dan jejak aksi.
 *
 * Wewenang tidak datang dari peran global (ADR-067): database hanya
 * menampilkan laporan atas konten yang dijalankan host perjalanan atau admin
 * klub pemilik perjalanan, lewat policy `content_reports_select_moderator`.
 * Modul ini **tidak** menyaring wewenang sendiri — ia menampilkan apa yang
 * dikembalikan RLS, sehingga daftar di layar dan izin sebenarnya tidak bisa
 * berbeda.
 *
 * Tiga jalur baca yang dipakai:
 * - `content_reports` (laporan terbuka) — policy moderator;
 * - `hazard_reports`/`chat_messages` (isi konten) — policy biasa, hanya untuk
 *   konten yang memang terbaca moderator (host adalah anggota perjalanan);
 * - RPC `get_moderation_subject` — hanya untuk konten yang lolos policy tapi
 *   tidak terbaca langsung (admin klub bukan peserta chat, hazard kedaluwarsa).
 *   RPC itu mengembalikan satu baris yang dilaporkan saja, bukan riwayat chat.
 *
 * Tidak ada DML langsung ke tabel mana pun: hapus konten dan tinjau laporan
 * memakai RPC `moderate_hazard`/`moderate_chat_message`/`review_content_report`,
 * dan setiap RPC itu menulis `moderation_actions` dalam transaksi yang sama.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { NETWORK_APP_ERROR, type AppError } from '@/features/auth/errors';
import {
  CONTENT_REPORT_REASONS,
  type ContentReportReason,
  type ContentReportRow,
} from '@/features/moderation/api';
import { mapModerationError } from '@/features/moderation/errors';
import type { Database } from '@/lib/supabase/database.types';

export type ModerationClient = SupabaseClient<Database>;

export type ModerationResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Laporan penyalahgunaan yang masih `open` dan boleh dibaca pengguna ini. */
export type ModerationReport = Pick<
  ContentReportRow,
  | 'id'
  | 'reporter_id'
  | 'target_type'
  | 'target_id'
  | 'reason'
  | 'details'
  | 'status'
  | 'created_at'
> & { reviewed_at: string | null };

export type ModerationSubjectKind = 'hazard' | 'chat_message';

/** Isi konten yang dilaporkan, sudah cukup untuk ditampilkan dan diputuskan. */
export type ModerationSubject = {
  kind: ModerationSubjectKind;
  id: string;
  authorId: string;
  rideId: string | null;
  body: string;
  category: string | null;
  severity: string | null;
  status: string;
  createdAt: string;
  /** Konten sudah tidak tampil (hazard final/kedaluwarsa atau pesan terhapus). */
  removed: boolean;
};

export type ModerationQueueItem = {
  report: ModerationReport;
  /** `null` bila konten sudah tidak ada; UI harus mengatakannya, bukan menebak. */
  subject: ModerationSubject | null;
  ride: { id: string; title: string } | null;
};

/** Label tampilan pengguna; kosong bila profilnya privat/tidak terbaca. */
export type ModerationPeople = Record<string, string>;

export type ModerationQueue = {
  items: ModerationQueueItem[];
  people: ModerationPeople;
};

export type ModerationActionRow = {
  id: string;
  actor_id: string;
  target_type: string;
  target_id: string;
  action: string;
  reason: string;
  note: string | null;
  created_at: string;
};

/** Jejak audit beserta label pelaku; `people` juga memuat moderator lain. */
export type ModerationAudit = {
  actions: ModerationActionRow[];
  people: ModerationPeople;
};

export type ReviewStatus = 'reviewed' | 'removed' | 'dismissed';

export const MODERATION_QUEUE_LIMIT = 50;
export const MODERATION_AUDIT_LIMIT = 20;
/** Selaras dengan `char_length(note) <= 1000` di migration. */
export const MAX_MODERATION_NOTE_LENGTH = 1000;

const REPORT_COLUMNS =
  'id, reporter_id, target_type, target_id, reason, details, status, created_at, reviewed_at';
const HAZARD_COLUMNS =
  'id, reporter_id, ride_id, category, description, severity, status, created_at';
const MESSAGE_COLUMNS = 'id, sender_id, ride_id, content, message_type, created_at, deleted_at';

type HazardSelectRow = {
  id: string;
  reporter_id: string;
  ride_id: string | null;
  category: string;
  description: string | null;
  severity: string;
  status: string;
  created_at: string;
};

type MessageSelectRow = {
  id: string;
  sender_id: string;
  ride_id: string;
  content: string;
  message_type: string;
  created_at: string;
  deleted_at: string | null;
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Alasan laporan yang dikenal database (CHECK `content_reports.reason`). */
export function isContentReportReason(value: string): value is ContentReportReason {
  return CONTENT_REPORT_REASONS.some((item) => item.value === value);
}

/** Alasan laporan dalam bahasa manusia; dipakai di antrean dan audit. */
export function contentReportReasonLabel(reason: string): string {
  return CONTENT_REPORT_REASONS.find((item) => item.value === reason)?.label ?? 'Alasan lain';
}

export function moderationActionLabel(action: string): string {
  switch (action) {
    case 'remove':
      return 'Konten dihapus';
    case 'dismiss':
      return 'Laporan diabaikan';
    case 'review':
      return 'Ditandai ditinjau';
    default:
      return 'Tindakan lain';
  }
}

export function moderationTargetLabel(targetType: string): string {
  switch (targetType) {
    case 'hazard':
      return 'Laporan bahaya';
    case 'chat_message':
      return 'Pesan chat';
    case 'content_report':
      return 'Laporan penyalahgunaan';
    default:
      return 'Konten';
  }
}

function subjectFromHazard(row: HazardSelectRow): ModerationSubject {
  return {
    kind: 'hazard',
    id: row.id,
    authorId: row.reporter_id,
    rideId: row.ride_id,
    body: row.description ?? '',
    category: row.category,
    severity: row.severity,
    status: row.status,
    createdAt: row.created_at,
    removed: row.status !== 'active',
  };
}

function subjectFromMessage(row: MessageSelectRow): ModerationSubject {
  return {
    kind: 'chat_message',
    id: row.id,
    authorId: row.sender_id,
    rideId: row.ride_id,
    body: row.content,
    category: null,
    severity: null,
    status: row.message_type,
    createdAt: row.created_at,
    removed: row.deleted_at !== null,
  };
}

function subjectFromRpc(value: unknown): ModerationSubject | null {
  if (typeof value !== 'object' || value === null) return null;

  const row = value as Record<string, unknown>;
  const kind = row.kind === 'hazard' || row.kind === 'chat_message' ? row.kind : null;
  if (!kind || typeof row.id !== 'string') return null;

  return {
    kind,
    id: row.id,
    authorId: typeof row.author_id === 'string' ? row.author_id : '',
    rideId: typeof row.ride_id === 'string' ? row.ride_id : null,
    body: typeof row.body === 'string' ? row.body : '',
    category: typeof row.category === 'string' ? row.category : null,
    severity: typeof row.severity === 'string' ? row.severity : null,
    status: typeof row.status === 'string' ? row.status : '',
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    removed: row.removed === true,
  };
}

async function fetchHazards(
  client: ModerationClient,
  ids: string[],
): Promise<ModerationResult<ModerationSubject[]>> {
  try {
    const { data, error } = await client
      .from('hazard_reports')
      .select(HAZARD_COLUMNS)
      .in('id', ids);

    if (error) return { ok: false, error: mapModerationError(error) };

    const rows = (data ?? []) as unknown as HazardSelectRow[];
    return { ok: true, data: rows.map(subjectFromHazard) };
  } catch (error) {
    return { ok: false, error: mapModerationError(error) };
  }
}

async function fetchMessages(
  client: ModerationClient,
  ids: string[],
): Promise<ModerationResult<ModerationSubject[]>> {
  try {
    const { data, error } = await client
      .from('chat_messages')
      .select(MESSAGE_COLUMNS)
      .in('id', ids);

    if (error) return { ok: false, error: mapModerationError(error) };

    const rows = (data ?? []) as unknown as MessageSelectRow[];
    return { ok: true, data: rows.map(subjectFromMessage) };
  } catch (error) {
    return { ok: false, error: mapModerationError(error) };
  }
}

/** Isi konten yang tidak terbaca lewat policy biasa (lihat catatan modul). */
async function fetchSubjectViaRpc(
  client: ModerationClient,
  report: ModerationReport,
): Promise<ModerationResult<ModerationSubject | null>> {
  try {
    const { data, error } = await (client.rpc as any)('get_moderation_subject', {
      p_target_type: report.target_type,
      p_target_id: report.target_id,
    });

    if (error) return { ok: false, error: mapModerationError(error) };

    return { ok: true, data: subjectFromRpc(data) };
  } catch (error) {
    return { ok: false, error: mapModerationError(error) };
  }
}

async function fetchRides(
  client: ModerationClient,
  ids: string[],
): Promise<ModerationResult<{ id: string; title: string }[]>> {
  try {
    const { data, error } = await client.from('rides').select('id, title').in('id', ids);

    if (error) return { ok: false, error: mapModerationError(error) };

    return { ok: true, data: (data ?? []) as unknown as { id: string; title: string }[] };
  } catch (error) {
    return { ok: false, error: mapModerationError(error) };
  }
}

/**
 * Nama pelapor/penulis. Pelengkap tampilan saja: profil privat memang tidak
 * terbaca (ADR-019), dan kegagalan query ini tidak boleh menghalangi moderator
 * meninjau laporan — UI memakai fallback "Pengguna" bila label tidak ada.
 */
async function fetchPeople(client: ModerationClient, ids: string[]): Promise<ModerationPeople> {
  if (ids.length === 0) return {};

  try {
    const { data, error } = await client
      .from('profiles')
      .select('id, username, display_name')
      .in('id', ids);

    if (error) return {};

    const rows = (data ?? []) as unknown as {
      id: string;
      username: string;
      display_name: string | null;
    }[];

    const people: ModerationPeople = {};
    for (const row of rows) {
      people[row.id] = row.display_name?.trim() || `@${row.username}`;
    }
    return people;
  } catch {
    return {};
  }
}

/**
 * Antrean laporan terbuka yang boleh ditinjau pengguna ini.
 *
 * Urutan lama → baru supaya laporan yang paling lama menunggu berada di atas.
 * Batas `MODERATION_QUEUE_LIMIT` disengaja: dashboard adalah alat tinjauan,
 * bukan arsip, dan laporan yang tidak terbaca tidak boleh "hilang" tanpa jejak.
 */
export async function loadModerationQueue(
  client: ModerationClient,
): Promise<ModerationResult<ModerationQueue>> {
  try {
    const { data, error } = await client
      .from('content_reports')
      .select(REPORT_COLUMNS)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(MODERATION_QUEUE_LIMIT);

    if (error) return { ok: false, error: mapModerationError(error) };

    const reports = ((data ?? []) as unknown as ModerationReport[]).filter(
      (row) => row.target_type === 'hazard' || row.target_type === 'chat_message',
    );

    if (reports.length === 0) return { ok: true, data: { items: [], people: {} } };

    const hazardIds = unique(
      reports.filter((row) => row.target_type === 'hazard').map((row) => row.target_id),
    );
    const messageIds = unique(
      reports.filter((row) => row.target_type === 'chat_message').map((row) => row.target_id),
    );

    const subjects = new Map<string, ModerationSubject>();

    if (hazardIds.length > 0) {
      const hazards = await fetchHazards(client, hazardIds);
      if (!hazards.ok) return hazards;
      for (const subject of hazards.data) subjects.set(subject.id, subject);
    }

    if (messageIds.length > 0) {
      const messages = await fetchMessages(client, messageIds);
      if (!messages.ok) return messages;
      for (const subject of messages.data) subjects.set(subject.id, subject);
    }

    const missing = reports.filter((row) => !subjects.has(row.target_id));
    if (missing.length > 0) {
      const enriched = await Promise.all(
        missing.map((report) => fetchSubjectViaRpc(client, report)),
      );

      for (const result of enriched) {
        if (!result.ok) return result;
        if (result.data) subjects.set(result.data.id, result.data);
      }
    }

    const rideIds = unique(
      reports
        .map((report) => subjects.get(report.target_id)?.rideId ?? null)
        .filter((id): id is string => id !== null),
    );

    let ridesById = new Map<string, string>();
    if (rideIds.length > 0) {
      const rides = await fetchRides(client, rideIds);
      if (!rides.ok) return rides;
      ridesById = new Map(rides.data.map((ride) => [ride.id, ride.title]));
    }

    const items: ModerationQueueItem[] = reports.map((report) => {
      const subject = subjects.get(report.target_id) ?? null;
      const rideId = subject?.rideId ?? null;
      const title = rideId ? ridesById.get(rideId) : undefined;

      return {
        report,
        subject,
        ride: rideId && title !== undefined ? { id: rideId, title } : null,
      };
    });

    const people = await fetchPeople(
      client,
      unique([
        ...reports.map((report) => report.reporter_id),
        ...items.map((item) => item.subject?.authorId ?? '').filter((id) => id.length > 0),
      ]),
    );

    return { ok: true, data: { items, people } };
  } catch (error) {
    return { ok: false, error: mapModerationError(error) };
  }
}

async function callRpc<T>(
  client: ModerationClient,
  name: string,
  args: Record<string, unknown>,
): Promise<ModerationResult<T>> {
  try {
    const { data, error } = await (client.rpc as any)(name, args);
    if (error) return { ok: false, error: mapModerationError(error) };
    if (data === null || data === undefined) return { ok: false, error: NETWORK_APP_ERROR };
    return { ok: true, data: data as T };
  } catch (error) {
    return { ok: false, error: mapModerationError(error) };
  }
}

/** Hapus konten yang dilaporkan (soft delete di server, bukan DELETE baris). */
export async function moderateSubject(
  client: ModerationClient,
  subject: Pick<ModerationSubject, 'id' | 'kind'>,
  reason: ContentReportReason,
  note: string | null = null,
): Promise<ModerationResult<unknown>> {
  const trimmedNote = note?.trim() ? note.trim() : null;

  if (trimmedNote !== null && trimmedNote.length > MAX_MODERATION_NOTE_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'invalid_data',
        message: `Catatan moderasi maksimal ${MAX_MODERATION_NOTE_LENGTH} karakter.`,
        retryable: false,
      },
    };
  }

  if (subject.kind === 'hazard') {
    return callRpc(client, 'moderate_hazard', {
      p_hazard_id: subject.id,
      p_action: 'remove',
      p_reason: reason,
      p_note: trimmedNote,
    });
  }

  return callRpc(client, 'moderate_chat_message', {
    p_message_id: subject.id,
    p_reason: reason,
    p_note: trimmedNote,
  });
}

/** Tutup laporan tanpa menyentuh kontennya. */
export async function reviewReport(
  client: ModerationClient,
  reportId: string,
  status: ReviewStatus,
  note: string | null = null,
): Promise<ModerationResult<ContentReportRow>> {
  const trimmedNote = note?.trim() ? note.trim() : null;

  if (trimmedNote !== null && trimmedNote.length > MAX_MODERATION_NOTE_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'invalid_data',
        message: `Catatan moderasi maksimal ${MAX_MODERATION_NOTE_LENGTH} karakter.`,
        retryable: false,
      },
    };
  }

  return callRpc(client, 'review_content_report', {
    p_report_id: reportId,
    p_status: status,
    p_note: trimmedNote,
  });
}

export type RemovalOutcome = {
  /** `true` bila konten benar-benar dihapus pada panggilan ini. */
  contentRemoved: boolean;
  report: ContentReportRow;
};

/**
 * Alur utama tombol "Hapus konten": hapus konten, lalu tutup laporan sebagai
 * `removed`. Dua RPC, bukan satu, karena laporan dan konten punya audit
 * masing-masing — dan kegagalan langkah kedua tidak boleh dilaporkan sebagai
 * sukses. Konten yang sudah dihapus tidak dihapus ulang (RPC chat idempoten,
 * hazard final ditolak) sehingga pesan galatnya jujur: konten sudah hilang,
 * status laporan belum berubah.
 */
export async function removeReportedContent(
  client: ModerationClient,
  item: ModerationQueueItem,
  reason: ContentReportReason,
  note: string | null = null,
): Promise<ModerationResult<RemovalOutcome>> {
  if (item.subject === null) {
    return {
      ok: false,
      error: {
        code: 'content_unavailable',
        message:
          'Isi konten ini tidak dapat dibaca lagi, jadi tidak ada yang bisa dihapus. Muat ulang antrean, lalu tutup laporannya.',
        retryable: false,
      },
    };
  }

  let contentRemoved = false;

  if (!item.subject.removed) {
    const removal = await moderateSubject(client, item.subject, reason, note);
    if (!removal.ok) return removal;
    contentRemoved = true;
  }

  const reviewed = await reviewReport(client, item.report.id, 'removed', note);
  if (!reviewed.ok) {
    return {
      ok: false,
      error: {
        code: 'partial',
        message:
          'Konten sudah dihapus, tetapi status laporan gagal diperbarui. Muat ulang antrean lalu tandai laporan ini sebagai ditinjau.',
        retryable: true,
      },
    };
  }

  return { ok: true, data: { contentRemoved, report: reviewed.data } };
}

/** Jejak aksi moderasi yang boleh dibaca pengguna ini (RPC, tanpa tabel langsung). */
export async function loadModerationAudit(
  client: ModerationClient,
  limit: number = MODERATION_AUDIT_LIMIT,
): Promise<ModerationResult<ModerationAudit>> {
  const result = await callRpc<ModerationActionRow[]>(client, 'list_moderation_actions', {
    p_limit: limit,
  });

  if (!result.ok) return result;

  const actions = Array.isArray(result.data) ? result.data : [];
  const people = await fetchPeople(client, unique(actions.map((entry) => entry.actor_id)));

  return { ok: true, data: { actions, people } };
}
