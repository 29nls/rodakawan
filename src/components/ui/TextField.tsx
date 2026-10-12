import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Icon } from '@/components/ui/Icon';
import { colors, radii, spacing, touch, typography } from '@/constants/theme';

export type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Pesan kesalahan; menampilkan status error dan dibacakan ke screen reader. */
  error?: string;
  helper?: string;
  placeholder?: string;
  secure?: boolean;
  editable?: boolean;
  multiline?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  testID?: string;
};

/**
 * Input teks berlabel untuk form. Label selalu terlihat (bukan hanya placeholder),
 * target sentuh minimal 48dp, dan pesan error tampil sebagai teks — tidak hanya warna
 * (docs/UX_SITEMAP.md bagian 4 dan 6).
 */
export function TextField({
  label,
  value,
  onChangeText,
  error,
  helper,
  placeholder,
  secure = false,
  editable = true,
  multiline = false,
  maxLength,
  autoFocus = false,
  onSubmitEditing,
  returnKeyType,
  keyboardType,
  autoCapitalize = 'none',
  autoComplete,
  textContentType,
  testID,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hasError = Boolean(error);

  return (
    <View style={styles.container}>
      <AppText variant="label" tone={hasError ? 'danger' : 'secondary'}>
        {label}
      </AppText>

      <View
        style={[
          styles.inputWrapper,
          focused ? styles.inputWrapperFocused : null,
          hasError ? styles.inputWrapperError : null,
          !editable ? styles.inputWrapperDisabled : null,
        ]}
      >
        <TextInput
          accessibilityHint={hasError ? error : helper}
          accessibilityLabel={label}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          editable={editable}
          keyboardType={keyboardType}
          maxLength={maxLength}
          multiline={multiline}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={colors.text.muted}
          returnKeyType={returnKeyType}
          secureTextEntry={secure && !revealed}
          selectionColor={colors.accent.base}
          style={[styles.input, multiline ? styles.inputMultiline : null]}
          testID={testID}
          textContentType={textContentType}
          value={value}
        />

        {secure ? (
          <Pressable
            accessibilityLabel={revealed ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
            accessibilityRole="button"
            hitSlop={touch.hitSlop}
            onPress={() => setRevealed((previous) => !previous)}
            style={styles.revealButton}
          >
            <Icon name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <AppText accessibilityLiveRegion="polite" tone="danger" variant="caption">
          {error}
        </AppText>
      ) : helper ? (
        <AppText tone="muted" variant="caption">
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  inputWrapper: {
    alignItems: 'center',
    backgroundColor: colors.background.elevated,
    borderColor: colors.border.strong,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    minHeight: touch.min,
  },
  inputWrapperFocused: {
    borderColor: colors.border.accent,
  },
  inputWrapperError: {
    borderColor: colors.status.unavailable,
  },
  inputWrapperDisabled: {
    opacity: 0.6,
  },
  input: {
    ...typography.body,
    color: colors.text.primary,
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  revealButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touch.min,
    minWidth: touch.min,
    paddingHorizontal: spacing.sm,
  },
});
