import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing } from '@/constants/theme';

export type DividerProps = {
  /** Jarak vertikal tambahan di atas dan bawah garis. */
  spacingToken?: keyof typeof spacing;
  style?: StyleProp<ViewStyle>;
};

export function Divider({ spacingToken, style }: DividerProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.line, spacingToken ? { marginVertical: spacing[spacingToken] } : null, style]}
    />
  );
}

const styles = StyleSheet.create({
  line: {
    backgroundColor: colors.border.subtle,
    height: StyleSheet.hairlineWidth * 2,
    width: '100%',
  },
});
