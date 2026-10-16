import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
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
  listClubMembers,
  removeClubMember,
  reviewClubMembership,
  setClubMemberRole,
} from '@/features/clubs/api';
import type { ClubMemberRole, ClubMemberRow } from '@/lib/supabase/database.types';

type AdminState =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'ready'; members: ClubMemberRow[]; clubName: string; isOwner: boolean }
  | { status: 'error'; error: AppError };

const roleLabel: Record<ClubMemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

/**
 * Dashboard pengelolaan klub (layar terpisah dari detail klub).
 *
 * Layar ini hanya menampilkan tombol untuk aksi yang benar-benar boleh dilakukan
 * pemanggil, tetapi keputusan akhir tetap di database: `review_club_membership`,
 * `set_club_member_role`, dan `remove_club_member` memeriksa keanggotaan aktif
 * pemanggil, dan menolak dengan `not_authorized` bila bukan owner/admin.
 */
export default function ClubAdminScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const clubId = typeof params.id === 'string' ? params.id : '';
  const { backend, userId } = useAuthSession();

  const [state, setState] = useState<AdminState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!backend.available || !userId || clubId.length === 0) return;

    const client = backend.client;
    let active = true;

    void (async () => {
      const detail = await getClubDetails(client, clubId, userId);

      if (!active) return;

      if (!detail.ok) {
        setState({ status: 'error', error: detail.error });
        return;
      }

      if (!detail.data.isAdmin) {
        setState({ status: 'forbidden' });
        return;
      }

      const members = await listClubMembers(client, clubId);

      if (!active) return;

      if (!members.ok) {
        setState({ status: 'error', error: members.error });
        return;
      }

      setState({
        status: 'ready',
        members: members.data,
        clubName: detail.data.club.name,
        isOwner: detail.data.myRole === 'owner',
      });
    })();

    return () => {
      active = false;
    };
  }, [backend, clubId, reloadToken, userId]);

  async function run(
    key: string,
    action: () => Promise<{ ok: boolean; error?: AppError }>,
    successMessage: string,
  ) {
    if (busyKey) return;

    setBusyKey(key);
    setNotice(null);
    setActionError(null);

    const result = await action();
    setBusyKey(null);

    if (!result.ok) {
      if (result.error) setActionError(result.error);
      return;
    }

    setNotice(successMessage);
    reload();
  }

  function handleReview(member: ClubMemberRow, approve: boolean) {
    if (!backend.available) return;

    const client = backend.client;
    void run(
      `${approve ? 'approve' : 'reject'}-${member.user_id}`,
      () => reviewClubMembership(client, clubId, member.user_id, approve),
      approve
        ? 'Permintaan disetujui; anggota kini punya akses ke data klub.'
        : 'Permintaan ditolak; pengguna itu tidak mendapat akses.',
    );
  }

  function handleRole(member: ClubMemberRow, role: ClubMemberRole) {
    if (!backend.available) return;

    const client = backend.client;
    void run(
      `role-${member.user_id}-${role}`,
      () => setClubMemberRole(client, clubId, member.user_id, role),
      `Peran anggota diperbarui menjadi ${roleLabel[role]}. Perubahan ini tercatat di jejak audit klub.`,
    );
  }

  function handleRemove(member: ClubMemberRow) {
    if (!backend.available) return;

    const client = backend.client;
    void run(
      `remove-${member.user_id}`,
      () => removeClubMember(client, clubId, member.user_id),
      'Anggota dikeluarkan dari klub; aksesnya ke data klub dicabut.',
    );
  }

  const pending =
    state.status === 'ready' ? state.members.filter((member) => member.status === 'pending') : [];
  const activeMembers =
    state.status === 'ready' ? state.members.filter((member) => member.status === 'active') : [];

  return (
    <Screen scroll testID="club-admin-screen">
      <ScreenHeader
        showBack
        overline="Pengelolaan klub"
        subtitle="Setujui permintaan, atur peran, dan keluarkan anggota."
        title={state.status === 'ready' ? state.clubName : 'Admin klub'}
      />

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {notice ? (
        <Banner message={notice} testID="club-admin-notice" title="Berhasil" tone="success" />
      ) : null}

      {actionError ? (
        <Banner message={actionError.message} title="Aksi tidak selesai" tone="danger" />
      ) : null}

      {state.status === 'loading' ? <LoadingState label="Memuat keanggotaan…" /> : null}

      {state.status === 'error' ? (
        <ErrorState description={state.error.message} onRetry={reload} />
      ) : null}

      {state.status === 'forbidden' ? (
        <UnavailableState
          description="Halaman ini hanya untuk owner/admin klub. Database menolak permintaan pengelolaan dari peran lain, jadi tidak ada tombol yang bisa memaksa."
          icon="shield-outline"
          title="Bukan admin klub"
        />
      ) : null}

      {state.status === 'ready' ? (
        <>
          <Card>
            <SectionHeader
              subtitle={`${pending.length} permintaan menunggu keputusan`}
              title="Permintaan bergabung"
            />
            <Divider />
            {pending.length === 0 ? (
              <AppText tone="muted" variant="caption">
                Tidak ada permintaan yang menunggu. Permintaan baru akan muncul di sini.
              </AppText>
            ) : (
              pending.map((member) => (
                <View key={member.user_id} style={styles.row}>
                  <InfoRow
                    badge={{ label: 'Menunggu', tone: 'warning' }}
                    detail={member.user_id}
                    label="Calon anggota"
                  />
                  <View style={styles.actions}>
                    <Button
                      disabled={busyKey !== null}
                      icon="checkmark-outline"
                      label="Setujui"
                      onPress={() => handleReview(member, true)}
                    />
                    <Button
                      disabled={busyKey !== null}
                      icon="close-outline"
                      label="Tolak"
                      onPress={() => handleReview(member, false)}
                      variant="secondary"
                    />
                  </View>
                </View>
              ))
            )}
          </Card>

          <Card>
            <SectionHeader
              subtitle={`${activeMembers.length} anggota aktif`}
              title="Anggota aktif"
            />
            <Divider />
            {activeMembers.map((member) => (
              <View key={member.user_id} style={styles.row}>
                <InfoRow
                  badge={{
                    label: roleLabel[member.role],
                    tone: member.role === 'member' ? 'neutral' : 'accent',
                  }}
                  detail={member.user_id === userId ? 'Anda' : member.user_id}
                  label={member.user_id === userId ? 'Akun ini' : 'Anggota'}
                />
                {state.isOwner ? (
                  <View style={styles.actions}>
                    {member.role === 'member' ? (
                      <Button
                        disabled={busyKey !== null}
                        label="Jadikan admin"
                        onPress={() => handleRole(member, 'admin')}
                        variant="secondary"
                      />
                    ) : null}
                    {member.role === 'admin' ? (
                      <Button
                        disabled={busyKey !== null}
                        label="Turunkan ke member"
                        onPress={() => handleRole(member, 'member')}
                        variant="secondary"
                      />
                    ) : null}
                    {member.role !== 'owner' ? (
                      <Button
                        disabled={busyKey !== null}
                        label="Jadikan owner"
                        onPress={() => handleRole(member, 'owner')}
                        variant="secondary"
                      />
                    ) : null}
                    {member.user_id !== userId ? (
                      <Button
                        disabled={busyKey !== null}
                        icon="person-remove-outline"
                        label="Keluarkan"
                        onPress={() => handleRemove(member)}
                        variant="ghost"
                      />
                    ) : null}
                  </View>
                ) : (
                  <AppText tone="muted" variant="caption">
                    Hanya owner yang dapat mengubah peran atau mengeluarkan anggota.
                  </AppText>
                )}
              </View>
            ))}
            <AppText tone="muted" variant="caption">
              Owner terakhir tidak dapat diturunkan atau keluar sebelum mengalihkan kepemilikan —
              aturan itu dijaga database, bukan hanya tombol di layar ini.
            </AppText>
          </Card>

          <Card variant="accent">
            <AppText tone="accent" variant="bodyStrong">
              Jejak audit
            </AppText>
            <AppText tone="secondary" variant="callout">
              Setiap persetujuan, penolakan, perubahan peran, pengeluaran, dan keluar dicatat pada
              tabel `club_role_audit` beserta pelaku dan waktu kejadian. Hanya owner/admin yang
              dapat membacanya; klien tidak punya jalur tulis ke tabel itu.
            </AppText>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
