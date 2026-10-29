import {
  Camera,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  type LngLat,
} from '@maplibre/maplibre-react-native';
import { LocalSvg } from 'react-native-svg/css';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { colors, radii, spacing } from '@/constants/theme';
import { type MapMarker, type MapRendererProps } from '@/features/map/provider';
import { locationAgeLabel } from '@/features/rides/location';

const DEFAULT_ZOOM = 12;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
const MAPTILER_LOGO = require('./maptiler-logo.svg');

function zoomForRegion(latitudeDelta: number, longitudeDelta: number): number {
  const zoom = Math.log2(360 / Math.max(latitudeDelta, longitudeDelta));
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function markerStatus(marker: MapMarker): string {
  const freshness =
    marker.freshness === 'live' ? 'Live' : marker.freshness === 'stale' ? 'Basi' : 'Offline';
  return `${freshness} · ${locationAgeLabel(marker.recordedAt)}`;
}

function RideMarker({ marker }: { marker: MapMarker }) {
  const stale = marker.freshness !== 'live';

  return (
    <View
      accessibilityLabel={`${marker.label}, ${markerStatus(marker)}`}
      accessible
      style={[
        styles.marker,
        stale && styles.staleMarker,
        marker.freshness === 'offline' && styles.offlineMarker,
      ]}
    >
      <AppText numberOfLines={1} style={styles.markerName} variant="caption">
        {marker.label}
      </AppText>
      <AppText
        numberOfLines={1}
        style={[
          styles.markerStatus,
          stale && styles.staleStatus,
          marker.freshness === 'offline' && styles.offlineStatus,
        ]}
        variant="overline"
      >
        {markerStatus(marker)}
      </AppText>
    </View>
  );
}

/** MapLibre renderer for the shared ride-location marker contract. */
export function MapLibreRenderer({ styleUrl, markers, initialRegion }: MapRendererProps) {
  const [styleFailed, setStyleFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const center: LngLat | undefined = initialRegion
    ? [initialRegion.longitude, initialRegion.latitude]
    : undefined;

  return (
    <View style={styles.mapContainer}>
      <MapLibreMap
        key={retryKey}
        mapStyle={styleUrl}
        onDidFailLoadingMap={() => setStyleFailed(true)}
        onDidFinishLoadingMap={() => setStyleFailed(false)}
        onWillStartLoadingMap={() => setStyleFailed(false)}
        style={styles.map}
        testID="maplibre-map"
      >
        <Camera
          testID="maplibre-camera"
          initialViewState={{
            ...(center ? { center } : {}),
            zoom: initialRegion
              ? zoomForRegion(initialRegion.latitudeDelta, initialRegion.longitudeDelta)
              : DEFAULT_ZOOM,
          }}
        />
        {markers.map((marker) => (
          <MapLibreMarker
            anchor="bottom"
            id={marker.userId}
            key={marker.userId}
            lngLat={[marker.longitude, marker.latitude]}
            testID={`maplibre-marker-${marker.userId}`}
          >
            <RideMarker marker={marker} />
          </MapLibreMarker>
        ))}
      </MapLibreMap>
      <Pressable
        accessibilityHint="Membuka situs MapTiler"
        accessibilityLabel="Logo MapTiler"
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL('https://www.maptiler.com');
        }}
        style={styles.maptilerLogoLink}
        testID="maptiler-logo-link"
      >
        <LocalSvg asset={MAPTILER_LOGO} height={20} testID="maptiler-logo" width={67} />
      </Pressable>
      {styleFailed ? (
        <View accessibilityLiveRegion="polite" style={styles.errorNotice} testID="map-style-error">
          <AppText variant="caption" tone="primary">
            Peta gagal dimuat. Periksa koneksi dan URL gaya, lalu coba lagi.
          </AppText>
          <Button
            icon="refresh"
            label="Coba lagi"
            onPress={() => {
              setStyleFailed(false);
              setRetryKey((current) => current + 1);
            }}
            variant="secondary"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mapContainer: {
    flex: 1,
    minHeight: 220,
    position: 'relative',
  },
  map: {
    flex: 1,
    minHeight: 220,
  },
  maptilerLogoLink: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.sm,
    bottom: spacing.sm,
    justifyContent: 'center',
    left: spacing.sm,
    padding: spacing.xs,
    position: 'absolute',
  },
  errorNotice: {
    alignItems: 'center',
    backgroundColor: colors.background.base,
    borderColor: colors.border.strong,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing.sm,
    left: spacing.md,
    padding: spacing.md,
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
  },
  marker: {
    backgroundColor: colors.background.elevated,
    borderColor: colors.status.live,
    borderRadius: radii.md,
    borderWidth: 1,
    maxWidth: 180,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  markerName: {
    color: colors.text.primary,
  },
  markerStatus: {
    color: colors.status.live,
  },
  staleMarker: {
    borderColor: colors.status.stale,
    opacity: 0.72,
  },
  staleStatus: {
    color: colors.status.stale,
  },
  offlineMarker: {
    borderColor: colors.status.offline,
  },
  offlineStatus: {
    color: colors.status.offline,
  },
});
