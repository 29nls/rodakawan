import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/components/ui/Icon';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { colors, radii, spacing } from '@/constants/theme';

export type PhotoCardProps = {
  title: string;
  subtitle: string;
  hint: string;
  photoUrl: string | null;
  /**
   * `true` bila baris memang menyimpan path foto, walaupun signed URL gagal dimuat.
   * Tombol hapus harus tetap tersedia supaya foto tidak "hilang" dari UI hanya
   * karena pratinjau gagal dimuat. Default: ada bila `photoUrl` ada.
   */
  hasPhoto?: boolean;
  emptyText: string;
  pickLabel: string;
  busy: boolean;
  onPick: () => void;
  onRemove: () => void;
  testID?: string;
};

/**
 * Kartu foto bersama untuk kendaraan dan logo klub.
 *
 * Foto hanya dirender dari signed URL yang didapat pemanggil; komponen ini tidak
 * pernah membentuk URL publik sendiri. Tombol hapus baru muncul bila memang ada
 * foto, sehingga tidak ada aksi yang tampak berfungsi padahal tidak punya target.
 */
export function PhotoCard({
  title,
  subtitle,
  hint,
  photoUrl,
  hasPhoto,
  emptyText,
  pickLabel,
  busy,
  onPick,
  onRemove,
  testID,
}: PhotoCardProps) {
  const photoExists = hasPhoto ?? photoUrl !== null;

  return (
    <Card>
      <SectionHeader subtitle={subtitle} title={title} />
      <Divider />

      {photoUrl ? (
        <Image
          accessibilityLabel={title}
          resizeMode="cover"
          source={{ uri: photoUrl }}
          style={styles.image}
        />
      ) : (
        <View style={styles.placeholder}>
          <Icon name="image-outline" size={28} color={colors.text.muted} />
          <AppText align="center" tone="muted" variant="caption">
            {photoExists
              ? 'Foto tersimpan, tetapi pratinjau tidak dapat dimuat. Muat ulang halaman untuk mencoba lagi; foto tetap bisa diganti atau dihapus dari sini.'
              : emptyText}
          </AppText>
        </View>
      )}

      <View style={styles.actions}>
        <Button
          accessibilityHint="Membuka galeri untuk memilih foto pengganti."
          disabled={busy}
          icon="images-outline"
          label={busy ? 'Memproses…' : pickLabel}
          onPress={onPick}
          testID={testID ? `${testID}-pick` : undefined}
          variant={photoExists ? 'secondary' : 'primary'}
        />
        {photoExists ? (
          <Button
            accessibilityHint="Menghapus foto ini dari penyimpanan privat. Tindakan ini tidak bisa dibatalkan."
            disabled={busy}
            icon="trash-outline"
            label="Hapus foto"
            onPress={onRemove}
            testID={testID ? `${testID}-remove` : undefined}
            variant="ghost"
          />
        ) : null}
      </View>

      <AppText tone="muted" variant="caption">
        {hint}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.overlay.soft,
    borderRadius: radii.md,
    height: 200,
    width: '100%',
  },
  placeholder: {
    alignItems: 'center',
    backgroundColor: colors.overlay.soft,
    borderColor: colors.border.subtle,
    borderRadius: radii.md,
    borderStyle: 'dashed',
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
