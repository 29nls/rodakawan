import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/components/ui/Icon';
import { InfoRow } from '@/components/ui/InfoRow';
import { LinkRow } from '@/components/ui/LinkRow';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { milestoneStatusLabels, milestones } from '@/constants/roadmap';
import { safetyCopy } from '@/constants/strings';
import { colors, spacing } from '@/constants/theme';
import { useAppStatus } from '@/hooks/useAppStatus';

const p0Milestones = milestones.filter((milestone) => milestone.phase === 'P0');

export default function HomeScreen() {
  const router = useRouter();
  const { appInfo, backend } = useAppStatus();

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <AppText variant="overline" tone="accent">
          RodaKawan
        </AppText>
        <AppText variant="display">Pendamping touring &amp; konvoi</AppText>
        <AppText variant="callout" tone="secondary">
          Aplikasi komunitas motor dan sepeda untuk berkumpul, berangkat, tetap terhubung, dan
          menutup perjalanan dengan jelas.
        </AppText>
      </View>

      <Card>
        <SectionHeader
          subtitle="Nilai nyata dari build yang sedang Anda jalankan."
          title="Status aplikasi"
        />
        <Divider />
        <InfoRow detail={appInfo.buildLabel} label="Versi" value={appInfo.version} />
        <InfoRow
          badge={{ label: backend.label, tone: backend.tone }}
          detail={backend.detail}
          label="Backend"
        />
        <InfoRow
          badge={{ label: 'Nonaktif', tone: 'neutral' }}
          detail={safetyCopy.noTrackingYet}
          label="Berbagi lokasi"
        />
      </Card>

      <View style={styles.section}>
        <SectionHeader
          subtitle="Perjalanan klub dengan berbagi lokasi yang Anda setujui sendiri."
          title="Mulai perjalanan"
        />
        <Card>
          <View style={styles.ctaRow}>
            <Button
              fullWidth
              icon="add-circle-outline"
              label="Buat perjalanan"
              onPress={() => router.push('/ride-new')}
            />
            <Button
              fullWidth
              icon="enter-outline"
              label="Gabung perjalanan"
              onPress={() => router.push('/rides')}
              variant="secondary"
            />
          </View>
          <AppText variant="caption" tone="muted">
            Pembuatan perjalanan memerlukan keanggotaan klub aktif. Berbagi lokasi bersifat opt-in
            per perjalanan dan dapat dihentikan kapan saja.
          </AppText>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader
          subtitle="Satu vertical slice berfungsi sebelum pindah ke fitur berikutnya."
          title="Urutan pengembangan"
        />
        <Card padding="none">
          {p0Milestones.map((milestone, index) => (
            <View key={milestone.id}>
              {index > 0 ? <Divider /> : null}
              <View style={styles.milestone}>
                <AppText variant="overline" tone="muted">
                  {milestone.id} · {milestone.phase}
                </AppText>
                <AppText variant="bodyStrong">{milestone.title}</AppText>
                <AppText variant="caption" tone="secondary">
                  {milestone.summary}
                </AppText>
                <Badge
                  label={milestoneStatusLabels[milestone.status]}
                  tone={
                    milestone.status === 'pondasi' || milestone.status === 'tersedia'
                      ? 'accent'
                      : 'neutral'
                  }
                />
              </View>
            </View>
          ))}
        </Card>
        <AppText variant="caption" tone="muted">
          Fase P1 (feed klub) dan P2 (voice PTT, musik lokal) dimulai hanya setelah acceptance P0
          lulus; sisa acceptance P0 ada pada uji dua perangkat dan uji baterai.
        </AppText>
      </View>

      <Card variant="accent">
        <View style={styles.safetyHeader}>
          <Icon color={colors.text.accent} name="shield-checkmark-outline" size={20} />
          <AppText tone="accent" variant="bodyStrong">
            Prinsip keselamatan &amp; privasi
          </AppText>
        </View>
        <AppText variant="callout" tone="secondary">
          {safetyCopy.stopBeforeTyping}
        </AppText>
        <AppText variant="caption" tone="muted">
          {safetyCopy.locationSharing}
        </AppText>
      </Card>

      <Card padding="none">
        <LinkRow
          detail="Token desain, komponen dasar, dan checklist Milestone 0."
          href="/system"
          icon="construct-outline"
          label="Lihat fondasi & sistem"
        />
      </Card>

      <AppText align="center" tone="muted" variant="caption">
        Versi {appInfo.version} · tanpa akun, lokasi, atau data contoh yang menyesatkan.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: spacing.sm,
  },
  section: {
    gap: spacing.md,
  },
  ctaRow: {
    gap: spacing.md,
  },
  milestone: {
    gap: spacing.xs,
    padding: spacing.lg,
  },
  safetyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
