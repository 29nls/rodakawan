import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, radii, spacing } from '@/constants/theme';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeSize = 'sm' | 'md';

type ToneStyle = {
  background: string;
  border: string;
  foreground: string;
};

const toneStyles: Record<BadgeTone, ToneStyle> = {
  neutral: {
    background: colors.overlay.medium,
    border: colors.border.subtle,
    foreground: colors.text.secondary,
  },
  accent: {
    background: colors.accent.soft,
    border: colors.border.accent,
    foreground: colors.text.accent,
  },
  success: {
    background: 'rgba(59, 214, 160, 0.14)',
    border: 'rgba(59, 214, 160, 0.38)',
    foreground: colors.status.live,
  },
  warning: {
    background: 'rgba(245, 158, 11, 0.16)',
    border: 'rgba(245, 158, 11, 0.42)',
    foreground: colors.text.accent,
  },
  danger: {
    background: 'rgba(245, 130, 124, 0.16)',
    border: 'rgba(245, 130, 124, 0.42)',
    foreground: colors.status.unavailable,
  },
  info: {
    background: 'rgba(107, 168, 248, 0.14)',
    border: 'rgba(107, 168, 248, 0.36)',
    foreground: colors.status.info,
  },
};

export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  size?: BadgeSize;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
};

/** Penanda status ringkas: warna + label teks, tidak pernah warna saja. */
export function Badge({ label, tone = 'neutral', size = 'sm', icon, style }: BadgeProps) {
  const toneStyle = toneStyles[tone];
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <View
      style={[
        styles.base,
        size === 'sm' ? styles.sizeSm : styles.sizeMd,
        { backgroundColor: toneStyle.background, borderColor: toneStyle.border },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={iconSize} color={toneStyle.foreground} /> : null}
      <AppText
        variant={size === 'sm' ? 'overline' : 'label'}
        style={[styles.label, { color: toneStyle.foreground }]}
      >
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sizeSm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sizeMd: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 1,
  },
  label: {
    textTransform: 'uppercase',
  },
});
