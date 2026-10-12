import { contrastRatio, describeContrast, parseHexColor, relativeLuminance } from '@/utils/color';

describe('parseHexColor', () => {
  it('membaca format #rrggbb', () => {
    expect(parseHexColor('#0B0D10')).toEqual({ r: 11, g: 13, b: 16 });
  });

  it('membaca format #rgb', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('menolak nilai di luar format hex', () => {
    expect(parseHexColor('rgba(0,0,0,0.5)')).toBeUndefined();
    expect(parseHexColor('#12345')).toBeUndefined();
    expect(parseHexColor('')).toBeUndefined();
  });
});

describe('contrastRatio', () => {
  it('memberi 21:1 untuk hitam dan putih', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('memberi 1:1 untuk warna identik', () => {
    expect(contrastRatio('#0B0D10', '#0B0D10')).toBeCloseTo(1, 5);
  });

  it('tidak bergantung pada urutan argumen', () => {
    const a = contrastRatio('#F3F6F9', '#0B0D10');
    const b = contrastRatio('#0B0D10', '#F3F6F9');
    expect(a).toBeCloseTo(b ?? 0, 5);
  });

  it('mengembalikan undefined untuk warna tidak valid', () => {
    expect(contrastRatio('not-a-color', '#0B0D10')).toBeUndefined();
  });
});

describe('relativeLuminance', () => {
  it('menghasilkan 0 untuk hitam dan 1 untuk putih', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
});

describe('describeContrast', () => {
  it('menyatakan lintas ambang AA untuk teks normal', () => {
    const report = describeContrast('#B7C1CC', '#0B0D10');
    expect(report.passesNormalText).toBe(true);
    expect(report.label).toContain('AA');
  });

  it('menandai warna berisiko sebagai gagal', () => {
    const report = describeContrast('#3A3F45', '#0B0D10');
    expect(report.passesNormalText).toBe(false);
    expect(report.label).toContain('Gagal');
  });

  it('menandai nilai tidak valid dengan jelas', () => {
    const report = describeContrast('rgb(0,0,0)', '#0B0D10');
    expect(report.ratio).toBeUndefined();
    expect(report.label).toBe('Tidak dapat dihitung');
  });
});
