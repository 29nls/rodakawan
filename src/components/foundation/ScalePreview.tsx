import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radii, spacing } from '@/constants/theme';

const spacingEntries = Object.entries(spacing) as [keyof typeof spacing, number][];
const radiusEntries = Object.entries(radii) as [keyof typeof radii, number][];

export function SpacingScale() {
  return (
    <View style={styles.list}>
      {spacingEntries.map(([name, value]) => (
        <View key={name} style={styles.row}>
          <AppText variant="caption" tone="muted" style={styles.label}>
            {name}
          </AppText>
          <View style={[styles.bar, { width: value }]} />
          <AppText variant="caption" tone="secondary">
            {value}dp
          </AppText>
        </View>
      ))}
    </View>
  );
}

export function RadiusScale() {
  return (
    <View style={styles.radiusRow}>
      {radiusEntries.map(([name, value]) => (
        <View key={name} style={styles.radiusItem}>
          <View style={[styles.radiusBox, { borderRadius: value }]} />
          <AppText variant="caption" tone="muted">
            {name}
          </AppText>
          <AppText variant="caption" tone="secondary">
            {value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  label: {
    width: 64,
  },
  bar: {
    backgroundColor: colors.accent.base,
    borderRadius: radii.sm / 2,
    height: 12,
  },
  radiusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  radiusItem: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  radiusBox: {
    backgroundColor: colors.background.raised,
    borderColor: colors.border.strong,
    borderWidth: StyleSheet.hairlineWidth * 2,
    height: 48,
    width: 48,
  },
});
