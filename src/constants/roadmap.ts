/**
 * Data roadmap yang dipakai UI (Ringkasan & layar Fondasi).
 * Sumber: docs/ROADMAP.md — ringkas, jangan menambah klaim yang belum ada di dokumen.
 */
export type MilestonePhase = 'P0' | 'P1' | 'P2';

export type MilestoneStatus = 'pondasi' | 'tersedia' | 'berikutnya' | 'rencana';

export type Milestone = {
  /** ID milestone, mis. "M0". */
  id: string;
  title: string;
  summary: string;
  phase: MilestonePhase;
  status: MilestoneStatus;
};

export const milestoneStatusLabels: Record<MilestoneStatus, string> = {
  pondasi: 'Fondasi tersedia',
  tersedia: 'Tersedia',
  berikutnya: 'Berikutnya',
  rencana: 'Direncanakan',
};

export const milestones: readonly Milestone[] = [
  {
    id: 'M0',
    title: 'Fondasi proyek',
    summary: 'Struktur Expo + Expo Router, design system, konfigurasi build, dan halaman awal.',
    phase: 'P0',
    status: 'pondasi',
  },
  {
    id: 'M1',
    title: 'Auth, profil, privasi dasar',
    summary: 'Daftar/masuk, profil, username unik, dan pengaturan sesi.',
    phase: 'P0',
    status: 'tersedia',
  },
  {
    id: 'M2',
    title: 'Garasi dan klub',
    summary: 'Kendaraan, klub, permintaan bergabung, peran anggota, dan storage foto.',
    phase: 'P0',
    status: 'tersedia',
  },
  {
    id: 'M3',
    title: 'Perjalanan dan live location',
    summary: 'Buat/gabung perjalanan, berbagi lokasi opt-in, dan peta konvoi.',
    phase: 'P0',
    status: 'tersedia',
  },
  {
    id: 'M4',
    title: 'Laporan jalan dan convoy chat',
    summary: 'Laporan bahaya dengan masa berlaku, chat perjalanan, dan sistem pesan sistem.',
    phase: 'P0',
    status: 'berikutnya',
  },
  {
    id: 'M5',
    title: 'Push, polish, dan beta',
    summary: 'Notifikasi, state lengkap, uji perangkat, dan checklist rilis.',
    phase: 'P0',
    status: 'rencana',
  },
  {
    id: 'M6',
    title: 'Feed dan komunitas sosial',
    summary: 'Post, like, komentar, follow, dan moderasi.',
    phase: 'P1',
    status: 'rencana',
  },
  {
    id: 'M7',
    title: 'Voice PTT (proof-of-concept)',
    summary: 'Voice room WebRTC dengan token dari backend dan uji headset.',
    phase: 'P2',
    status: 'rencana',
  },
  {
    id: 'M8',
    title: 'Musik lokal dan penyempurnaan',
    summary: 'Pemutar file lokal dengan audio focus dan uji transisi audio.',
    phase: 'P2',
    status: 'rencana',
  },
];
