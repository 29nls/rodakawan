import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, typography } from '@/constants/theme';

const SAMPLE_TEXT = 'Konvoi malam ke titik kumpul';

type SpecimenRow = {
  variant: keyof typeof typography;
  description: string;
};

const specimens: readonly SpecimenRow[] = [
  { variant: 'display', description: 'Judul utama layar' },
  { variant: 'titleLg', description: 'Judul halaman' },
  { variant: 'title', description: 'Judul kartu' },
  { variant: 'subtitle', description: 'Subjudul bagian' },
  { variant: 'body', description: 'Teks isi' },
  { variant: 'bodyStrong', description: 'Teks isi tebal' },
  { variant: 'callout', description: 'Keterangan' },
  { variant: 'label', description: 'Label tombol' },
  { variant: 'caption', description: 'Catatan kecil' },
  { variant: 'overline', description: 'Label di atas judul' },
];

export function TypeSpecimen({ rows = specimens }: { rows?: readonly SpecimenRow[] }) {
  return (
    <View style={styles.list}>
      {rows.map((row) => {
        const token = typography[row.variant];

        return (
          <View key={row.variant} style={styles.row}>
            <AppText variant="caption" tone="muted">
              {row.variant} · {token.fontSize}/{token.lineHeight} · {token.fontWeight}
            </AppText>
            <AppText
              variant={row.variant}
              style={row.variant === 'overline' ? styles.uppercase : undefined}
            >
              {SAMPLE_TEXT}
            </AppText>
            <AppText variant="caption" tone="muted">
              {row.description}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 20,
  },
  row: {
    borderBottomColor: colors.border.subtle,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    gap: 6,
    paddingBottom: 14,
  },
  uppercase: {
    textTransform: 'uppercase',
  },
});
