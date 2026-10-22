/**
 * Layanan chat konvoi (Milestone 4).
 *
 * Prinsip yang dijaga di sini:
 * - pesan baru hanya dianggap terkirim setelah server mengembalikan barisnya;
 * - `clientMessageId` membuat pengiriman ulang idempoten (unique index
 *   `(ride_id, sender_id, client_message_id)`), jadi retry setelah jaringan
 *   putus tidak menggandakan pesan;
 * - riwayat memakai keyset pagination `(created_at, id)` — bukan offset — supaya
 *   pesan baru yang masuk saat pengguna memuat pesan lama tidak menggeser
 *   halaman dan tidak membuat baris terlewat;
 * - pesan sistem tidak punya jalur tulis klien: pembuatnya trigger database
 *   (`insert_ride_system_message` dicabut dari `authenticated`);
 * - isi pesan yang sudah dihapus tidak pernah dikirim ke UI (`toChatMessage`);
 * - pesan dari pengguna yang diblokir **tidak pernah diterima klien**: policy
 *   `chat_select_ride_member` menyaringnya di server (ADR-068), termasuk untuk
 *   Postgres Changes. Tidak ada daftar blokir di sisi klien.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { NETWORK_APP_ERROR, type AppError } from '@/features/auth/errors';
import { mapChatError } from '@/features/chat/errors';
import { reportContent, type ContentReportReason } from '@/features/moderation/api';
import type { ChatMessageRow, ChatMessageType, Database } from '@/lib/supabase/database.types';

export type ChatClient = SupabaseClient<Database>;

export type ChatResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Bentuk baris `public.chat_messages` (union sesuai CHECK constraint). */
export type { ChatMessageRow, ChatMessageType };

/** Pesan yang aman ditampilkan: isi pesan terhapus sudah dikosongkan. */
export type ChatMessage = ChatMessageRow & { deleted: boolean };

export type ChatCursor = { created_at: string; id: string };

export type ChatPage = {
  /** Urut lama → baru, siap dirender. */
  messages: ChatMessage[];
  /** `true` bila masih ada pesan lebih lama di server. */
  hasMore: boolean;
};

export type ChatPageOptions = {
  limit?: number;
  /** Ambil pesan yang lebih lama dari baris ini (keyset). */
  before?: ChatCursor | null;
};

export const MAX_CHAT_CONTENT_LENGTH = 2000;
export const CHAT_PAGE_SIZE = 50;
/** Selaras dengan `edit_chat_message`/`delete_chat_message` di database. */
export const CHAT_EDIT_WINDOW_MS = 15 * 60 * 1000;

const CHAT_COLUMNS =
  'id, ride_id, sender_id, message_type, content, created_at, edited_at, deleted_at, client_message_id';

/** Validasi isi pesan: 1–2000 karakter **setelah** trim. */
export function validateChatContent(raw: string): ChatResult<string> {
  const content = raw.trim();

  if (content.length < 1) {
    return {
      ok: false,
      error: {
        code: 'chat_trim_invalid',
        message: 'Pesan tidak boleh kosong. Tulis sesuatu dulu, lalu kirim.',
        retryable: false,
      },
    };
  }

  if (content.length > MAX_CHAT_CONTENT_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'chat_trim_invalid',
        message: `Pesan maksimal ${MAX_CHAT_CONTENT_LENGTH} karakter. Pendekkan dulu, lalu kirim.`,
        retryable: false,
      },
    };
  }

  return { ok: true, data: content };
}

function toChatMessage(row: ChatMessageRow): ChatMessage {
  const deleted = row.deleted_at !== null && row.deleted_at !== undefined;
  return { ...row, content: deleted ? '' : row.content, deleted };
}

/** Apakah pengguna masih boleh mengubah/menghapus pesan ini. */
export function canEditChatMessage(
  message: Pick<ChatMessageRow, 'message_type' | 'sender_id' | 'created_at' | 'deleted_at'>,
  userId: string | null,
  now: number = Date.now(),
): boolean {
  if (!userId || message.sender_id !== userId) return false;
  if (message.message_type !== 'text') return false;
  if (message.deleted_at) return false;

  const createdAt = Date.parse(message.created_at);
  if (Number.isNaN(createdAt)) return false;
  return now - createdAt <= CHAT_EDIT_WINDOW_MS;
}

/** Ride final tidak menerima pesan baru (sama dengan aturan `send_chat_message`). */
export function chatAcceptsNewMessages(rideStatus: string): boolean {
  return rideStatus !== 'completed' && rideStatus !== 'cancelled';
}

async function callRows(
  action: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<ChatResult<ChatMessageRow>> {
  try {
    const { data, error } = await action();
    if (error) return { ok: false, error: mapChatError(error) };
    if (!data) return { ok: false, error: NETWORK_APP_ERROR };
    return { ok: true, data: data as ChatMessageRow };
  } catch (error) {
    return { ok: false, error: mapChatError(error) };
  }
}

export async function sendChatMessage(
  client: ChatClient,
  input: { rideId: string; content: string; clientMessageId: string },
): Promise<ChatResult<ChatMessage>> {
  const validated = validateChatContent(input.content);
  if (!validated.ok) return validated;

  const result = await callRows(async () =>
    (client.rpc as any)('send_chat_message', {
      p_ride_id: input.rideId,
      p_content: validated.data,
      p_client_message_id: input.clientMessageId,
    }),
  );

  if (!result.ok) return result;
  return { ok: true, data: toChatMessage(result.data) };
}

export async function editChatMessage(
  client: ChatClient,
  input: { messageId: string; content: string },
): Promise<ChatResult<ChatMessage>> {
  const validated = validateChatContent(input.content);
  if (!validated.ok) return validated;

  const result = await callRows(async () =>
    (client.rpc as any)('edit_chat_message', {
      p_message_id: input.messageId,
      p_content: validated.data,
    }),
  );

  if (!result.ok) return result;
  return { ok: true, data: toChatMessage(result.data) };
}

/** Soft delete: baris tetap ada untuk moderasi, isinya tidak lagi ditampilkan. */
export async function deleteChatMessage(
  client: ChatClient,
  messageId: string,
): Promise<ChatResult<ChatMessage>> {
  const result = await callRows(async () =>
    (client.rpc as any)('delete_chat_message', { p_message_id: messageId }),
  );

  if (!result.ok) return result;
  return { ok: true, data: toChatMessage(result.data) };
}

/**
 * Satu halaman riwayat chat.
 *
 * Kueri mengambil `limit + 1` baris untuk mengetahui apakah masih ada halaman
 * lebih lama, lalu hasilnya dibalik menjadi urutan lama → baru.
 */
export async function getChatMessages(
  client: ChatClient,
  rideId: string,
  options: ChatPageOptions = {},
): Promise<ChatResult<ChatPage>> {
  const limit = options.limit ?? CHAT_PAGE_SIZE;

  try {
    let query = client
      .from('chat_messages')
      .select(CHAT_COLUMNS)
      .eq('ride_id', rideId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (options.before) {
      const createdAt = options.before.created_at;
      const id = options.before.id;
      // Keyset: lebih lama dari cursor, atau timestamp sama dengan id lebih kecil.
      query = query.or(
        `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt."${id}")`,
      );
    }

    const { data, error } = await query;
    if (error) return { ok: false, error: mapChatError(error) };

    const rows = (data ?? []).map(toChatMessage);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return { ok: true, data: { messages: page.slice().reverse(), hasMore } };
  } catch (error) {
    return { ok: false, error: mapChatError(error) };
  }
}

/**
 * Gabungkan pesan baru/realtime ke daftar yang sudah ada tanpa duplikat.
 *
 * Identitas pesan adalah `id` server, bukan `client_message_id`, sehingga pesan
 * optimistis yang sudah dikonfirmasi server tidak muncul dua kali. Hasil selalu
 * diurutkan lama → baru dan tidak pernah memuat isi pesan terhapus.
 */
export function mergeChatMessages(
  existing: readonly ChatMessage[],
  incoming: readonly ChatMessageRow[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();

  for (const message of existing) byId.set(message.id, message);
  for (const row of incoming) {
    const next = toChatMessage(row);
    const previous = byId.get(next.id);
    // Baris hasil realtime bisa lebih lama dari versi lokal; jangan menurunkan versi.
    if (previous && previous.edited_at && !next.edited_at && !next.deleted) {
      byId.set(next.id, { ...next, edited_at: previous.edited_at, content: previous.content });
      continue;
    }
    byId.set(next.id, next);
  }

  return [...byId.values()].sort((a, b) => {
    const diff = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type ChatSubscriptionHandlers = {
  onInsert?: (message: ChatMessage) => void;
  onUpdate?: (message: ChatMessage) => void;
  onDelete?: (messageId: string) => void;
  /** Status channel Supabase: `SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`. */
  onStatus?: (status: string) => void;
};

export type ChatSubscription = { unsubscribe: () => void };

/**
 * Langganan Postgres Changes untuk satu perjalanan.
 *
 * Bukan Broadcast publik: setiap baris tetap melewati policy SELECT
 * `chat_select_ride_member` sebelum dikirim, jadi non-anggota, peserta yang
 * keluar, dan peserta yang dikeluarkan tidak menerima baris apa pun.
 */
export function subscribeChatMessages(
  client: ChatClient,
  rideId: string,
  handlers: ChatSubscriptionHandlers,
): ChatSubscription {
  const channel = client
    .channel(`ride-chat:${rideId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `ride_id=eq.${rideId}` },
      (payload) => {
        const row = payload.new as ChatMessageRow | undefined;
        if (!row || row.ride_id !== rideId) return;
        handlers.onInsert?.(toChatMessage(row));
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `ride_id=eq.${rideId}` },
      (payload) => {
        const row = payload.new as ChatMessageRow | undefined;
        if (!row || row.ride_id !== rideId) return;
        handlers.onUpdate?.(toChatMessage(row));
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'chat_messages', filter: `ride_id=eq.${rideId}` },
      (payload) => {
        const row = payload.old as { id?: string } | undefined;
        if (row?.id) handlers.onDelete?.(row.id);
      },
    )
    .subscribe((status) => handlers.onStatus?.(status));

  return {
    unsubscribe: () => {
      void client.removeChannel(channel);
    },
  };
}

/** Laporkan pesan chat melalui RPC moderasi yang sama dengan laporan bahaya. */
export async function reportChatMessage(
  client: ChatClient,
  messageId: string,
  reason: ContentReportReason,
  details?: string,
): Promise<ChatResult<{ id: string }>> {
  const result = await reportContent(client, {
    targetType: 'chat_message',
    targetId: messageId,
    reason,
    details,
  });

  if (!result.ok) return result;
  return { ok: true, data: { id: result.data.id } };
}
