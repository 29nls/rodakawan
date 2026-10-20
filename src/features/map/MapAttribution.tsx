import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { spacing, touch } from '@/constants/theme';
import type { MapAttributionLine } from '@/features/map/provider';

type MapAttributionProps = {
  lines: MapAttributionLine[];
  testID?: string;
};

/**
 * Teks atribusi wajib provider tile (mis. `© MapTiler © OpenStreetMap contributors`).
 *
 * Setiap baris dapat ditekan untuk membuka halaman lisensinya. Atribusi hanya
 * dirender bersama peta yang benar-benar digambar — build tanpa peta tidak
 * menampilkannya, karena tidak ada tile yang dipakai.
 */
export function MapAttribution({ lines, testID = 'map-attribution' }: MapAttributionProps) {
  if (lines.length === 0) return null;

  return (
    <View style={styles.container} testID={testID}>
      {lines.map((line) => (
        <Pressable
          accessibilityHint="Membuka halaman lisensi peta di peramban"
          accessibilityLabel={line.label}
          accessibilityRole="link"
          hitSlop={touch.hitSlop}
          key={line.label}
          onPress={() => {
            void Linking.openURL(line.url);
          }}
          style={styles.link}
        >
          <AppText tone="muted" variant="caption">
            {line.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  link: {
    minHeight: touch.min / 2,
    justifyContent: 'center',
  },
});
