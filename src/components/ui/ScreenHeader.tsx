import { router } from 'expo-router';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Icon } from '@/components/ui/Icon';
import { colors, radii, spacing, touch } from '@/constants/theme';

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  overline?: string;
  /** Menampilkan tombol kembali; hanya dipakai pada layar yang bisa ditutup. */
  showBack?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Header dalam aplikasi (bukan header native) agar warna dan tipografi tetap
 * mengikuti design system, dan agar tidak menambah dependency navigasi native.
 */
export function ScreenHeader({
  title,
  subtitle,
  overline,
  showBack = false,
  style,
}: ScreenHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      {showBack ? (
        <Pressable
          accessibilityHint="Kembali ke layar sebelumnya"
          accessibilityLabel="Kembali"
          accessibilityRole="button"
          hitSlop={touch.hitSlop}
          onPress={() => {
            if (router.canGoBack()) router.back();
          }}
          style={({ pressed }) => [styles.backButton, pressed ? styles.backButtonPressed : null]}
        >
          <Icon color={colors.text.primary} name="chevron-back" size={22} />
        </Pressable>
      ) : null}
      <View style={styles.text}>
        {overline ? (
          <AppText tone="accent" variant="overline">
            {overline}
          </AppText>
        ) : null}
        <AppText variant="titleLg">{title}</AppText>
        {subtitle ? (
          <AppText tone="secondary" variant="callout">
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  backButton: {
    alignItems: 'center',
    borderColor: colors.border.subtle,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    height: touch.min,
    justifyContent: 'center',
    width: touch.min,
  },
  backButtonPressed: {
    backgroundColor: colors.overlay.medium,
  },
  text: {
    flex: 1,
    gap: spacing.xs / 2,
  },
});
