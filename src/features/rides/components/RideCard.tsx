import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { colors, radii, spacing } from '@/constants/theme';
import type { RideWithClub } from '@/features/rides/api';
import { formatRideSchedule } from '@/features/rides/validation';
import type { RideStatus } from '@/lib/supabase/database.types';

export const rideStatusCopy: Record<RideStatus, { label: string; tone: BadgeTone }> = {
  planned: { label: 'Direncanakan', tone: 'neutral' },
  active: { label: 'Berlangsung', tone: 'success' },
  completed: { label: 'Selesai', tone: 'info' },
  cancelled: { label: 'Dibatalkan', tone: 'danger' },
};

export function RideCard({ ride }: { ride: RideWithClub }) {
  const status = rideStatusCopy[ride.status];

  return (
    <Link asChild href={{ pathname: '/ride', params: { id: ride.id } }}>
      <Pressable
        accessibilityHint="Membuka detail perjalanan, peserta, dan kontrol berbagi lokasi."
        accessibilityLabel={`${ride.title}, ${status.label}`}
        accessibilityRole="link"
        style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      >
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            <AppText variant="subtitle" numberOfLines={2}>
              {ride.title}
            </AppText>
            <AppText variant="caption" tone="muted">
              {ride.clubs?.name ?? 'Tanpa klub'}
            </AppText>
          </View>
          <Badge label={status.label} tone={status.tone} />
        </View>

        <View style={styles.metaRow}>
          <Icon name="calendar-outline" size={15} color={colors.text.muted} />
          <AppText variant="caption" tone="secondary">
            {formatRideSchedule(ride.starts_at)}
          </AppText>
        </View>

        {ride.meeting_label ? (
          <View style={styles.metaRow}>
            <Icon name="location-outline" size={15} color={colors.text.muted} />
            <AppText variant="caption" tone="secondary" numberOfLines={1}>
              Kumpul: {ride.meeting_label}
            </AppText>
          </View>
        ) : null}

        {ride.destination_label ? (
          <View style={styles.metaRow}>
            <Icon name="flag-outline" size={15} color={colors.text.muted} />
            <AppText variant="caption" tone="secondary" numberOfLines={1}>
              Tujuan: {ride.destination_label}
            </AppText>
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background.elevated,
    borderColor: colors.border.subtle,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  pressed: {
    backgroundColor: colors.overlay.medium,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  titleGroup: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
