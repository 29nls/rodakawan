/**
 * Bantuan pengujian: client Supabase palsu.
 *
 * Dipakai agar pengujian lapisan API tidak menyentuh jaringan maupun modul native,
 * dan agar test bisa memeriksa argumen yang benar-benar dikirim ke SDK
 * (mis. filter `id` pada query profil).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, ProfileRow } from '@/lib/supabase/database.types';

export type AuthSpies = {
  signUp: jest.Mock;
  signInWithPassword: jest.Mock;
  signOut: jest.Mock;
  resetPasswordForEmail: jest.Mock;
  resend: jest.Mock;
  updateUser: jest.Mock;
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  exchangeCodeForSession: jest.Mock;
  verifyOtp: jest.Mock;
  setSession: jest.Mock;
  initialize: jest.Mock;
  startAutoRefresh: jest.Mock;
  stopAutoRefresh: jest.Mock;
};

export type AuthResultShape = { data: unknown; error: unknown };

const DEFAULT_RESULT: AuthResultShape = { data: {}, error: null };

export function createAuthSpies(overrides: Partial<AuthSpies> = {}): AuthSpies {
  return {
    signUp: jest.fn(async () => DEFAULT_RESULT),
    signInWithPassword: jest.fn(async () => DEFAULT_RESULT),
    signOut: jest.fn(async () => DEFAULT_RESULT),
    resetPasswordForEmail: jest.fn(async () => DEFAULT_RESULT),
    resend: jest.fn(async () => DEFAULT_RESULT),
    updateUser: jest.fn(async () => DEFAULT_RESULT),
    getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    exchangeCodeForSession: jest.fn(async () => DEFAULT_RESULT),
    verifyOtp: jest.fn(async () => DEFAULT_RESULT),
    setSession: jest.fn(async () => DEFAULT_RESULT),
    initialize: jest.fn(async () => ({ data: { session: null, user: null }, error: null })),
    startAutoRefresh: jest.fn(async () => undefined),
    stopAutoRefresh: jest.fn(async () => undefined),
    ...overrides,
  };
}

export function createAuthClient(spies: Partial<AuthSpies> = {}): {
  client: SupabaseClient<Database>;
  auth: AuthSpies;
} {
  const auth = createAuthSpies(spies);
  const client = { auth } as unknown as SupabaseClient<Database>;
  return { client, auth };
}

export type ProfileQueryResult = {
  data?: ProfileRow | null;
  error?: { code?: string; message?: string; details?: string } | null;
};

export type ProfileQueryLog = {
  table: string | null;
  selectColumns: string | null;
  insertValues: Record<string, unknown> | null;
  updateValues: Record<string, unknown> | null;
  filters: { column: string; value: unknown }[];
  maybeSingleCalls: number;
  singleCalls: number;
};

/**
 * Client palsu untuk tabel `public.profiles` yang mencatat filter dan nilai tulis,
 * sehingga test dapat membuktikan query selalu dibatasi pada `id` milik sesi.
 */
export function createProfilesClient(result: ProfileQueryResult = {}): {
  client: SupabaseClient<Database>;
  log: ProfileQueryLog;
} {
  const log: ProfileQueryLog = {
    table: null,
    selectColumns: null,
    insertValues: null,
    updateValues: null,
    filters: [],
    maybeSingleCalls: 0,
    singleCalls: 0,
  };

  const response = {
    data: result.data ?? null,
    error: result.error ?? null,
    status: result.error ? 400 : 200,
    statusText: '',
    count: null,
  };

  const builder = {
    select(columns = '*') {
      log.selectColumns = columns;
      return builder;
    },
    insert(values: Record<string, unknown>) {
      log.insertValues = values;
      return builder;
    },
    update(values: Record<string, unknown>) {
      log.updateValues = values;
      return builder;
    },
    eq(column: string, value: unknown) {
      log.filters.push({ column, value });
      return builder;
    },
    async maybeSingle() {
      log.maybeSingleCalls += 1;
      return response;
    },
    async single() {
      log.singleCalls += 1;
      return response;
    },
  };

  const client = {
    from(table: string) {
      log.table = table;
      return builder;
    },
  } as unknown as SupabaseClient<Database>;

  return { client, log };
}

/** Profil contoh dengan bentuk kolom seperti hasil `select *`. */
export function buildProfileRow(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    username: 'uji_user',
    display_name: 'Uji User',
    avatar_url: null,
    bio: null,
    city: null,
    is_private: false,
    created_at: '2026-10-12T00:00:00.000Z',
    updated_at: '2026-10-12T00:00:00.000Z',
    ...overrides,
  };
}
