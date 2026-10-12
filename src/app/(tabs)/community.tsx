import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { BulletList } from '@/components/ui/BulletList';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { UnavailableState } from '@/components/ui/StateView';
import { unavailableCopy } from '@/constants/strings';
import { spacing } from '@/constants/theme';

const plannedCapabilities: readonly string[] = [
  'Cari klub publik dan melihat detailnya',
  'Ajukan permintaan bergabung dan kelola peran owner, admin, member',
  'Profil publik anggota yang terpisah dari data pribadi',
  'Garasi kendaraan dengan nomor polisi tetap privat',
  'Agenda klub dan post kegiatan (fase P1, Milestone 6)',
];

export default function CommunityScreen() {
  return (
    <Screen scroll>
      <View style={styles.header}>
        <AppText variant="overline" tone="accent">
          Komunitas
        </AppText>
        <AppText variant="titleLg">Klub &amp; anggota</AppText>
      </View>

      <UnavailableState
        badge={{ label: unavailableCopy.badge }}
        description="Belum ada klub, anggota, atau agenda yang bisa ditampilkan. Data komunitas belum diambil dari backend mana pun."
        footnote="Direncanakan pada Milestone 2 (klub) dan Milestone 6 (feed sosial)."
        icon="people-outline"
        title="Komunitas belum tersedia"
      />

      <Card>
        <SectionHeader
          subtitle="Ringkasan kemampuan yang sedang dibangun."
          title="Nanti di layar ini"
        />
        <BulletList items={plannedCapabilities} />
      </Card>

      <Card>
        <AppText variant="bodyStrong">Privasi data anggota</AppText>
        <AppText variant="callout" tone="secondary">
          Profil publik hanya memuat username, nama tampilan, bio, dan kota yang disetujui
          pemiliknya. Nomor polisi dan kontak tidak pernah ikut ke profil publik.
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
