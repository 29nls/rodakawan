import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, spacing, touch } from '@/constants/theme';

export type LinkRowProps = {
  href: Href;
  label: string;
  detail?: string;
  icon?: IconName;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

/** Baris navigasi nyata (dipakai hanya untuk tujuan yang benar-benar ada). */
export function LinkRow({ href, label, detail, icon, accessibilityHint, style }: LinkRowProps) {
  return (
    <Link asChild href={href}>
      <Pressable
        accessibilityHint={accessibilityHint}
        accessibilityLabel={label}
        accessibilityRole="link"
        style={({ pressed }) => [styles.row, pressed ? styles.pressed : null, style]}
      >
        {icon ? (
          <View style={styles.icon}>
            <Icon name={icon} size={20} color={colors.text.accent} />
          </View>
        ) : null}
        <View style={styles.text}>
          <AppText variant="label">{label}</AppText>
          {detail ? (
            <AppText variant="caption" tone="muted">
              {detail}
            </AppText>
          ) : null}
        </View>
        <Icon name="chevron-forward" size={18} color={colors.text.muted} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: touch.comfortable,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pressed: {
    backgroundColor: colors.overlay.medium,
  },
  icon: {
    alignItems: 'center',
  },
  text: {
    flex: 1,
    gap: spacing.xs / 2,
  },
});
