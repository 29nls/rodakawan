import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ColorSwatches } from '@/components/foundation/ColorSwatches';
import { ComponentShowcase } from '@/components/foundation/ComponentShowcase';
import { RadiusScale, SpacingScale } from '@/components/foundation/ScalePreview';
import { TypeSpecimen } from '@/components/foundation/TypeSpecimen';
import { AppText } from '@/components/ui/AppText';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { InfoRow } from '@/components/ui/InfoRow';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { spacing } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/session';
import { useAppStatus } from '@/hooks/useAppStatus';
import { installWebCrypto } from '@/lib/crypto/webcrypto';
import { PUBLIC_ENV_KEYS } from '@/lib/env';

type ChecklistStatus = 'selesai' | 'tindakan';

type ChecklistItem = {
  label: string;
  detail: string;
  status: ChecklistStatus;
};

const foundationChecklist: readonly ChecklistItem[] = [
  {
    label: 'Expo + Expo Router + TypeScript strict',
    detail: 'Rute di src/app dengan tab navigasi dasar dan route 404.',
    status: 'selesai',
  },
  {
    label: 'Design system',
    detail: 'Token warna, tipografi, spacing, dan radius di src/constants/theme.ts.',
    status: 'selesai',
  },
  {
    label: 'Komponen UI dasar',
    detail: 'Tombol, kartu, badge, baris info, daftar butir, dan primitif state.',
    status: 'selesai',
  },
  {
    label: 'Script lint, format, typecheck, test',
    detail: 'Tersedia di package.json dan dijalankan sebelum milestone selesai.',
    status: 'selesai',
  },
  {
    label: 'Konfigurasi environment tanpa secret',
    detail: '.env.example hanya memuat variabel EXPO_PUBLIC_*; tidak ada kredensial nyata.',
    status: 'selesai',
  },
  {
    label: 'Error boundary dan state primitives',
    detail: 'Route error boundary, loading, empty, error, dan state belum tersedia.',
    status: 'selesai',
  },
  {
    label: 'Project development Supabase',
    detail: 'Perlu akun Anda. Migration awal dijalankan lewat Supabase CLI atau SQL Editor.',
    status: 'tindakan',
  },
  {
    label: 'Keystore rilis + secret repository',
    detail: 'Keempat secret keystore di GitHub; tanpa itu rilis berhenti di langkah pertama.',
    status: 'tindakan',
  },
  {
    label: 'Build APK rilis (Gradle lokal)',
    detail: 'expo prebuild + ./gradlew assembleRelease di runner; tanpa kuota build pihak ketiga.',
    status: 'tindakan',
  },
  {
    label: 'Uji di perangkat Android fisik',
    detail: 'Pasang APK atau buka lewat Expo Go, lalu jalankan smoke test dasar.',
    status: 'tindakan',
  },
];

/** Status Milestone 1 berdasarkan hasil pemeriksaan yang benar-benar dijalankan. */
const authChecklist: readonly ChecklistItem[] = [
  {
    label: 'Supabase client + penyimpanan sesi',
    detail:
      'Satu client terpusat, session di expo-sqlite localStorage, refresh token mengikuti AppState.',
    status: 'selesai',
  },
  {
    label: 'Alur masuk, daftar, lupa sandi, atur sandi baru',
    detail: 'Validasi, loading, dan pesan error Bahasa Indonesia; teruji unit tanpa backend.',
    status: 'selesai',
  },
  {
    label: 'Navigasi terlindungi berbasis sesi',
    detail: 'Stack.Protected + gerbang loading; RLS tetap otoritas data.',
    status: 'selesai',
  },
  {
    label: 'Profil: baca, lengkapi, dan ubah',
    detail: 'Username unik, indikator loading/sukses/gagal, penanganan profil yang belum ada.',
    status: 'selesai',
  },
  {
    label: 'Migration bootstrap profil + uji RLS',
    detail: 'Jalankan di project development; dua akun diuji lewat SQL (supabase/tests).',
    status: 'tindakan',
  },
  {
    label: 'Uji nyata: dua akun di perangkat',
    detail: 'Perlu project Supabase, kredensial .env.local, dan perangkat fisik.',
    status: 'tindakan',
  },
];

const commands: readonly { label: string; command: string }[] = [
  { label: 'Jalankan aplikasi', command: 'npx expo start' },
  { label: 'Pemeriksaan tipe', command: 'npm run typecheck' },
  { label: 'Lint', command: 'npm run lint' },
  { label: 'Versi dependency SDK', command: 'npm run deps:check' },
  { label: 'Test unit', command: 'npm test' },
  { label: 'Kesehatan project', command: 'npm run doctor' },
  {
    label: 'APK rilis lokal',
    command: 'npx expo prebuild -p android && (cd android && ./gradlew :app:assembleRelease)',
  },
];

const checklistTones: Record<ChecklistStatus, BadgeTone> = {
  selesai: 'success',
  tindakan: 'warning',
};

function ChecklistSection({ items, title }: { items: readonly ChecklistItem[]; title: string }) {
  return (
    <View style={styles.section}>
      <SectionHeader
        subtitle="Item bertanda tindakan memerlukan akun atau perangkat Anda."
        title={title}
      />
      <Card padding="none">
        {items.map((item, index) => (
          <View key={item.label}>
            {index > 0 ? <Divider /> : null}
            <View style={styles.checklistRow}>
              <AppText variant="label">{item.label}</AppText>
              <AppText variant="caption" tone="muted">
                {item.detail}
              </AppText>
              <Badge
                label={item.status === 'selesai' ? 'Selesai di repo' : 'Perlu tindakan'}
                tone={checklistTones[item.status]}
              />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

export default function SystemScreen() {
  const { appInfo, backend, env } = useAppStatus();
  const { status: sessionStatus } = useAuthSession();
  const cryptoSupport = useMemo(() => installWebCrypto(), []);
  const privilegedWarning = backend.privilegedKeyWarning;
  const missingEnvKeys = PUBLIC_ENV_KEYS.filter((key) => env[key] === undefined);

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      header={
        <ScreenHeader
          showBack
          overline="Diagnostik"
          subtitle="Token desain, runtime, konfigurasi, dan checklist milestone."
          title="Fondasi & sistem"
        />
      }
      scroll
    >
      <Card>
        <SectionHeader
          subtitle="Rincian build ini; berguna saat menguji di perangkat."
          title="Identitas build"
        />
        <Divider />
        <InfoRow detail={appInfo.buildLabel} label="Versi" value={appInfo.version} />
        <InfoRow label="Expo SDK" value={appInfo.expoSdkVersion ?? 'Belum terbaca'} />
        <InfoRow label="Slug" value={appInfo.slug} />
        <InfoRow label="Skema URL" value={appInfo.scheme ?? 'Belum diset'} />
        <InfoRow label="Paket Android" value={appInfo.androidPackage ?? 'Belum diset'} />
        <InfoRow
          badge={{
            label: appInfo.easProjectId ? 'Terdaftar' : 'Belum terdaftar',
            tone: appInfo.easProjectId ? 'success' : 'neutral',
          }}
          label="EAS project"
        />
        {appInfo.devServerUrl ? (
          <InfoRow
            detail="Alamat bundler Metro yang melayani perangkat ini."
            label="Metro host"
            value={appInfo.devServerUrl}
          />
        ) : null}
      </Card>

      <Card>
        <SectionHeader
          subtitle="Hanya variabel berprefix EXPO_PUBLIC_ yang tersedia di aplikasi."
          title="Konfigurasi lingkungan"
        />
        <Divider />
        <InfoRow
          badge={{ label: backend.label, tone: backend.tone }}
          detail={backend.detail}
          label="Status backend"
        />
        {PUBLIC_ENV_KEYS.map((key) => (
          <InfoRow
            badge={{
              label: env[key] ? 'Terisi' : 'Belum diisi',
              tone: env[key] ? 'success' : 'neutral',
            }}
            key={key}
            label={key}
          />
        ))}
        {missingEnvKeys.length > 0 ? (
          <AppText variant="caption" tone="muted">
            Nilai tidak ditampilkan di layar ini agar tidak bocor lewat screenshot. Isi variabel di
            file .env.local berdasarkan .env.example.
          </AppText>
        ) : null}
      </Card>

      {privilegedWarning ? (
        <Card variant="accent">
          <AppText tone="accent" variant="bodyStrong">
            Peringatan keamanan
          </AppText>
          <AppText variant="callout" tone="secondary">
            {privilegedWarning}
          </AppText>
        </Card>
      ) : null}

      <Card>
        <SectionHeader
          subtitle="Palet charcoal + amber. Rasio kontras dihitung terhadap latar charcoal."
          title="Warna"
        />
        <Divider />
        <ColorSwatches />
      </Card>

      <Card>
        <SectionHeader subtitle="Semua ukuran berbasis skala 4dp." title="Tipografi" />
        <Divider />
        <TypeSpecimen />
      </Card>

      <Card>
        <SectionHeader title="Ruang & radius" />
        <Divider />
        <SpacingScale />
        <Divider />
        <RadiusScale />
      </Card>

      <Card>
        <SectionHeader
          subtitle="Semua kontrol punya target sentuh minimal 48dp."
          title="Komponen dasar"
        />
        <Divider />
        <ComponentShowcase />
      </Card>

      <Card>
        <SectionHeader
          subtitle="Polyfill dipasang oleh aplikasi; tanpa ini Supabase akan memakai metode PKCE yang lebih lemah."
          title="Kripto runtime & sesi"
        />
        <Divider />
        <InfoRow
          badge={{
            label: sessionStatus === 'loading' ? 'Memeriksa' : 'Selesai',
            tone: sessionStatus === 'loading' ? 'neutral' : 'success',
          }}
          detail="Status pemeriksaan sesi saat aplikasi mulai."
          label="Pemulihan sesi"
        />
        <InfoRow
          badge={{
            label: cryptoSupport.textEncoder ? 'Ada' : 'Tidak ada',
            tone: cryptoSupport.textEncoder ? 'success' : 'warning',
          }}
          label="TextEncoder"
        />
        <InfoRow
          badge={{
            label: cryptoSupport.randomValues ? 'Ada' : 'Tidak ada',
            tone: cryptoSupport.randomValues ? 'success' : 'warning',
          }}
          label="crypto.getRandomValues"
        />
        <InfoRow
          badge={{
            label: cryptoSupport.sha256 ? 'Ada' : 'Tidak ada',
            tone: cryptoSupport.sha256 ? 'success' : 'warning',
          }}
          label="crypto.subtle.digest (SHA-256)"
        />
        <InfoRow
          badge={{
            label: cryptoSupport.pkceSha256Ready ? 'Siap (S256)' : 'Terbatas (plain)',
            tone: cryptoSupport.pkceSha256Ready ? 'success' : 'warning',
          }}
          detail="Metode challenge PKCE yang benar-benar dipakai di perangkat ini."
          label="PKCE"
        />
      </Card>

      <ChecklistSection items={authChecklist} title="Checklist Milestone 1" />
      <ChecklistSection items={foundationChecklist} title="Checklist Milestone 0" />

      <Card>
        <SectionHeader
          subtitle="Jalankan dari PowerShell di folder proyek."
          title="Perintah penting"
        />
        <Divider />
        {commands.map((item) => (
          <View key={item.command} style={styles.commandRow}>
            <AppText variant="caption" tone="muted">
              {item.label}
            </AppText>
            <AppText variant="callout" tone="accent">
              {item.command}
            </AppText>
          </View>
        ))}
      </Card>

      <AppText align="center" variant="caption" tone="muted">
        Layar ini hanya menampilkan nilai dari build yang berjalan; tidak ada data contoh.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  checklistRow: {
    alignItems: 'flex-start',
    gap: spacing.xs,
    padding: spacing.lg,
  },
  commandRow: {
    gap: spacing.xs / 2,
  },
});
