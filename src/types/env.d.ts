/**
 * Variabel lingkungan publik yang boleh dibaca aplikasi.
 * Hanya variabel berprefix EXPO_PUBLIC_ yang tersedia di bundle aplikasi.
 * Lihat `.env.example` untuk dokumentasi nilainya.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
    EXPO_PUBLIC_MAP_STYLE_URL?: string;
  }
}
