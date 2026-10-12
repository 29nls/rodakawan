import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { colors, radii, spacing, touch } from '@/constants/theme';

export type AuthScaffoldProps = {
  title: string;
  description: string;
  children: ReactNode;
  /** Aksi sekunder di luar kartu, mis. tautan "lupa kata sandi". */
  footer?: ReactNode;
  /** Tombol kembali untuk layar yang dibuka dari layar lain. */
  showBack?: boolean;
  testID?: string;
};

/** Kerangka bersama layar autentikasi supaya jarak dan hierarki teks konsisten. */
export function AuthScaffold({
  title,
  description,
  children,
  footer,
  showBack = false,
  testID,
}: AuthScaffoldProps) {
  return (
    <Screen scroll testID={testID}>
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

      <View style={styles.hero}>
        <AppText variant="overline" tone="accent">
          RodaKawan
        </AppText>
        <AppText variant="titleLg">{title}</AppText>
        <AppText variant="callout" tone="secondary">
          {description}
        </AppText>
      </View>

      <Card>{children}</Card>

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
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
  hero: {
    gap: spacing.sm,
  },
  footer: {
    gap: spacing.sm,
  },
});
