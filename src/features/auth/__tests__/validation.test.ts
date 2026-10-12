import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  describePasswordPolicy,
  emailError,
  normalizeEmail,
  passwordConfirmationError,
  passwordError,
  signInPasswordError,
} from '@/features/auth/validation';

describe('normalizeEmail', () => {
  it('memangkas spasi dan mengecilkan huruf', () => {
    expect(normalizeEmail('  Budi@Contoh.COM ')).toBe('budi@contoh.com');
  });
});

describe('emailError', () => {
  it('menerima email yang wajar', () => {
    expect(emailError('rider@contoh.com')).toBeUndefined();
    expect(emailError('nama.touring+klub@sub.contoh.co.id')).toBeUndefined();
  });

  it('menolak email kosong', () => {
    expect(emailError('')).toBe('Email wajib diisi.');
    expect(emailError('   ')).toBe('Email wajib diisi.');
  });

  it('menolak format tanpa @ atau domain', () => {
    expect(emailError('rider.contoh.com')).toMatch(/Format email/);
    expect(emailError('rider@contoh')).toMatch(/Domain email/);
    expect(emailError('rider@contoh.')).toMatch(/Domain email/);
  });

  it('menolak karakter yang tidak wajar', () => {
    expect(emailError('ri der@contoh.com')).toMatch(/Format email/);
    expect(emailError('rider@con toh.com')).toMatch(/Domain email/);
  });

  it('menolak email yang terlalu panjang', () => {
    expect(emailError(`${'a'.repeat(250)}@contoh.com`)).toBe('Email terlalu panjang.');
  });
});

describe('passwordError', () => {
  it('menerima kata sandi yang memenuhi kebijakan', () => {
    expect(passwordError('touring2026')).toBeUndefined();
    expect(passwordError('RodaKawan1')).toBeUndefined();
  });

  it('menolak kata sandi kosong', () => {
    expect(passwordError('')).toBe('Kata sandi wajib diisi.');
  });

  it('menolak kata sandi terlalu pendek atau terlalu panjang', () => {
    expect(passwordError('a1'.repeat(2))).toBe(
      `Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.`,
    );
    expect(passwordError(`a1${'x'.repeat(PASSWORD_MAX_LENGTH)}`)).toBe(
      `Kata sandi maksimal ${PASSWORD_MAX_LENGTH} karakter.`,
    );
  });

  it('mewajibkan huruf dan angka', () => {
    expect(passwordError('12345678')).toBe('Kata sandi harus memuat minimal satu huruf.');
    expect(passwordError('tanpaangka')).toBe('Kata sandi harus memuat minimal satu angka.');
  });
});

describe('signInPasswordError', () => {
  it('hanya mewajibkan terisi (kebijakan lama tidak dipaksakan)', () => {
    expect(signInPasswordError('')).toBe('Kata sandi wajib diisi.');
    expect(signInPasswordError('lama')).toBeUndefined();
  });
});

describe('passwordConfirmationError', () => {
  it('meminta konfirmasi terisi dan sama', () => {
    expect(passwordConfirmationError('touring2026', '')).toMatch(/Ulangi kata sandi/);
    expect(passwordConfirmationError('touring2026', 'touring2027')).toBe(
      'Konfirmasi kata sandi belum sama.',
    );
    expect(passwordConfirmationError('touring2026', 'touring2026')).toBeUndefined();
  });
});

describe('describePasswordPolicy', () => {
  it('menyebut angka dan huruf sesuai aturan', () => {
    expect(describePasswordPolicy()).toContain('huruf');
    expect(describePasswordPolicy()).toContain('angka');
  });
});
