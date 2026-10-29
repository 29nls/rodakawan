import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { type BadgeTone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { InfoRow } from '@/components/ui/InfoRow';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { spacing } from '@/constants/theme';
import { MapLibreRenderer } from '@/features/map/MapLibreRenderer';
import {
  resolveMapRenderState,
  type MapProviderId,
  type MapRendererRegistration,
  type MapRenderState,
} from '@/features/map/provider';
import { readPublicEnv } from '@/lib/env';

const PROVIDER_LABEL: Record<KnownProvider, string> = {
  maptiler: 'MapTiler',
  stadia: 'Stadia Maps',
  mapbox: 'Mapbox',
  google: 'Google Maps',
};

type KnownProvider = Exclude<MapProviderId, 'unknown'>;

type StatusSummary = { headline: string; tone: BadgeTone; detail: string };

function describeStatus(state: MapRenderState): StatusSummary {
  if (state.kind === 'unconfigured') {
    const headline =
      state.reason === 'missing_style_url'
        ? 'Belum dikonfigurasi'
        : state.reason === 'invalid_style_url'
          ? 'URL gaya tidak sah'
          : 'Penyedia tidak dikenal';
    return {
      headline,
      tone: state.reason === 'missing_style_url' ? 'neutral' : 'warning',
      detail: state.notice,
    };
  }

  if (state.kind === 'renderer_missing') {
    return { headline: 'Renderer tidak cocok', tone: 'warning', detail: state.notice };
  }

  return {
    headline: 'Siap menggambar',
    tone: 'success',
    detail: 'Renderer terdaftar, atribusi tampil bersama tile.',
  };
}

export type MapStatusCardProps = {
  /** Untuk pengujian; saat produksi nilainya dibaca dari `readPublicEnv`. */
  styleUrl?: string;
  renderer?: MapRendererRegistration;
  testID?: string;
};

/**
 * Kartu diagnostik peta untuk layar sistem.
 *
 * Memakai logika keadaan yang sama dengan layar perjalanan
 * (`resolveMapRenderState`), jadi keadaan "belum dikonfigurasi" dan konfigurasi
 * style-provider yang tidak cocok terlihat tanpa harus membuka detail perjalanan.
 * Nilai URL gaya tidak ditampilkan agar screenshot tidak membocorkan konfigurasi —
 * hanya penyedianya.
 */
export function MapStatusCard({
  styleUrl,
  renderer,
  testID = 'map-status-card',
}: MapStatusCardProps) {
  const state = useMemo(
    () =>
      resolveMapRenderState({
        styleUrl: styleUrl ?? readPublicEnv().EXPO_PUBLIC_MAP_STYLE_URL,
        renderer: renderer ?? { provider: 'maptiler', renderer: MapLibreRenderer },
      }),
    [styleUrl, renderer],
  );
  const summary = describeStatus(state);

  return (
    <View testID={testID}>
      <Card>
        <SectionHeader
          subtitle="Keadaan lapisan peta untuk build ini; MapLibre dan MapTiler ditetapkan oleh ADR-082."
          title="Peta"
        />
        <Divider />
        <InfoRow
          badge={{ label: summary.headline, tone: summary.tone }}
          detail={summary.detail}
          label="Status"
        />
        {state.kind !== 'unconfigured' ? (
          <>
            <Divider />
            <InfoRow label="Penyedia tile" value={PROVIDER_LABEL[state.provider]} />
            <Divider />
            <InfoRow
              badge={{
                label: state.kind === 'ready' ? 'Terdaftar' : 'Belum dipasang',
                tone: state.kind === 'ready' ? 'success' : 'warning',
              }}
              label="Renderer"
            />
            <Divider />
            <InfoRow
              detail="Baris atribusi tampil bersama peta yang digambar."
              label="Atribusi wajib"
              value={`${state.attribution.length} baris`}
            />
          </>
        ) : null}
        {state.kind === 'renderer_missing' ? (
          <View style={styles.hint}>
            <AppText variant="caption" tone="muted">
              Renderer MapLibre tersedia pada build aplikasi. Tanpa URL MapTiler, posisi anggota
              tetap tampil sebagai daftar dengan waktu pembaruan.
            </AppText>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    marginTop: spacing.md,
  },
});
