import type { TextStyle } from 'react-native';

/**
 * Design tokens RodaKawan — tema gelap premium (charcoal + amber).
 *
 * Aturan pakai:
 * - Komponen mengambil nilai dari file ini, jangan menulis hex/ukuran langsung di screen.
 * - Kontras teks utama minimal 4.5:1 terhadap latar; status tidak boleh dibedakan
 *   hanya dengan warna (selalu ada label/ikon) sesuai docs/UX_SITEMAP.md bagian 6.
 */
export const palette = {
  black: '#05070A',
  charcoal: '#0B0D10',
  charcoalElevated: '#12161C',
  charcoalRaised: '#181D24',
  slateBorder: '#232A33',
  slateBorderStrong: '#343D49',
  ink: '#F3F6F9',
  inkSecondary: '#B7C1CC',
  inkMuted: '#818D9B',
  amber: '#F59E0B',
  amberBright: '#FFB020',
  amberSoft: '#FFC46B',
  amberDim: '#B4761A',
  amberInk: '#1A1206',
  amberGlow: 'rgba(245, 158, 11, 0.14)',
  emerald: '#3BD6A0',
  sky: '#6BA8F8',
  rose: '#F5827C',
} as const;

export const colors = {
  background: {
    base: palette.charcoal,
    elevated: palette.charcoalElevated,
    raised: palette.charcoalRaised,
    scrim: 'rgba(5, 7, 10, 0.72)',
  },
  border: {
    subtle: palette.slateBorder,
    strong: palette.slateBorderStrong,
    accent: 'rgba(245, 158, 11, 0.38)',
  },
  text: {
    primary: palette.ink,
    secondary: palette.inkSecondary,
    muted: palette.inkMuted,
    accent: palette.amberBright,
    onAccent: palette.amberInk,
    danger: palette.rose,
  },
  accent: {
    base: palette.amber,
    pressed: '#DE8A08',
    soft: palette.amberGlow,
    disabled: 'rgba(245, 158, 11, 0.32)',
  },
  /** Status operasional (dipakai bersama label, bukan warna saja). */
  status: {
    live: palette.emerald,
    stale: palette.amber,
    offline: palette.inkMuted,
    unavailable: palette.rose,
    info: palette.sky,
  },
  overlay: {
    soft: 'rgba(255, 255, 255, 0.04)',
    medium: 'rgba(255, 255, 255, 0.07)',
  },
} as const;

/** Skala jarak 4pt; dipakai untuk padding, margin, dan gap. */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radii = {
  sm: 8,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

/**
 * Ukuran sentuh minimum 48dp sesuai docs/UX_SITEMAP.md bagian 4
 * (target 44-48dp, kontras tinggi, tipografi tidak tipis).
 */
export const touch = {
  min: 48,
  comfortable: 56,
  hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
} as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.4 },
  titleLg: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.2 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  subtitle: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  callout: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  overline: { fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 1.2 },
} as const satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof typography;

export const theme = {
  palette,
  colors,
  spacing,
  radii,
  touch,
  typography,
} as const;

export type Theme = typeof theme;
