import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button, type ButtonVariant } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, radii, spacing } from '@/constants/theme';

export type StateViewTone = 'neutral' | 'accent' | 'danger';

const iconContainerStyles: Record<StateViewTone, ViewStyle> = {
  neutral: {
    backgroundColor: colors.overlay.soft,
    borderColor: colors.border.subtle,
  },
  accent: {
    backgroundColor: colors.accent.soft,
    borderColor: colors.border.accent,
  },
  danger: {
    backgroundColor: 'rgba(245, 130, 124, 0.14)',
    borderColor: 'rgba(245, 130, 124, 0.38)',
  },
};

const iconColors: Record<StateViewTone, string> = {
  neutral: colors.text.secondary,
  accent: colors.text.accent,
  danger: colors.status.unavailable,
};

export type StateViewProps = {
  title: string;
  description: string;
  icon?: IconName;
  tone?: StateViewTone;
  badge?: { label: string; tone?: BadgeTone };
  /** Keterangan tambahan, mis. milestone tempat fitur ini direncanakan. */
  footnote?: string;
  action?: {
    label: string;
    onPress: () => void;
    variant?: ButtonVariant;
    icon?: IconName;
  };
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Dasar untuk semua state non-konten (kosong, belum tersedia, error).
 * Deskripsi wajib menjelaskan langkah berikutnya, bukan hanya "tidak ada data"
 * (docs/UX_SITEMAP.md bagian 3).
 */
export function StateView({
  title,
  description,
  icon = 'information-circle-outline',
  tone = 'neutral',
  badge,
  footnote,
  action,
  style,
  testID,
}: StateViewProps) {
  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={[styles.iconContainer, iconContainerStyles[tone]]}>
        <Icon name={icon} size={26} color={iconColors[tone]} />
      </View>
      {badge ? <Badge label={badge.label} tone={badge.tone ?? 'neutral'} size="md" /> : null}
      <AppText variant="subtitle" align="center">
        {title}
      </AppText>
      <AppText variant="callout" tone="secondary" align="center">
        {description}
      </AppText>
      {footnote ? (
        <AppText variant="caption" tone="muted" align="center">
          {footnote}
        </AppText>
      ) : null}
      {action ? (
        <Button
          icon={action.icon}
          label={action.label}
          onPress={action.onPress}
          variant={action.variant ?? 'secondary'}
        />
      ) : null}
    </View>
  );
}

export type LoadingStateProps = {
  label?: string;
  testID?: string;
};

export function LoadingState({ label = 'Memuat…', testID }: LoadingStateProps) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      style={styles.loading}
      testID={testID}
    >
      <ActivityIndicator color={colors.accent.base} size="small" />
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
    </View>
  );
}

export type EmptyStateProps = Omit<StateViewProps, 'tone' | 'badge'> & {
  icon?: IconName;
};

export function EmptyState({ icon = 'albums-outline', ...rest }: EmptyStateProps) {
  return <StateView icon={icon} tone="neutral" {...rest} />;
}

export type UnavailableStateProps = Omit<StateViewProps, 'tone'>;

/** Dipakai untuk fitur yang belum dibangun pada milestone ini. */
export function UnavailableState({ icon = 'construct-outline', ...rest }: UnavailableStateProps) {
  return <StateView icon={icon} tone="accent" {...rest} />;
}

export type ErrorStateProps = {
  onRetry?: () => void;
  title?: string;
  description?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function ErrorState({
  onRetry,
  title = 'Terjadi kesalahan',
  description = 'Bagian ini gagal ditampilkan. Coba lagi; bila masalah berlanjut, laporkan ke pengembang dengan menyertakan versi aplikasi.',
  style,
  testID,
}: ErrorStateProps) {
  return (
    <StateView
      description={description}
      icon="alert-circle-outline"
      style={style}
      testID={testID}
      title={title}
      tone="danger"
      action={
        onRetry
          ? { label: 'Coba lagi', onPress: onRetry, variant: 'secondary', icon: 'refresh' }
          : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  iconContainer: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  loading: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
});
