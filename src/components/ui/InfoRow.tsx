import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { spacing } from '@/constants/theme';

export type InfoRowProps = {
  label: string;
  /** Nilai ringkas di sisi kanan. */
  value?: string;
  badge?: { label: string; tone?: BadgeTone };
  /** Keterangan tambahan di bawah label. */
  detail?: string;
  valueTone?: 'primary' | 'secondary' | 'muted' | 'accent';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Baris label–nilai untuk daftar status teknis. */
export function InfoRow({
  label,
  value,
  badge,
  detail,
  valueTone = 'primary',
  style,
  testID,
}: InfoRowProps) {
  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.left}>
        <AppText variant="label">{label}</AppText>
        {detail ? (
          <AppText variant="caption" tone="muted">
            {detail}
          </AppText>
        ) : null}
      </View>
      <View style={styles.right}>
        {value ? (
          <AppText variant="callout" tone={valueTone} style={styles.value}>
            {value}
          </AppText>
        ) : null}
        {badge ? <Badge label={badge.label} tone={badge.tone ?? 'neutral'} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  left: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  right: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: spacing.xs,
    maxWidth: '52%',
  },
  value: {
    textAlign: 'right',
  },
});
