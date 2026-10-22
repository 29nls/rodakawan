/**
 * Label kategori dan tingkat keparahan laporan bahaya.
 *
 * Satu sumber untuk UI (filter, kartu, formulir) dan untuk pengujian, supaya
 * nilai mentah database (`traffic_enforcement`) tidak pernah tampil ke pengguna.
 */

import type { BadgeTone } from '@/components/ui/Badge';
import type { HazardCategory, HazardSeverity } from '@/lib/supabase/database.types';

/**
 * Tipe kategori dan tingkat keparahan bukan definisi terpisah: keduanya berasal
 * dari `@/lib/supabase/database.types`, yang memakai union yang sama persis dengan
 * `CHECK` constraint di database. Modul ini hanya membuka labelnya.
 */
export type { HazardCategory, HazardSeverity };

export const HAZARD_CATEGORIES: readonly { value: HazardCategory; label: string }[] = [
  { value: 'pothole', label: 'Lubang jalan' },
  { value: 'crash', label: 'Kecelakaan' },
  { value: 'traffic', label: 'Kemacetan' },
  { value: 'weather', label: 'Cuaca buruk' },
  { value: 'flood', label: 'Banjir' },
  { value: 'road_block', label: 'Jalan terhalang' },
  { value: 'traffic_enforcement', label: 'Razia lalu lintas' },
  { value: 'other', label: 'Lainnya' },
];

export const HAZARD_SEVERITIES: readonly {
  value: HazardSeverity;
  label: string;
  tone: BadgeTone;
}[] = [
  { value: 'info', label: 'Info', tone: 'info' },
  { value: 'moderate', label: 'Sedang', tone: 'warning' },
  { value: 'high', label: 'Tinggi', tone: 'warning' },
  { value: 'critical', label: 'Kritis', tone: 'danger' },
];

export function hazardCategoryLabel(category: string): string {
  return HAZARD_CATEGORIES.find((item) => item.value === category)?.label ?? 'Lainnya';
}

export function hazardSeverityLabel(severity: string): string {
  return HAZARD_SEVERITIES.find((item) => item.value === severity)?.label ?? 'Tidak diketahui';
}

export function hazardSeverityTone(severity: string): BadgeTone {
  return HAZARD_SEVERITIES.find((item) => item.value === severity)?.tone ?? 'neutral';
}
