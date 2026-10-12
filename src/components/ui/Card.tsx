import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, spacing } from '@/constants/theme';

export type CardVariant = 'surface' | 'raised' | 'accent';

export type CardProps = {
  children: ReactNode;
  variant?: CardVariant;
  /** Padding dari skala spacing, bukan angka bebas. */
  padding?: keyof typeof spacing;
  style?: StyleProp<ViewStyle>;
};

/**
 * Wadah konten. Varian `accent` dipakai untuk informasi keselamatan/penting
 * agar tidak perlu menambahkan warna di luar token.
 */
export function Card({ children, variant = 'surface', padding = 'lg', style }: CardProps) {
  return (
    <View style={[styles.base, variantStyles[variant], { padding: spacing[padding] }, style]}>
      {children}
    </View>
  );
}

const variantStyles: Record<CardVariant, ViewStyle> = {
  surface: {
    backgroundColor: colors.background.elevated,
    borderColor: colors.border.subtle,
  },
  raised: {
    backgroundColor: colors.background.raised,
    borderColor: colors.border.strong,
  },
  accent: {
    backgroundColor: colors.accent.soft,
    borderColor: colors.border.accent,
  },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing.md,
  },
});
