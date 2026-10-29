import type { ComponentType, ReactNode } from 'react';
import { View } from 'react-native';

type NativeMapMockProps = {
  testID?: string;
  id?: string;
  children?: ReactNode;
  onDidFailLoadingMap?: () => void;
  onDidFinishLoadingMap?: () => void;
  onWillStartLoadingMap?: () => void;
};

const MockMapView = View as ComponentType<NativeMapMockProps>;

export function Map({
  testID = 'maplibre-map',
  children,
  onDidFailLoadingMap,
  onDidFinishLoadingMap,
  onWillStartLoadingMap,
}: NativeMapMockProps) {
  return (
    <MockMapView
      onDidFailLoadingMap={onDidFailLoadingMap}
      onDidFinishLoadingMap={onDidFinishLoadingMap}
      onWillStartLoadingMap={onWillStartLoadingMap}
      testID={testID}
    >
      {children}
    </MockMapView>
  );
}

export function LocalSvg({
  testID = 'maptiler-logo',
  accessibilityLabel,
}: {
  testID?: string;
  accessibilityLabel?: string;
}) {
  return <View accessibilityLabel={accessibilityLabel} testID={testID} />;
}

export function Camera({ testID = 'maplibre-camera' }: NativeMapMockProps) {
  return <View testID={testID} />;
}

export function Marker({ id, testID, children }: NativeMapMockProps) {
  return <View testID={testID ?? `maplibre-marker-${id ?? 'unknown'}`}>{children}</View>;
}
