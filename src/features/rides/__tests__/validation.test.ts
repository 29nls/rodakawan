import {
  formatRideSchedule,
  parseStartsAt,
  rideDescriptionError,
  rideLabelError,
  rideTitleError,
} from '@/features/rides/validation';

describe('validasi perjalanan', () => {
  it('menerima judul 3-120 karakter dan menolak di luar itu', () => {
    expect(rideTitleError('Kopdar')).toBeUndefined();
    expect(rideTitleError('  abc  ')).toBeUndefined();
    expect(rideTitleError('ab')).toMatch(/minimal 3/);
    expect(rideTitleError('')).toMatch(/Isi judul/);
    expect(rideTitleError('x'.repeat(121))).toMatch(/maksimal 120/);
  });

  it('membatasi deskripsi dan label', () => {
    expect(rideDescriptionError('catatan')).toBeUndefined();
    expect(rideDescriptionError('x'.repeat(2001))).toMatch(/2000/);
    expect(rideLabelError('x'.repeat(121), 'Titik kumpul')).toMatch(/Titik kumpul/);
  });

  it('mengosongkan jadwal bila input kosong', () => {
    expect(parseStartsAt('   ')).toEqual({ value: null });
  });

  it('mengubah format lokal menjadi ISO yang dapat dibaca', () => {
    const parsed = parseStartsAt('2026-10-20 19:30', new Date('2026-10-01T00:00:00.000Z'));

    expect(parsed.error).toBeUndefined();
    expect(parsed.value).not.toBeNull();
    expect(Number.isNaN(Date.parse(parsed.value!))).toBe(false);
  });

  it('menerima ISO-8601 lengkap', () => {
    const parsed = parseStartsAt('2026-10-20T12:30:00.000Z');

    expect(parsed).toEqual({ value: '2026-10-20T12:30:00.000Z' });
  });

  it('menolak tanggal mustahil dan teks bebas', () => {
    expect(parseStartsAt('2026-02-30 10:00').error).toMatch(/tidak valid/);
    expect(parseStartsAt('besok pagi').error).toMatch(/format/i);
  });

  it('menolak jadwal lebih dari setahun di masa lalu', () => {
    const parsed = parseStartsAt('2020-01-01 10:00', new Date('2026-10-19T00:00:00.000Z'));

    expect(parsed.error).toMatch(/masa lalu/);
  });

  it('menampilkan jadwal kosong dan tidak valid dengan jelas', () => {
    expect(formatRideSchedule(null)).toBe('Belum dijadwalkan');
    expect(formatRideSchedule('bukan tanggal')).toBe('Jadwal tidak valid');
    expect(formatRideSchedule('2026-10-20T12:30:00.000Z')).toMatch(/2026/);
  });
});
