/**
 * Tab Peringatan — laporan bahaya jalan (Milestone 4).
 *
 * Laporan hazard tidak ditampilkan pada peta konvoi ADR-082, jadi laporan tidak
 * digambar di peta dan tidak ada tile/marker palsu. Penggantinya adalah daftar
 * dengan filter kategori/keparahan dan label area kasar yang diturunkan dari
 * koordinat laporan (`approximateAreaLabel`).
 *
 * Izin lokasi hanya diminta ketika pengguna menekan "Gunakan lokasi saat ini";
 * penolakan izin tidak mengunci formulir karena koordinat masih bisa diisi
 * manual.
 */

import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, ErrorState, LoadingState, UnavailableState } from '@/components/ui/StateView';
import { TextField } from '@/components/ui/TextField';
import { colors, radii, spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import {
  canEditHazard,
  confirmHazard,
  createHazard,
  getActiveHazards,
  removeHazard,
  updateHazard,
  type HazardFilters,
  type HazardRow,
} from '@/features/hazards/api';
import { mapHazardError } from '@/features/hazards/errors';
import {
  approximateAreaLabel,
  describeDistance,
  distanceMeters,
  hazardWindowCopy,
} from '@/features/hazards/geo';
import {
  HAZARD_CATEGORIES,
  HAZARD_SEVERITIES,
  hazardCategoryLabel,
  hazardSeverityLabel,
  hazardSeverityTone,
  type HazardCategory,
  type HazardSeverity,
} from '@/features/hazards/labels';
import {
  CONTENT_REPORT_REASONS,
  reportContent,
  type ContentReportReason,
} from '@/features/moderation/api';
import { screenPrecondition } from '@/features/state-helper';

type HazardsState =
  | { status: 'loading' }
  | { status: 'ready'; hazards: HazardRow[] }
  | { status: 'error'; error: AppError };

type CreateForm = {
  category: HazardCategory;
  severity: HazardSeverity;
  description: string;
  latitude: string;
  longitude: string;
  rideId: string;
};

const EMPTY_FORM: CreateForm = {
  category: 'pothole',
  severity: 'moderate',
  description: '',
  latitude: '',
  longitude: '',
  rideId: '',
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function HazardsScreen() {
  const { backend, userId } = useAuthSession();
  const [state, setState] = useState<HazardsState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [filters, setFilters] = useState<HazardFilters>({ category: 'all', severity: 'all' });
  const [viewerLocation, setViewerLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // Form buat laporan.
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Dipertahankan selama pengiriman diulang supaya server mengembalikan baris
  // yang sama, bukan membuat laporan kedua.
  const clientReportId = useRef<string | null>(null);

  // Aksi per laporan.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTotals, setConfirmTotals] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<{
    id: string;
    severity: HazardSeverity;
    description: string;
  } | null>(null);
  const [reporting, setReporting] = useState<{
    id: string;
    reason: ContentReportReason;
    details: string;
  } | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const precondition = screenPrecondition(
    backend,
    userId,
    'Sesi tidak ditemukan di perangkat ini. Masuk kembali untuk melihat laporan bahaya.',
  );

  useFocusEffect(
    useCallback(() => {
      void reloadToken;

      if (!backend.available || !userId) {
        setState({ status: 'ready', hazards: [] });
        return;
      }

      const client = backend.client;
      let active = true;
      setState({ status: 'loading' });

      void (async () => {
        try {
          const result = await getActiveHazards(client, filters);
          if (!active) return;

          if (!result.ok) {
            setState({ status: 'error', error: result.error });
            return;
          }

          setState({ status: 'ready', hazards: result.data });
        } catch (error) {
          if (!active) return;
          setState({ status: 'error', error: mapHazardError(error) });
        }
      })();

      return () => {
        active = false;
      };
    }, [backend, filters, reloadToken, userId]),
  );

  const unauthorized = !backend.available || !userId;

  const handleUseCurrentLocation = async () => {
    setFormError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // Penolakan izin bukan jalan buntu: koordinat tetap bisa diisi manual.
        setFormError(
          'Izin lokasi ditolak. Anda masih bisa mengisi lintang dan bujur secara manual.',
        );
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      setViewerLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      setForm((previous) => ({
        ...previous,
        latitude: location.coords.latitude.toString(),
        longitude: location.coords.longitude.toString(),
      }));
    } catch {
      setFormError(
        'Lokasi saat ini tidak terbaca (GPS lemah atau izin perangkat). Isi koordinat manual bila perlu.',
      );
    }
  };

  const openForm = () => {
    clientReportId.current = Crypto.randomUUID();
    setForm(EMPTY_FORM);
    setFormError(null);
    setActionError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    clientReportId.current = null;
    setShowForm(false);
    setFormError(null);
  };

  const handleCreate = async () => {
    if (unauthorized) {
      setFormError('Backend belum siap atau sesi belum aktif. Masuk kembali lalu coba lagi.');
      return;
    }

    setFormError(null);
    setActionError(null);

    const latitude = Number.parseFloat(form.latitude.replace(',', '.'));
    const longitude = Number.parseFloat(form.longitude.replace(',', '.'));

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setFormError(
        'Lintang dan bujur harus berupa angka. Contoh: -6.200000 dan 106.816666, atau pakai lokasi saat ini.',
      );
      return;
    }

    setSubmitting(true);
    const result = await createHazard(backend.client, {
      category: form.category,
      severity: form.severity,
      latitude,
      longitude,
      description: form.description.trim() || undefined,
      rideId: form.rideId.trim() || undefined,
      clientReportId: clientReportId.current ?? undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    clientReportId.current = null;
    setShowForm(false);
    setForm(EMPTY_FORM);
    setNotice('Laporan terkirim. Masa berlakunya dihitung otomatis sesuai kategori.');
    reload();
  };

  const handleConfirm = async (hazardId: string) => {
    if (unauthorized) return;

    setBusyId(hazardId);
    const result = await confirmHazard(backend.client, hazardId);
    setBusyId(null);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setActionError(null);
    setNotice('Konfirmasi tercatat. Terima kasih sudah memverifikasi kondisi jalan.');
    setConfirmTotals((previous) => ({ ...previous, [hazardId]: result.data.total }));
  };

  const handleSaveEdit = async () => {
    if (!editing || unauthorized) return;

    setBusyId(editing.id);
    const result = await updateHazard(backend.client, editing.id, {
      severity: editing.severity,
      description: editing.description.trim() || undefined,
    });
    setBusyId(null);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setActionError(null);
    setEditing(null);
    setNotice('Laporan diperbarui.');
    reload();
  };

  const handleRemove = (hazardId: string) => {
    if (unauthorized) return;

    Alert.alert(
      'Lepas laporan ini?',
      'Laporan tidak lagi tampil sebagai bahaya aktif. Riwayatnya tetap tersimpan untuk moderasi.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Lepas',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusyId(hazardId);
              const result = await removeHazard(backend.client, hazardId);
              setBusyId(null);

              if (!result.ok) {
                setActionError(result.error);
                return;
              }

              setActionError(null);
              setNotice('Laporan dilepas.');
              reload();
            })();
          },
        },
      ],
    );
  };

  const handleReport = async () => {
    if (!reporting || unauthorized) return;

    setBusyId(reporting.id);
    const result = await reportContent(backend.client, {
      targetType: 'hazard',
      targetId: reporting.id,
      reason: reporting.reason,
      details: reporting.details.trim() || undefined,
    });
    setBusyId(null);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setActionError(null);
    setReporting(null);
    setNotice('Laporan penyalahgunaan terkirim. Konten tidak dihapus otomatis.');
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
          Laporan bahaya dari komunitas, dengan masa berlaku otomatis sesuai kategori. Peta belum
          aktif di build ini, jadi laporan ditampilkan sebagai daftar dengan label area perkiraan.
        </AppText>
      </View>

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      <Button
        icon={showForm ? 'close-outline' : 'add-circle-outline'}
        label={showForm ? 'Tutup formulir' : 'Laporkan bahaya jalan'}
        onPress={showForm ? closeForm : openForm}
        variant="primary"
      />

      {notice ? <Banner message={notice} title="Berhasil" tone="success" /> : null}
      {actionError ? (
        <Banner message={actionError.message} title="Aksi tidak selesai" tone="danger" />
      ) : null}

      {showForm ? (
        <Card>
          <SectionHeader
            subtitle="Masa berlaku dihitung server dari kategori: kemacetan 1 jam, kecelakaan 2 jam, lubang 24 jam."
            title="Laporkan bahaya baru"
          />

          <View style={styles.formSection}>
            <AppText variant="bodyStrong">Kategori</AppText>
            <View style={styles.pillGroup}>
              {HAZARD_CATEGORIES.map((category) => (
                <Pressable
                  key={category.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: form.category === category.value }}
                  onPress={() => setForm((previous) => ({ ...previous, category: category.value }))}
                  style={[styles.pill, form.category === category.value && styles.pillActive]}
                >
                  <AppText tone={form.category === category.value ? 'accent' : 'secondary'}>
                    {category.label}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.formSection}>
            <AppText variant="bodyStrong">Tingkat keparahan</AppText>
            <View style={styles.pillGroup}>
              {HAZARD_SEVERITIES.map((severity) => (
                <Pressable
                  key={severity.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: form.severity === severity.value }}
                  onPress={() => setForm((previous) => ({ ...previous, severity: severity.value }))}
                  style={[styles.pill, form.severity === severity.value && styles.pillActive]}
                >
                  <AppText tone={form.severity === severity.value ? 'accent' : 'secondary'}>
                    {severity.label}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>

          <TextField
            helper="Maksimal 1000 karakter."
            label="Deskripsi (opsional)"
            multiline
            placeholder="Contoh: lubang besar di lajur kanan setelah jembatan"
            value={form.description}
            onChangeText={(text) => setForm((previous) => ({ ...previous, description: text }))}
          />

          <View style={styles.row}>
            <View style={styles.half}>
              <TextField
                keyboardType="decimal-pad"
                label="Lintang"
                placeholder="-6.200000"
                value={form.latitude}
                onChangeText={(text) => setForm((previous) => ({ ...previous, latitude: text }))}
              />
            </View>
            <View style={styles.half}>
              <TextField
                keyboardType="decimal-pad"
                label="Bujur"
                placeholder="106.816666"
                value={form.longitude}
                onChangeText={(text) => setForm((previous) => ({ ...previous, longitude: text }))}
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
            helper="Opsional. Hanya bisa menautkan perjalanan yang Anda ikuti."
            label="ID perjalanan"
            placeholder="Kosongkan bila bukan dari perjalanan"
            value={form.rideId}
            onChangeText={(text) => setForm((previous) => ({ ...previous, rideId: text }))}
          />

          {formError ? <Banner message={formError} title="Periksa isian" tone="warning" /> : null}

          <Button
            disabled={submitting}
            icon="send-outline"
            label={submitting ? 'Mengirim…' : 'Kirim laporan'}
            onPress={handleCreate}
            variant="primary"
          />
        </Card>
      ) : null}

      <Card>
        <SectionHeader
          subtitle="Filter berlaku pada daftar laporan aktif. Laporan kedaluwarsa tidak ditampilkan."
          title="Filter"
        />

        <View style={styles.formSection}>
          <AppText variant="bodyStrong">Kategori</AppText>
          <View style={styles.pillGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: filters.category === 'all' }}
              onPress={() => setFilters((previous) => ({ ...previous, category: 'all' }))}
              style={[styles.pill, filters.category === 'all' && styles.pillActive]}
            >
              <AppText tone={filters.category === 'all' ? 'accent' : 'secondary'}>Semua</AppText>
            </Pressable>
            {HAZARD_CATEGORIES.map((category) => (
              <Pressable
                key={category.value}
                accessibilityRole="button"
                accessibilityState={{ selected: filters.category === category.value }}
                onPress={() =>
                  setFilters((previous) => ({ ...previous, category: category.value }))
                }
                style={[styles.pill, filters.category === category.value && styles.pillActive]}
              >
                <AppText tone={filters.category === category.value ? 'accent' : 'secondary'}>
                  {category.label}
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.formSection}>
          <AppText variant="bodyStrong">Keparahan</AppText>
          <View style={styles.pillGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: filters.severity === 'all' }}
              onPress={() => setFilters((previous) => ({ ...previous, severity: 'all' }))}
              style={[styles.pill, filters.severity === 'all' && styles.pillActive]}
            >
              <AppText tone={filters.severity === 'all' ? 'accent' : 'secondary'}>Semua</AppText>
            </Pressable>
            {HAZARD_SEVERITIES.map((severity) => (
              <Pressable
                key={severity.value}
                accessibilityRole="button"
                accessibilityState={{ selected: filters.severity === severity.value }}
                onPress={() =>
                  setFilters((previous) => ({ ...previous, severity: severity.value }))
                }
                style={[styles.pill, filters.severity === severity.value && styles.pillActive]}
              >
                <AppText tone={filters.severity === severity.value ? 'accent' : 'secondary'}>
                  {severity.label}
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>
      </Card>

      {precondition ? (
        <UnavailableState
          description={precondition.message}
          icon="lock-closed-outline"
          title="Laporan bahaya belum bisa dimuat"
        />
      ) : null}

      {!precondition && state.status === 'loading' ? (
        <LoadingState label="Memuat laporan bahaya…" />
      ) : null}

      {!precondition && state.status === 'error' ? (
        <ErrorState description={state.error.message} onRetry={reload} />
      ) : null}

      {!precondition && state.status === 'ready' && hazards.length === 0 ? (
        <EmptyState
          description="Belum ada laporan yang cocok dengan filter ini. Ubah filter, atau laporkan kondisi jalan dengan tombol di atas."
          icon="warning-outline"
          title="Tidak ada laporan aktif"
        />
      ) : null}

      {hazards.map((hazard) => {
        const window = hazardWindowCopy(hazard.expires_at);
        const mine = hazard.reporter_id === userId;
        const editable = mine && canEditHazard(hazard);
        const distance = viewerLocation ? distanceMeters(viewerLocation, hazard) : Number.NaN;
        const confirmedTotal = confirmTotals[hazard.id];

        return (
          <Card key={hazard.id}>
            <View style={styles.hazardHeader}>
              <View style={styles.hazardMeta}>
                <AppText variant="bodyStrong">{hazardCategoryLabel(hazard.category)}</AppText>
                <View style={styles.badgeRow}>
                  <Badge
                    label={hazardSeverityLabel(hazard.severity)}
                    tone={hazardSeverityTone(hazard.severity)}
                  />
                  <Badge label={window.label} tone={window.expired ? 'danger' : 'neutral'} />
                  {mine ? <Badge label="Laporan Anda" tone="accent" /> : null}
                </View>
              </View>
            </View>

            <AppText tone="secondary" variant="caption">
              {approximateAreaLabel(hazard.latitude, hazard.longitude)}
              {Number.isFinite(distance) ? ` · ${describeDistance(distance)} dari lokasi Anda` : ''}
            </AppText>

            {hazard.description ? <AppText variant="callout">{hazard.description}</AppText> : null}

            <AppText tone="muted" variant="caption">
              Dilaporkan {formatDateTime(hazard.created_at)}
              {confirmedTotal !== undefined ? ` · ${confirmedTotal} konfirmasi` : ''}
            </AppText>

            {editing?.id === hazard.id ? (
              <View style={styles.editBox}>
                <AppText variant="bodyStrong">Tingkat keparahan</AppText>
                <View style={styles.pillGroup}>
                  {HAZARD_SEVERITIES.map((severity) => (
                    <Pressable
                      key={severity.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: editing.severity === severity.value }}
                      onPress={() => setEditing({ ...editing, severity: severity.value })}
                      style={[
                        styles.pill,
                        editing.severity === severity.value && styles.pillActive,
                      ]}
                    >
                      <AppText tone={editing.severity === severity.value ? 'accent' : 'secondary'}>
                        {severity.label}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
                <TextField
                  label="Deskripsi"
                  multiline
                  value={editing.description}
                  onChangeText={(text) => setEditing({ ...editing, description: text })}
                />
                <View style={styles.actionRow}>
                  <Button
                    disabled={busyId === hazard.id}
                    label={busyId === hazard.id ? 'Menyimpan…' : 'Simpan'}
                    onPress={handleSaveEdit}
                    variant="primary"
                  />
                  <Button label="Batal" onPress={() => setEditing(null)} variant="secondary" />
                </View>
              </View>
            ) : null}

            {reporting?.id === hazard.id ? (
              <View style={styles.editBox}>
                <AppText variant="bodyStrong">Alasan laporan</AppText>
                <View style={styles.pillGroup}>
                  {CONTENT_REPORT_REASONS.map((reason) => (
                    <Pressable
                      key={reason.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: reporting.reason === reason.value }}
                      onPress={() => setReporting({ ...reporting, reason: reason.value })}
                      style={[styles.pill, reporting.reason === reason.value && styles.pillActive]}
                    >
                      <AppText tone={reporting.reason === reason.value ? 'accent' : 'secondary'}>
                        {reason.label}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
                <TextField
                  helper="Maksimal 2000 karakter."
                  label="Rincian (opsional)"
                  multiline
                  value={reporting.details}
                  onChangeText={(text) => setReporting({ ...reporting, details: text })}
                />
                <View style={styles.actionRow}>
                  <Button
                    disabled={busyId === hazard.id}
                    label={busyId === hazard.id ? 'Mengirim…' : 'Kirim laporan'}
                    onPress={handleReport}
                    variant="primary"
                  />
                  <Button label="Batal" onPress={() => setReporting(null)} variant="secondary" />
                </View>
              </View>
            ) : null}

            {editing?.id === hazard.id || reporting?.id === hazard.id ? null : (
              <View style={styles.actionRow}>
                <Button
                  disabled={busyId === hazard.id}
                  icon="thumbs-up-outline"
                  label={busyId === hazard.id ? 'Memproses…' : 'Masih ada'}
                  onPress={() => handleConfirm(hazard.id)}
                  variant="secondary"
                />
                {editable ? (
                  <>
                    <Button
                      label="Ubah"
                      onPress={() =>
                        setEditing({
                          id: hazard.id,
                          severity: hazard.severity,
                          description: hazard.description ?? '',
                        })
                      }
                      variant="ghost"
                    />
                    <Button label="Lepas" onPress={() => handleRemove(hazard.id)} variant="ghost" />
                  </>
                ) : null}
                <Button
                  label="Laporkan"
                  onPress={() => setReporting({ id: hazard.id, reason: 'spam', details: '' })}
                  variant="ghost"
                />
              </View>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  editBox: {
    backgroundColor: colors.background.raised,
    borderRadius: radii.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  formSection: {
    gap: spacing.sm,
  },
  half: {
    flex: 1,
  },
  hazardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hazardMeta: {
    gap: spacing.xs,
  },
  header: {
    gap: spacing.sm,
  },
  pill: {
    backgroundColor: colors.background.elevated,
    borderColor: colors.border.subtle,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pillActive: {
    backgroundColor: colors.accent.soft,
    borderColor: colors.accent.base,
  },
  pillGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
});
