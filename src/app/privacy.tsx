import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { spacing } from '@/constants/theme';
import { useSupabaseState, classifyScreenState, getEmptyStateText, formatErrorMessage } from '@/features/state-helper';
import { useAuthSession } from '@/features/auth/session';
import { useProfile } from '@/features/profile/useProfile';
const SUPPORT_URL = 'https://github.com/29nls/rodakawan/issues';

/**
 * Kebijakan privasi versi aplikasi.
 *
 * Ditulis sebagai halaman statis (tanpa backend) supaya tetap bisa dibaca saat
 * offline dan tidak bergantung pada sesi. Isinya harus cocok dengan yang benar-
 * benar disimpan: lihat `docs/SECURITY_PRIVACY.md` dan ERD. Bila skema berubah,
 * halaman ini ikut berubah — bukan sebaliknya.
 */
export default function PrivacyScreen() {
  const { backend } = useAuthSession();
  const { state } = useProfile();
  const supabaseAvailable = backend?.available ?? false;

  // Klasifikasi state layar berdasarkan status Supabase
  const { status, showEmpty, showError } = classifyScreenState(
    supabaseAvailable,
    state.status ?? null,
    0,
  );

  // Jika error, dapatkan pesan yang konsisten
  const errorMessage = showError ? formatErrorMessage(state.error) : undefined;

  return (
    <Screen
      header={<ScreenHeader showBack title="Kebijakan privasi" />}
      scroll
      testID="privacy-screen"
    >
      <Card>
        <SectionHeader
          subtitle="Ringkasan Bahasa Indonesia; diperbarui 23 Oktober 2026."
          title="Data yang disimpan"
        />
        {status === 'loading' ? (
            <AppText variant="callout">
              • Sedang memuat konfigurasi dan data privasi...\n  </AppText>
          ) : null}

          {status === 'ready' && showEmpty ? (
            <AppText variant="callout">
              • {getEmptyStateText('profile')}\n  </AppText>
          ) : null}

          {status === 'error' && !showEmpty ? (
            <AppText variant="callout">
              • {errorMessage ?? 'Terjadi kesalahan. Coba lagi.'}\n  </AppText>
          ) : null}

          {status === 'ready' && !showEmpty ? (
            <View style={styles.list}>
              <AppText variant="callout">
                • Akun: email (dikelola Supabase Auth), username, nama tampilan, bio, kota, dan foto
                profil privat.
              </AppText>
              <AppText variant="callout">
                • Kendaraan: merek, model, tahun, foto, serta nomor polisi dan catatan privat yang hanya
                dapat dibaca pemilik.
              </AppText>
              <AppText variant="callout">
                • Perjalanan: keanggotaan, posisi terakhir selama Anda mengaktifkan berbagi lokasi,
                pesan konvoi, dan laporan bahaya yang Anda kirim.
              </AppText>
              <AppText variant="callout">
                • Perangkat: token notifikasi bila fitur notifikasi diaktifkan. Aplikasi tidak menyimpan
                lokasi presisi di log.
              </AppText>
            </View>
          ) : null}
        </View>
      </Card>

      <Card>
        <SectionHeader
          subtitle="Berapa lama data disimpan dan apa yang tidak dibagikan."
          title="Retensi"
        />
        <View style={styles.list}>
          <AppText variant="callout">
            • Posisi terakhir dihapus saat Anda berhenti berbagi lokasi atau keluar dari perjalanan.
          </AppText>
          <AppText variant="callout">
            • Pesan konvoi dan laporan bahaya disimpan selama perjalanan/komunitas membutuhkannya,
            termasuk untuk keselamatan peserta lain.
          </AppText>
          <AppText variant="callout">
            • Setelah akun dihapus, identitas login, profil, dan data pribadi dihapus. Laporan
            bahaya dan audit moderasi tetap ada tanpa identitas Anda; pesan konvoi serta
            postingan/komentar diredaksi dan diatribusikan ke “Akun dihapus”.
          </AppText>
          <AppText variant="callout">
            • Data tidak dijual dan tidak dipakai untuk iklan. Layanan pihak ketiga hanya Supabase
            (autentikasi, database, penyimpanan) dan penyedia push bila diaktifkan.
          </AppText>
        </View>
      </Card>

      <Card>
        <SectionHeader subtitle="Cara meminta penjelasan atau penghapusan." title="Kontak" />
        <AppText variant="callout">
          Pertanyaan privasi, permintaan ekspor, atau laporan penyalahgunaan dapat dikirim lewat
          halaman dukungan:
        </AppText>
        <AppText
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(SUPPORT_URL);
          }}
          tone="accent"
          variant="callout"
        >
          {SUPPORT_URL}
        </AppText>
        <AppText tone="muted" variant="caption">
          Anda juga dapat menghapus akun sendiri dari Profil → Hapus akun. Proses dijalankan di
          server dan baru dinyatakan berhasil setelah seluruh langkah selesai; bila gagal di tengah
          jalan, permintaan dapat diulang tanpa menghapus data dua kali.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
});
