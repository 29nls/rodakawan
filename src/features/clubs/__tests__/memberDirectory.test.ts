import { filterMembers, MEMBER_PAGE_SIZE, paginateMembers } from '@/features/clubs/memberDirectory';
import type {
  ClubMemberRow,
  ClubMemberRole,
  ClubMemberStatus,
} from '@/lib/supabase/database.types';

/**
 * Pengujian aturan daftar anggota: pencarian, filter, urutan, dan paginasi.
 *
 * Yang dibuktikan di sini: pencarian tidak membedakan huruf besar/kecil dan
 * mencocokkan user ID/peran/status, filter digabung (bukan saling menimpa), urutan
 * stabil dengan pending lebih dulu, dan nomor halaman selalu dijepit ke rentang
 * yang ada sehingga daftar tidak pernah menampilkan halaman kosong.
 */

const CLUB_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function member(
  index: number,
  overrides: Partial<ClubMemberRow> & { status?: ClubMemberStatus; role?: ClubMemberRole } = {},
): ClubMemberRow {
  return {
    club_id: CLUB_ID,
    user_id: `${String(index).padStart(8, '0')}-0000-0000-0000-000000000000`,
    role: 'member',
    status: 'active',
    joined_at: '2026-10-01T00:00:00.000Z',
    created_at: `2026-10-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('filterMembers', () => {
  it('mencocokkan pencarian pada user ID, peran, dan status tanpa membedakan huruf besar/kecil', () => {
    const members = [
      member(1, { role: 'owner' }),
      member(2, { role: 'admin' }),
      member(3, { role: 'member', status: 'pending' }),
    ];

    expect(filterMembers(members, { query: '00000002' }).map((row) => row.user_id)).toEqual([
      members[1].user_id,
    ]);
    expect(filterMembers(members, { query: 'ADMIN' }).map((row) => row.user_id)).toEqual([
      members[1].user_id,
    ]);
    expect(filterMembers(members, { query: '  pending  ' }).map((row) => row.user_id)).toEqual([
      members[2].user_id,
    ]);
    expect(filterMembers(members, { query: '' })).toHaveLength(3);
  });

  it('menggabungkan filter status dan peran dengan pencarian', () => {
    const members = [
      member(1, { role: 'owner' }),
      member(2, { role: 'admin' }),
      member(3, { role: 'admin', status: 'pending' }),
      member(4, { role: 'member', status: 'removed' }),
    ];

    expect(
      filterMembers(members, { status: 'active', role: 'admin' }).map((row) => row.user_id),
    ).toEqual([members[1].user_id]);
    expect(
      filterMembers(members, { status: 'pending', role: 'admin', query: 'tidak-ada' }).map(
        (row) => row.user_id,
      ),
    ).toEqual([]);
    expect(
      filterMembers(members, { status: 'pending', role: 'admin', query: '00000003' }).map(
        (row) => row.user_id,
      ),
    ).toEqual([members[2].user_id]);
    expect(filterMembers(members, { status: 'all', role: 'all' })).toHaveLength(4);
  });

  it('mengurutkan pending lebih dulu, lalu aktif, lalu riwayat, dan tidak mengubah array masukan', () => {
    const members = [
      member(4, { status: 'left' }),
      member(1, { status: 'active' }),
      member(3, { status: 'removed' }),
      member(2, { status: 'pending' }),
    ];
    const original = members.map((row) => row.user_id);

    const result = filterMembers(members, {});

    expect(result.map((row) => row.status)).toEqual(['pending', 'active', 'removed', 'left']);
    expect(members.map((row) => row.user_id)).toEqual(original);
  });
});

describe('paginateMembers', () => {
  const members = Array.from({ length: 12 }, (_, index) => member(index + 1));

  it('memotong daftar sesuai ukuran halaman dan melaporkan rentangnya', () => {
    const first = paginateMembers(members, 1, 5);

    expect(first.items).toHaveLength(5);
    expect(first.items[0].user_id).toBe(members[0].user_id);
    expect(first.page).toBe(1);
    expect(first.pageCount).toBe(3);
    expect(first.total).toBe(12);
    expect(first.start).toBe(1);
    expect(first.end).toBe(5);

    const last = paginateMembers(members, 3, 5);

    expect(last.items).toHaveLength(2);
    expect(last.items[1].user_id).toBe(members[11].user_id);
    expect(last.start).toBe(11);
    expect(last.end).toBe(12);
  });

  it('menjepit nomor halaman di luar rentang, termasuk 0, negatif, dan NaN', () => {
    expect(paginateMembers(members, 99, 5).page).toBe(3);
    expect(paginateMembers(members, 0, 5).page).toBe(1);
    expect(paginateMembers(members, -4, 5).page).toBe(1);
    expect(paginateMembers(members, Number.NaN, 5).page).toBe(1);
    expect(paginateMembers(members, 2, Number.NaN).pageCount).toBe(3);
  });

  it('mengembalikan halaman kosong yang aman untuk daftar tanpa anggota', () => {
    const result = paginateMembers([], 1);

    expect(result.items).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.total).toBe(0);
    expect(result.start).toBe(0);
    expect(result.end).toBe(0);
  });

  it('memakai ukuran halaman bawaan saat tidak ditentukan', () => {
    const result = paginateMembers(members);

    expect(result.items).toHaveLength(MEMBER_PAGE_SIZE);
  });
});
