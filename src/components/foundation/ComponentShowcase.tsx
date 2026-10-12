import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { InfoRow } from '@/components/ui/InfoRow';
import { LoadingState } from '@/components/ui/StateView';
import { colors, spacing } from '@/constants/theme';

/**
 * Pratinjau komponen dasar. Semua tombol di sini dinonaktifkan karena belum ada
 * aksi nyata pada milestone fondasi — jangan menambahkan handler palsu.
 */
export function ComponentShowcase() {
  return (
    <View style={styles.section}>
      <AppText variant="label">Tombol</AppText>
      <View style={styles.row}>
        <Button disabled label="Tombol utama" />
        <Button disabled label="Sekunder" variant="secondary" />
      </View>
      <View style={styles.row}>
        <Button disabled label="Tautan" variant="ghost" />
        <Button disabled icon="add-circle-outline" label="Dengan ikon" variant="secondary" />
      </View>

      <Divider />

      <AppText variant="label">Badge</AppText>
      <View style={styles.row}>
        <Badge label="Netral" />
        <Badge label="Aksen" tone="accent" />
        <Badge label="Sukses" tone="success" icon="checkmark-circle-outline" />
      </View>
      <View style={styles.row}>
        <Badge label="Peringatan" tone="warning" icon="alert-circle-outline" />
        <Badge label="Bahaya" tone="danger" />
        <Badge label="Info" tone="info" />
      </View>

      <Divider />

      <AppText variant="label">Varian kartu</AppText>
      <Card variant="surface">
        <AppText variant="callout" tone="secondary">
          Kartu permukaan: konten umum.
        </AppText>
      </Card>
      <Card variant="raised">
        <AppText variant="callout" tone="secondary">
          Kartu terangkat: konten yang perlu perhatian.
        </AppText>
      </Card>
      <Card variant="accent">
        <AppText variant="callout" tone="secondary">
          Kartu aksen: informasi keselamatan atau peringatan penting.
        </AppText>
      </Card>

      <Divider />

      <AppText variant="label">Baris informasi</AppText>
      <Card>
        <InfoRow label="Contoh label" value="Nilai" detail="Keterangan tambahan" />
        <Divider />
        <InfoRow
          badge={{ label: 'Belum tersedia', tone: 'neutral' }}
          label="Contoh status"
          detail="Status selalu punya label teks, bukan hanya warna."
        />
      </Card>

      <Divider />

      <AppText variant="label">State pemuatan</AppText>
      <Card>
        <LoadingState label="Memuat data (contoh)" />
        <AppText variant="caption" tone="muted">
          Primitif ini belum dipakai layar mana pun karena milestone fondasi belum mengambil data
          dari backend.
        </AppText>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  accentSurface: {
    backgroundColor: colors.accent.soft,
  },
});
