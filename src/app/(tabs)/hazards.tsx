import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { BulletList } from '@/components/ui/BulletList';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { UnavailableState } from '@/components/ui/StateView';
import { safetyCopy, unavailableCopy } from '@/constants/strings';
import { spacing } from '@/constants/theme';

const plannedCapabilities: readonly string[] = [
  'Kategori awal: lubang/kerusakan jalan, kecelakaan, kemacetan, cuaca, hambatan, operasi lalu lintas',
  'Titik laporan dari GPS saat ini atau pin pada peta',
  'Masa berlaku per kategori, mis. kemacetan 45 menit dan lubang jalan 7 hari',
  'Konfirmasi komunitas dan tombol laporkan informasi keliru',
  'Daftar non-peta untuk pengguna yang membutuhkan alternatif teks',
];

export default function HazardsScreen() {
  return (
    <Screen scroll>
      <View style={styles.header}>
        <AppText variant="overline" tone="accent">
          Peringatan jalan
        </AppText>
        <AppText variant="titleLg">Kondisi di jalan</AppText>
      </View>

      <UnavailableState
        badge={{ label: unavailableCopy.badge }}
        description="Belum ada laporan kondisi jalan dan tidak ada koordinat contoh yang ditampilkan. Fitur laporan bahaya belum dibangun."
        footnote="Direncanakan pada Milestone 4 (laporan jalan dan convoy chat)."
        icon="warning-outline"
        title="Laporan jalan belum tersedia"
      />

      <Card>
        <SectionHeader
          subtitle="Ringkasan kemampuan yang sedang dibangun."
          title="Nanti di layar ini"
        />
        <BulletList items={plannedCapabilities} />
      </Card>

      <Card variant="accent">
        <AppText tone="accent" variant="bodyStrong">
          Informasi dari komunitas
        </AppText>
        <AppText variant="callout" tone="secondary">
          {safetyCopy.communityReport}
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
});
