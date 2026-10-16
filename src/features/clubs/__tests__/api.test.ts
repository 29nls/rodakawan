import { getClubDetails, listClubMembers, listClubs, updateClub } from '@/features/clubs/api';
import type { ClubMemberRow, ClubRow } from '@/lib/supabase/database.types';
import { createQueryClient } from '@/test-support/fakeSupabase';

const CLUB_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SESSION_USER_ID = '11111111-1111-1111-1111-111111111111';

function buildClub(overrides: Partial<ClubRow> = {}): ClubRow {
  return {
    id: CLUB_ID,
    name: 'Touring Malam',
    slug: 'touring-malam',
    description: null,
    logo_path: null,
    visibility: 'public',
    join_policy: 'approval',
    created_by: SESSION_USER_ID,
    created_at: '2026-10-15T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

function buildMember(overrides: Partial<ClubMemberRow> = {}): ClubMemberRow {
  return {
    club_id: CLUB_ID,
    user_id: SESSION_USER_ID,
    role: 'member',
    status: 'active',
    joined_at: '2026-10-15T00:00:00.000Z',
    created_at: '2026-10-15T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('listClubs', () => {
  it('hanya mengambil klub publik, terbaru lebih dulu', async () => {
    const club = buildClub();
    const { client, log } = createQueryClient({ data: [club] });

    const result = await listClubs(client);

    expect(log.queries).toEqual([
      {
        table: 'clubs',
        op: 'select',
        columns: '*',
        values: null,
        onConflict: null,
        filters: [{ column: 'visibility', value: 'public' }],
        order: [{ column: 'created_at', ascending: false }],
      },
    ]);
    expect(result).toEqual({ ok: true, data: [club] });
  });

  it('memetakan penolakan database menjadi error yang bisa ditindaklanjuti', async () => {
    const { client } = createQueryClient({
      error: { code: '42501', message: 'permission denied' },
    });

    const result = await listClubs(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_authorized');
      expect(result.error.retryable).toBe(false);
    }
  });
});

describe('getClubDetails', () => {
  it('membaca keanggotaan dengan filter club_id dan user_id milik sesi', async () => {
    const { client, log } = createQueryClient([
      { data: buildClub() },
      { data: { role: 'admin', status: 'active' } },
    ]);

    const result = await getClubDetails(client, CLUB_ID, SESSION_USER_ID);

    expect(log.maybeSingleCalls).toBe(2);
    expect(log.queries[1].table).toBe('club_members');
    expect(log.queries[1].columns).toBe('role, status');
    expect(log.queries[1].filters).toEqual([
      { column: 'club_id', value: CLUB_ID },
      { column: 'user_id', value: SESSION_USER_ID },
    ]);
    expect(result).toEqual({
      ok: true,
      data: {
        club: buildClub(),
        isMember: true,
        isAdmin: true,
        myRole: 'admin',
        memberStatus: 'active',
      },
    });
  });

  it('tidak menganggap permintaan yang belum disetujui sebagai keanggotaan', async () => {
    const { client } = createQueryClient([
      { data: buildClub() },
      { data: { role: 'member', status: 'pending' } },
    ]);

    const result = await getClubDetails(client, CLUB_ID, SESSION_USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isMember).toBe(false);
      expect(result.data.isAdmin).toBe(false);
      expect(result.data.memberStatus).toBe('pending');
      expect(result.data.myRole).toBe('member');
    }
  });

  it('tidak menanyakan keanggotaan bila belum ada sesi', async () => {
    const { client, log } = createQueryClient({ data: buildClub() });

    const result = await getClubDetails(client, CLUB_ID, null);

    expect(log.queries).toHaveLength(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isMember).toBe(false);
      expect(result.data.myRole).toBeNull();
      expect(result.data.memberStatus).toBeNull();
    }
  });

  it('melaporkan klub yang tidak terbaca sebagai not_found tanpa query kedua', async () => {
    const { client, log } = createQueryClient({ data: null });

    const result = await getClubDetails(client, CLUB_ID, SESSION_USER_ID);

    expect(log.queries).toHaveLength(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });
});

describe('listClubMembers', () => {
  it('membatasi daftar anggota pada satu klub', async () => {
    const member = buildMember();
    const { client, log } = createQueryClient({ data: [member] });

    const result = await listClubMembers(client, CLUB_ID);

    expect(log.queries[0].table).toBe('club_members');
    expect(log.queries[0].filters).toEqual([{ column: 'club_id', value: CLUB_ID }]);
    expect(log.queries[0].order).toEqual([{ column: 'created_at', ascending: true }]);
    expect(result).toEqual({ ok: true, data: [member] });
  });
});

describe('updateClub', () => {
  it('menolak nama yang tidak valid sebelum ada query dikirim', async () => {
    const { client, log } = createQueryClient({ data: buildClub() });

    const result = await updateClub(client, CLUB_ID, { name: 'a' });

    expect(log.queries).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_data');
  });

  it('menolak perubahan kosong', async () => {
    const { client, log } = createQueryClient({ data: buildClub() });

    const result = await updateClub(client, CLUB_ID, {});

    expect(log.queries).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_data');
  });

  it('mengirim nama yang dirapikan, updated_at, dan filter id klub', async () => {
    const updated = buildClub({ name: 'Klub Malam' });
    const { client, log } = createQueryClient({ data: updated });

    const result = await updateClub(client, CLUB_ID, {
      name: '  Klub   Malam ',
      description: '  Klub touring malam  ',
      visibility: 'private',
    });

    expect(log.queries[0].op).toBe('update');
    expect(log.queries[0].filters).toEqual([{ column: 'id', value: CLUB_ID }]);
    expect(log.queries[0].values).toEqual({
      name: 'Klub Malam',
      description: 'Klub touring malam',
      visibility: 'private',
      updated_at: expect.any(String),
    });
    expect(result).toEqual({ ok: true, data: updated });
  });

  it('melaporkan penolakan policy sebagai error, bukan sukses palsu', async () => {
    const { client } = createQueryClient({
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
    });

    const result = await updateClub(client, CLUB_ID, { visibility: 'private' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_authorized');
      expect(result.error.message).toMatch(/tidak diterapkan/i);
    }
  });
});
