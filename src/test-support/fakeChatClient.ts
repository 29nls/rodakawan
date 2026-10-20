/**
 * Client Supabase palsu untuk pengujian chat konvoi dan laporan bahaya.
 *
 * Yang dibutuhkan test fitur ini lebih dari `createQueryClient`: pemanggilan
 * `rpc`, rantai filter keyset (`or`), tabel `user_blocks`, dan channel realtime.
 * Semua pemanggilan dicatat supaya test dapat membuktikan bentuk query yang
 * dikirim (mis. retry memakai `clientMessageId` yang sama) tanpa menyentuh
 * jaringan maupun modul native.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/supabase/database.types';

export type RpcCall = { name: string; args: Record<string, unknown> };

export type RealtimeCall = {
  event: string;
  config: Record<string, unknown>;
  handler: (payload: { new?: unknown; old?: unknown }) => void;
};

export type FakeChannel = {
  name: string;
  calls: RealtimeCall[];
  statusCallbacks: ((status: string) => void)[];
  /** Kirim event buatan ke handler terdaftar, seperti Postgres Changes. */
  emit: (payload: { new?: unknown; old?: unknown }, event?: string) => void;
  emitStatus: (status: string) => void;
};

export type QueryCall = { table: string; filters: { column: string; value: unknown }[] };

export type FakeChatClient = {
  client: SupabaseClient<Database>;
  rpcCalls: RpcCall[];
  queryCalls: QueryCall[];
  channels: FakeChannel[];
  removedChannels: string[];
};

export type FakeChatClientOptions = {
  /** Baris per tabel; dipakai untuk riwayat chat (`chat_messages`) dan blokir. */
  rows?: Record<string, unknown[]>;
  rpc?: (
    call: RpcCall,
  ) => { data?: unknown; error?: unknown } | Promise<{ data?: unknown; error?: unknown }>;
  /** Status yang dikirim saat `subscribe()` pertama, default `SUBSCRIBED`. */
  status?: string;
};

export function createFakeChatClient(options: FakeChatClientOptions = {}): FakeChatClient {
  const rpcCalls: RpcCall[] = [];
  const queryCalls: QueryCall[] = [];
  const channels: FakeChannel[] = [];
  const removedChannels: string[] = [];

  function createQuery(table: string, rows: unknown[]) {
    const call: QueryCall = { table, filters: [] };
    queryCalls.push(call);

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: () => builder,
      update: () => builder,
      delete: () => builder,
      eq: (column: string, value: unknown) => {
        call.filters.push({ column, value });
        return builder;
      },
      gt: (column: string, value: unknown) => {
        call.filters.push({ column, value: { op: 'gt', value } });
        return builder;
      },
      is: (column: string, value: unknown) => {
        call.filters.push({ column, value: { op: 'is', value } });
        return builder;
      },
      or: (expression: string) => {
        call.filters.push({ column: 'or', value: expression });
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      single: async () => ({ data: rows[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (
        onFulfilled?: (value: { data: unknown[]; error: unknown }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected),
    };

    return builder;
  }

  function createChannel(name: string): FakeChannel & {
    on: (
      event: string,
      config: Record<string, unknown>,
      handler: RealtimeCall['handler'],
    ) => unknown;
    subscribe: (callback?: (status: string) => void) => unknown;
  } {
    const channel = {
      name,
      calls: [] as RealtimeCall[],
      statusCallbacks: [] as ((status: string) => void)[],
      emit: (payload: { new?: unknown; old?: unknown }, event?: string) => {
        for (const call of channel.calls) {
          const callEvent = (call.config.event as string | undefined) ?? call.event;
          if (!event || callEvent === event) call.handler(payload);
        }
      },
      emitStatus: (status: string) => {
        for (const callback of channel.statusCallbacks) callback(status);
      },
      on(event: string, config: Record<string, unknown>, handler: RealtimeCall['handler']) {
        channel.calls.push({ event, config, handler });
        return channel;
      },
      subscribe(callback?: (status: string) => void) {
        if (callback) {
          channel.statusCallbacks.push(callback);
          callback(options.status ?? 'SUBSCRIBED');
        }
        return channel;
      },
    };

    channels.push(channel);
    return channel;
  }

  const client = {
    from(table: string) {
      return createQuery(table, options.rows?.[table] ?? []);
    },
    rpc(name: string, args: Record<string, unknown>) {
      const call = { name, args };
      rpcCalls.push(call);

      if (options.rpc) return Promise.resolve(options.rpc(call));
      return Promise.resolve({ data: null, error: null });
    },
    channel(name: string) {
      return createChannel(name);
    },
    removeChannel(channel: { name?: string }) {
      if (typeof channel?.name === 'string') removedChannels.push(channel.name);
      return Promise.resolve('ok');
    },
  } as unknown as SupabaseClient<Database>;

  return { client, rpcCalls, queryCalls, channels, removedChannels };
}
