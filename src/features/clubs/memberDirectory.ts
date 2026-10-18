/**
 * Penyaringan dan paginasi daftar anggota klub.
 *
 * Dipisahkan dari layar supaya aturannya bisa diuji langsung: pencarian tidak
 * membedakan huruf besar/kecil, filter status/peran digabung dengan pencarian
 * (bukan saling menimpa), halaman selalu dijepit ke rentang yang ada (1..pageCount)
 * sehingga penghapusan/penyetujuan anggota tidak bisa menyisakan halaman kosong, dan
 * urutan hasil stabil — pending lebih dulu, lalu anggota aktif, lalu riwayat, dengan
 * `created_at` sebagai pemecah seri.
 *
 * Daftar ini tidak memuat nama profil, jadi pencarian mencocokkan kolom yang memang
 * ada di `public.club_members`: `user_id`, `role`, dan `status`.
 */

import type {
  ClubMemberRole,
  ClubMemberRow,
  ClubMemberStatus,
} from '@/lib/supabase/database.types';

export type MemberStatusFilter = ClubMemberStatus | 'all';
export type MemberRoleFilter = ClubMemberRole | 'all';

export type MemberFilters = {
  query?: string;
  status?: MemberStatusFilter;
  role?: MemberRoleFilter;
};

export type MemberPage = {
  items: ClubMemberRow[];
  /** Halaman yang benar-benar dipakai setelah dijepit ke rentang yang ada. */
  page: number;
  pageCount: number;
  total: number;
  /** Indeks pertama dan terakhir yang tampil (berbasis 1); 0 bila kosong. */
  start: number;
  end: number;
};

/** Jumlah baris per halaman; cukup kecil agar tombol aksi tetap mudah dijangkau. */
export const MEMBER_PAGE_SIZE = 5;

const STATUS_ORDER: Record<ClubMemberStatus, number> = {
  pending: 0,
  active: 1,
  rejected: 2,
  removed: 3,
  left: 4,
};

/** Urutan filter status di layar, mengikuti alur kerja admin. */
export const MEMBER_STATUS_FILTERS: ClubMemberStatus[] = [
  'pending',
  'active',
  'rejected',
  'removed',
  'left',
];

export const MEMBER_ROLE_FILTERS: ClubMemberRole[] = ['owner', 'admin', 'member'];

function searchableText(member: ClubMemberRow): string {
  return `${member.user_id} ${member.role} ${member.status}`.toLowerCase();
}

/**
 * Menyaring anggota sesuai pencarian dan filter, lalu mengurutkannya untuk daftar.
 * Selalu mengembalikan array baru, sehingga urutan masukan tidak diubah.
 */
export function filterMembers(
  members: ClubMemberRow[],
  filters: MemberFilters = {},
): ClubMemberRow[] {
  const query = (filters.query ?? '').trim().toLowerCase();
  const status = filters.status ?? 'all';
  const role = filters.role ?? 'all';

  return members
    .filter((member) => status === 'all' || member.status === status)
    .filter((member) => role === 'all' || member.role === role)
    .filter((member) => query.length === 0 || searchableText(member).includes(query))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.created_at.localeCompare(b.created_at) ||
        a.user_id.localeCompare(b.user_id),
    );
}

/** Memotong daftar menjadi satu halaman; `page` di luar rentang dijepit, bukan error. */
export function paginateMembers(
  members: ClubMemberRow[],
  page = 1,
  pageSize = MEMBER_PAGE_SIZE,
): MemberPage {
  const total = members.length;
  const safeSize = Math.max(1, Math.floor(pageSize) || MEMBER_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / safeSize));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const offset = (safePage - 1) * safeSize;
  const items = members.slice(offset, offset + safeSize);

  return {
    items,
    page: safePage,
    pageCount,
    total,
    start: total === 0 ? 0 : offset + 1,
    end: Math.min(offset + safeSize, total),
  };
}
