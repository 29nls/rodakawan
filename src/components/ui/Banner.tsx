import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, radii, spacing } from '@/constants/theme';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

type ToneStyle = {
  icon: IconName;
  iconColor: string;
  background: string;
  border: string;
};

const toneStyles: Record<BannerTone, ToneStyle> = {
  info: {
    icon: 'information-circle-outline',
    iconColor: colors.status.info,
    background: 'rgba(107, 168, 248, 0.12)',
    border: 'rgba(107, 168, 248, 0.36)',
  },
  success: {
    icon: 'checkmark-circle-outline',
    iconColor: colors.status.live,
    background: 'rgba(59, 214, 160, 0.12)',
    border: 'rgba(59, 214, 160, 0.36)',
  },
  warning: {
    icon: 'warning-outline',
    iconColor: colors.status.stale,
    background: colors.accent.soft,
    border: colors.border.accent,
  },
  danger: {
    icon: 'alert-circle-outline',
    iconColor: colors.status.unavailable,
    background: 'rgba(245, 130, 124, 0.12)',
    border: 'rgba(245, 130, 124, 0.36)',
  },
};

export type BannerProps = {
  tone?: BannerTone;
  title: string;
  message?: string;
  /** Langkah pemulihan yang bisa dilakukan pengguna. */
  action?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Pesan status yang selalu memuat judul + penjelasan tindakan.
 * Varian `danger` diumumkan sebagai alert ke screen reader.
 */
export function Banner({ tone = 'info', title, message, action, style, testID }: BannerProps) {
  const toneStyle = toneStyles[tone];

  return (
    <View
      accessibilityLabel={`${title}${message ? `. ${message}` : ''}${action ? `. ${action}` : ''}`}
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      style={[
        styles.container,
        { backgroundColor: toneStyle.background, borderColor: toneStyle.border },
        style,
      ]}
      testID={testID}
    >
      <Icon color={toneStyle.iconColor} name={toneStyle.icon} size={20} />
      <View style={styles.content}>
        <AppText variant="bodyStrong">{title}</AppText>
        {message ? (
          <AppText tone="secondary" variant="callout">
            {message}
          </AppText>
        ) : null}
        {action ? (
          <AppText tone="muted" variant="caption">
            {action}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  content: {
    flex: 1,
    gap: spacing.xs,
  },
});
