/**
 * Konfigurasi Babel standar Expo.
 *
 * Metro (development & build) memakai babel-preset-expo apa adanya, termasuk plugin
 * `react-native-worklets/plugin` yang dibutuhkan Reanimated 4.
 *
 * Pada lingkungan test (Jest) plugin itu dimatikan: plugin tersebut menyuntikkan
 * pemeriksaan `require('react-native-reanimated').getUseOfValueInStyleWarning(...)`
 * ke setiap style, sementara Jest memakai mock Reanimated tanpa native worklets.
 * Di perangkat, plugin tetap aktif sehingga perilaku runtime tidak berubah.
 */
module.exports = function babelConfig(api) {
  // Cache per lingkungan agar konfigurasi test tidak tercampur dengan build Metro.
  api.cache.using(() => process.env.NODE_ENV);

  const isTest = api.env('test');

  return {
    presets: [['babel-preset-expo', isTest ? { worklets: false, reanimated: false } : {}]],
  };
};
