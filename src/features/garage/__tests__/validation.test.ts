import {
  hasFormErrors,
  MOTORCYCLE_MAKE_MAX_LENGTH,
  MOTORCYCLE_YEAR_MAX,
  MOTORCYCLE_YEAR_MIN,
  motorcycleFormErrors,
  normalizeText,
  parseModelYear,
  plateError,
  privateNotesError,
  PRIVATE_NOTES_MAX_LENGTH,
} from '@/features/garage/validation';

describe('validasi formulir kendaraan', () => {
  it('menerima isian yang sah dan mengosongkan tahun sebagai null', () => {
    const errors = motorcycleFormErrors({
      make: 'Honda',
      model: 'Vario 160',
      nickname: 'Si Merah',
      modelYear: '2019',
    });

    expect(hasFormErrors(errors)).toBe(false);
    expect(parseModelYear('2019')).toEqual({ ok: true, value: 2019 });
    expect(parseModelYear('   ')).toEqual({ ok: true, value: null });
  });

  it('mewajibkan merek dan model', () => {
    const errors = motorcycleFormErrors({ make: '   ', model: '', nickname: '', modelYear: '' });

    expect(errors.make).toBeDefined();
    expect(errors.model).toBeDefined();
    expect(hasFormErrors(errors)).toBe(true);
  });

  it('menolak merek yang melebihi batas database', () => {
    const errors = motorcycleFormErrors({
      make: 'A'.repeat(MOTORCYCLE_MAKE_MAX_LENGTH + 1),
      model: 'Vario',
      nickname: '',
      modelYear: '',
    });

    expect(errors.make).toBeDefined();
  });

  it('menolak tahun yang bukan 4 angka atau di luar rentang', () => {
    expect(parseModelYear('19')).toEqual({
      ok: false,
      error: expect.stringContaining('4 angka'),
    });
    expect(parseModelYear(String(MOTORCYCLE_YEAR_MIN - 1))).toEqual({
      ok: false,
      error: expect.stringContaining(String(MOTORCYCLE_YEAR_MIN)),
    });
    expect(parseModelYear(String(MOTORCYCLE_YEAR_MAX + 1)).ok).toBe(false);
    expect(parseModelYear('abcd').ok).toBe(false);
  });

  it('melaporkan tahun tidak sah lewat motorcycleFormErrors', () => {
    const errors = motorcycleFormErrors({
      make: 'Honda',
      model: 'Vario',
      nickname: '',
      modelYear: '3000',
    });

    expect(errors.modelYear).toBeDefined();
  });

  it('merapikan spasi berlebih pada semua teks', () => {
    expect(normalizeText('  Vario   160 ')).toBe('Vario 160');
  });
});

describe('validasi detail privat', () => {
  it('mewajibkan nomor polisi saat bagian privat disimpan', () => {
    expect(plateError('   ')).toBeDefined();
    expect(plateError('B 1234 XYZ')).toBeUndefined();
  });

  it('membatasi panjang nomor polisi agar tidak salah tempel', () => {
    expect(plateError('B'.repeat(17))).toBeDefined();
  });

  it('membatasi panjang catatan privat', () => {
    expect(privateNotesError('a'.repeat(PRIVATE_NOTES_MAX_LENGTH + 1))).toBeDefined();
    expect(privateNotesError('a'.repeat(PRIVATE_NOTES_MAX_LENGTH))).toBeUndefined();
  });
});
