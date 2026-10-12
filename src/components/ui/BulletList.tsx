import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, spacing } from '@/constants/theme';

export type BulletListProps = {
  items: readonly string[];
  marker?: IconName;
  style?: StyleProp<ViewStyle>;
};

/** Daftar butir ringkas dengan penanda ikon (alternatif non-bahasa-warna). */
export function BulletList({ items, marker = 'ellipse', style }: BulletListProps) {
  return (
    <View style={[styles.list, style]}>
      {items.map((item) => (
        <View key={item} style={styles.row}>
          <View style={styles.marker}>
            <Icon name={marker} size={marker === 'ellipse' ? 8 : 16} color={colors.accent.base} />
          </View>
          <AppText variant="callout" tone="secondary" style={styles.text}>
            {item}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  marker: {
    alignItems: 'center',
    // Menyamakan tinggi ikon penanda dengan baris pertama teks.
    paddingTop: 7,
    width: 16,
  },
  text: {
    flex: 1,
  },
});
