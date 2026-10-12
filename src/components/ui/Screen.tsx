import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';

export type ScreenProps = {
  children: ReactNode;
  /** Header tetap di luar area scroll, mis. <ScreenHeader />. */
  header?: ReactNode;
  /** Bungkus konten dalam ScrollView; pakai untuk layar dengan konten panjang. */
  scroll?: boolean;
  padded?: boolean;
  /** Default: atas/kiri/kanan. Bagian bawah diatur tab bar atau konten. */
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Kerangka layar: latar charcoal + safe area + padding standar.
 * Semua layar memakai komponen ini agar jarak antar layar konsisten.
 */
export function Screen({
  children,
  header,
  scroll = false,
  padded = true,
  edges = ['top', 'left', 'right'],
  style,
  contentContainerStyle,
  testID,
}: ScreenProps) {
  const paddingStyle = padded ? styles.padded : undefined;

  return (
    <SafeAreaView edges={edges} style={[styles.safeArea, style]} testID={testID}>
      {header ? <View style={[styles.headerWrap, paddingStyle]}>{header}</View> : null}
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, paddingStyle, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, paddingStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background.base,
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing.lg,
  },
  headerWrap: {
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
  },
  scrollContent: {
    gap: spacing.lg,
    paddingBottom: spacing.huge,
    paddingTop: spacing.sm,
  },
});
