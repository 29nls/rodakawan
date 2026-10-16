import {
  CLUB_NAME_MAX_LENGTH,
  CLUB_SLUG_MAX_LENGTH,
  CLUB_SLUG_MIN_LENGTH,
  clubSlugFromName,
  descriptionError,
  nameError,
  normalizeClubName,
} from '@/features/clubs/validation';

describe('normalizeClubName', () => {
  it('membuang spasi pinggir dan melipat spasi ganda', () => {
    expect(normalizeClubName('  Touring   Malam  ')).toBe('Touring Malam');
  });
});

describe('nameError', () => {
  it('menerima nama pada batas yang diizinkan CHECK constraint', () => {
    expect(nameError('AB')).toBeUndefined();
    expect(nameError('a'.repeat(CLUB_NAME_MAX_LENGTH))).toBeUndefined();
  });

  it('menolak nama yang terlalu pendek atau terlalu panjang', () => {
    expect(nameError('a')).toMatch(/minimal 2/);
    expect(nameError('a'.repeat(CLUB_NAME_MAX_LENGTH + 1))).toMatch(/maksimal 100/);
  });
});

describe('descriptionError', () => {
  it('menerima null dan teks dalam batas kolom', () => {
    expect(descriptionError(null)).toBeUndefined();
    expect(descriptionError('Klub touring malam')).toBeUndefined();
  });

  it('menolak deskripsi melebihi batas kolom', () => {
    expect(descriptionError('a'.repeat(2001))).toMatch(/maksimal 2000/);
  });
});

describe('clubSlugFromName', () => {
  it('membuat slug dari nama biasa', () => {
    expect(clubSlugFromName('Touring Malam')).toBe('touring-malam');
    expect(clubSlugFromName('Kawan   Roda 2026!')).toBe('kawan-roda-2026');
  });

  it('selalu memenuhi panjang minimum walau nama tidak menyisakan karakter', () => {
    for (const name of ['AB', 'a b', '!!!', '??']) {
      const slug = clubSlugFromName(name);

      expect(slug.length).toBeGreaterThanOrEqual(CLUB_SLUG_MIN_LENGTH);
      expect(slug.length).toBeLessThanOrEqual(CLUB_SLUG_MAX_LENGTH);
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('memotong nama panjang agar slug tidak melebihi batas kolom', () => {
    expect(clubSlugFromName('a'.repeat(200))).toHaveLength(CLUB_SLUG_MAX_LENGTH);
  });

  it('deterministik supaya benturan nama bisa dilaporkan sebagai conflict', () => {
    expect(clubSlugFromName('AB')).toBe(clubSlugFromName('AB'));
    expect(clubSlugFromName('Klub Malam')).toBe(clubSlugFromName('Klub  Malam'));
  });
});
