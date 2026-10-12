import type { ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { colors, typography, type TextVariant } from '@/constants/theme';

export type TextTone = 'primary' | 'secondary' | 'muted' | 'accent' | 'onAccent' | 'danger';

const toneColors: Record<TextTone, string> = {
  primary: colors.text.primary,
  secondary: colors.text.secondary,
  muted: colors.text.muted,
  accent: colors.text.accent,
  onAccent: colors.text.onAccent,
  danger: colors.text.danger,
};

export type AppTextProps = TextProps & {
  /** Skala tipografi dari design system. */
  variant?: TextVariant;
  tone?: TextTone;
  align?: 'left' | 'center' | 'right';
  children?: ReactNode;
};

/**
 * Teks dasar aplikasi. Semua teks memakai komponen ini agar skala tipografi
 * dan warna tetap konsisten (lihat src/constants/theme.ts).
 */
export function AppText({
  variant = 'body',
  tone = 'primary',
  align,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[
        typography[variant] as TextStyle,
        { color: toneColors[tone] },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
