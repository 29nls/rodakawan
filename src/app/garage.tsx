import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { InfoRow } from '@/components/ui/InfoRow';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, ErrorState, LoadingState, UnavailableState } from '@/components/ui/StateView';
import { TextField } from '@/components/ui/TextField';
import { spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import {
  createMotorcycle,
  deleteMotorcycle,
  listOwnMotorcycles,
  setPrimaryMotorcycle,
  type MotorcycleSummary,
} from '@/features/garage/api';
import {
  hasFormErrors,
  motorcycleFormErrors,
  normalizeText,
  parseModelYear,
  type MotorcycleFormErrors,
} from '@/features/garage/validation';
import {
  cleanUpVehiclePhotosAfterDelete,
  sweepOrphanVehiclePhotos,
} from '@/features/media/photoCleanup';
import { describeUnavailableReason } from '@/lib/supabase/client';

type GarageState =
  | { status: 'loading' }
  | { status: 'ready'; vehicles: MotorcycleSummary[] }
  | { status: 'error'; error: AppError };

const EMPTY_FORM = { make: '', model: '', nickname: '', modelYear: '' };

/**
 * Layar Garasi: daftar, tambah, jadikan utama, dan hapus kendaraan milik akun yang
 * sedang masuk. Semua query dibatasi `owner_id` dari sesi (`listOwnMotorcycles`),
 * jadi layar ini tidak punya jalur untuk membaca kendaraan pengguna lain.
 *
 * Nomor polisi tidak ditampilkan di sini: datanya ada di tabel terpisah
 * (`motorcycle_private_details`) dan hanya dibuka di halaman detail kendaraan.
 */
export default function GarageScreen() {
  const router = useRouter();
  const { backend, userId } = useAuthSession();

  const [state, setState] = useState<GarageState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<MotorcycleFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!backend.available || !userId) return;

    const client = backend.client;
    let active = true;

    void listOwnMotorcycles(client, userId).then((result) => {
      if (!active) return;

      if (result.ok) {
        setState({ status: 'ready', vehicles: result.data });

        // Objek foto yang tertinggal dari unggahan gagal (mis. perangkat offline
        // saat mengganti foto) dirapikan di latar belakang. Hasilnya sengaja
        // tidak ditampilkan: sapuan ini tidak menghalangi apa pun di layar ini.
        void sweepOrphanVehiclePhotos(client, userId, result.data);
      } else {
        setState({ status: 'error', error: result.error });
      }
    });

    return () => {
      active = false;
    };
  }, [backend, reloadToken, userId]);

  const precondition: AppError | null = !backend.available
    ? {
        code: 'backend_not_configured',
        message: describeUnavailableReason(backend.reason),
        retryable: false,
      }
    : !userId
      ? {
          code: 'session_expired',
          message: 'Sesi tidak ditemukan di perangkat ini. Masuk kembali untuk membuka garasi.',
          retryable: false,
        }
      : null;

  async function handleAdd() {
    if (!backend.available || !userId || saving) return;

    const errors = motorcycleFormErrors(form);
    setFormErrors(errors);
    setNotice(null);
    setActionError(null);

    if (hasFormErrors(errors)) return;

    const year = parseModelYear(form.modelYear);
    if (!year.ok) return;

    setSaving(true);
    const result = await createMotorcycle(backend.client, userId, {
      make: normalizeText(form.make),
      model: normalizeText(form.model),
      nickname: normalizeText(form.nickname) || null,
      modelYear: year.value,
      isPrimary: state.status === 'ready' && state.vehicles.length === 0,
    });
    setSaving(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setForm(EMPTY_FORM);
    setNotice(
      result.data.isPrimary
        ? `${result.data.make} ${result.data.model} ditambahkan sebagai kendaraan utama.`
        : `${result.data.make} ${result.data.model} ditambahkan ke garasi Anda.`,
    );
    reload();
  }

  async function handleSetPrimary(vehicle: MotorcycleSummary) {
    if (!backend.available || !userId || busyId) return;

    setBusyId(vehicle.id);
    setNotice(null);
    setActionError(null);

    const result = await setPrimaryMotorcycle(backend.client, userId, vehicle.id);
    setBusyId(null);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setNotice(
      `${vehicle.make} ${vehicle.model} sekarang menjadi kendaraan utama Anda. Kendaraan dengan nomor polisi tetap privat tidak ikut ditampilkan di profil publik.`,
    );
    reload();
  }

  function confirmDelete(vehicle: MotorcycleSummary) {
    if (!backend.available || !userId) return;

    const label = vehicle.nickname ?? `${vehicle.make} ${vehicle.model}`;

    Alert.alert(
      'Hapus kendaraan?',
      `${label} akan dihapus dari garasi Anda beserta detail privatnya (nomor polisi dan catatan). Tindakan ini tidak bisa dibatalkan.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () => {
            void handleDelete(vehicle);
          },
        },
      ],
    );
  }

  async function handleDelete(vehicle: MotorcycleSummary) {
    if (!backend.available || !userId) return;

    setBusyId(vehicle.id);
    setNotice(null);
    setActionError(null);

    const result = await deleteMotorcycle(backend.client, userId, vehicle.id);

    // Baris sudah terhapus, jadi path foto diambil dari ringkasan yang tampil.
    // Objek yang masih diketahui dihapus lebih dulu, lalu folder kendaraan itu
    // disapu untuk sisa unggahan sebelumnya. Kegagalan membersihkan objek tidak
    // membatalkan penghapusan kendaraan.
    if (result.ok) {
      await cleanUpVehiclePhotosAfterDelete(
        backend.client,
        userId,
        vehicle.photoPath,
        state.status === 'ready' ? state.vehicles.filter((item) => item.id !== vehicle.id) : [],
      );
    }

    setBusyId(null);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setNotice('Kendaraan dihapus dari garasi Anda.');
    reload();
  }

  return (
    <Screen scroll testID="garage-screen">
      <ScreenHeader
        showBack
        overline="Garasi"
        title="Kendaraan saya"
        subtitle="Data publik kendaraan dipisahkan dari nomor polisi dan catatan privat."
      />

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {notice ? (
        <Banner message={notice} testID="garage-notice" title="Berhasil" tone="success" />
      ) : null}

      {actionError ? (
        <Banner message={actionError.message} title="Aksi tidak selesai" tone="danger" />
      ) : null}

      {precondition ? (
        <UnavailableState
          description={precondition.message}
          icon="lock-closed-outline"
          title="Garasi belum bisa dibuka"
        />
      ) : null}

      {!precondition ? (
        <Card>
          <SectionHeader
            subtitle="Kendaraan yang terdaftar untuk akun ini."
            title="Daftar kendaraan"
          />
          <Divider />

          {state.status === 'loading' ? <LoadingState label="Memuat kendaraan…" /> : null}

          {state.status === 'error' ? (
            <ErrorState onRetry={reload} description={state.error.message} />
          ) : null}

          {state.status === 'ready' && state.vehicles.length === 0 ? (
            <EmptyState
              description="Belum ada kendaraan di garasi ini. Tambahkan kendaraan pertama Anda pada formulir di bawah."
              icon="bicycle-outline"
              testID="garage-empty"
              title="Garasi masih kosong"
            />
          ) : null}

          {state.status === 'ready'
            ? state.vehicles.map((vehicle) => (
                <Card key={vehicle.id} padding="md" variant="raised" style={styles.vehicle}>
                  <InfoRow
                    detail={vehicle.nickname ?? undefined}
                    label={`${vehicle.make} ${vehicle.model}`}
                    value={vehicle.modelYear ? String(vehicle.modelYear) : 'Tahun belum diisi'}
                  />
                  <View style={styles.badges}>
                    {vehicle.isPrimary ? <Badge label="Utama" tone="accent" /> : null}
                    <Badge
                      label={vehicle.isPublic ? 'Terlihat publik' : 'Disembunyikan'}
                      tone={vehicle.isPublic ? 'neutral' : 'warning'}
                    />
                    <Badge icon="lock-closed-outline" label="Plat privat" tone="neutral" />
                  </View>
                  <View style={styles.actions}>
                    <Button
                      accessibilityHint="Membuka detail kendaraan, termasuk nomor polisi privat."
                      disabled={busyId !== null}
                      icon="open-outline"
                      label="Detail"
                      onPress={() =>
                        router.push({ pathname: '/vehicle', params: { id: vehicle.id } })
                      }
                      variant="secondary"
                    />
                    {vehicle.isPrimary ? null : (
                      <Button
                        accessibilityHint="Menjadikan kendaraan ini kendaraan utama."
                        disabled={busyId !== null}
                        icon="star-outline"
                        label="Jadikan utama"
                        onPress={() => {
                          void handleSetPrimary(vehicle);
                        }}
                        variant="secondary"
                      />
                    )}
                    <Button
                      accessibilityHint="Menghapus kendaraan ini dari garasi Anda."
                      disabled={busyId !== null}
                      icon="trash-outline"
                      label="Hapus"
                      onPress={() => confirmDelete(vehicle)}
                      variant="ghost"
                    />
                  </View>
                </Card>
              ))
            : null}
        </Card>
      ) : null}

      <Card>
        <SectionHeader
          subtitle="Merek dan model wajib; tahun boleh dikosongkan."
          title="Tambah kendaraan"
        />
        <Divider />
        <TextField
          error={formErrors.make}
          label="Merek"
          onChangeText={(make) => setForm((previous) => ({ ...previous, make }))}
          placeholder="Honda"
          testID="garage-make"
          value={form.make}
        />
        <TextField
          error={formErrors.model}
          label="Model"
          onChangeText={(model) => setForm((previous) => ({ ...previous, model }))}
          placeholder="Vario 160"
          testID="garage-model"
          value={form.model}
        />
        <TextField
          error={formErrors.nickname}
          helper="Opsional, mis. nama panggilan kendaraan."
          label="Nama panggilan"
          onChangeText={(nickname) => setForm((previous) => ({ ...previous, nickname }))}
          value={form.nickname}
        />
        <TextField
          error={formErrors.modelYear}
          keyboardType="number-pad"
          label="Tahun"
          maxLength={4}
          onChangeText={(modelYear) => setForm((previous) => ({ ...previous, modelYear }))}
          placeholder="2019"
          value={form.modelYear}
        />
        <Button
          accessibilityHint="Menyimpan kendaraan baru ke garasi Anda."
          disabled={!backend.available || !userId || saving}
          icon="add-circle-outline"
          label={saving ? 'Menyimpan…' : 'Simpan kendaraan'}
          onPress={() => {
            void handleAdd();
          }}
          testID="garage-submit"
        />
        <Button
          disabled={saving || state.status !== 'ready'}
          label="Muat ulang daftar"
          onPress={reload}
          variant="secondary"
        />
      </Card>

      <Card variant="accent">
        <AppText variant="bodyStrong" tone="accent">
          Nomor polisi tetap privat
        </AppText>
        <AppText tone="secondary" variant="callout">
          Nomor polisi dan catatan pribadi disimpan pada tabel terpisah yang hanya dapat dibaca
          pemiliknya (`motorcycle_private_details`). Nilainya tidak pernah ikut ke profil publik,
          daftar kendaraan publik, maupun muatan realtime.
        </AppText>
      </Card>

      <AppText tone="muted" variant="caption">
        Foto kendaraan diunggah dari halaman detail masing-masing kendaraan. Bucket penyimpanannya
        privat dan hanya dapat dibaca akun pemilik kendaraan.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  vehicle: {
    gap: spacing.md,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
