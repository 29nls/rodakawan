import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radii, spacing } from '@/constants/theme';
import { describeContrast } from '@/utils/color';

export type ColorToken = {
  name: string;
  value: string;
  /** Sertakan pemeriksaan kontras untuk token teks. */
  checkContrast?: boolean;
};

export const colorTokens: readonly ColorToken[] = [
  { name: 'background.base', value: colors.background.base },
  { name: 'background.elevated', value: colors.background.elevated },
  { name: 'background.raised', value: colors.background.raised },
  { name: 'border.subtle', value: colors.border.subtle },
  { name: 'border.strong', value: colors.border.strong },
  { name: 'text.primary', value: colors.text.primary, checkContrast: true },
  { name: 'text.secondary', value: colors.text.secondary, checkContrast: true },
  { name: 'text.muted', value: colors.text.muted, checkContrast: true },
  { name: 'accent.base', value: colors.accent.base, checkContrast: true },
  { name: 'status.live', value: colors.status.live, checkContrast: true },
  { name: 'status.stale', value: colors.status.stale, checkContrast: true },
  { name: 'status.unavailable', value: colors.status.unavailable, checkContrast: true },
  { name: 'status.info', value: colors.status.info, checkContrast: true },
];

export function ColorSwatches({ tokens = colorTokens }: { tokens?: readonly ColorToken[] }) {
  return (
    <View style={styles.list}>
      {tokens.map((token) => {
        const contrast = token.checkContrast
          ? describeContrast(token.value, colors.background.base)
          : undefined;

        return (
          <View key={token.name} style={styles.row}>
            <View style={[styles.swatch, { backgroundColor: token.value }]} />
            <View style={styles.text}>
              <AppText variant="label">{token.name}</AppText>
              <AppText variant="caption" tone="muted">
                {token.value}
              </AppText>
            </View>
            {contrast ? (
              <AppText variant="caption" tone={contrast.passesNormalText ? 'secondary' : 'danger'}>
                {contrast.label}
              </AppText>
            ) : null}
          </View>
        );
      })}
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
  swatch: {
    borderColor: colors.border.subtle,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth * 2,
    height: 40,
    width: 40,
  },
  text: {
    flex: 1,
    gap: spacing.xs / 2,
  },
});
