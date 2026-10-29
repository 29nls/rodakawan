import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Icon } from '@/components/ui/Icon';
import { colors, radii, spacing } from '@/constants/theme';
import { MapAttribution } from '@/features/map/MapAttribution';
import { regionForMarkers, type MapMarker, type MapRenderState } from '@/features/map/provider';

type MapCanvasProps = {
  state: MapRenderState;
  markers: MapMarker[];
  testID?: string;
};

/**
 * Slot renderer peta.
 *
 * Komponen ini tidak mengimpor library peta secara langsung; renderer didaftarkan
 * melalui kontrak `MapRendererRegistration` oleh layar pemanggil. `MapCanvas`
 * menggambar peta dan atribusinya saat state siap, atau menampilkan alasan
 * eksplisit — tidak ada peta tiruan, tile publik, atau marker contoh.
 */
export function MapCanvas({ state, markers, testID = 'map-canvas' }: MapCanvasProps) {
  if (state.kind === 'ready') {
    const region = regionForMarkers(markers);

    return (
      <View style={styles.container} testID={testID}>
        <View style={styles.surface}>
          {state.renderer({
            styleUrl: state.styleUrl,
            markers,
            attribution: state.attribution,
            initialRegion: region,
          })}
        </View>
        <MapAttribution lines={state.attribution} />
      </View>
    );
  }

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.notice} testID="map-notice">
        <Icon name="map-outline" size={20} color={colors.text.muted} />
        <AppText style={styles.noticeText} tone="muted" variant="caption">
          {state.notice}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  notice: {
    alignItems: 'center',
    backgroundColor: colors.overlay.soft,
    borderColor: colors.border.subtle,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noticeText: {
    flex: 1,
  },
  surface: {
    backgroundColor: colors.background.elevated,
    borderColor: colors.border.subtle,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    minHeight: 220,
    overflow: 'hidden',
  },
});
