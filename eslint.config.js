const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    ignores: [
      'dist/*',
      '.expo/*',
      'android/*',
      'ios/*',
      'node_modules/*',
      // Edge Function Deno: global/import Deno tidak dikenali konfigurasi Expo.
      'supabase/functions/*',
      // Hasil `supabase gen types`: bentuknya ditentukan CLI, bukan aturan lint repo.
      'src/lib/supabase/database.generated.ts',
    ],
  },
]);
