import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { InfoRow } from '@/components/ui/InfoRow';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ErrorState, LoadingState } from '@/components/ui/StateView';
import { TextField } from '@/components/ui/TextField';
import { colors, spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import { MapCanvas } from '@/features/map/MapCanvas';
import { buildRideMarkers, resolveMapRenderState } from '@/features/map/provider';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import {
  acceptRideInvite,
  findRideInvitee,
  getRideDetails,
  inviteRideMember,
  joinRide,
  leaveRide,
  removeRideMember,
  setRideLocationSharing,
  subscribeRideLocations,
  transitionRide,
  type RideDetails,
  type RideMemberWithProfile,
} from '@/features/rides/api';
import { rideStatusCopy } from '@/features/rides/components/RideCard';
import {
  locationAgeLabel,
  locationFreshness,
  type LocationFreshness,
} from '@/features/rides/location';
import {
  getBackgroundPermissionState,
  getForegroundPermissionState,
  isRideLocationTrackingActive,
  readTrackedRideId,
  requestBackgroundPermission,
  requestForegroundPermission,
  requestTrackingNotificationPermission,
  startRideLocationTracking,
  stopRideLocationTracking,
} from '@/features/rides/tracking';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { formatRideSchedule } from '@/features/rides/validation';
import { readPublicEnv } from '@/lib/env';
import type {
  RideLocationRow,
  RideMemberRole,
  RideMemberStatus,
} from '@/lib/supabase/database.types';

type RideState =
  | { status: 'loading' }
  | { status: 'ready'; details: RideDetails }
  | { status: 'error'; error: AppError };

const roleCopy: Record<RideMemberRole, string> = {
  host: 'Host',
  sweeper: 'Sweeper',
  rider: 'Peserta',
};

const memberStatusCopy: Record<RideMemberStatus, { label: string; tone: BadgeTone }> = {
  invited: { label: 'Diundang', tone: 'warning' },
  joined: { label: 'Bergabung', tone: 'success' },
  left: { label: 'Keluar', tone: 'neutral' },
  removed: { label: 'Dikeluarkan', tone: 'danger' },
};

const freshnessCopy: Record<LocationFreshness, { label: string; tone: BadgeTone }> = {
  live: { label: 'Live', tone: 'success' },
  stale: { label: 'Basi', tone: 'warning' },
  offline: { label: 'Belum ada', tone: 'neutral' },
};

function memberName(member: RideMemberWithProfile): string {
  return member.profiles?.display_name ?? member.profiles?.username ?? 'Peserta';
}

export default function RideScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const rideId = typeof params.id === 'string' ? params.id : '';
  const { backend, userId } = useAuthSession();

  const [state, setState] = useState<RideState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [inviteUsername, setInviteUsername] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [trackingActive, setTrackingActive] = useState(false);
  const [foregroundPermission, setForegroundPermission] = useState<string>('undetermined');
  const [backgroundPermission, setBackgroundPermission] = useState<string>('undetermined');

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!backend.available || !userId || rideId.length === 0) return;

    const client = backend.client;
    let active = true;

    void (async () => {
      const result = await getRideDetails(client, rideId, userId);
      if (!active) return;

      if (!result.ok) {
        setState({ status: 'error', error: result.error });
        return;
      }

      setState({ status: 'ready', details: result.data });
    })();

    return () => {
      active = false;
    };
  }, [backend, reloadToken, rideId, userId]);

  const details = state.status === 'ready' ? state.details : null;
  const ride = details?.ride ?? null;
  const membership = details?.myMembership ?? null;
  const isHost = membership?.role === 'host' && membership.status === 'joined';
  const isMember = membership?.status === 'joined';
  const isActive = ride?.status === 'active';

  // Nama pengirim untuk chat diambil dari daftar peserta yang sudah dimuat,
  // supaya panel chat tidak melakukan query profil tambahan.
  const senderNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const member of details?.members ?? []) names[member.user_id] = memberName(member);
    return names;
  }, [details?.members]);

  // Jam untuk label kesegaran; tidak memanggil jaringan.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  // Izin OS diperiksa saat layar dibuka, bukan diminta.
  useEffect(() => {
    if (!ride?.id) return;

    void getForegroundPermissionState().then(setForegroundPermission);
    void getBackgroundPermissionState().then(setBackgroundPermission);
    void isRideLocationTrackingActive().then(setTrackingActive);
  }, [ride?.id]);

  // Realtime hanya berlangganan saat peserta aktif; RLS tetap gerbang utamanya.
  useEffect(() => {
    if (!backend.available || !rideId || !isActive || !isMember) return;

    const subscription = subscribeRideLocations(backend.client, rideId, (location) => {
      setState((previous) => {
        if (previous.status !== 'ready') return previous;
        const others = previous.details.locations.filter(
          (item) => item.user_id !== location.user_id,
        );
        return {
          ...previous,
          details: { ...previous.details, locations: [...others, location] },
        };
      });
      setNow(Date.now());
    });

    return () => subscription.unsubscribe();
  }, [backend, isActive, isMember, rideId]);

  // Hanya hentikan task milik perjalanan ini. Membuka detail perjalanan lain
  // tidak boleh mematikan berbagi yang sedang berjalan di perjalanan sendiri.
  const trackingEligible =
    ride?.status === 'active' &&
    membership?.status === 'joined' &&
    membership?.sharing_location === true;

  useEffect(() => {
    if (state.status !== 'ready' || trackingEligible) return;
    if (readTrackedRideId() !== rideId) return;

    let active = true;

    void (async () => {
      await stopRideLocationTracking();
      if (active) setTrackingActive(false);
    })();

    return () => {
      active = false;
    };
  }, [rideId, state.status, trackingEligible]);

  async function run(action: () => Promise<{ ok: boolean; error?: AppError }>, success: string) {
    setBusy(true);
    setNotice(null);
    setActionError(null);

    const result = await action();
    setBusy(false);

    if (!result.ok) {
      if (result.error) setActionError(result.error);
      return false;
    }

    setNotice(success);
    reload();
    return true;
  }

  async function handleJoin() {
    if (!backend.available) return;
    await run(() => joinRide(backend.client, rideId), 'Anda bergabung ke perjalanan ini.');
  }

  async function handleAcceptInvite() {
    if (!backend.available) return;
    await run(
      () => acceptRideInvite(backend.client, rideId),
      'Undangan diterima. Berbagi lokasi tetap nonaktif sampai Anda menyalakannya.',
    );
  }

  async function handleLeave() {
    if (!backend.available) return;

    setBusy(true);
    setNotice(null);
    setActionError(null);

    // Hentikan task hanya bila task itu memang milik perjalanan ini. Pengguna
    // dapat menjadi peserta beberapa perjalanan, dan meninggalkan perjalanan B
    // tidak boleh mematikan berbagi di perjalanan A.
    if (readTrackedRideId() === rideId) {
      await stopRideLocationTracking();
      setTrackingActive(false);
    }

    if (membership?.sharing_location) {
      const revoked = await setRideLocationSharing(backend.client, rideId, false);
      if (!revoked.ok) {
        setBusy(false);
        setActionError({
          ...revoked.error,
          message: `${revoked.error.message} Pelacakan di perangkat sudah dihentikan, tetapi server belum mengonfirmasi pencabutan berbagi.`,
        });
        return;
      }
    }

    const result = await leaveRide(backend.client, rideId);
    setBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setNotice('Anda keluar dari perjalanan. Lokasi terakhir Anda sudah dihapus.');
    reload();
  }

  function handleTransition(next: 'active' | 'completed' | 'cancelled') {
    if (!backend.available || busy) return;

    const copy =
      next === 'active'
        ? {
            title: 'Mulai perjalanan?',
            message: 'Peserta dapat menyalakan berbagi lokasi setelah perjalanan aktif.',
          }
        : next === 'completed'
          ? {
              title: 'Selesaikan perjalanan?',
              message: 'Semua lokasi peserta akan dihapus dan tidak dapat dibuka kembali.',
            }
          : {
              title: 'Batalkan perjalanan?',
              message: 'Perjalanan yang dibatalkan bersifat final dan lokasi peserta dihapus.',
            };

    Alert.alert(copy.title, copy.message, [
      { text: 'Batal', style: 'cancel' },
      {
        text: next === 'cancelled' ? 'Batalkan perjalanan' : 'Lanjutkan',
        style: next === 'cancelled' ? 'destructive' : 'default',
        onPress: () => {
          void run(
            () => transitionRide(backend.client, rideId, next),
            next === 'active'
              ? 'Perjalanan dimulai.'
              : next === 'completed'
                ? 'Perjalanan selesai. Lokasi peserta sudah dihapus.'
                : 'Perjalanan dibatalkan. Lokasi peserta sudah dihapus.',
          );
        },
      },
    ]);
  }

  async function handleInvite() {
    if (!backend.available || inviteUsername.trim().length === 0) return;

    setBusy(true);
    setNotice(null);
    setActionError(null);

    const found = await findRideInvitee(backend.client, inviteUsername);

    if (!found.ok) {
      setBusy(false);
      setActionError(found.error);
      return;
    }

    if (!found.data) {
      setBusy(false);
      setActionError({
        code: 'not_found',
        message:
          'Username tidak ditemukan, atau profilnya privat sehingga tidak dapat diundang dengan cara ini.',
        retryable: false,
      });
      return;
    }

    const result = await inviteRideMember(backend.client, rideId, found.data.id);
    setBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setInviteUsername('');
    setNotice(`${found.data.display_name} diundang. Ia harus menerima undangan sebelum bergabung.`);
    reload();
  }

  function handleRemove(member: RideMemberWithProfile) {
    if (!backend.available || busy) return;

    Alert.alert(
      `Keluarkan ${memberName(member)}?`,
      'Lokasi terakhir peserta ini akan dihapus dan ia tidak lagi dapat mengirim posisi.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Keluarkan',
          style: 'destructive',
          onPress: () => {
            void run(
              () => removeRideMember(backend.client, rideId, member.user_id),
              `${memberName(member)} dikeluarkan dari perjalanan.`,
            );
          },
        },
      ],
    );
  }

  async function handleSharingOn() {
    if (!backend.available || busy) return;

    setBusy(true);
    setActionError(null);
    setNotice(null);

    const permission = await requestForegroundPermission();
    setForegroundPermission(permission);

    if (permission !== 'granted') {
      setBusy(false);
      setActionError({
        code: 'not_authorized',
        message:
          'Izin lokasi belum diberikan. Anda tetap bisa ikut perjalanan tanpa berbagi posisi. Aktifkan izin dari pengaturan perangkat bila ingin berbagi.',
        retryable: false,
      });
      return;
    }

    const consent = await setRideLocationSharing(backend.client, rideId, true);
    if (!consent.ok) {
      setBusy(false);
      setActionError(consent.error);
      return;
    }

    const started = await startRideLocationTracking(rideId);
    if (!started.ok) {
      await setRideLocationSharing(backend.client, rideId, false);
      setBusy(false);
      setActionError({ code: 'unknown', message: started.message, retryable: true });
      return;
    }

    setTrackingActive(true);
    setBusy(false);
    setNotice('Berbagi lokasi aktif. Posisi hanya terlihat oleh peserta aktif perjalanan ini.');
    reload();
  }

  async function handleSharingOff() {
    if (!backend.available || busy) return;

    setBusy(true);
    setActionError(null);
    setNotice(null);

    await stopRideLocationTracking();
    setTrackingActive(false);

    const result = await setRideLocationSharing(backend.client, rideId, false);
    setBusy(false);

    if (!result.ok) {
      setActionError({
        ...result.error,
        message: `${result.error.message} Pelacakan perangkat sudah berhenti, tetapi server belum mengonfirmasi. Coba lagi sebelum menutup aplikasi.`,
      });
      return;
    }

    setNotice('Berbagi lokasi dihentikan dan lokasi terakhir Anda sudah dihapus.');
    reload();
  }

  async function handleResumeTracking() {
    if (!backend.available || busy) return;

    setBusy(true);
    setActionError(null);

    const started = await startRideLocationTracking(rideId);
    setBusy(false);

    if (!started.ok) {
      setActionError({ code: 'unknown', message: started.message, retryable: true });
      return;
    }

    setTrackingActive(true);
    setNotice('Pelacakan perangkat dilanjutkan.');
  }

  async function handleEnableBackground() {
    if (!backend.available || busy) return;

    setBusy(true);
    setActionError(null);

    // Notifikasi foreground service adalah tanda bahwa lokasi masih dibagikan.
    // Tanpa izinnya, jangan minta izin latar belakang yang tidak bisa ditampilkan.
    const notifications = await requestTrackingNotificationPermission();
    if (notifications !== 'granted') {
      setBusy(false);
      setNotice(
        'Izin notifikasi tidak diberikan. Berbagi tetap berjalan selama aplikasi terbuka; notifikasi status wajib terlihat sebelum berbagi di latar belakang dapat dinyalakan.',
      );
      return;
    }

    const permission = await requestBackgroundPermission();
    setBackgroundPermission(permission);
    setBusy(false);

    if (permission !== 'granted') {
      setNotice(
        'Izin latar belakang tidak diberikan. Berbagi tetap berjalan selama aplikasi terbuka; posisi berhenti diperbarui saat aplikasi ditutup.',
      );
      return;
    }

    if (trackingActive) {
      await stopRideLocationTracking();
      const started = await startRideLocationTracking(rideId);
      if (!started.ok) {
        setTrackingActive(false);
        setActionError({ code: 'unknown', message: started.message, retryable: true });
        return;
      }
      setTrackingActive(true);
    }

    setNotice('Izin latar belakang aktif. Notifikasi tetap terlihat selama pelacakan berjalan.');
  }

  const locationsByUser = useMemo(() => {
    const map = new Map<string, RideLocationRow>();
    for (const location of details?.locations ?? []) map.set(location.user_id, location);
    return map;
  }, [details?.locations]);

  const joinedMembers = details?.members.filter((member) => member.status === 'joined') ?? [];
  const invitedMembers = details?.members.filter((member) => member.status === 'invited') ?? [];

  // Selama ADR-064 belum disetujui, `renderer` tidak pernah didaftarkan sehingga
  // keadaan tertinggi yang bisa dicapai adalah `renderer_missing`.
  const mapState = useMemo(
    () => resolveMapRenderState({ styleUrl: readPublicEnv().EXPO_PUBLIC_MAP_STYLE_URL }),
    [],
  );
  const mapMarkers = useMemo(
    () => buildRideMarkers(details?.members ?? [], details?.locations ?? [], now),
    [details?.members, details?.locations, now],
  );

  {showError ? (
    return (
      <Screen testID="ride-screen">
        <ScreenHeader showBack overline="Perjalanan" title="Detail perjalanan" />
        <ErrorState description={errorMessage} onRetry={reload} />
      </Screen>
    );
  ) : null}

  {showEmpty && !details ? (
    return (
      <Screen testID="ride-screen">
        <ScreenHeader showBack overline="Perjalanan" title="Detail perjalanan" />
        <AppText tone="muted" variant="caption">
          Perjalanan belum terisi. Cek tautannya atau cari perjalanan lain.
        </AppText>
      </Screen>
    );
  ) : null}

  if (!ride) return null;

  return (
    <Screen scroll testID="ride-screen">
      <ScreenHeader
        showBack
        overline={ride.clubs?.name ?? 'Perjalanan'}
        subtitle={formatRideSchedule(ride.starts_at)}
        title={ride.title}
      />

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {notice ? (
        <Banner message={notice} testID="ride-notice" title="Berhasil" tone="success" />
      ) : null}

      {actionError ? (
        <Banner message={actionError.message} title="Aksi tidak selesai" tone="danger" />
      ) : null}

      <Card>
        <View style={styles.badgeRow}>
          <Badge
            label={rideStatusCopy[ride.status].label}
            tone={rideStatusCopy[ride.status].tone}
          />
          <Badge
            label={
              ride.visibility === 'public'
                ? 'Publik'
                : ride.visibility === 'club'
                  ? 'Anggota klub'
                  : 'Hanya undangan'
            }
            tone="neutral"
          />
          {membership ? (
            <Badge
              label={memberStatusCopy[membership.status].label}
              tone={memberStatusCopy[membership.status].tone}
            />
          ) : null}
          {isHost ? <Badge icon="shield-checkmark-outline" label="Host" tone="info" /> : null}
        </View>

        <InfoRow label="Jadwal" value={formatRideSchedule(ride.starts_at)} />
        <InfoRow label="Titik kumpul" value={ride.meeting_label ?? 'Belum diisi'} />
        <InfoRow label="Tujuan" value={ride.destination_label ?? 'Belum diisi'} />
        <InfoRow
          label="Peserta bergabung"
          value={`${joinedMembers.length} orang${invitedMembers.length > 0 ? ` · ${invitedMembers.length} diundang` : ''}`}
        />

        {ride.description ? (
          <>
            <Divider />
            <AppText tone="secondary" variant="callout">
              {ride.description}
            </AppText>
          </>
        ) : null}
      </Card>

      <Card>
        <SectionHeader
          subtitle="Hanya host yang dapat memulai, menyelesaikan, atau membatalkan."
          title="Tindakan"
        />
        <View style={styles.actions}>
          {isHost && ride.status === 'planned' ? (
            <Button
              disabled={busy}
              icon="play-outline"
              label="Mulai perjalanan"
              onPress={() => handleTransition('active')}
              variant="primary"
            />
          ) : null}

          {isHost && ride.status === 'active' ? (
            <Button
              disabled={busy}
              icon="checkmark-done-outline"
              label="Selesaikan perjalanan"
              onPress={() => handleTransition('completed')}
              variant="primary"
            />
          ) : null}

          {isHost && (ride.status === 'planned' || ride.status === 'active') ? (
            <Button
              disabled={busy}
              icon="close-circle-outline"
              label="Batalkan perjalanan"
              onPress={() => handleTransition('cancelled')}
              variant="secondary"
            />
          ) : null}

          {isHost && ride.status === 'planned' ? (
            <Button
              disabled={busy}
              icon="create-outline"
              label="Ubah detail"
              onPress={() => router.push({ pathname: '/ride-new', params: { id: ride.id } })}
              variant="secondary"
            />
          ) : null}

          {!isMember && membership?.status === 'invited' ? (
            <Button
              disabled={busy}
              icon="mail-open-outline"
              label="Terima undangan"
              onPress={handleAcceptInvite}
              variant="primary"
            />
          ) : null}

          {!isMember &&
          membership?.status !== 'invited' &&
          (ride.status === 'planned' || ride.status === 'active') &&
          ride.visibility !== 'invite_only' ? (
            <Button
              disabled={busy}
              icon="enter-outline"
              label="Gabung perjalanan"
              onPress={handleJoin}
              variant="primary"
            />
          ) : null}

          {!isMember && ride.visibility === 'invite_only' && membership?.status !== 'invited' ? (
            <AppText tone="muted" variant="caption">
              Perjalanan ini hanya dapat diikuti lewat undangan host.
            </AppText>
          ) : null}

          {isMember && !isHost ? (
            <Button
              disabled={busy}
              icon="exit-outline"
              label="Keluar dari perjalanan"
              onPress={handleLeave}
              variant="secondary"
            />
          ) : null}

          {isMember && isHost && (ride.status === 'completed' || ride.status === 'cancelled') ? (
            <AppText tone="muted" variant="caption">
              Perjalanan sudah final. Lokasi peserta telah dihapus.
            </AppText>
          ) : null}
        </View>
      </Card>

      {isMember && isActive ? (
        <Card variant="accent">
          <SectionHeader
            subtitle="Consent ini terpisah dari izin lokasi Android. Berbagi tidak pernah menyala sendiri."
            title="Berbagi lokasi"
          />
          <View style={styles.badgeRow}>
            <Badge
              label={membership.sharing_location ? 'Berbagi aktif' : 'Berbagi nonaktif'}
              tone={membership.sharing_location ? 'success' : 'neutral'}
            />
            <Badge
              label={
                foregroundPermission === 'granted'
                  ? 'Izin lokasi diberikan'
                  : foregroundPermission === 'denied'
                    ? 'Izin lokasi ditolak'
                    : 'Izin lokasi belum diminta'
              }
              tone={foregroundPermission === 'granted' ? 'success' : 'warning'}
            />
            <Badge
              label={
                trackingActive ? 'Pelacakan perangkat berjalan' : 'Pelacakan perangkat berhenti'
              }
              tone={trackingActive ? 'success' : 'neutral'}
            />
          </View>

          <AppText tone="secondary" variant="callout">
            Saat aktif, peserta aktif perjalanan ini dapat melihat posisi terakhir Anda. Marker
            berubah menjadi “basi” setelah 60 detik tanpa pembaruan. Lokasi terakhir dihapus saat
            Anda berhenti berbagi, keluar, atau perjalanan selesai/dibatalkan.
          </AppText>

          <View style={styles.actions}>
            {membership.sharing_location ? (
              <Button
                disabled={busy}
                icon="stop-circle-outline"
                label="Hentikan berbagi lokasi"
                onPress={handleSharingOff}
                variant="secondary"
              />
            ) : (
              <Button
                disabled={busy}
                icon="location-outline"
                label="Nyalakan berbagi lokasi"
                onPress={handleSharingOn}
                variant="primary"
              />
            )}

            {membership.sharing_location && !trackingActive ? (
              <Button
                disabled={busy}
                icon="refresh-outline"
                label="Lanjutkan pelacakan perangkat"
                onPress={handleResumeTracking}
                variant="secondary"
              />
            ) : null}

            {membership.sharing_location && backgroundPermission !== 'granted' ? (
              <Button
                disabled={busy}
                icon="phone-portrait-outline"
                label="Izinkan berbagi saat aplikasi di latar belakang"
                onPress={handleEnableBackground}
                variant="secondary"
              />
            ) : null}
          </View>

          <AppText tone="muted" variant="caption">
            Android dapat menghentikan pelacakan setelah force-stop atau pembatasan baterai ekstrem;
            aplikasi tidak menjanjikan pelacakan tanpa jeda dan akan menampilkan status “pelacakan
            berhenti” bila task tidak berjalan.
          </AppText>
        </Card>
      ) : null}

      {backend.available ? (
        <ChatPanel
          client={backend.client}
          isActiveMember={Boolean(isMember)}
          rideId={ride.id}
          rideStatus={ride.status}
          senderNames={senderNames}
          userId={userId ?? ''}
        />
      ) : null}

      <Card>
        <SectionHeader
          subtitle={
            mapState.kind === 'ready'
              ? 'Posisi terakhir peserta; daftar di bawah tetap menunjukkan kesegaran posisi.'
              : 'Peta belum digambar di build ini; daftar di bawah tetap menunjukkan kesegaran posisi.'
          }
          title="Posisi peserta"
        />
        {!isActive ? (
          <AppText tone="muted" variant="callout">
            Posisi peserta hanya dapat dibaca saat perjalanan aktif. Sebelum dan sesudah itu,
            database tidak menyimpan lokasi yang dapat ditampilkan.
          </AppText>
        ) : !isMember ? (
          <AppText tone="muted" variant="callout">
            Bergabunglah ke perjalanan untuk melihat peserta. Non-anggota tidak dapat membaca
            lokasi.
          </AppText>
        ) : (
          <View style={styles.list}>
            {joinedMembers.map((member) => {
              const location = locationsByUser.get(member.user_id) ?? null;
              const freshness = locationFreshness(location?.recorded_at ?? null, now);
              const copy = freshnessCopy[freshness];

              return (
                <View key={member.user_id} style={styles.locationRow}>
                  <View style={styles.locationText}>
                    <AppText variant="label">
                      {memberName(member)}
                      {member.user_id === userId ? ' (Anda)' : ''}
                    </AppText>
                    <AppText tone="muted" variant="caption">
                      {roleCopy[member.role]} ·{' '}
                      {member.sharing_location ? 'berbagi aktif' : 'tidak berbagi'}
                    </AppText>
                    <AppText tone="secondary" variant="caption">
                      {location
                        ? `${locationAgeLabel(location.recorded_at, now)}${
                            location.accuracy_m !== null
                              ? ` · akurasi ±${Math.round(location.accuracy_m)} m`
                              : ''
                          }`
                        : member.sharing_location
                          ? 'Menunggu lokasi pertama…'
                          : 'Tidak ada lokasi yang dibagikan'}
                    </AppText>
                  </View>
                  <Badge label={copy.label} tone={copy.tone} />
                </View>
              );
            })}
          </View>
        )}

        <MapCanvas markers={mapMarkers} state={mapState} />
      </Card>

      <Card>
        <SectionHeader
          subtitle="Hanya peserta aktif yang dapat melihat daftar ini."
          title={`Peserta (${joinedMembers.length})`}
        />
        <View style={styles.list}>
          {details?.members.length === 0 ? (
            <AppText tone="muted" variant="callout">
              Belum ada peserta yang dapat ditampilkan.
            </AppText>
          ) : null}
          {details?.members.map((member) => {
            const status = memberStatusCopy[member.status];
            return (
              <View key={member.user_id} style={styles.memberRow}>
                <View style={styles.locationText}>
                  <AppText variant="label">
                    {memberName(member)}
                    {member.user_id === userId ? ' (Anda)' : ''}
                  </AppText>
                  <AppText tone="muted" variant="caption">
                    {roleCopy[member.role]} · @{member.profiles?.username ?? 'tanpa-username'}
                  </AppText>
                </View>
                <View style={styles.memberActions}>
                  <Badge label={status.label} tone={status.tone} />
                  {isHost && member.role !== 'host' && member.status !== 'removed' ? (
                    <Button
                      disabled={busy}
                      label="Keluarkan"
                      onPress={() => handleRemove(member)}
                      variant="ghost"
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        {isHost && (ride.status === 'planned' || ride.status === 'active') ? (
          <>
            <Divider />
            <AppText variant="bodyStrong">Undang anggota klub</AppText>
            <TextField
              autoCapitalize="none"
              helper="Masukkan username. Undangan harus diterima target sebelum ia bergabung."
              label="Username"
              onChangeText={setInviteUsername}
              placeholder="contoh: budi_solo"
              value={inviteUsername}
            />
            <Button
              disabled={busy || inviteUsername.trim().length === 0}
              icon="person-add-outline"
              label="Kirim undangan"
              onPress={handleInvite}
              variant="secondary"
            />
          </>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
  },
  list: {
    gap: spacing.md,
  },
  locationRow: {
    alignItems: 'center',
    borderBottomColor: colors.border.subtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
  },
  locationText: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  memberRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  memberActions: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
});
