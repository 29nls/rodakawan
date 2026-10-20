/**
 * Panel chat konvoi untuk layar detail perjalanan.
 *
 * Batas tanggung jawab:
 * - komponen ini tidak menentukan otorisasi. Database yang memutuskan siapa
 *   boleh membaca/menulis (`chat_select_ride_member`, RPC `send_chat_message`);
 *   panel hanya menampilkan penolakan itu sebagai pesan yang bisa ditindaklanjuti;
 * - pesan baru tampil sebagai "Mengirim…" sampai server mengembalikan barisnya.
 *   Label "Terkirim" hanya diberikan pada pesan yang sudah dikonfirmasi server;
 * - pengiriman ulang memakai `clientMessageId` yang sama, jadi tombol "Kirim
 *   ulang" tidak pernah menggandakan pesan;
 * - pesan dari pengguna yang diblokir tidak pernah sampai ke panel ini: policy
 *   `chat_select_ride_member` menyaringnya di server (ADR-068), jadi tidak ada
 *   daftar blokir maupun penyembunyian isi di klien.
 */

import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateView';
import { TextField } from '@/components/ui/TextField';
import { colors, radii, spacing } from '@/constants/theme';
import type { AppError } from '@/features/auth/errors';
import {
  canEditChatMessage,
  chatAcceptsNewMessages,
  deleteChatMessage,
  editChatMessage,
  getChatMessages,
  MAX_CHAT_CONTENT_LENGTH,
  mergeChatMessages,
  reportChatMessage,
  sendChatMessage,
  subscribeChatMessages,
  validateChatContent,
  type ChatClient,
  type ChatMessage,
} from '@/features/chat/api';
import { CONTENT_REPORT_REASONS, type ContentReportReason } from '@/features/moderation/api';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

type PendingMessage = {
  clientMessageId: string;
  content: string;
  state: 'sending' | 'failed';
  createdAt: string;
};

type ConnectionState = 'connecting' | 'online' | 'offline';

export type ChatPanelProps = {
  client: ChatClient;
  rideId: string;
  userId: string;
  rideStatus: string;
  /** Anggota `joined` (peserta aktif) — satu-satunya pihak yang boleh chat. */
  isActiveMember: boolean;
  /** Nama tampilan per `user_id`; dipakai untuk label pengirim. */
  senderNames: Record<string, string>;
  /** Hanya untuk pengujian: sumber idempotensi dan jam yang deterministik. */
  createClientId?: () => string;
  now?: () => number;
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

export function ChatPanel({
  client,
  rideId,
  userId,
  rideStatus,
  isActiveMember,
  senderNames,
  createClientId = () => Crypto.randomUUID(),
  now = Date.now,
}: ChatPanelProps) {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<AppError | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [reporting, setReporting] = useState<{
    id: string;
    reason: ContentReportReason;
    details: string;
  } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Menandai apakah channel pernah tersambung, supaya reconnect memuat ulang
  // halaman terakhir dan tidak membiarkan celah pesan selama koneksi putus.
  const everConnected = useRef(false);
  const loadLatestRef = useRef<() => Promise<void>>(async () => undefined);

  const canWrite = isActiveMember && chatAcceptsNewMessages(rideStatus);
  const trimmedLength = draft.trim().length;

  const loadLatest = useCallback(async () => {
    const result = await getChatMessages(client, rideId);
    if (!result.ok) {
      setError(result.error);
      setStatus('error');
      return;
    }

    setError(null);
    setHasMore(result.data.hasMore);
    setMessages((previous) => mergeChatMessages(previous, result.data.messages));
    setStatus('ready');
  }, [client, rideId]);

  // Ref diperbarui di effect, bukan saat render, supaya callback realtime selalu
  // memakai `loadLatest` terbaru tanpa melanggar aturan React Compiler.
  useEffect(() => {
    loadLatestRef.current = loadLatest;
  }, [loadLatest]);

  useEffect(() => {
    if (!client || !isActiveMember) return;

    let active = true;

    void (async () => {
      const result = await getChatMessages(client, rideId);
      if (!active) return;

      if (!result.ok) {
        setError(result.error);
        setStatus('error');
        return;
      }

      setMessages((previous) => mergeChatMessages(previous, result.data.messages));
      setHasMore(result.data.hasMore);
      setStatus('ready');
    })();

    return () => {
      active = false;
    };
  }, [client, isActiveMember, reloadToken, rideId]);

  useEffect(() => {
    if (!client || !isActiveMember || status !== 'ready') return;

    const subscription = subscribeChatMessages(client, rideId, {
      onInsert: (row) => setMessages((previous) => mergeChatMessages(previous, [row])),
      onUpdate: (row) => setMessages((previous) => mergeChatMessages(previous, [row])),
      onDelete: (messageId) =>
        setMessages((previous) => previous.filter((message) => message.id !== messageId)),
      onStatus: (next) => {
        if (next === 'SUBSCRIBED') {
          const reconnected = everConnected.current;
          everConnected.current = true;
          setConnection('online');
          // Reconnect: muat halaman terbaru lalu gabungkan (dedupe per id).
          if (reconnected) void loadLatestRef.current();
          return;
        }

        if (next === 'CHANNEL_ERROR' || next === 'TIMED_OUT' || next === 'CLOSED') {
          setConnection('offline');
        }
      },
    });

    return () => subscription.unsubscribe();
  }, [client, isActiveMember, rideId, status]);

  const handleLoadOlder = async () => {
    if (messages.length === 0 || loadingOlder) return;

    setLoadingOlder(true);
    const oldest = messages[0];
    const result = await getChatMessages(client, rideId, {
      before: { id: oldest.id, created_at: oldest.created_at },
    });
    setLoadingOlder(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setActionError(null);
    setHasMore(result.data.hasMore);
    setMessages((previous) => mergeChatMessages(previous, result.data.messages));
  };

  const deliver = useCallback(
    async (clientMessageId: string, content: string) => {
      const result = await sendChatMessage(client, { rideId, content, clientMessageId });

      if (!result.ok) {
        setPending((previous) =>
          previous.map((item) =>
            item.clientMessageId === clientMessageId ? { ...item, state: 'failed' } : item,
          ),
        );
        setActionError(result.error);
        return false;
      }

      setPending((previous) => previous.filter((item) => item.clientMessageId !== clientMessageId));
      setMessages((previous) => mergeChatMessages(previous, [result.data]));
      setActionError(null);
      return true;
    },
    [client, rideId],
  );

  const handleSend = async () => {
    const validated = validateChatContent(draft);
    if (!validated.ok) {
      setActionError(validated.error);
      return;
    }

    const clientMessageId = createClientId();
    const content = validated.data;

    setActionError(null);
    setNotice(null);
    setSending(true);
    setPending((previous) => [
      ...previous,
      { clientMessageId, content, state: 'sending', createdAt: new Date(now()).toISOString() },
    ]);
    setDraft('');

    await deliver(clientMessageId, content);
    setSending(false);
  };

  const handleRetry = async (item: PendingMessage) => {
    setPending((previous) =>
      previous.map((entry) =>
        entry.clientMessageId === item.clientMessageId ? { ...entry, state: 'sending' } : entry,
      ),
    );
    await deliver(item.clientMessageId, item.content);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;

    const validated = validateChatContent(editing.draft);
    if (!validated.ok) {
      setActionError(validated.error);
      return;
    }

    const result = await editChatMessage(client, {
      messageId: editing.id,
      content: validated.data,
    });

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setActionError(null);
    setEditing(null);
    setMessages((previous) => mergeChatMessages(previous, [result.data]));
  };

  const handleDelete = (message: ChatMessage) => {
    Alert.alert(
      'Hapus pesan ini?',
      'Pesan akan ditandai terhapus untuk semua peserta. Tindakan ini tidak bisa dibatalkan.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await deleteChatMessage(client, message.id);
              if (!result.ok) {
                setActionError(result.error);
                return;
              }
              setActionError(null);
              setNotice('Pesan dihapus.');
              setMessages((previous) => mergeChatMessages(previous, [result.data]));
            })();
          },
        },
      ],
    );
  };

  const handleReport = async () => {
    if (!reporting) return;

    setReportBusy(true);
    const result = await reportChatMessage(
      client,
      reporting.id,
      reporting.reason,
      reporting.details.trim() || undefined,
    );
    setReportBusy(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setActionError(null);
    setReporting(null);
    setNotice('Laporan terkirim ke peninjau. Konten tidak dihapus otomatis.');
  };

  const visibleMessages = useMemo(
    () => messages.filter((message) => !message.deleted || message.sender_id === userId),
    [messages, userId],
  );

  if (!isActiveMember) {
    return (
      <Card>
        <SectionHeader
          subtitle="Chat hanya untuk peserta aktif perjalanan ini."
          title="Chat konvoi"
        />
        <EmptyState
          description="Bergabunglah ke perjalanan (status peserta “Bergabung”) untuk membaca dan mengirim pesan. Peserta yang keluar atau dikeluarkan kehilangan akses baca."
          icon="lock-closed-outline"
          title="Chat terkunci untuk non-peserta"
        />
      </Card>
    );
  }

  return (
    <Card>
      <SectionHeader
        subtitle="Obrolan peserta aktif. Pesan disimpan di server dan hanya bisa dibaca peserta perjalanan."
        title="Chat konvoi"
      />

      <View style={styles.statusRow}>
        <Badge
          label={
            connection === 'online'
              ? 'Tersambung'
              : connection === 'offline'
                ? 'Koneksi terputus'
                : 'Menyambung…'
          }
          tone={
            connection === 'online' ? 'success' : connection === 'offline' ? 'warning' : 'neutral'
          }
        />
        {canWrite ? null : <Badge label="Hanya baca" tone="neutral" />}
      </View>

      {connection === 'offline' ? (
        <Banner
          message="Pembaruan realtime terputus. Pesan yang Anda kirim tetap dicoba ke server; muat ulang untuk menyusul pesan terbaru."
          title="Menyambung ulang"
          tone="warning"
        />
      ) : null}

      {!canWrite ? (
        <AppText tone="secondary" variant="callout">
          Perjalanan ini sudah selesai atau dibatalkan, jadi pesan baru tidak dapat dikirim. Riwayat
          tetap bisa dibaca.
        </AppText>
      ) : null}

      {notice ? <Banner message={notice} title="Berhasil" tone="success" /> : null}
      {actionError ? (
        <Banner message={actionError.message} title="Aksi tidak selesai" tone="danger" />
      ) : null}

      {status === 'loading' ? <LoadingState label="Memuat pesan konvoi…" /> : null}

      {status === 'error' && error ? (
        <ErrorState
          description={error.message}
          onRetry={() => {
            setStatus('loading');
            setReloadToken((token) => token + 1);
          }}
          title="Chat gagal dimuat"
        />
      ) : null}

      {status === 'ready' && hasMore ? (
        <Button
          disabled={loadingOlder}
          icon="time-outline"
          label={loadingOlder ? 'Memuat pesan lama…' : 'Muat pesan lama'}
          onPress={handleLoadOlder}
          variant="secondary"
        />
      ) : null}

      {status === 'ready' && visibleMessages.length === 0 && pending.length === 0 ? (
        <EmptyState
          description="Belum ada pesan di perjalanan ini. Sapa peserta lain untuk memulai koordinasi."
          icon="chatbubbles-outline"
          title="Belum ada pesan"
        />
      ) : null}

      {visibleMessages.map((message) => {
        if (message.message_type === 'system') {
          return (
            <View key={message.id} style={styles.systemRow}>
              <AppText align="center" tone="muted" variant="caption">
                {message.content} · {formatTime(message.created_at)}
              </AppText>
            </View>
          );
        }

        const mine = message.sender_id === userId;
        const editable = canEditChatMessage(message, userId, now());
        const name = mine ? 'Anda' : (senderNames[message.sender_id] ?? 'Peserta');

        return (
          <View key={message.id} style={[styles.message, mine ? styles.messageMine : null]}>
            <AppText tone={mine ? 'accent' : 'secondary'} variant="caption">
              {name} · {formatTime(message.created_at)}
              {message.edited_at ? ' · diubah' : ''}
              {mine && !message.deleted ? ' · terkirim' : ''}
            </AppText>

            {message.deleted ? (
              <AppText tone="muted" variant="callout">
                Pesan ini dihapus oleh pengirim.
              </AppText>
            ) : editing?.id === message.id ? (
              <View style={styles.editBox}>
                <TextField
                  label="Ubah pesan"
                  multiline
                  value={editing.draft}
                  onChangeText={(text) => setEditing({ id: message.id, draft: text })}
                />
                <View style={styles.inlineActions}>
                  <Button label="Simpan" onPress={handleSaveEdit} variant="primary" />
                  <Button label="Batal" onPress={() => setEditing(null)} variant="secondary" />
                </View>
              </View>
            ) : (
              <AppText variant="body">{message.content}</AppText>
            )}

            {editing?.id === message.id ? null : (
              <View style={styles.inlineActions}>
                {editable ? (
                  <>
                    <Button
                      label="Ubah"
                      onPress={() => setEditing({ id: message.id, draft: message.content })}
                      variant="ghost"
                    />
                    <Button label="Hapus" onPress={() => handleDelete(message)} variant="ghost" />
                  </>
                ) : null}
                {mine ? null : (
                  <Button
                    label="Laporkan"
                    onPress={() => setReporting({ id: message.id, reason: 'spam', details: '' })}
                    variant="ghost"
                  />
                )}
              </View>
            )}

            {reporting?.id === message.id ? (
              <View style={styles.reportBox}>
                <AppText variant="label">Alasan laporan</AppText>
                <View style={styles.pillGroup}>
                  {CONTENT_REPORT_REASONS.map((reason) => (
                    <Button
                      key={reason.value}
                      label={reason.label}
                      onPress={() => setReporting({ ...reporting, reason: reason.value })}
                      variant={reporting.reason === reason.value ? 'primary' : 'secondary'}
                    />
                  ))}
                </View>
                <TextField
                  label="Rincian (opsional)"
                  multiline
                  value={reporting.details}
                  onChangeText={(text) => setReporting({ ...reporting, details: text })}
                />
                <View style={styles.inlineActions}>
                  <Button
                    disabled={reportBusy}
                    label={reportBusy ? 'Mengirim…' : 'Kirim laporan'}
                    onPress={handleReport}
                    variant="primary"
                  />
                  <Button label="Batal" onPress={() => setReporting(null)} variant="secondary" />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}

      {pending.map((item) => (
        <View key={item.clientMessageId} style={[styles.message, styles.messageMine]}>
          <AppText tone="muted" variant="caption">
            {item.state === 'sending' ? 'Mengirim…' : 'Belum terkirim'}
          </AppText>
          <AppText variant="body">{item.content}</AppText>
          {item.state === 'failed' ? (
            <View style={styles.inlineActions}>
              <Button
                icon="refresh"
                label="Kirim ulang"
                onPress={() => handleRetry(item)}
                variant="secondary"
              />
            </View>
          ) : null}
        </View>
      ))}

      <TextField
        editable={canWrite && !sending}
        helper={
          canWrite
            ? `${trimmedLength}/${MAX_CHAT_CONTENT_LENGTH} karakter`
            : 'Perjalanan sudah selesai, pesan baru dinonaktifkan.'
        }
        label="Pesan baru"
        multiline
        placeholder="Tulis pesan untuk konvoi…"
        value={draft}
        onChangeText={setDraft}
      />

      <Button
        disabled={!canWrite || sending || trimmedLength === 0}
        icon="send-outline"
        label={sending ? 'Mengirim…' : 'Kirim'}
        onPress={handleSend}
        variant="primary"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  editBox: {
    gap: spacing.sm,
  },
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  message: {
    backgroundColor: colors.background.elevated,
    borderColor: colors.border.subtle,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing.xs,
    padding: spacing.md,
  },
  messageMine: {
    borderColor: colors.border.accent,
  },
  pillGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  reportBox: {
    backgroundColor: colors.background.raised,
    borderRadius: radii.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  systemRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
