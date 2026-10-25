import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useSupabaseState, classifyScreenState, formatErrorMessage } from '@/features/state-helper';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateView';
import { TextField } from '@/components/ui/TextField';
import { spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import { createClub, listClubs, listMyClubMemberships, type Club } from '@/features/clubs/api';
import {
  CLUB_DESCRIPTION_MAX_LENGTH,
  CLUB_NAME_MAX_LENGTH,
  descriptionError,
  nameError,
} from '@/features/clubs/validation';
import type {
  ClubJoinPolicy,
  ClubMemberStatus,
  ClubVisibility,
} from '@/lib/supabase/database.types';

type BrowseState =
  | { status: 'loading' }
  | { status: 'ready'; clubs: Club[]; memberships: Map<string, ClubMemberStatus> }
  | { status: 'error'; error: AppError };

const membershipCopy: Record<ClubMemberStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Menunggu persetujuan', tone: 'warning' },
  active: { label: 'Anggota', tone: 'success' },
  rejected: { label: 'Permintaan ditolak', tone: 'danger' },
  removed: { label: 'Dikeluarkan', tone: 'danger' },
  left: { label: 'Sudah keluar', tone: 'neutral' },
};

const joinPolicyCopy: Record<ClubJoinPolicy, string> = {
  open: 'Gabung langsung',
  approval: 'Perlu persetujuan',
  invite_only: 'Hanya undangan',
};

const EMPTY_CLUB_FORM = {
  name: '',
  description: '',
  visibility: 'public' as ClubVisibility,
  joinPolicy: 'approval' as ClubJoinPolicy,
};

/**
 * Tab Komunitas: jelajah klub publik, cari, dan buat klub baru.
 *
 * Pembuatan klub dan seluruh perubahan keanggotaan dijalankan lewat RPC di
 * `src/features/clubs/api.ts`; layar ini tidak pernah menulis ke `public.clubs`
 * atau `public.club_members` secara langsung karena database memang tidak
 * menyediakan policy untuk itu.
 */
export default function CommunityScreen() {
  const router = useRouter();
  const { backend, userId } = useAuthSession();
  const supabaseAvailable = backend?.available ?? false;

  // Klasifikasi state layar berdasarkan status Supabase
  const { status, showEmpty, showError } = classifyScreenState(
    supabaseAvailable,
    state.status ?? null,
    0,
  );

  // Jika error, dapatkan pesan yang konsisten
  const errorMessage = showError ? formatErrorMessage(state.error) : undefined;

  const [state, setState] = useState<BrowseState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(EMPTY_CLUB_FORM);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!backend.available || !userId) return;

    const client = backend.client;
    let active = true;

    void (async () => {
      const clubs = await listClubs(client);

      if (!active) return;

      if (!clubs.ok) {
        setState({ status: 'error', error: clubs.error });
        return;
      }

      const memberships = await listMyClubMemberships(client, userId);

      if (!active) return;

      if (!memberships.ok) {
        setState({ status: 'error', error: memberships.error });
        return;
      }

      setState({
        status: 'ready',
        clubs: clubs.data,
        memberships: new Map(memberships.data.map((row) => [row.club_id, row.status])),
      });
    })();

    return () => {
      active = false;
    };
  }, [backend, reloadToken, userId]);

  async function handleCreateClub() {
    if (!backend.available || !userId || saving) return;

    const problem = nameError(form.name) ?? descriptionError(form.description || null);
    setFormError(problem);
    setNotice(null);
    setActionError(null);

    if (problem) return;

    setSaving(true);
    const result = await createClub(backend.client, {
      name: form.name,
      description: form.description.trim().length > 0 ? form.description.trim() : null,
      visibility: form.visibility,
      join_policy: form.joinPolicy,
    });
    setSaving(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setForm(EMPTY_CLUB_FORM);
    setNotice(
      `Klub ${result.data.name} dibuat. Anda menjadi owner, dan keanggotaan itu tercatat di jejak audit klub.`,
    );
    reload();
  }

  const clubs = state.status === 'ready' ? state.clubs : [];
  const memberships =
    state.status === 'ready' ? state.memberships : new Map<string, ClubMemberStatus>();
  const needle = query.trim().toLowerCase();
  const visibleClubs =
    needle.length === 0
      ? clubs
      : clubs.filter(
          (club) =>
            club.name.toLowerCase().includes(needle) ||
            club.slug.toLowerCase().includes(needle) ||
            (club.description ?? '').toLowerCase().includes(needle),
        );

  return (
    <Screen scroll testID="community-screen">
      <View style={styles.header}>
        <AppText variant="overline" tone="accent">
          Komunitas
        </AppText>
        <AppText variant="titleLg">Klub &amp; anggota</AppText>
      </View>

      {showError ? (
        <Banner message={notice} testID="community-notice" title="Berhasil" tone="success" />
      ) : null}

      {actionError ? (
        <Banner message={actionError.message} title="Aksi tidak selesai" tone="danger" />
      ) : null}

      <Card>
        <SectionHeader
          subtitle="Hanya klub publik yang muncul di sini; klub privat hanya terlihat oleh anggotanya."
          title="Jelajahi klub"
        />
        <Divider />
        <TextField
          label="Cari klub"
          onChangeText={setQuery}
          placeholder="Nama atau kata kunci"
          testID="club-search"
          value={query}
        />

        {state.status === 'loading' ? <LoadingState label="Memuat klub…" /> : null}

        {state.status === 'error' ? (
          <ErrorState description={state.error.message} onRetry={reload} />
        ) : null}

        {state.status === 'ready' && clubs.length === 0 ? (
          <EmptyState
            description="Belum ada klub publik di backend. Buat klub pertama lewat formulir di bawah."
            icon="people-outline"
            testID="community-empty"
            title="Belum ada klub publik"
          />
        ) : null}

        {state.status === 'ready' && clubs.length > 0 && visibleClubs.length === 0 ? (
          <AppText tone="muted" variant="caption">
            Tidak ada klub yang cocok dengan pencarian “{query.trim()}”.
          </AppText>
        ) : null}

        {visibleClubs.map((club) => {
          const membership = memberships.get(club.id);

          return (
            <View key={club.id} style={styles.clubRow}>
              <AppText variant="bodyStrong">{club.name}</AppText>
              <View style={styles.badges}>
                <Badge label={joinPolicyCopy[club.join_policy]} tone="accent" />
                {membership ? (
                  <Badge
                    label={membershipCopy[membership].label}
                    tone={membershipCopy[membership].tone}
                  />
                ) : null}
              </View>
              {club.description ? (
                <AppText tone="secondary" variant="callout">
                  {club.description}
                </AppText>
              ) : null}
              <Button
                accessibilityHint="Membuka detail klub dan aksi keanggotaan."
                icon="open-outline"
                label="Lihat detail"
                onPress={() => router.push({ pathname: '/club', params: { id: club.id } })}
                variant="secondary"
              />
            </View>
          );
        })}
      </Card>

      <Card>
        <SectionHeader
          subtitle="Anda menjadi owner klub yang dibuat dan dapat menambah admin setelahnya."
          title="Buat klub"
        />
        <Divider />
        <TextField
          error={formError}
          label="Nama klub"
          maxLength={CLUB_NAME_MAX_LENGTH}
          onChangeText={(name) => setForm((previous) => ({ ...previous, name }))}
          placeholder="RodaKawan Solo"
          testID="club-name"
          value={form.name}
        />
        <TextField
          label="Deskripsi"
          maxLength={CLUB_DESCRIPTION_MAX_LENGTH}
          multiline
          onChangeText={(description) => setForm((previous) => ({ ...previous, description }))}
          value={form.description}
        />
        <AppText variant="label">Visibilitas</AppText>
        <View style={styles.toggles}>
          <Button
            accessibilityHint="Klub publik dapat ditemukan semua pengguna."
            label={form.visibility === 'public' ? 'Publik (dipilih)' : 'Publik'}
            onPress={() => setForm((previous) => ({ ...previous, visibility: 'public' }))}
            variant={form.visibility === 'public' ? 'primary' : 'secondary'}
          />
          <Button
            accessibilityHint="Klub privat hanya terlihat oleh anggotanya."
            label={form.visibility === 'private' ? 'Privat (dipilih)' : 'Privat'}
            onPress={() => setForm((previous) => ({ ...previous, visibility: 'private' }))}
            variant={form.visibility === 'private' ? 'primary' : 'secondary'}
          />
        </View>
        <AppText variant="label">Cara bergabung</AppText>
        <View style={styles.toggles}>
          {(['open', 'approval', 'invite_only'] as const).map((policy) => (
            <Button
              key={policy}
              accessibilityHint={`Menetapkan kebijakan bergabung: ${joinPolicyCopy[policy]}.`}
              label={
                form.joinPolicy === policy
                  ? `${joinPolicyCopy[policy]} (dipilih)`
                  : joinPolicyCopy[policy]
              }
              onPress={() => setForm((previous) => ({ ...previous, joinPolicy: policy }))}
              variant={form.joinPolicy === policy ? 'primary' : 'secondary'}
            />
          ))}
        </View>
        <Button
          accessibilityHint="Membuat klub dan mendaftarkan Anda sebagai owner."
          disabled={!backend.available || !userId || saving}
          icon="add-circle-outline"
          label={saving ? 'Membuat klub…' : 'Buat klub'}
          onPress={() => {
            void handleCreateClub();
          }}
          testID="club-submit"
        />
      </Card>

      <Card>
        <AppText variant="bodyStrong">Privasi data anggota</AppText>
        <AppText variant="callout" tone="secondary">
          Profil publik hanya memuat username, nama tampilan, bio, dan kota yang disetujui
          pemiliknya. Nomor polisi dan kontak tidak pernah ikut ke profil publik, dan daftar anggota
          klub privat hanya dapat dibaca anggotanya.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  clubRow: {
    gap: spacing.sm,
  },
  toggles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
