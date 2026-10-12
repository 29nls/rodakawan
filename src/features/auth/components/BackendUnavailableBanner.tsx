import { Banner } from '@/components/ui/Banner';
import { describeUnavailableReason, type SupabaseUnavailableReason } from '@/lib/supabase/client';

export type BackendUnavailableBannerProps = {
  reason: SupabaseUnavailableReason;
};

/**
 * Ditampilkan ketika Supabase belum dikonfigurasi atau konfigurasinya tidak aman.
 * Form tetap dirender tetapi tombol kirim dinonaktifkan supaya tidak ada aksi
 * yang terlihat berfungsi padahal tidak bisa berhasil (aturan 9 AI_CODING_AGENT_PROMPT).
 */
export function BackendUnavailableBanner({ reason }: BackendUnavailableBannerProps) {
  return (
    <Banner
      action="Langkah: salin .env.example menjadi .env.local, isi kredensial project Supabase development, lalu jalankan ulang aplikasi (docs/SETUP_GUIDE.md bagian 4)."
      message={describeUnavailableReason(reason)}
      testID="backend-unavailable-banner"
      title="Backend belum siap"
      tone="danger"
    />
  );
}
