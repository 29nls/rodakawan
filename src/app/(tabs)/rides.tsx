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
  'Buat perjalanan dengan judul, waktu, titik kumpul, tujuan, dan aturan bergabung',
  'Gabung lewat undangan atau kode, lalu lihat daftar peserta',
  'Berbagi lokasi opt-in dengan status live, terlambat, offline, atau tidak tersedia',
  'Peta konvoi yang menampilkan waktu pembaruan setiap peserta',
  'Kontrol hentikan berbagi lokasi dan keluar dari perjalanan yang selalu terlihat',
];

export default function RidesScreen() {
  return (
    <Screen scroll>
      <View style={styles.header}>
        <AppText variant="overline" tone="accent">
          Perjalanan
        </AppText>
        <AppText variant="titleLg">Touring &amp; konvoi</AppText>
      </View>

      <UnavailableState
        badge={{ label: unavailableCopy.badge }}
        description="Belum ada perjalanan yang bisa dibuat atau digabung, dan aplikasi tidak menampilkan daftar contoh. Fitur perjalanan belum dibangun pada milestone fondasi."
        footnote="Direncanakan pada Milestone 3 (perjalanan dan live location)."
        icon="navigate-outline"
        title="Perjalanan belum tersedia"
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
          Catatan keselamatan
        </AppText>
        <AppText variant="callout" tone="secondary">
          {safetyCopy.locationSharing}
        </AppText>
        <AppText variant="caption" tone="muted">
          Tracking tidak akan pernah aktif diam-diam: hanya setelah Anda bergabung ke perjalanan
          aktif, memberi izin lokasi, dan menyalakan berbagi.
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
