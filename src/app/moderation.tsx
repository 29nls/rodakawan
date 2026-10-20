/**
 * Dashboard moderasi laporan penyalahgunaan (ADR-067).
 *
 * Layar ini **bukan** panel admin global. Yang tampil di sini hanyalah laporan
 * atas konten yang wewenangnya dimiliki pengguna: chat dan laporan bahaya pada
 * perjalanan yang ia pimpin, atau pada perjalanan milik klub tempat ia admin.
 * Penyaringan itu dilakukan RLS di database; layar tidak menambahkan filter
 * wewenang sendiri, jadi daftar dan izin sebenarnya tidak bisa menyimpang.
 *
 * Tiga tindakan, masing-masing punya jejak audit sendiri di server:
 * - "Hapus konten"  → konten di-soft-delete, laporan ditutup `removed`;
 * - "Abaikan"       → laporan ditutup `dismissed`, konten tidak disentuh;
 * - "Tandai ditinjau" → laporan ditutup `reviewed`, konten tidak disentuh.
 *
 * Alasan yang dicatat adalah alasan laporan yang sedang ditinjau: moderator
 * tidak memilih alasan baru, sehingga audit tidak bisa dipakai menuliskan alasan
 * yang berbeda dari yang dilihat pelapor.
 */

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
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateView';
import { colors, spacing } from '@/constants/theme';
import { BackendUnavailableBanner } from '@/features/auth/components/BackendUnavailableBanner';
import type { AppError } from '@/features/auth/errors';
import { useAuthSession } from '@/features/auth/session';
import { hazardCategoryLabel, hazardSeverityLabel } from '@/features/hazards/labels';
import {
  contentReportReasonLabel,
  isContentReportReason,
  loadModerationAudit,
  loadModerationQueue,
  moderationActionLabel,
  moderationTargetLabel,
  removeReportedContent,
  reviewReport,
  type ModerationActionRow,
  type ModerationPeople,
  type ModerationQueueItem,
  type ReviewStatus,
} from '@/features/moderation/queue';
import { describeUnavailableReason } from '@/lib/supabase/client';

type QueueState =
  | { status: 'loading' }
  | { status: 'ready'; items: ModerationQueueItem[]; people: ModerationPeople }
  | { status: 'error'; error: AppError };

function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Waktu tidak diketahui';
  return parsed.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function reporterLabel(people: ModerationPeople, userId: string): string {
  return people[userId] ?? 'Pengguna';
}

/** Ringkasan konten yang dilaporkan; `null` berarti isinya tidak terbaca lagi. */
function SubjectSummary({ subject }: { subject: ModerationQueueItem['subject'] }) {
  if (subject === null) {
    return (
      <View style={styles.subject}>
        <AppText tone="muted" variant="callout">
          Isi konten tidak lagi tersedia untuk dibaca. Tutup laporannya sebagai “ditinjau” atau
          “diabaikan”; penghapusan tidak dapat dilakukan tanpa isi yang terbaca.
        </AppText>
      </View>
    );
  }

  if (subject.kind === 'hazard') {
    return (
      <View style={styles.subject}>
        <View style={styles.badges}>
          <Badge label={hazardCategoryLabel(subject.category ?? 'other')} tone="info" />
          <Badge label={hazardSeverityLabel(subject.severity ?? 'moderate')} tone="warning" />
          {subject.removed ? <Badge label="Tidak aktif" tone="neutral" /> : null}
        </View>
        <AppText variant="body">{subject.body || 'Tanpa deskripsi.'}</AppText>
      </View>
    );
  }

  return (
    <View style={styles.subject}>
      <View style={styles.badges}>
        <Badge label="Pesan chat" tone="info" />
        {subject.removed ? <Badge label="Sudah dihapus" tone="neutral" /> : null}
      </View>
      <AppText variant="body">{subject.body || 'Isi pesan kosong.'}</AppText>
    </View>
  );
}

function QueueCard({
  item,
  people,
  busy,
  onRemove,
  onDismiss,
  onReview,
}: {
  item: ModerationQueueItem;
  people: ModerationPeople;
  busy: boolean;
  onRemove: () => void;
  onDismiss: () => void;
  onReview: () => void;
}) {
  const { report, ride, subject } = item;

  return (
    <Card testID={`moderation-item-${report.id}`}>
      <View style={styles.cardHeader}>
        <Badge
          label={contentReportReasonLabel(report.reason)}
          tone={
            report.reason === 'harassment' || report.reason === 'privacy' ? 'danger' : 'warning'
          }
        />
        <AppText tone="muted" variant="caption">
          {formatDateTime(report.created_at)}
        </AppText>
      </View>

      <AppText variant="bodyStrong">
        {subject?.kind === 'chat_message' ? 'Pesan chat' : 'Laporan bahaya'}
        {ride ? ` · ${ride.title}` : ''}
      </AppText>
      <AppText tone="secondary" variant="caption">
        Dilaporkan oleh {reporterLabel(people, report.reporter_id)}
        {subject?.authorId ? ` · ditulis oleh ${reporterLabel(people, subject.authorId)}` : ''}
      </AppText>

      <SubjectSummary subject={subject} />

      {report.details ? (
        <View style={styles.details}>
          <AppText tone="muted" variant="caption">
            Catatan pelapor
          </AppText>
          <AppText tone="secondary" variant="callout">
            {report.details}
          </AppText>
        </View>
      ) : null}

      <Divider />

      <View style={styles.actions}>
        <Button
          disabled={busy}
          fullWidth
          icon="trash-outline"
          label={busy ? 'Memproses…' : 'Hapus konten'}
          onPress={onRemove}
          testID={`moderation-remove-${report.id}`}
          variant="secondary"
        />
        <Button
          disabled={busy}
          fullWidth
          label="Abaikan laporan"
          onPress={onDismiss}
          testID={`moderation-dismiss-${report.id}`}
          variant="ghost"
        />
        <Button
          disabled={busy}
          fullWidth
          label="Tandai ditinjau"
          onPress={onReview}
          testID={`moderation-review-${report.id}`}
          variant="ghost"
        />
      </View>
    </Card>
  );
}

export default function ModerationScreen() {
  const { backend, userId } = useAuthSession();

  const [state, setState] = useState<QueueState>({ status: 'loading' });
  const [audit, setAudit] = useState<ModerationActionRow[]>([]);
  const [auditPeople, setAuditPeople] = useState<ModerationPeople>({});
  const [auditError, setAuditError] = useState<AppError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  // Status loading dipasang di event handler (bukan di body effect) supaya tidak
  // ada setState sinkron saat effect berjalan; muat ulang manual tetap memperlihatkan
  // spinner sebelum data baru datang.
  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!backend.available) return;

    const client = backend.client;
    let active = true;

    void loadModerationQueue(client).then((result) => {
      if (!active) return;

      if (result.ok) {
        setState({ status: 'ready', items: result.data.items, people: result.data.people });
      } else {
        setState({ status: 'error', error: result.error });
      }
    });

    void loadModerationAudit(client).then((result) => {
      if (!active) return;
      setAuditError(result.ok ? null : result.error);
      if (result.ok) {
        setAudit(result.data.actions);
        setAuditPeople(result.data.people);
      }
    });

    return () => {
      active = false;
    };
  }, [backend, reloadToken]);

  const precondition: AppError | null = !backend.available
    ? {
        code: 'backend_not_configured',
        message: describeUnavailableReason(backend.reason),
        retryable: false,
      }
    : !userId
      ? {
          code: 'session_expired',
          message:
            'Sesi tidak ditemukan di perangkat ini. Masuk kembali untuk membuka dashboard moderasi.',
          retryable: false,
        }
      : null;

  async function runAction(
    reportId: string,
    action: () => Promise<{ ok: true } | { ok: false; error: AppError }>,
    successMessage: string,
  ) {
    if (!backend.available || busyId) return;

    setBusyId(reportId);
    setNotice(null);
    setActionError(null);

    const result = await action();
    setBusyId(null);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setNotice(successMessage);
    reload();
  }

  function handleRemove(item: ModerationQueueItem) {
    if (!backend.available || busyId) return;

    const reason = item.report.reason;

    if (!isContentReportReason(reason)) {
      setActionError({
        code: 'invalid_data',
        message: 'Alasan laporan tidak dikenal, jadi konten tidak dihapus. Muat ulang antrean.',
        retryable: false,
      });
      return;
    }

    Alert.alert(
      'Hapus konten ini?',
      `Konten tidak dihapus permanen — hanya disembunyikan dan tetap tersimpan untuk peninjauan. Laporan ditutup sebagai "dihapus" dengan alasan "${contentReportReasonLabel(
        reason,
      )}".`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () => {
            void runAction(
              item.report.id,
              () => removeReportedContent(backend.client, item, reason),
              'Konten dihapus dan laporan ditutup. Tindakan ini tercatat di jejak audit.',
            );
          },
        },
      ],
    );
  }

  function handleDecision(item: ModerationQueueItem, status: ReviewStatus) {
    if (!backend.available || busyId) return;

    void runAction(
      item.report.id,
      () => reviewReport(backend.client, item.report.id, status),
      status === 'dismissed'
        ? 'Laporan diabaikan tanpa menghapus konten.'
        : 'Laporan ditandai sudah ditinjau tanpa menghapus konten.',
    );
  }

  const items = state.status === 'ready' ? state.items : [];
  // Label dari antrean dan audit digabung: pelaku di jejak audit bisa moderator
  // lain yang tidak muncul sebagai pelapor/penulis di antrean.
  const people: ModerationPeople = {
    ...(state.status === 'ready' ? state.people : {}),
    ...auditPeople,
  };

  return (
    <Screen scroll testID="moderation-screen">
      <ScreenHeader
        showBack
        overline="Moderasi"
        subtitle="Tinjau laporan penyalahgunaan atas laporan bahaya dan chat di perjalanan yang Anda pimpin atau klub yang Anda kelola."
        title="Laporan penyalahgunaan"
      />

      {backend.available ? null : <BackendUnavailableBanner reason={backend.reason} />}

      {notice ? (
        <Banner message={notice} testID="moderation-notice" title="Tersimpan" tone="success" />
      ) : null}

      {actionError ? (
        <Banner message={actionError.message} title="Aksi tidak selesai" tone="danger" />
      ) : null}

      {precondition ? (
        <EmptyState
          description={precondition.message}
          icon="lock-closed-outline"
          title="Dashboard moderasi belum bisa dibuka"
        />
      ) : null}

      {!precondition ? (
        <>
          <Card>
            <AppText variant="bodyStrong">Apa yang tercatat</AppText>
            <AppText tone="secondary" variant="callout">
              Setiap tindakan menyimpan pelaku, alasan laporan, dan waktu di server. Laporan tidak
              menghapus konten secara otomatis; penghapusan selalu tindakan terpisah.
            </AppText>
            <AppText tone="muted" variant="caption">
              Laporan bahaya tanpa perjalanan dan konten di luar perjalanan Anda tidak tampil di
              sini; jalurnya dashboard tepercaya.
            </AppText>
          </Card>

          <View style={styles.sectionHeader}>
            <AppText variant="bodyStrong">Menunggu tinjauan</AppText>
            {state.status === 'ready' ? (
              <Badge
                label={`${items.length} laporan`}
                tone={items.length > 0 ? 'warning' : 'neutral'}
              />
            ) : null}
          </View>

          {state.status === 'loading' ? <LoadingState label="Memuat laporan…" /> : null}

          {state.status === 'error' ? (
            <ErrorState
              description={state.error.message}
              onRetry={reload}
              title="Antrean gagal dimuat"
            />
          ) : null}

          {state.status === 'ready' && items.length === 0 ? (
            <EmptyState
              description="Belum ada laporan penyalahgunaan yang menunggu di perjalanan atau klub Anda. Laporan baru akan muncul di sini."
              icon="shield-checkmark-outline"
              testID="moderation-empty"
              title="Tidak ada laporan menunggu"
            />
          ) : null}

          {items.map((item) => (
            <QueueCard
              key={item.report.id}
              busy={busyId !== null}
              item={item}
              people={people}
              onDismiss={() => handleDecision(item, 'dismissed')}
              onRemove={() => handleRemove(item)}
              onReview={() => handleDecision(item, 'reviewed')}
            />
          ))}

          <View style={styles.sectionHeader}>
            <AppText variant="bodyStrong">Jejak aksi terakhir</AppText>
            <Button
              icon="refresh"
              label="Muat ulang"
              onPress={reload}
              testID="moderation-refresh"
              variant="ghost"
            />
          </View>

          <Card testID="moderation-audit">
            {auditError ? (
              <AppText tone="secondary" variant="callout">
                Jejak audit gagal dimuat: {auditError.message}
              </AppText>
            ) : audit.length === 0 ? (
              <AppText tone="muted" variant="callout">
                Belum ada tindakan moderasi yang tercatat untuk Anda.
              </AppText>
            ) : (
              audit.map((entry) => (
                <View
                  key={entry.id}
                  style={styles.auditRow}
                  testID={`moderation-audit-${entry.id}`}
                >
                  <View style={styles.auditTitle}>
                    <Badge
                      label={moderationActionLabel(entry.action)}
                      tone={entry.action === 'remove' ? 'danger' : 'neutral'}
                    />
                    <AppText tone="muted" variant="caption">
                      {formatDateTime(entry.created_at)}
                    </AppText>
                  </View>
                  <AppText tone="secondary" variant="callout">
                    {moderationTargetLabel(entry.target_type)} ·{' '}
                    {contentReportReasonLabel(entry.reason)} · oleh{' '}
                    {entry.actor_id === userId ? 'Anda' : reporterLabel(people, entry.actor_id)}
                  </AppText>
                  {entry.note ? (
                    <AppText tone="muted" variant="caption">
                      Catatan: {entry.note}
                    </AppText>
                  ) : null}
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  subject: {
    backgroundColor: colors.overlay.soft,
    borderRadius: 12,
    gap: spacing.sm,
    padding: spacing.md,
  },
  details: {
    gap: spacing.xs / 2,
  },
  actions: {
    gap: spacing.sm,
  },
  auditRow: {
    gap: spacing.xs,
  },
  auditTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
});
