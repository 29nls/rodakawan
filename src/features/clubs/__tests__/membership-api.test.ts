import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createClub,
  leaveClub,
  removeClubMember,
  requestClubMembership,
  reviewClubMembership,
  setClubMemberRole,
} from '@/features/clubs/api';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Pengujian lapisan API keanggotaan klub.
 *
 * Yang dibuktikan di sini: pemanggilan memakai RPC (bukan DML langsung), argumen
 * yang dikirim sesuai kontrak fungsi database, slug diturunkan dari nama, dan
 * kegagalan dilaporkan sebagai `error` — termasuk saat fungsi RPC-nya belum ada di
 * backend (`PGRST202`), yang tidak boleh terlihat seperti sukses.
 */
type RpcCall = { name: string; args: Record<string, unknown> };

function createRpcClient(response: { data?: unknown; error?: unknown } = {}) {
  const calls: RpcCall[] = [];

  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });

      return Promise.resolve({ data: response.data ?? null, error: response.error ?? null });
    },
  } as unknown as SupabaseClient<Database>;

  return { client, calls };
}

describe('createClub', () => {
  it('memanggil RPC create_club dengan slug turunan nama dan mengembalikan klub', async () => {
    const { client, calls } = createRpcClient({
      data: {
        id: 'club-1',
        name: 'Rider Solo',
        slug: 'rider-solo',
        visibility: 'public',
        join_policy: 'approval',
      },
    });

    const result = await createClub(client, {
      name: '  Rider   Solo ',
      description: ' Klub rider Solo. ',
      visibility: 'public',
      join_policy: 'approval',
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('create_club');
    expect(calls[0].args).toEqual({
      p_name: 'Rider Solo',
      p_slug: 'rider-solo',
      p_description: 'Klub rider Solo.',
      p_visibility: 'public',
      p_join_policy: 'approval',
    });
  });

  it('menolak nama tidak sah sebelum memanggil backend', async () => {
    const { client, calls } = createRpcClient();

    const result = await createClub(client, {
      name: 'X',
      description: null,
      visibility: 'public',
      join_policy: 'open',
    });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
    if (!result.ok) expect(result.error.code).toBe('invalid_data');
  });

  it('melaporkan RPC yang belum ada di backend sebagai masalah konfigurasi, bukan sukses', async () => {
    const { client } = createRpcClient({ error: { code: 'PGRST202', message: 'not found' } });

    const result = await createClub(client, {
      name: 'Klub Uji',
      description: null,
      visibility: 'public',
      join_policy: 'open',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('table_missing');
      expect(result.error.message).toContain('20261016093000');
      expect(result.error.retryable).toBe(false);
    }
  });
});

describe('mutasi keanggotaan', () => {
  it('mengirim argumen yang benar untuk ajukan, tinjau, peran, keluarkan, dan keluar', async () => {
    const request = createRpcClient({ data: 'pending' });
    expect(await requestClubMembership(request.client, 'club-1')).toEqual({
      ok: true,
      data: 'pending',
    });
    expect(request.calls[0]).toEqual({
      name: 'request_club_membership',
      args: { p_club_id: 'club-1' },
    });

    const review = createRpcClient({ data: 'active' });
    await reviewClubMembership(review.client, 'club-1', 'user-2', true);
    expect(review.calls[0].args).toEqual({
      p_club_id: 'club-1',
      p_user_id: 'user-2',
      p_approve: true,
    });

    const role = createRpcClient({ data: 'admin' });
    await setClubMemberRole(role.client, 'club-1', 'user-2', 'admin');
    expect(role.calls[0].args).toEqual({
      p_club_id: 'club-1',
      p_user_id: 'user-2',
      p_role: 'admin',
    });

    const remove = createRpcClient({ data: 'removed' });
    await removeClubMember(remove.client, 'club-1', 'user-2');
    expect(remove.calls[0].args).toEqual({ p_club_id: 'club-1', p_user_id: 'user-2' });

    const leave = createRpcClient({ data: 'left' });
    await leaveClub(leave.client, 'club-1');
    expect(leave.calls[0]).toEqual({ name: 'leave_club', args: { p_club_id: 'club-1' } });
  });

  it('menerjemahkan penolakan otorisasi database menjadi not_authorized', async () => {
    const { client } = createRpcClient({
      error: { code: '42501', message: 'Hanya owner klub yang boleh mengubah peran anggota.' },
    });

    const result = await setClubMemberRole(client, 'club-1', 'user-2', 'owner');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
  });

  it('menerjemahkan invarian owner terakhir menjadi invalid_data', async () => {
    const { client } = createRpcClient({
      error: { code: '23514', message: 'Owner terakhir tidak bisa diturunkan.' },
    });

    const result = await leaveClub(client, 'club-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_data');
  });
});
