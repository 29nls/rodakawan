import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { colors } from '@/constants/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export type IconProps = {
  name: IconName;
  size?: number;
  /** ColorValue agar kompatibel dengan warna bawaan react-navigation. */
  color?: ColorValue;
};

/**
 * Ikon tunggal dari Ionicons. Ikon tidak pernah menjadi satu-satunya penanda status:
 * selalu dipasangkan dengan label teks (docs/UX_SITEMAP.md bagian 6).
 */
export function Icon({ name, size = 20, color = colors.text.secondary }: IconProps) {
  return <Ionicons name={name} size={size} color={color} />;
}
