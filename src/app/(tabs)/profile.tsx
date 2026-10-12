import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { InfoRow } from '@/components/ui/InfoRow';
import { LinkRow } from '@/components/ui/LinkRow';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { safetyCopy, unavailableCopy } from '@/constants/strings';
import { spacing } from '@/constants/theme';
import { useAppStatus } from '@/hooks/useAppStatus';

export default function ProfileScreen() {
  const { appInfo, backend } = useAppStatus();

  return (
    <Screen scroll>
      <View style={styles.header}>
        <AppText variant="overline" tone="accent">
          Profil
        </AppText>
        <AppText variant="titleLg">Akun &amp; pengaturan</AppText>
      </View>

      <Card>
        <SectionHeader subtitle="Milestone 1" title="Akun" />
        <Divider />
        <AppText variant="callout" tone="secondary">
          Belum ada sistem akun pada versi fondasi ini. Daftar/masuk, username unik, foto profil,
          dan pengaturan privasi dibangun pada Milestone 1; garasi kendaraan pada Milestone 2.
        </AppText>
        <Badge icon="lock-closed-outline" label={unavailableCopy.badge} />
      </Card>

      <Card>
        <SectionHeader
          subtitle="Diambil langsung dari konfigurasi build ini."
          title="Status perangkat & build"
        />
        <Divider />
        <InfoRow label="Aplikasi" value={appInfo.name} />
        <InfoRow detail={appInfo.buildLabel} label="Versi" value={appInfo.version} />
        <InfoRow label="Expo SDK" value={appInfo.expoSdkVersion ?? 'Belum terbaca'} />
        <InfoRow label="Paket Android" value={appInfo.androidPackage ?? 'Belum diset'} />
        <InfoRow
          badge={{ label: backend.label, tone: backend.tone }}
          detail={backend.detail}
          label="Backend"
        />
        <InfoRow
          badge={{
            label: appInfo.easProjectId ? 'Terdaftar' : 'Belum terdaftar',
            tone: appInfo.easProjectId ? 'success' : 'neutral',
          }}
          detail={
            appInfo.easProjectId
              ? 'Project EAS sudah terhubung, siap untuk cloud build.'
              : 'Jalankan "eas init" dari PowerShell untuk menghubungkan project ke akun Expo Anda.'
          }
          label="EAS project"
        />
      </Card>

      <Card padding="none">
        <LinkRow
          detail="Token desain, komponen dasar, dan checklist Milestone 0."
          href="/system"
          icon="construct-outline"
          label="Fondasi & sistem"
        />
      </Card>

      <Card>
        <AppText variant="bodyStrong">Privasi &amp; keselamatan</AppText>
        <AppText variant="callout" tone="secondary">
          {safetyCopy.noTrackingYet}
        </AppText>
        <AppText variant="caption" tone="muted">
          Waktu berbagi lokasi, pengaturan izin, dan penghapusan akun akan dijelaskan di layar ini
          pada milestone berikutnya.
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
