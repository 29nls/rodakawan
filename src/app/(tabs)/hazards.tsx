import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';

import { AppText } from '@/components/ui/AppText';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateView';
import { TextField } from '@/components/ui/TextField';
import { colors, radii, spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import {
  confirmHazard,
  createHazard,
  getActiveHazards,
  type HazardRow,
} from '@/features/hazards/api';
import type { HazardFilters } from '@/features/hazards/api';

type HazardsState =
  | { status: 'loading' }
  | { status: 'ready'; hazards: HazardRow[] }
  | { status: 'error'; error: AppError };

type CreateForm = {
  category: string;
  severity: string;
  description: string;
  latitude: string;
  longitude: string;
  rideId: string;
};

const CATEGORIES = [
  { value: 'pothole', label: 'Lubang jalan' },
  { value: 'crash', label: 'Kecelakaan' },
  { value: 'traffic', label: 'Kemacetan' },
  { value: 'weather', label: 'Cuaca buruk' },
  { value: 'flood', label: 'Banjir' },
  { value: 'road_block', label: 'Penghalang jalan' },
  { value: 'traffic_enforcement', label: 'Penegakan lalu lintas' },
  { value: 'other', label: 'Lainnya' },
];

const SEVERITIES = [
  { value: 'info', label: 'Info' },
  { value: 'moderate', label: 'Sedang' },
  { value: 'high', label: 'Tinggi' },
  { value: 'critical', label: 'Kritis' },
];

const EMPTY_FORM: CreateForm = {
  category: 'other',
  severity: 'moderate',
  description: '',
  latitude: '',
  longitude: '',
  rideId: '',
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID');
  } catch {
    return iso;
  }
}

function getCategoryLabel(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.label || category;
}

function getSeverityLabel(severity: string): string {
  return SEVERITIES.find((s) => s.value === severity)?.label || severity;
}

export default function HazardsScreen() {
  const { backend, userId } = useAuthSession();
  const [state, setState] = useState<HazardsState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filters, setFilters] = useState<HazardFilters>({});
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useFocusEffect(
    useCallback(() => {
      void reloadToken;

      if (!backend.available || !userId) {
        setState({ status: 'ready', hazards: [] });
        return;
      }

      const client = backend.client;
      let active = true;

      void (async () => {
        const result = await getActiveHazards(client, filters);
        if (!active) return;

        if (!result.ok) {
          setState({ status: 'error', error: result.error });
          return;
        }

        setState({ status: 'ready', hazards: result.data });
      })();

      return () => {
        active = false;
      };
    }, [backend, reloadToken, userId, filters]),
  );

  const handleUseCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setFormError('Izin lokasi diperlukan untuk menggunakan lokasi saat ini');
        return;
      }
      const location = await Location.getCurrentPositionAsync({});
      setForm((prev) => ({
        ...prev,
        latitude: location.coords.latitude.toString(),
        longitude: location.coords.longitude.toString(),
      }));
      setFormError(null);
    } catch (error) {
      setFormError('Gagal mendapatkan lokasi saat ini');
    }
  };

  const handleCreate = async () => {
    setFormError(null);
    setActionError(null);

    if (!backend.available || !userId) {
      setFormError('Backend belum tersedia');
      return;
    }

    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);

    if (isNaN(lat) || isNaN(lng)) {
      setFormError('Koordinat lintang dan bujur harus diisi dengan benar');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createHazard(backend.client, {
        category: form.category,
        severity: form.severity,
        latitude: lat,
        longitude: lng,
        description: form.description.trim() || undefined,
        rideId: form.rideId.trim() || undefined,
      });

      if (!result.ok) {
        setActionError(result.error);
        setSubmitting(false);
        return;
      }

      setShowForm(false);
      setForm(EMPTY_FORM);
      reload();
    } catch (error) {
      setFormError('Terjadi kesalahan tak terduga');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (hazardId: string) => {
    if (!backend.available || !userId) return;

    setConfirmingId(hazardId);
    try {
      const result = await confirmHazard(backend.client, hazardId);
      if (!result.ok) {
        setActionError(result.error);
        setConfirmingId(null);
        return;
      }
      reload();
    } catch (error) {
      setActionError({ code: 'unknown', message: 'Gagal mengkonfirmasi laporan', retryable: true });
    } finally {
      setConfirmingId(null);
    }
  };

  const hazards = state.status === 'ready' ? state.hazards : [];

  return (
    <Screen scroll>
      <View style={styles.header}>
        <AppText variant="overline" tone="accent">
          Peringatan jalan
        </AppText>
        <AppText variant="titleLg">Kondisi di jalan</AppText>
        <AppText tone="secondary" variant="callout">
          Laporan bahaya jalan dari komunitas. Laporan kedaluwarsa otomatis sesuai kategorinya.
        </AppText>
      </View>

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      <Button
        icon={showForm ? 'close-outline' : 'add-circle-outline'}
        label={showForm ? 'Tutup formulir' : 'Laporkan bahaya jalan'}
        onPress={() => setShowForm(!showForm)}
        variant="primary"
      />

      {showForm ? (
        <Card>
          <SectionHeader
            subtitle="Isi informasi bahaya jalan. Koordinat wajib diisi."
            title="Laporkan bahaya baru"
          />
          <View style={styles.formSection}>
            <AppText variant="bodyStrong">Kategori</AppText>
            <View style={styles.pillGroup}>
              {CATEGORIES.map((cat) => (
                <Pressable
                  key={cat.value}
                  onPress={() => setForm((prev) => ({ ...prev, category: cat.value }))}
                  style={[
                    styles.pill,
                    form.category === cat.value && styles.pillActive,
                  ]}
                >
                  <AppText tone={form.category === cat.value ? 'primary' : 'secondary'}>
                    {cat.label}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.formSection}>
            <AppText variant="bodyStrong">Tingkat keparahan</AppText>
            <View style={styles.pillGroup}>
              {SEVERITIES.map((sev) => (
                <Pressable
                  key={sev.value}
                  onPress={() => setForm((prev) => ({ ...prev, severity: sev.value }))}
                  style={[
                    styles.pill,
                    form.severity === sev.value && styles.pillActive,
                  ]}
                >
                  <AppText tone={form.severity === sev.value ? 'primary' : 'secondary'}>
                    {sev.label}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>

          <TextField
            label="Deskripsi (opsional)"
            placeholder="Contoh: lubang berukuran besar di jalur kanan"
            value={form.description}
            onChangeText={(text) => setForm((prev) => ({ ...prev, description: text }))}
          />

          <View style={styles.row}>
            <View style={styles.half}>
              <TextField
                label="Lintang"
                placeholder="-6.200000"
                value={form.latitude}
                onChangeText={(text) => setForm((prev) => ({ ...prev, latitude: text }))}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.half}>
              <TextField
                label="Bujur"
                placeholder="106.816666"
                value={form.longitude}
                onChangeText={(text) => setForm((prev) => ({ ...prev, longitude: text }))}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <Button
            icon="locate-outline"
            label="Gunakan lokasi saat ini"
            onPress={handleUseCurrentLocation}
            variant="secondary"
          />

          <TextField
            label="ID Perjalanan (opsional)"
            placeholder="Untuk menghubungkan dengan perjalanan tertentu"
            value={form.rideId}
            onChangeText={(text) => setForm((prev) => ({ ...prev, rideId: text }))}
          />

          {formError ? <Banner title="Kesalahan" message={formError} tone="danger" /> : null}
          {actionError ? <Banner title="Aksi tidak selesai" message={actionError.message} tone="danger" /> : null}

          <Button
            disabled={submitting}
            icon="send-outline"
            label={submitting ? 'Mengirim...' : 'Kirim laporan'}
            onPress={handleCreate}
            variant="primary"
          />
        </Card>
      ) : null}

      {state.status === 'loading' ? <LoadingState label="Memuat laporan bahaya..." /> : null}

      {state.status === 'error' ? (
        <ErrorState description={state.error.message} onRetry={reload} />
      ) : null}

      {state.status === 'ready' && hazards.length === 0 ? (
        <EmptyState
          description="Belum ada laporan bahaya aktif saat ini. Anda bisa melaporkan kondisi jalan dengan tombol di atas."
          icon="warning-outline"
          title="Belum ada laporan bahaya aktif"
        />
      ) : null}

      {state.status === 'ready' && hazards.length > 0
        ? hazards.map((hazard) => (
            <Card key={hazard.id}>
              <View style={styles.hazardHeader}>
                <View style={styles.hazardMeta}>
                  <AppText variant="bodyStrong">{getCategoryLabel(hazard.category)}</AppText>
                  <AppText tone="secondary" variant="caption">
                    {getSeverityLabel(hazard.severity)} • {formatDateTime(hazard.created_at)}
                  </AppText>
                </View>
              </View>
              {hazard.description ? (
                <AppText variant="callout">{hazard.description}</AppText>
              ) : null}
              <AppText tone="secondary" variant="caption">
                Berlaku hingga: {formatDateTime(hazard.expires_at)}
              </AppText>
              <AppText tone="secondary" variant="caption">
                Status: {hazard.status}
              </AppText>
              <View style={styles.hazardActions}>
                <Button
                  disabled={confirmingId === hazard.id}
                  icon="thumbs-up-outline"
                  label={confirmingId === hazard.id ? 'Mengkonfirmasi...' : 'Masih ada'}
                  onPress={() => handleConfirm(hazard.id)}
                  variant="secondary"
                />
              </View>
            </Card>
          ))
        : null}

      {actionError && !showForm ? (
        <Banner title="Aksi tidak selesai" message={actionError.message} tone="danger" />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  formSection: {
    gap: spacing.sm,
  },
  pillGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.background.elevated,
  },
  pillActive: {
    backgroundColor: colors.accent.soft,
    borderColor: colors.accent.base,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
  hazardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  hazardMeta: {
    gap: spacing.xs,
  },
  hazardActions: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
});