import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';

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
import { ErrorState, LoadingState, UnavailableState } from '@/components/ui/StateView';
import { spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import {
  getClubDetails,
  leaveClub,
  listClubMembers,
  requestClubMembership,
  type ApiResult,
  type ClubDetail,
} from '@/features/clubs/api';
import { CLUB_LOGO_BUCKET, getPhotoSignedUrl } from '@/features/media/photos';
import type { ClubMemberRow, ClubMemberStatus } from '@/lib/supabase/database.types';

type ClubState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; detail: ClubDetail; members: ClubMemberRow[] }
  | { status: 'error'; error: AppError };

const statusCopy: Record<ClubMemberStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Menunggu persetujuan', tone: 'warning' },
  active: { label: 'Anggota aktif', tone: 'success' },
  rejected: { label: 'Permintaan ditolak', tone: 'danger' },
  removed: { label: 'Dikeluarkan', tone: 'danger' },
  left: { label: 'Sudah keluar', tone: 'neutral' },
};

const roleLabel: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

/**
 * Detail klub: informasi klub, status keanggotaan pengguna, dan aksi yang benar-benar
 * tersedia (ajukan gabung, batalkan permintaan, keluar klub).
 *
 * Otorisasi tidak bergantung pada tombol di layar ini: seluruh aksi memanggil RPC
 * yang memeriksa keanggotaan di database, jadi menyembunyikan tombol hanya soal UX.
 */
export default function ClubScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const clubId = typeof params.id === 'string' ? params.id : '';
  const { backend, userId } = useAuthSession();

  const [state, setState] = useState<ClubState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [logoPreview, setLogoPreview] = useState<{ path: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const logoPath = state.status === 'ready' ? state.detail.club.logo_path : null;

  useEffect(() => {
    if (!backend.available || !userId || clubId.length === 0) return;

    const client = backend.client;
    let active = true;

    void (async () => {
      const detail = await getClubDetails(client, clubId, userId);

      if (!active) return;

      if (!detail.ok) {
        setState(
          detail.error.code === 'not_found'
            ? { status: 'missing' }
            : { status: 'error', error: detail.error },
        );
        return;
      }

      const members: ApiResult<ClubMemberRow[]> = detail.data.isMember
        ? await listClubMembers(client, clubId)
        : { ok: true, data: [] };

      if (!active) return;

      if (!members.ok) {
        setState({ status: 'error', error: members.error });
        return;
      }

      setState({ status: 'ready', detail: detail.data, members: members.data });
    })();

    return () => {
      active = false;
    };
  }, [backend, clubId, reloadToken, userId]);

  // Logo klub juga privat. Signed URL-nya hanya diminta bila pengguna memang
  // boleh membaca klub ini; non-anggota klub privat tidak akan mendapatkannya.
  useEffect(() => {
    if (!backend.available || !logoPath) return;

    let active = true;

    void getPhotoSignedUrl(backend.client, CLUB_LOGO_BUCKET, logoPath).then((result) => {
      if (!active || !result.ok) return;
      setLogoPreview({ path: logoPath, url: result.data });
    });

    return () => {
      active = false;
    };
  }, [backend, logoPath]);

  async function handleJoin() {
    if (!backend.available || !userId || busy) return;

    setBusy(true);
    setNotice(null);
    setActionError(null);

    const result = await requestClubMembership(backend.client, clubId);
    setBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setNotice(
      result.data === 'active'
        ? 'Anda bergabung sebagai anggota klub ini.'
        : 'Permintaan bergabung dikirim. Owner/admin klub akan meninjaunya.',
    );
    reload();
  }

  async function handleLeave() {
    if (!backend.available || !userId || busy) return;

    setBusy(true);
    setNotice(null);
    setActionError(null);

    const result = await leaveClub(backend.client, clubId);
    setBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setNotice(
      result.data === 'cancelled'
        ? 'Permintaan bergabung dibatalkan.'
        : 'Anda keluar dari klub ini. Riwayat keanggotaan tetap tercatat untuk audit.',
    );
    reload();
  }

  const detail = state.status === 'ready' ? state.detail : null;
  const logoUrl = logoPath && logoPreview?.path === logoPath ? logoPreview.url : null;
  const status = detail?.memberStatus ?? null;
  const badge = status ? statusCopy[status] : null;
  const canJoin =
    detail !== null &&
    !detail.isMember &&
    status !== 'pending' &&
    detail.club.join_policy !== 'invite_only';

  return (
    <Screen scroll testID="club-screen">
      <ScreenHeader
        showBack
        overline="Komunitas"
        subtitle={
          detail ? `Klub ${detail.club.visibility === 'public' ? 'publik' : 'privat'}` : undefined
        }
        title={detail ? detail.club.name : 'Detail klub'}
      />

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {notice ? (
        <Banner message={notice} testID="club-notice" title="Berhasil" tone="success" />
      ) : null}

      {actionError ? (
        <Banner message={actionError.message} title="Aksi tidak selesai" tone="danger" />
      ) : null}

      {state.status === 'loading' ? <LoadingState label="Memuat klub…" /> : null}

      {state.status === 'error' ? (
        <ErrorState description={state.error.message} onRetry={reload} />
      ) : null}

      {state.status === 'missing' ? (
        <UnavailableState
          description="Klub tidak ditemukan, atau klub ini privat dan bukan klub Anda. Periksa kembali tautannya."
          icon="lock-closed-outline"
          title="Klub tidak bisa dibuka"
        />
      ) : null}

      {detail ? (
        <>
          <Card>
            {logoUrl ? (
              <Image
                accessibilityLabel={`Logo ${detail.club.name}`}
                resizeMode="cover"
                source={{ uri: logoUrl }}
                style={styles.logo}
              />
            ) : null}
            <View style={styles.badges}>
              <Badge
                label={detail.club.visibility === 'public' ? 'Klub publik' : 'Klub privat'}
                tone="neutral"
              />
              <Badge
                label={
                  detail.club.join_policy === 'open'
                    ? 'Gabung langsung'
                    : detail.club.join_policy === 'approval'
                      ? 'Perlu persetujuan'
                      : 'Hanya undangan'
                }
                tone="accent"
              />
              {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
              {detail.isAdmin ? (
                <Badge icon="shield-checkmark-outline" label="Anda admin" tone="info" />
              ) : null}
            </View>

            <Divider />

            <InfoRow label="Slug" value={detail.club.slug} />
            <InfoRow
              label="Keanggotaan Anda"
              value={status ? (roleLabel[detail.myRole ?? 'member'] ?? '-') : 'Belum bergabung'}
            />
            {detail.club.description ? (
              <AppText tone="secondary" variant="callout">
                {detail.club.description}
              </AppText>
            ) : (
              <AppText tone="muted" variant="caption">
                Klub ini belum mengisi deskripsi.
              </AppText>
            )}

            {canJoin ? (
              <Button
                accessibilityHint="Mengirim permintaan bergabung ke klub ini."
                disabled={busy}
                icon="person-add-outline"
                label={
                  detail.club.join_policy === 'open' ? 'Gabung klub' : 'Ajukan permintaan bergabung'
                }
                onPress={() => {
                  void handleJoin();
                }}
                testID="club-join"
              />
            ) : null}

            {status === 'pending' ? (
              <Button
                accessibilityHint="Membatalkan permintaan bergabung yang masih menunggu."
                disabled={busy}
                icon="close-circle-outline"
                label="Batalkan permintaan"
                onPress={() => {
                  void handleLeave();
                }}
                variant="secondary"
              />
            ) : null}

            {detail.club.join_policy === 'invite_only' &&
            !detail.isMember &&
            status !== 'pending' ? (
              <Banner
                message="Klub ini hanya menerima anggota lewat undangan, jadi permintaan bergabung dari aplikasi tidak akan berhasil."
                title="Hanya undangan"
                tone="warning"
              />
            ) : null}

            {detail.isMember ? (
              <Button
                accessibilityHint="Keluar dari klub ini."
                disabled={busy}
                icon="exit-outline"
                label="Keluar klub"
                onPress={() => {
                  Alert.alert(
                    'Keluar dari klub?',
                    'Anda akan kehilangan akses ke data khusus anggota klub ini.',
                    [
                      { text: 'Batal', style: 'cancel' },
                      {
                        text: 'Keluar',
                        style: 'destructive',
                        onPress: () => {
                          void handleLeave();
                        },
                      },
                    ],
                  );
                }}
                variant="ghost"
              />
            ) : null}

            {detail.isAdmin ? (
              <Button
                accessibilityHint="Membuka halaman pengelolaan anggota klub."
                icon="settings-outline"
                label="Kelola anggota klub"
                onPress={() => router.push({ pathname: '/club-admin', params: { id: clubId } })}
              />
            ) : null}
          </Card>

          {detail.isMember ? (
            <Card>
              <SectionHeader
                subtitle={`${state.status === 'ready' ? state.members.filter((member) => member.status === 'active').length : 0} anggota aktif`}
                title="Anggota"
              />
              <Divider />
              {state.status === 'ready' && state.members.length > 0 ? (
                state.members.map((member) => (
                  <InfoRow
                    key={member.user_id}
                    badge={{
                      label: roleLabel[member.role] ?? member.role,
                      tone: member.role === 'member' ? 'neutral' : 'accent',
                    }}
                    detail={`${statusCopy[member.status].label} · ${member.user_id.slice(0, 8)}`}
                    label={member.user_id === userId ? 'Anda' : 'Anggota'}
                  />
                ))
              ) : (
                <AppText tone="muted" variant="caption">
                  Belum ada anggota lain di klub ini.
                </AppText>
              )}
              <AppText tone="muted" variant="caption">
                Setiap perubahan peran dan status dicatat pada jejak audit klub di database.
              </AppText>
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: {
    aspectRatio: 1,
    borderRadius: spacing.md,
    maxWidth: 160,
    width: '100%',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
