import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { spacing } from '@/constants/theme';

const SUPPORT_URL = 'https://github.com/29nls/rodakawan/issues';

/**
 * Kebijakan privasi versi aplikasi.
 *
 * Ditulis sebagai halaman statis (tanpa backend) supaya tetap bisa dibaca saat
 * offline dan tidak bergantung pada sesi. Isinya harus cocok dengan yang benar-
 * benar disimpan: lihat `docs/SECURITY_PRIVACY.md` dan ERD. Bila skema berubah,
 * halaman ini ikut berubah — bukan sebaliknya.
 *
 * Layar ini sengaja tidak punya state: teks kebijakan selalu tampil, termasuk
 * saat backend belum dikonfigurasi atau pengguna belum masuk — justru di situ
 * kebijakan ini paling perlu terbaca.
 */
export default function PrivacyScreen() {
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
