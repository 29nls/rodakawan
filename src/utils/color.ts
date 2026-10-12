/**
 * Utilitas warna untuk memeriksa kontras teks terhadap latar (WCAG 2.2).
 * Dipakai layar Fondasi agar keputusan tema dapat diverifikasi, bukan diklaim.
 * Referensi rumus: WCAG 2.2, relative luminance & contrast ratio.
 */
export type RgbColor = { r: number; g: number; b: number };

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Mendukung #rgb dan #rrggbb (nilai tanpa alpha, sesuai token tema). */
export function parseHexColor(value: string): RgbColor | undefined {
  const normalized = value.trim();
  if (!HEX_PATTERN.test(normalized)) return undefined;

  const hex = normalized.slice(1);
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : hex;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function channelLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: RgbColor): number {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}

/** Rasio kontras 1–21; mengembalikan undefined bila salah satu warna tidak valid. */
export function contrastRatio(foreground: string, background: string): number | undefined {
  const front = parseHexColor(foreground);
  const back = parseHexColor(background);
  if (!front || !back) return undefined;

  const luminanceFront = relativeLuminance(front);
  const luminanceBack = relativeLuminance(back);
  const lighter = Math.max(luminanceFront, luminanceBack);
  const darker = Math.min(luminanceFront, luminanceBack);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Statistik kontras yang dapat ditampilkan ke pengguna.
 * Ambang mengikuti WCAG 2.2: 4.5:1 teks normal, 3:1 teks besar.
 */
export type ContrastReport = {
  ratio: number | undefined;
  /** Label ringkas siap tampil, mis. "12.4:1 · AAA". */
  label: string;
  passesNormalText: boolean;
};

export function describeContrast(foreground: string, background: string): ContrastReport {
  const ratio = contrastRatio(foreground, background);

  if (ratio === undefined) {
    return { ratio: undefined, label: 'Tidak dapat dihitung', passesNormalText: false };
  }

  const rounded = Math.round(ratio * 10) / 10;
  const level = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA besar' : 'Gagal';

  return {
    ratio,
    label: `${rounded.toFixed(1)}:1 · ${level}`,
    passesNormalText: ratio >= 4.5,
  };
}
