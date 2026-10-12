import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  GENERATED_USERNAME_PREFIX,
  bioError,
  cityError,
  displayNameError,
  isGeneratedUsername,
  normalizeUsername,
  optionalText,
  usernameError,
} from '@/features/profile/validation';

describe('normalizeUsername', () => {
  it('mengecilkan huruf dan memangkas spasi', () => {
    expect(normalizeUsername('  Bayu_Solo ')).toBe('bayu_solo');
  });
});

describe('usernameError', () => {
  it('menerima username sesuai aturan', () => {
    expect(usernameError('bayu_solo')).toBeUndefined();
    expect(usernameError('rider123')).toBeUndefined();
    expect(usernameError('  BAYU  ')).toBeUndefined();
  });

  it('menolak username kosong, pendek, dan terlalu panjang', () => {
    expect(usernameError('')).toBe('Username wajib diisi.');
    expect(usernameError('ab')).toBe('Username minimal 3 karakter.');
    expect(usernameError('a'.repeat(31))).toBe('Username maksimal 30 karakter.');
  });

  it('menolak karakter di luar huruf kecil, angka, dan garis bawah', () => {
    expect(usernameError('bayu solo')).toMatch(/huruf kecil, angka, dan garis bawah/);
    expect(usernameError('bayu-solo')).toMatch(/huruf kecil, angka, dan garis bawah/);
    expect(usernameError('bayu.solo')).toMatch(/huruf kecil, angka, dan garis bawah/);
  });

  it('melindungi awalan username sementara', () => {
    expect(usernameError(`${GENERATED_USERNAME_PREFIX}abc1234567`)).toMatch(/username sementara/);
  });
});

describe('isGeneratedUsername', () => {
  it('mengenali username sementara buatan sistem', () => {
    expect(isGeneratedUsername(`${GENERATED_USERNAME_PREFIX}ab12cd34ef`)).toBe(true);
    expect(isGeneratedUsername('bayu_solo')).toBe(false);
  });
});

describe('displayNameError', () => {
  it('mewajibkan nama dan membatasi panjangnya', () => {
    expect(displayNameError('   ')).toBe('Nama tampilan wajib diisi.');
    expect(displayNameError('Bayu')).toBeUndefined();
    expect(displayNameError('a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toBe(
      `Nama tampilan maksimal ${DISPLAY_NAME_MAX_LENGTH} karakter.`,
    );
  });
});

describe('bioError dan cityError', () => {
  it('opsional tetapi dibatasi panjangnya', () => {
    expect(bioError('')).toBeUndefined();
    expect(bioError('a'.repeat(BIO_MAX_LENGTH + 1))).toBe(
      `Bio maksimal ${BIO_MAX_LENGTH} karakter.`,
    );
    expect(cityError('')).toBeUndefined();
    expect(cityError('a'.repeat(81))).toBe('Kota maksimal 80 karakter.');
  });
});

describe('optionalText', () => {
  it('mengubah field opsional kosong menjadi null agar konsisten di database', () => {
    expect(optionalText('   ')).toBeNull();
    expect(optionalText(' Bandung ')).toBe('Bandung');
  });
});
