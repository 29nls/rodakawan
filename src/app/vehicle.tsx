import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ErrorState, LoadingState, UnavailableState } from '@/components/ui/StateView';
import { TextField } from '@/components/ui/TextField';
import { spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import {
  deleteMotorcycle,
  deletePrivateMotorcycleDetails,
  getPrivateMotorcycleDetails,
  listOwnMotorcycles,
  savePrivateMotorcycleDetails,
  updateMotorcycle,
  type MotorcyclePrivateDetails,
  type MotorcycleSummary,
} from '@/features/garage/api';
import {
  hasFormErrors,
  motorcycleFormErrors,
  normalizeText,
  parseModelYear,
  plateError,
  privateNotesError,
  type MotorcycleFormErrors,
} from '@/features/garage/validation';
import { PhotoCard } from '@/features/media/components/PhotoCard';
import { VEHICLE_PHOTO_MAX_DIMENSION } from '@/features/media/imageCompression';
import { pickPhoto } from '@/features/media/picker';
import {
  deleteVehiclePhoto,
  getPhotoSignedUrl,
  removePhotoObject,
  uploadVehiclePhoto,
  VEHICLE_PHOTO_BUCKET,
} from '@/features/media/photos';

type DetailState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; vehicle: MotorcycleSummary; privateDetails: MotorcyclePrivateDetails }
  | { status: 'error'; error: AppError };

/**
 * Detail kendaraan: data publik yang bisa diubah, plus bagian privat (nomor polisi
 * dan catatan) yang dibaca dari `motorcycle_private_details`.
 *
 * Baris kendaraan diambil dari `listOwnMotorcycles` (selalu dibatasi `owner_id`
 * dari sesi) lalu dicari berdasarkan `id` dari tautan, sehingga id kendaraan
 * pengguna lain tidak pernah bisa dibuka dari layar ini.
 */
export default function VehicleScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const vehicleId = typeof params.id === 'string' ? params.id : '';
  const { backend, userId } = useAuthSession();

  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [form, setForm] = useState({ make: '', model: '', nickname: '', modelYear: '' });
  const [makePrimary, setMakePrimary] = useState(false);
  const [formErrors, setFormErrors] = useState<MotorcycleFormErrors>({});
  const [plate, setPlate] = useState('');
  const [notes, setNotes] = useState('');
  const [plateErrorText, setPlateErrorText] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ path: string; url: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const vehiclePhotoPath = state.status === 'ready' ? state.vehicle.photoPath : null;

  useEffect(() => {
    if (!backend.available || !userId || vehicleId.length === 0) return;

    const client = backend.client;
    let active = true;

    void (async () => {
      const list = await listOwnMotorcycles(client, userId);

      if (!active) return;

      if (!list.ok) {
        setState({ status: 'error', error: list.error });
        return;
      }

      const vehicle = list.data.find((item) => item.id === vehicleId) ?? null;

      if (!vehicle) {
        setState({ status: 'missing' });
        return;
      }

      const priv = await getPrivateMotorcycleDetails(client, userId, vehicle.id);

      if (!active) return;

      if (!priv.ok) {
        setState({ status: 'error', error: priv.error });
        return;
      }

      setForm({
        make: vehicle.make,
        model: vehicle.model,
        nickname: vehicle.nickname ?? '',
        modelYear: vehicle.modelYear ? String(vehicle.modelYear) : '',
      });
      setMakePrimary(vehicle.isPrimary);
      setPlate(priv.data.plateNumber);
      setNotes(priv.data.privateNotes);
      setState({ status: 'ready', vehicle, privateDetails: priv.data });
    })();

    return () => {
      active = false;
    };
  }, [backend, reloadToken, userId, vehicleId]);

  // Signed URL dibuat ulang setiap kali path berubah; URL lama tidak disimpan
  // di state global maupun database, jadi tidak ada tautan permanen ke foto.
  // Pratinjau hanya dipakai bila path-nya masih sama dengan baris yang tampil.
  useEffect(() => {
    if (!backend.available || !vehiclePhotoPath) return;

    let active = true;

    void getPhotoSignedUrl(backend.client, VEHICLE_PHOTO_BUCKET, vehiclePhotoPath).then(
      (result) => {
        if (!active || !result.ok) return;
        setPhotoPreview({ path: vehiclePhotoPath, url: result.data });
      },
    );

    return () => {
      active = false;
    };
  }, [backend, vehiclePhotoPath]);

  async function handlePickPhoto() {
    if (!backend.available || !userId || photoBusy) return;

    setNotice(null);
    setActionError(null);

    const picked = await pickPhoto('vehicle');
    if (!picked.ok) {
      setActionError(picked.error);
      return;
    }

    if (!picked.asset) return;

    setPhotoBusy(true);
    const result = await uploadVehiclePhoto(backend.client, userId, vehicleId, picked.asset);
    setPhotoBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setNotice('Foto kendaraan diperbarui. Foto ini privat: hanya akun Anda yang dapat membukanya.');
    reload();
  }

  function confirmRemovePhoto() {
    Alert.alert('Hapus foto kendaraan?', 'Foto akan dihapus permanen dari penyimpanan privat.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!backend.available || !userId || photoBusy) return;

            setNotice(null);
            setActionError(null);
            setPhotoBusy(true);
            const result = await deleteVehiclePhoto(backend.client, userId, vehicleId);
            setPhotoBusy(false);

            if (!result.ok) {
              setActionError(result.error);
              return;
            }

            setPhotoPreview(null);
            setNotice(
              result.data.deleted
                ? 'Foto kendaraan dihapus.'
                : 'Kendaraan ini belum memiliki foto.',
            );
            reload();
          })();
        },
      },
    ]);
  }

  async function handleSaveVehicle() {
    if (!backend.available || !userId || busy) return;

    const errors = motorcycleFormErrors(form);
    setFormErrors(errors);
    setNotice(null);
    setActionError(null);

    if (hasFormErrors(errors)) return;

    const year = parseModelYear(form.modelYear);
    if (!year.ok) return;

    setBusy(true);
    const result = await updateMotorcycle(backend.client, userId, vehicleId, {
      make: normalizeText(form.make),
      model: normalizeText(form.model),
      nickname: normalizeText(form.nickname) || null,
      modelYear: year.value,
      isPrimary: makePrimary,
    });
    setBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setNotice('Data kendaraan diperbarui.');
    reload();
  }

  async function handleSavePrivate() {
    if (!backend.available || !userId || busy) return;

    const problem = plateError(plate) ?? privateNotesError(notes);
    setPlateErrorText(plateError(plate));
    setNotice(null);
    setActionError(null);

    if (problem) return;

    setBusy(true);
    const result = await savePrivateMotorcycleDetails(backend.client, userId, vehicleId, {
      plateNumber: normalizeText(plate),
      privateNotes: notes.trim().length > 0 ? notes.trim() : null,
    });
    setBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setNotice(
      'Nomor polisi dan catatan privat disimpan. Data ini tidak pernah dikirim ke profil publik.',
    );
    reload();
  }

  async function handleDeletePrivate() {
    if (!backend.available || !userId || busy) return;

    setBusy(true);
    const result = await deletePrivateMotorcycleDetails(backend.client, userId, vehicleId);
    setBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setPlate('');
    setNotes('');
    setPlateErrorText(undefined);
    setNotice(
      result.data.deleted
        ? 'Detail privat kendaraan dihapus.'
        : 'Tidak ada detail privat yang tersimpan untuk kendaraan ini.',
    );
    reload();
  }

  function confirmDeleteVehicle() {
    Alert.alert('Hapus kendaraan?', 'Kendaraan beserta detail privatnya akan dihapus permanen.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!backend.available || !userId) return;

            const photoPath = state.status === 'ready' ? state.vehicle.photoPath : null;

            setBusy(true);
            const result = await deleteMotorcycle(backend.client, userId, vehicleId);

            if (result.ok && photoPath) {
              await removePhotoObject(backend.client, VEHICLE_PHOTO_BUCKET, photoPath);
            }

            setBusy(false);

            if (!result.ok) {
              setActionError(result.error);
              return;
            }

            router.back();
          })();
        },
      },
    ]);
  }

  const vehicle = state.status === 'ready' ? state.vehicle : null;
  const photoUrl =
    vehicle && vehiclePhotoPath && photoPreview?.path === vehiclePhotoPath
      ? photoPreview.url
      : null;

  return (
    <Screen scroll testID="vehicle-screen">
      <ScreenHeader
        showBack
        overline="Kendaraan"
        subtitle="Data publik bisa diubah di sini; nomor polisi disimpan terpisah."
        title={vehicle ? `${vehicle.make} ${vehicle.model}` : 'Detail kendaraan'}
      />

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {notice ? (
        <Banner message={notice} testID="vehicle-notice" title="Tersimpan" tone="success" />
      ) : null}

      {actionError ? (
        <Banner message={actionError.message} title="Aksi tidak selesai" tone="danger" />
      ) : null}

      {state.status === 'loading' ? <LoadingState label="Memuat kendaraan…" /> : null}

      {state.status === 'error' ? (
        <ErrorState description={state.error.message} onRetry={reload} />
      ) : null}

      {state.status === 'missing' ? (
        <UnavailableState
          description="Kendaraan ini tidak ada di garasi akun Anda. Kendaraan milik pengguna lain tidak dapat dibuka dari layar ini."
          icon="lock-closed-outline"
          title="Kendaraan tidak ditemukan"
        />
      ) : null}

      {vehicle ? (
        <>
          <PhotoCard
            busy={photoBusy}
            emptyText="Belum ada foto. Pilih foto dari galeri untuk kendaraan ini."
            hasPhoto={Boolean(vehicle.photoPath)}
            hint="Foto disimpan di bucket privat. Hanya akun pemilik kendaraan yang dapat membuka atau menghapusnya; foto tidak pernah menjadi URL publik."
            onPick={() => {
              void handlePickPhoto();
            }}
            onRemove={confirmRemovePhoto}
            photoUrl={photoUrl}
            pickLabel={vehicle.photoPath ? 'Ganti foto' : 'Unggah foto'}
            subtitle={`JPG, PNG, atau WEBP; maksimal 5 MB. Foto diperkecil otomatis ke ${VEHICLE_PHOTO_MAX_DIMENSION} px sebelum diunggah.`}
            testID="vehicle-photo"
            title="Foto kendaraan"
          />

          <Card>
            <SectionHeader
              subtitle="Perubahan di sini hanya menyentuh data publik kendaraan Anda."
              title="Data kendaraan"
            />
            <Divider />
            <View style={styles.badges}>
              {vehicle.isPrimary ? <Badge label="Utama" tone="accent" /> : null}
              <Badge
                label={vehicle.isPublic ? 'Terlihat publik' : 'Disembunyikan'}
                tone={vehicle.isPublic ? 'neutral' : 'warning'}
              />
              <Badge icon="lock-closed-outline" label="Plat privat" tone="neutral" />
            </View>
            <TextField
              error={formErrors.make}
              label="Merek"
              onChangeText={(make) => setForm((previous) => ({ ...previous, make }))}
              value={form.make}
            />
            <TextField
              error={formErrors.model}
              label="Model"
              onChangeText={(model) => setForm((previous) => ({ ...previous, model }))}
              value={form.model}
            />
            <TextField
              error={formErrors.nickname}
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
              value={form.modelYear}
            />
            <Button
              accessibilityHint={
                makePrimary
                  ? 'Kendaraan ini sudah menjadi kendaraan utama.'
                  : 'Menjadikan kendaraan ini kendaraan utama saat menyimpan.'
              }
              icon={makePrimary ? 'star' : 'star-outline'}
              label={makePrimary ? 'Kendaraan utama saat ini' : 'Jadikan kendaraan utama'}
              onPress={() => setMakePrimary((value) => !value)}
              variant="secondary"
            />
            <Button
              disabled={busy}
              icon="save-outline"
              label={busy ? 'Menyimpan…' : 'Simpan perubahan'}
              onPress={() => {
                void handleSaveVehicle();
              }}
              testID="vehicle-save"
            />
          </Card>

          <Card variant="accent">
            <SectionHeader
              subtitle="Hanya akun ini yang dapat membaca baris ini (RLS owner-only)."
              title="Detail privat"
            />
            <Divider />
            <TextField
              autoCapitalize="characters"
              error={plateErrorText}
              helper="Mis. B 1234 XYZ. Tidak pernah tampil di profil publik."
              label="Nomor polisi"
              maxLength={16}
              onChangeText={setPlate}
              testID="vehicle-plate"
              value={plate}
            />
            <TextField
              label="Catatan privat"
              multiline
              onChangeText={setNotes}
              placeholder="Mis. servis rutin, kunci cadangan"
              value={notes}
            />
            <Button
              disabled={busy}
              icon="save-outline"
              label={busy ? 'Menyimpan…' : 'Simpan detail privat'}
              onPress={() => {
                void handleSavePrivate();
              }}
              testID="vehicle-save-private"
            />
            <Button
              disabled={busy}
              icon="trash-outline"
              label="Hapus detail privat"
              onPress={() => {
                void handleDeletePrivate();
              }}
              variant="ghost"
            />
          </Card>

          <Card>
            <SectionHeader subtitle="Tindakan ini tidak bisa dibatalkan." title="Hapus kendaraan" />
            <Button
              accessibilityHint="Menghapus kendaraan ini dari garasi Anda beserta detail privatnya."
              disabled={busy || photoBusy}
              icon="trash-outline"
              label="Hapus kendaraan"
              onPress={confirmDeleteVehicle}
              variant="ghost"
            />
            <AppText tone="muted" variant="caption">
              Objek foto di Storage tidak otomatis terhapus saat kendaraan dihapus. Hapus foto lebih
              dulu dari kartu foto di atas bila ingin membersihkannya.
            </AppText>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
