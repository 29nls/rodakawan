import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Icon } from '@/components/ui/Icon';
import { colors, spacing, touch } from '@/constants/theme';

export type SectionHeaderAction = {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
};

export type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  overline?: string;
  action?: SectionHeaderAction;
  style?: StyleProp<ViewStyle>;
};

/**
 * Judul bagian. `action` hanya dirender jika benar-benar ada aksi nyata,
 * sehingga tidak muncul tautan yang belum berfungsi.
 */
export function SectionHeader({ title, subtitle, overline, action, style }: SectionHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.textColumn}>
        {overline ? (
          <AppText variant="overline" tone="accent">
            {overline}
          </AppText>
        ) : null}
        <AppText variant="subtitle">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {action ? (
        <Pressable
          accessibilityHint={action.accessibilityHint}
          accessibilityLabel={action.label}
          accessibilityRole="link"
          hitSlop={touch.hitSlop}
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
        >
          <AppText variant="label" tone="accent">
            {action.label}
          </AppText>
          <Icon name="chevron-forward" size={16} color={colors.text.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  textColumn: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  action: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: touch.min - 12,
    paddingHorizontal: spacing.xs,
  },
  actionPressed: {
    backgroundColor: colors.overlay.medium,
  },
});
