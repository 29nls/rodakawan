/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo/android',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Polyfill expo-sqlite/localStorage/install membutuhkan modul native; di Jest
    // diganti shim yang menyediakan global localStorage, sehingga modul yang membaca
    // storage tetap dapat diimpor tanpa perangkat.
    '^expo-sqlite/localStorage/install$': '<rootDir>/src/test-support/sqliteLocalStorageShim.js',
  },
  // Mock bawaan jest-expo untuk `Image.getSize` hanya mendukung bentuk callback,
  // sedangkan kode membaca dimensi foto lewat bentuk Promise (didukung React Native).
  setupFiles: ['<rootDir>/src/test-support/imageSizeShim.js'],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts?(x)'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/**',
    '!src/test-support/**',
  ],
};
