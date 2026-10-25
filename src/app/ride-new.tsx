import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { LoadingState, UnavailableState } from '@/components/ui/StateView';
import { TextField } from '@/components/ui/TextField';
import { colors, radii, spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import {
  createRide,
  getRideDetails,
  listMyActiveClubs,
  updateRide,
  type RideClubSummary,
} from '@/features/rides/api';
import {
  RIDE_DESCRIPTION_MAX_LENGTH,
  RIDE_TITLE_MAX_LENGTH,
  parseStartsAt,
  rideDescriptionError,
  rideLabelError,
  rideTitleError,
} from '@/features/rides/validation';
import { screenPrecondition } from '@/features/state-helper';
import type { RideVisibility } from '@/lib/supabase/database.types';

type FormState = {
  clubId: string;
  title: string;
  description: string;
  startsAt: string;
  meetingLabel: string;
  destinationLabel: string;
  visibility: RideVisibility;
};

const EMPTY_FORM: FormState = {
  clubId: '',
  title: '',
  description: '',
  startsAt: '',
  meetingLabel: '',
  destinationLabel: '',
  visibility: 'club',
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const VISIBILITY_OPTIONS: { value: RideVisibility; label: string; detail: string }[] = [
  {
    value: 'club',
    label: 'Anggota klub',
    detail: 'Semua anggota klub dapat melihat dan bergabung.',
  },
  { value: 'invite_only', label: 'Hanya undangan', detail: 'Hanya peserta yang diundang host.' },
  { value: 'public', label: 'Publik', detail: 'Pengguna terautentikasi dapat melihat perjalanan.' },
];

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default function RideNewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const rideId = typeof params.id === 'string' ? params.id : null;
  const editing = rideId !== null;
  const { backend, userId } = useAuthSession();
  const precondition = screenPrecondition(
    backend,
    userId,
    'Sesi tidak ditemukan di perangkat ini. Masuk kembali untuk membuat perjalanan.',
  );

  const [clubs, setClubs] = useState<RideClubSummary[] | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!backend.available || !userId) return;

    const client = backend.client;
    let active = true;

    void (async () => {
      const clubResult = await listMyActiveClubs(client, userId);
      if (!active) return;

      if (!clubResult.ok) {
        setLoadProblem(clubResult.error.message);
        return;
      }

      setClubs(clubResult.data);

      if (!editing) {
        setForm((previous) =>
          previous.clubId.length > 0 || clubResult.data.length === 0
            ? previous
            : { ...previous, clubId: clubResult.data[0]!.id },
        );
        return;
      }

      const detail = await getRideDetails(client, rideId, userId);
      if (!active) return;

      if (!detail.ok) {
        setLoadProblem(detail.error.message);
        return;
      }

      if (detail.data.myMembership?.role !== 'host') {
        setLoadProblem('Hanya host yang dapat mengubah perjalanan ini.');
        return;
      }

      if (detail.data.ride.status !== 'planned') {
        setLoadProblem('Perjalanan sudah dimulai atau selesai, jadi detailnya tidak dapat diubah.');
        return;
      }

      const ride = detail.data.ride;
      setForm({
        clubId: ride.club_id ?? '',
        title: ride.title,
        description: ride.description ?? '',
        startsAt: toLocalInput(ride.starts_at),
        meetingLabel: ride.meeting_label ?? '',
        destinationLabel: ride.destination_label ?? '',
        visibility: ride.visibility,
      });
    })();

    return () => {
      active = false;
    };
  }, [backend, editing, rideId, userId]);

  const update = useCallback((key: keyof FormState, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }, []);

  function validate(): boolean {
    const next: FormErrors = {};
    const title = rideTitleError(form.title);
    if (title) next.title = title;

    if (!editing && form.clubId.length === 0) next.clubId = 'Pilih klub untuk perjalanan ini.';

    const description = rideDescriptionError(form.description);
    if (description) next.description = description;

    const meeting = rideLabelError(form.meetingLabel, 'Titik kumpul');
    if (meeting) next.meetingLabel = meeting;

    const destination = rideLabelError(form.destinationLabel, 'Tujuan');
    if (destination) next.destinationLabel = destination;

    const startsAt = parseStartsAt(form.startsAt);
    if (startsAt.error) next.startsAt = startsAt.error;

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!backend.available || !userId || busy || !validate()) return;

    setBusy(true);
    setActionError(null);

    const startsAt = parseStartsAt(form.startsAt);
    const payload = {
      title: form.title,
      description: form.description.trim() || null,
      startsAt: startsAt.value,
      meetingLabel: form.meetingLabel.trim() || null,
      destinationLabel: form.destinationLabel.trim() || null,
    };

    const result = editing
      ? await updateRide(backend.client, rideId, payload)
      : await createRide(backend.client, {
          ...payload,
          clubId: form.clubId,
          visibility: form.visibility,
        });

    setBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    router.replace({ pathname: '/ride', params: { id: result.data.id } });
  }

  return (
    <Screen scroll testID="ride-new-screen">
      <ScreenHeader
        showBack
        overline="Perjalanan"
        subtitle={
          editing ? 'Ubah detail sebelum perjalanan dimulai.' : 'Perjalanan selalu milik satu klub.'
        }
        title={editing ? 'Ubah perjalanan' : 'Buat perjalanan'}
      />

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {actionError ? (
        <Banner message={actionError.message} title="Perjalanan belum tersimpan" tone="danger" />
      ) : null}

      {precondition ? (
        <UnavailableState
          description={precondition.message}
          icon="lock-closed-outline"
          title="Perjalanan belum bisa dibuat"
        />
      ) : null}

      {loadProblem ? (
        <UnavailableState
          action={{ label: 'Kembali', onPress: () => router.back(), icon: 'arrow-back-outline' }}
          description={loadProblem}
          icon="alert-circle-outline"
          title="Perjalanan tidak bisa diubah"
        />
      ) : null}

      {!precondition && clubs === null && !loadProblem ? (
        <LoadingState label="Memuat klub Anda…" />
      ) : null}

      {clubs !== null && clubs.length === 0 && !editing ? (
        <UnavailableState
          action={{
            label: 'Cari klub',
            onPress: () => router.push('/community'),
            icon: 'people-outline',
          }}
          description="Perjalanan harus dibuat dari klub tempat Anda menjadi anggota aktif. Bergabung ke klub dulu, lalu kembali ke layar ini."
          icon="people-outline"
          title="Belum ada klub aktif"
        />
      ) : null}

      {clubs !== null && (clubs.length > 0 || editing) && !loadProblem ? (
        <>
          <Card>
            <AppText variant="bodyStrong">Klub penyelenggara</AppText>
            {editing ? (
              <AppText tone="secondary" variant="callout">
                {clubs.find((club) => club.id === form.clubId)?.name ??
                  'Klub perjalanan ini tidak lagi Anda ikuti.'}
              </AppText>
            ) : (
              <View style={styles.chips}>
                {clubs.map((club) => {
                  const selected = form.clubId === club.id;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      key={club.id}
                      onPress={() => update('clubId', club.id)}
                      style={[styles.chip, selected ? styles.chipSelected : null]}
                    >
                      <AppText tone={selected ? 'accent' : 'secondary'} variant="label">
                        {club.name}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {errors.clubId ? (
              <AppText tone="danger" variant="caption">
                {errors.clubId}
              </AppText>
            ) : null}
          </Card>

          <Card>
            <TextField
              autoCapitalize="sentences"
              error={errors.title}
              label="Judul perjalanan"
              maxLength={RIDE_TITLE_MAX_LENGTH}
              onChangeText={(value) => update('title', value)}
              placeholder="Contoh: Kopdar Sabtu pagi"
              testID="ride-title"
              value={form.title}
            />
            <TextField
              autoCapitalize="none"
              error={errors.startsAt}
              helper="Format 2026-10-20 19:30 (waktu perangkat). Kosongkan bila belum dijadwalkan."
              keyboardType="numbers-and-punctuation"
              label="Jadwal"
              onChangeText={(value) => update('startsAt', value)}
              placeholder="2026-10-20 19:30"
              value={form.startsAt}
            />
            <TextField
              autoCapitalize="sentences"
              error={errors.meetingLabel}
              label="Titik kumpul"
              onChangeText={(value) => update('meetingLabel', value)}
              placeholder="Contoh: Alun-alun kota"
              value={form.meetingLabel}
            />
            <TextField
              autoCapitalize="sentences"
              error={errors.destinationLabel}
              label="Tujuan"
              onChangeText={(value) => update('destinationLabel', value)}
              placeholder="Contoh: Puncak"
              value={form.destinationLabel}
            />
            <TextField
              autoCapitalize="sentences"
              error={errors.description}
              label="Deskripsi"
              maxLength={RIDE_DESCRIPTION_MAX_LENGTH}
              multiline
              onChangeText={(value) => update('description', value)}
              placeholder="Aturan bergabung, kecepatan, atau catatan lain."
              value={form.description}
            />
          </Card>

          {editing ? null : (
            <Card>
              <AppText variant="bodyStrong">Siapa yang dapat melihat?</AppText>
              <View style={styles.options}>
                {VISIBILITY_OPTIONS.map((option) => {
                  const selected = form.visibility === option.value;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      key={option.value}
                      onPress={() => update('visibility', option.value)}
                      style={[styles.option, selected ? styles.optionSelected : null]}
                    >
                      <AppText tone={selected ? 'accent' : 'primary'} variant="label">
                        {option.label}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {option.detail}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          )}

          <Button
            disabled={busy}
            icon="checkmark-circle-outline"
            label={busy ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Buat perjalanan'}
            onPress={handleSubmit}
            variant="primary"
          />

          <AppText variant="caption" tone="muted">
            Membuat perjalanan tidak menyalakan lokasi. Berbagi posisi baru aktif bila Anda menekan
            tombol berbagi di detail perjalanan dan menyetujui consent perjalanan itu.
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderColor: colors.border.subtle,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipSelected: {
    backgroundColor: colors.accent.soft,
    borderColor: colors.border.accent,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    borderColor: colors.border.subtle,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing.xs / 2,
    padding: spacing.md,
  },
  optionSelected: {
    backgroundColor: colors.accent.soft,
    borderColor: colors.border.accent,
  },
});
