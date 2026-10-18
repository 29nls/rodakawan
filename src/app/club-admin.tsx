import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import type { BadgeTone } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { InfoRow } from '@/components/ui/InfoRow';
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
  getClubDetails,
  listClubMembers,
  removeClubMember,
  reviewClubMembership,
  setClubMemberRole,
  updateClub,
  type Club,
} from '@/features/clubs/api';
import {
  filterMembers,
  MEMBER_PAGE_SIZE,
  MEMBER_ROLE_FILTERS,
  MEMBER_STATUS_FILTERS,
  paginateMembers,
  type MemberRoleFilter,
  type MemberStatusFilter,
} from '@/features/clubs/memberDirectory';
import {
  CLUB_DESCRIPTION_MAX_LENGTH,
  CLUB_NAME_MAX_LENGTH,
  descriptionError,
  nameError,
} from '@/features/clubs/validation';
import { PhotoCard } from '@/features/media/components/PhotoCard';
import { CLUB_LOGO_MAX_DIMENSION } from '@/features/media/imageCompression';
import { pickPhoto } from '@/features/media/picker';
import {
  CLUB_LOGO_BUCKET,
  deleteClubLogo,
  getPhotoSignedUrl,
  uploadClubLogo,
} from '@/features/media/photos';
import type {
  ClubJoinPolicy,
  ClubMemberRole,
  ClubMemberRow,
  ClubMemberStatus,
  ClubVisibility,
} from '@/lib/supabase/database.types';

type AdminState =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'ready'; members: ClubMemberRow[]; club: Club; isOwner: boolean }
  | { status: 'error'; error: AppError };

const roleLabel: Record<ClubMemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

const joinPolicyCopy: Record<ClubJoinPolicy, string> = {
  open: 'Gabung langsung',
  approval: 'Perlu persetujuan',
  invite_only: 'Hanya undangan',
};

const requestStatusCopy: Record<ClubMemberStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Menunggu', tone: 'warning' },
  active: { label: 'Anggota aktif', tone: 'success' },
  rejected: { label: 'Ditolak', tone: 'danger' },
  removed: { label: 'Dikeluarkan', tone: 'danger' },
  left: { label: 'Sudah keluar', tone: 'neutral' },
};

/** Label ringkas untuk chip filter status (badge memakai label penuh di atas). */
const statusFilterCopy: Record<ClubMemberStatus, string> = {
  pending: 'Menunggu',
  active: 'Aktif',
  rejected: 'Ditolak',
  removed: 'Dikeluarkan',
  left: 'Keluar',
};

type ClubFormState = {
  name: string;
  description: string;
  visibility: ClubVisibility;
  joinPolicy: ClubJoinPolicy;
};

type ClubFormErrors = { name?: string; description?: string };

const EMPTY_CLUB_FORM: ClubFormState = {
  name: '',
  description: '',
  visibility: 'public',
  joinPolicy: 'approval',
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
  const [photoBusy, setPhotoBusy] = useState(false);
  const [logoPreview, setLogoPreview] = useState<{ path: string; url: string } | null>(null);
  const [clubForm, setClubForm] = useState<ClubFormState>(EMPTY_CLUB_FORM);
  const [clubFormErrors, setClubFormErrors] = useState<ClubFormErrors>({});
  const [clubSaving, setClubSaving] = useState(false);
  const initialisedClubId = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>('all');
  const [roleFilter, setRoleFilter] = useState<MemberRoleFilter>('all');
  const [memberPage, setMemberPage] = useState(1);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const club = state.status === 'ready' ? state.club : null;
  const logoPath = club?.logo_path ?? null;

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

      // Isi formulir hanya saat klub pertama kali dimuat, bukan pada setiap reload
      // setelah aksi lain (setujui anggota, ganti logo). Reload seperti itu tidak boleh
      // membuang suntingan yang sedang diketik admin.
      if (initialisedClubId.current !== clubId) {
        initialisedClubId.current = clubId;
        setClubForm({
          name: detail.data.club.name,
          description: detail.data.club.description ?? '',
          visibility: detail.data.club.visibility,
          joinPolicy: detail.data.club.join_policy,
        });
        setClubFormErrors({});
      }

      setState({
        status: 'ready',
        members: members.data,
        club: detail.data.club,
        isOwner: detail.data.myRole === 'owner',
      });
    })();

    return () => {
      active = false;
    };
  }, [backend, clubId, reloadToken, userId]);

  // Logo dibaca lewat signed URL, sama seperti foto kendaraan. Karena bucket-nya
  // privat, mengganti logo tidak meninggalkan URL lama yang bisa dipakai selamanya.
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

  async function handlePickLogo() {
    if (!backend.available || !userId || photoBusy) return;

    setNotice(null);
    setActionError(null);

    const picked = await pickPhoto('club');
    if (!picked.ok) {
      setActionError(picked.error);
      return;
    }

    if (!picked.asset) return;

    setPhotoBusy(true);
    const result = await uploadClubLogo(backend.client, clubId, picked.asset);
    setPhotoBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setNotice(
      'Logo klub diperbarui. Hanya anggota klub (dan pengunjung klub publik) yang dapat melihatnya.',
    );
    reload();
  }

  function confirmRemoveLogo() {
    Alert.alert('Hapus logo klub?', 'Logo akan dihapus permanen dari penyimpanan privat klub.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!backend.available || photoBusy) return;

            setNotice(null);
            setActionError(null);
            setPhotoBusy(true);
            const result = await deleteClubLogo(backend.client, clubId);
            setPhotoBusy(false);

            if (!result.ok) {
              setActionError(result.error);
              return;
            }

            setLogoPreview(null);
            setNotice(result.data.deleted ? 'Logo klub dihapus.' : 'Klub ini belum memiliki logo.');
            reload();
          })();
        },
      },
    ]);
  }

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

  async function handleSaveClub() {
    if (!backend.available || clubSaving) return;

    const nameProblem = nameError(clubForm.name);
    const description = clubForm.description.trim();
    const descriptionProblem = descriptionError(description.length > 0 ? description : null);

    setClubFormErrors({ name: nameProblem, description: descriptionProblem });
    setNotice(null);
    setActionError(null);

    if (nameProblem || descriptionProblem) return;

    setClubSaving(true);
    const result = await updateClub(backend.client, clubId, {
      name: clubForm.name,
      description: description.length > 0 ? description : null,
      visibility: clubForm.visibility,
      join_policy: clubForm.joinPolicy,
    });
    setClubSaving(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    // Pakai nilai yang dikembalikan database (nama sudah dirapikan) tanpa menunggu
    // reload, sehingga formulir tidak terlihat "kembali" ke nilai lama.
    setClubForm({
      name: result.data.name,
      description: result.data.description ?? '',
      visibility: result.data.visibility,
      joinPolicy: result.data.join_policy,
    });
    setClubFormErrors({});
    setNotice(
      'Data klub diperbarui. Nama baru langsung terlihat; slug lama tetap dipakai supaya tautan yang sudah dibagikan tidak rusak.',
    );
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

  const logoUrl = logoPath && logoPreview?.path === logoPath ? logoPreview.url : null;
  const members = state.status === 'ready' ? state.members : [];
  const pendingCount = members.filter((member) => member.status === 'pending').length;

  // Pencarian/filter dijalankan pada data yang sudah dimuat, lalu dipotong per halaman.
  // `paginateMembers` menjepit nomor halaman ke rentang yang ada, jadi menyetujui atau
  // mengeluarkan anggota dari halaman terakhir tidak menyisakan halaman kosong.
  const directory = paginateMembers(
    filterMembers(members, { query: memberQuery, status: statusFilter, role: roleFilter }),
    memberPage,
    MEMBER_PAGE_SIZE,
  );

  return (
    <Screen scroll testID="club-admin-screen">
      <ScreenHeader
        showBack
        overline="Pengelolaan klub"
        subtitle="Ubah data klub, setujui permintaan, atur peran, dan keluarkan anggota."
        title={club ? club.name : 'Admin klub'}
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
          <PhotoCard
            busy={photoBusy}
            emptyText="Belum ada logo. Logo membantu anggota mengenali klub ini."
            hasPhoto={Boolean(club?.logo_path)}
            hint="Logo disimpan di bucket privat. Anggota klub dan pengunjung klub publik dapat melihatnya; hanya owner/admin yang dapat mengganti atau menghapusnya."
            onPick={() => {
              void handlePickLogo();
            }}
            onRemove={confirmRemoveLogo}
            photoUrl={logoUrl}
            pickLabel={club?.logo_path ? 'Ganti logo' : 'Unggah logo'}
            subtitle={`JPG, PNG, atau WEBP; maksimal 2 MB. Logo diperkecil otomatis ke ${CLUB_LOGO_MAX_DIMENSION} px; rasio 1:1 paling rapi.`}
            testID="club-logo"
            title="Logo klub"
          />

          <Card>
            <SectionHeader
              subtitle="Hanya owner/admin aktif yang dapat mengubah data ini. Perubahan langsung terlihat oleh anggota."
              title="Ubah data klub"
            />
            <Divider />
            <InfoRow label="Slug" value={club?.slug ?? '-'} />
            <TextField
              error={clubFormErrors.name}
              label="Nama klub"
              maxLength={CLUB_NAME_MAX_LENGTH}
              onChangeText={(name) => setClubForm((previous) => ({ ...previous, name }))}
              testID="club-admin-name"
              value={clubForm.name}
            />
            <TextField
              error={clubFormErrors.description}
              label="Deskripsi"
              maxLength={CLUB_DESCRIPTION_MAX_LENGTH}
              multiline
              onChangeText={(description) =>
                setClubForm((previous) => ({ ...previous, description }))
              }
              placeholder="Ceritakan tujuan dan kegiatan klub"
              testID="club-admin-description"
              value={clubForm.description}
            />
            <AppText variant="label">Visibilitas</AppText>
            <View style={styles.toggles}>
              <Button
                accessibilityHint="Klub publik dapat ditemukan semua pengguna."
                label={clubForm.visibility === 'public' ? 'Publik (dipilih)' : 'Publik'}
                onPress={() => setClubForm((previous) => ({ ...previous, visibility: 'public' }))}
                variant={clubForm.visibility === 'public' ? 'primary' : 'secondary'}
              />
              <Button
                accessibilityHint="Klub privat hanya terlihat oleh anggotanya."
                label={clubForm.visibility === 'private' ? 'Privat (dipilih)' : 'Privat'}
                onPress={() => setClubForm((previous) => ({ ...previous, visibility: 'private' }))}
                variant={clubForm.visibility === 'private' ? 'primary' : 'secondary'}
              />
            </View>
            <AppText variant="label">Cara bergabung</AppText>
            <View style={styles.toggles}>
              {(['open', 'approval', 'invite_only'] as const).map((policy) => (
                <Button
                  key={policy}
                  accessibilityHint={`Menetapkan kebijakan bergabung: ${joinPolicyCopy[policy]}.`}
                  label={
                    clubForm.joinPolicy === policy
                      ? `${joinPolicyCopy[policy]} (dipilih)`
                      : joinPolicyCopy[policy]
                  }
                  onPress={() => setClubForm((previous) => ({ ...previous, joinPolicy: policy }))}
                  variant={clubForm.joinPolicy === policy ? 'primary' : 'secondary'}
                />
              ))}
            </View>
            <Button
              accessibilityHint="Menyimpan perubahan nama, deskripsi, visibilitas, dan cara bergabung klub."
              disabled={clubSaving || busyKey !== null}
              icon="save-outline"
              label={clubSaving ? 'Menyimpan…' : 'Simpan perubahan klub'}
              onPress={() => {
                void handleSaveClub();
              }}
              testID="club-admin-save"
            />
            <AppText tone="muted" variant="caption">
              Slug klub tidak berubah saat nama diganti, sehingga tautan undangan lama tetap
              berfungsi.
            </AppText>
          </Card>

          <Card>
            <SectionHeader
              subtitle={`${members.length} anggota · ${pendingCount} menunggu keputusan`}
              title="Anggota klub"
            />
            <Divider />
            <TextField
              helper="Pencarian mencocokkan user ID, peran, dan status. Daftar ini tidak memuat nama profil, jadi nama tampilan tidak bisa dicari."
              label="Cari anggota"
              onChangeText={(value) => {
                setMemberQuery(value);
                setMemberPage(1);
              }}
              placeholder="Cari user ID, peran, atau status"
              testID="club-admin-member-search"
              value={memberQuery}
            />
            <AppText variant="label">Filter status</AppText>
            <View style={styles.toggles}>
              <Button
                accessibilityHint="Menampilkan anggota dari semua status keanggotaan."
                label={statusFilter === 'all' ? 'Semua status (dipilih)' : 'Semua status'}
                onPress={() => {
                  setStatusFilter('all');
                  setMemberPage(1);
                }}
                testID="club-admin-status-all"
                variant={statusFilter === 'all' ? 'primary' : 'secondary'}
              />
              {MEMBER_STATUS_FILTERS.map((status) => (
                <Button
                  key={status}
                  accessibilityHint={`Hanya menampilkan status ${statusFilterCopy[status]}.`}
                  label={
                    statusFilter === status
                      ? `${statusFilterCopy[status]} (dipilih)`
                      : statusFilterCopy[status]
                  }
                  onPress={() => {
                    setStatusFilter(status);
                    setMemberPage(1);
                  }}
                  testID={`club-admin-status-${status}`}
                  variant={statusFilter === status ? 'primary' : 'secondary'}
                />
              ))}
            </View>
            <AppText variant="label">Filter peran</AppText>
            <View style={styles.toggles}>
              <Button
                accessibilityHint="Menampilkan semua peran anggota."
                label={roleFilter === 'all' ? 'Semua peran (dipilih)' : 'Semua peran'}
                onPress={() => {
                  setRoleFilter('all');
                  setMemberPage(1);
                }}
                testID="club-admin-role-all"
                variant={roleFilter === 'all' ? 'primary' : 'secondary'}
              />
              {MEMBER_ROLE_FILTERS.map((role) => (
                <Button
                  key={role}
                  accessibilityHint={`Hanya menampilkan peran ${roleLabel[role]}.`}
                  label={roleFilter === role ? `${roleLabel[role]} (dipilih)` : roleLabel[role]}
                  onPress={() => {
                    setRoleFilter(role);
                    setMemberPage(1);
                  }}
                  testID={`club-admin-role-${role}`}
                  variant={roleFilter === role ? 'primary' : 'secondary'}
                />
              ))}
            </View>
            <Divider />
            {directory.total === 0 ? (
              <AppText testID="club-admin-members-empty" tone="muted" variant="caption">
                Tidak ada anggota yang cocok dengan pencarian dan filter ini.
              </AppText>
            ) : (
              <>
                {directory.items.map((member) => {
                  const isSelf = member.user_id === userId;

                  return (
                    <View key={member.user_id} style={styles.row}>
                      <InfoRow
                        badge={requestStatusCopy[member.status]}
                        detail={isSelf ? 'Anda' : member.user_id}
                        label={roleLabel[member.role]}
                        testID={`club-admin-member-${member.user_id}`}
                      />
                      {member.status === 'pending' ? (
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
                      ) : member.status === 'active' ? (
                        state.isOwner ? (
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
                            {!isSelf ? (
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
                        )
                      ) : null}
                    </View>
                  );
                })}
                <View style={styles.pagination}>
                  <Button
                    disabled={directory.page <= 1 || busyKey !== null}
                    label="Sebelumnya"
                    onPress={() => setMemberPage(directory.page - 1)}
                    testID="club-admin-members-prev"
                    variant="secondary"
                  />
                  <Button
                    disabled={directory.page >= directory.pageCount || busyKey !== null}
                    label="Berikutnya"
                    onPress={() => setMemberPage(directory.page + 1)}
                    testID="club-admin-members-next"
                    variant="secondary"
                  />
                </View>
                <AppText testID="club-admin-members-page" tone="muted" variant="caption">
                  Menampilkan {directory.start}–{directory.end} dari {directory.total} anggota ·
                  Halaman {directory.page} dari {directory.pageCount}
                </AppText>
              </>
            )}
            <AppText tone="muted" variant="caption">
              Riwayat penolakan, pengeluaran, dan keluar tetap tersimpan dan bisa disaring lewat
              filter status. Owner terakhir tidak dapat diturunkan atau keluar sebelum mengalihkan
              kepemilikan — aturan itu dijaga database, bukan hanya tombol di layar ini.
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
  toggles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
