import type { SupabaseClient } from '@supabase/supabase-js';

import { mapRpcError, mapTableError, type AppError } from '@/features/auth/errors';
import type { Database } from '@/lib/supabase/database.types';

export type ChatClient = SupabaseClient<Database>;
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };
export type ChatMessageRow = {
  id: string;
  ride_id: string;
  sender_id: string;
  message_type: 'text' | 'system';
  content: string;
  edited_at: string | null;
  created_at: string;
  deleted_at?: string | null;
};
export type SystemMessageRow = {
  id: string;
  ride_id: string;
  sender_id: string | null;
  message_type: 'system';
  content: string;
  created_at: string;
};
export type ChatFilters = {
  rideId?: string;
  searchAfter?: { id: string; created_at: string };
};

function chatTrimInvalidMessage(): string {
  return 'Pesan harus 1-2000 karakter setelah ditrim.';
}

function chatRateLimitMessage(): string {
  return 'Terlalu banyak pesan dalam waktu singkat. Coba lagi sebentar lagi.';
}

function chatEditWindowMessage(): string {
  return 'Jendela pengubahan pesan sudah lewat (15 menit sejak dikirim)';
}

function chatNotSenderMessage(): string {
  return 'Hanya pengirim yang dapat mengubah/hapus pesannya';
}

function chatSystemMessageMessage(): string {
  return 'Pesan sistem tidak dapat diubah/hapus';
}

export async function sendChatMessage(
  client: ChatClient,
  rideId: string,
  content: string,
  clientMessageId?: string,
): Promise<ApiResult<ChatMessageRow>> {
  // Validasi konten (1-2000 karakter)
  if (content.length < 1 || content.length > 2000) {
    return {
      ok: false,
      error: { code: 'chat_trim_invalid', message: chatTrimInvalidMessage(), retryable: false },
    };
  }

  const { data, error } = await (client.rpc as any)('send_chat_message', {
    p_ride_id: rideId,
    p_content: content,
    p_client_message_id: clientMessageId ?? null,
  });

  if (error) {
    const detail = (error as any).details || (error as any).detail || '';
    // Deteksi rate limit
    if (typeof detail === 'string' && detail.includes('chat_rate_limit')) {
      return {
        ok: false,
        error: { code: 'chat_rate_limit', message: chatRateLimitMessage(), retryable: true },
      };
    }
    // Deteksi ride final
    if (typeof detail === 'string' && detail.includes('chat_ride_final')) {
      return {
        ok: false,
        error: {
          code: 'chat_ride_final',
          message: 'Perjalanan ini sudah selesai, pesan baru tidak dapat dikirim',
          retryable: false,
        },
      };
    }
    return { ok: false, error: mapRpcError(error) };
  }

  return { ok: true, data: data as ChatMessageRow };
}

/** Ubah pesan. Hanya pengirim, hanya `message_type = 'text'`, tidak boleh sudah dihapus, maksimal 15 menit sejak `created_at`. */
export async function editChatMessage(
  client: ChatClient,
  messageId: string,
  content: string,
): Promise<ApiResult<ChatMessageRow>> {
  // Validasi konten (1-2000 karakter)
  if (content.length < 1 || content.length > 2000) {
    return {
      ok: false,
      error: { code: 'chat_trim_invalid', message: chatTrimInvalidMessage(), retryable: false },
    };
  }

  const { data, error } = await (client.rpc as any)('edit_chat_message', {
    p_message_id: messageId,
    p_content: content,
  });

  if (error) {
    const detail = (error as any).details || (error as any).detail || '';
    // Deteksi jendela edit
    if (typeof detail === 'string' && detail.includes('jendela edit')) {
      return {
        ok: false,
        error: { code: 'chat_edit_window', message: chatEditWindowMessage(), retryable: false },
      };
    }
    // Deteksi pesan sistem
    if (typeof detail === 'string' && detail.includes('chat_system_message')) {
      return {
        ok: false,
        error: {
          code: 'chat_system_message',
          message: chatSystemMessageMessage(),
          retryable: false,
        },
      };
    }
    // Deteksi bukan pengirim
    if (typeof detail === 'string' && detail.includes('chat_not_sender')) {
      return {
        ok: false,
        error: { code: 'chat_not_sender', message: chatNotSenderMessage(), retryable: false },
      };
    }
    return { ok: false, error: mapRpcError(error) };
  }

  return { ok: true, data: data as ChatMessageRow };
}

/** Hapus (soft delete) pesan: `deleted_at`, baris tetap ada untuk moderasi. Idempoten: menghapus pesan yang sudah terhapus mengembalikan baris yang sama. */
export async function deleteChatMessage(
  client: ChatClient,
  messageId: string,
): Promise<ApiResult<ChatMessageRow>> {
  const { data, error } = await (client.rpc as any)('delete_chat_message', {
    p_message_id: messageId,
  });

  if (error) {
    const detail = (error as any).details || (error as any).detail || '';
    // Deteksi rate limit
    if (typeof detail === 'string' && detail.includes('chat_rate_limit')) {
      return {
        ok: false,
        error: { code: 'chat_rate_limit', message: chatRateLimitMessage(), retryable: true },
      };
    }
    // Deteksi jendela edit
    if (typeof detail === 'string' && detail.includes('jendela edit')) {
      return {
        ok: false,
        error: { code: 'chat_edit_window', message: chatEditWindowMessage(), retryable: false },
      };
    }
    // Deteksi pesan sistem
    if (typeof detail === 'string' && detail.includes('chat_system_message')) {
      return {
        ok: false,
        error: {
          code: 'chat_system_message',
          message: chatSystemMessageMessage(),
          retryable: false,
        },
      };
    }
    // Deteksi bukan pengirim
    if (typeof detail === 'string' && detail.includes('chat_not_sender')) {
      return {
        ok: false,
        error: { code: 'chat_not_sender', message: chatNotSenderMessage(), retryable: false },
      };
    }
    return { ok: false, error: mapRpcError(error) };
  }

  return { ok: true, data: data as ChatMessageRow };
}

/** Dapatkan riwayat pesan. Menggunakan keyset pagination dengan ordering berdasarkan created_at dan id. */
export async function getChatHistory(
  client: ChatClient,
  rideId: string,
  hasMore: boolean = false,
): Promise<ApiResult<ChatMessageRow[]>> {
  let query = client
    .from('chat_messages')
    .select('id, ride_id, sender_id, message_type, content, edited_at, created_at')
    .eq('ride_id', rideId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (hasMore) {
    // Ambil lebih sedikit untuk membuat space di UI
    query = query.limit(20);
  } else {
    // Ambil pesan terbaru 50
    query = query.limit(50);
  }

  const { data, error } = await query;

  if (error) return { ok: false, error: mapTableError(error) };

  return { ok: true, data: (data || []) as ChatMessageRow[] };
}

/** Kirim pesan sistem untuk transisi ride/membership. */
export async function insertRideSystemMessage(
  client: ChatClient,
  rideId: string,
  type:
    | 'ride_started'
    | 'ride_completed'
    | 'ride_cancelled'
    | 'member_joined'
    | 'member_left'
    | 'member_removed',
  content: string,
): Promise<ApiResult<SystemMessageRow>> {
  const { data, error } = await (client.rpc as any)('insert_ride_system_message', {
    p_ride_id: rideId,
    p_content: content,
  });

  if (error) return { ok: false, error: mapRpcError(error) };

  return { ok: true, data: data as SystemMessageRow };
}

/** Filtri pesan: hanya anggota join aktif yang bisa membaca */
export async function filterActiveMembers(
  client: ChatClient,
  rideId: string,
  userId: string,
): Promise<ApiResult<boolean>> {
  const { data, error } = await client
    .from('ride_members')
    .select('status')
    .eq('ride_id', rideId)
    .eq('user_id', userId)
    .single();

  if (error) return { ok: false, error: mapTableError(error) };

  if (!data || (data as any).status !== 'joined') {
    return {
      ok: false,
      error: {
        code: 'chat_not_member',
        message: 'Anda bukan anggota aktif perjalanan ini',
        retryable: false,
      },
    };
  }

  return { ok: true, data: true };
}
