import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, radii, spacing, touch } from '@/constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'lg';

type Palette = {
  background: string;
  border: string;
  text: string;
  borderWidth: number;
};

type VariantStates = {
  enabled: Palette;
  pressed: Palette;
  disabled: Palette;
};

const variants: Record<ButtonVariant, VariantStates> = {
  primary: {
    enabled: {
      background: colors.accent.base,
      border: colors.accent.base,
      text: colors.text.onAccent,
      borderWidth: 0,
    },
    pressed: {
      background: colors.accent.pressed,
      border: colors.accent.pressed,
      text: colors.text.onAccent,
      borderWidth: 0,
    },
    disabled: {
      background: colors.overlay.soft,
      border: colors.border.subtle,
      text: colors.text.muted,
      borderWidth: StyleSheet.hairlineWidth * 2,
    },
  },
  secondary: {
    enabled: {
      background: 'transparent',
      border: colors.border.strong,
      text: colors.text.primary,
      borderWidth: StyleSheet.hairlineWidth * 2,
    },
    pressed: {
      background: colors.overlay.medium,
      border: colors.border.strong,
      text: colors.text.primary,
      borderWidth: StyleSheet.hairlineWidth * 2,
    },
    disabled: {
      background: 'transparent',
      border: colors.border.subtle,
      text: colors.text.muted,
      borderWidth: StyleSheet.hairlineWidth * 2,
    },
  },
  ghost: {
    enabled: {
      background: 'transparent',
      border: 'transparent',
      text: colors.text.accent,
      borderWidth: 0,
    },
    pressed: {
      background: colors.accent.soft,
      border: 'transparent',
      text: colors.text.accent,
      borderWidth: 0,
    },
    disabled: {
      background: 'transparent',
      border: 'transparent',
      text: colors.text.muted,
      borderWidth: 0,
    },
  },
};

export type ButtonProps = {
  label: string;
  /** Tidak wajib diisi untuk tombol yang memang dinonaktifkan. */
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  icon?: IconName;
  fullWidth?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Tombol dengan target sentuh minimal 48dp.
 *
 * `disabled` dipakai untuk fitur yang memang belum dibangun: tombol tidak berpura-pura
 * berfungsi dan statusnya diumumkan ke screen reader (docs/AI_CODING_AGENT_PROMPT.md aturan 9).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  icon,
  fullWidth = false,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const palette = disabled ? variants[variant].disabled : variants[variant].enabled;

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={touch.hitSlop}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.sizeLg : styles.sizeMd,
        {
          backgroundColor:
            pressed && !disabled ? variants[variant].pressed.background : palette.background,
          borderColor: palette.border,
          borderWidth: palette.borderWidth,
        },
        fullWidth ? styles.fullWidth : null,
        style,
      ]}
      testID={testID}
    >
      {icon ? (
        <View style={styles.icon}>
          <Icon name={icon} size={size === 'lg' ? 20 : 18} color={palette.text} />
        </View>
      ) : null}
      <AppText variant={size === 'lg' ? 'bodyStrong' : 'label'} style={{ color: palette.text }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: touch.min,
  },
  sizeMd: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  sizeLg: {
    minHeight: touch.comfortable,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  icon: {
    alignItems: 'center',
  },
});
