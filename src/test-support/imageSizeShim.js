/**
 * Shim untuk Jest: `Image.getSize` bentuk Promise.
 *
 * Mock bawaan jest-expo hanya mendukung bentuk callback
 * (`getSize: jest.fn((uri, success) => ... success(320, 240))`), sehingga
 * pemanggilan `Image.getSize(uri)` tanpa callback — bentuk yang dipakai
 * `src/features/media/imageCompression.ts` untuk membaca dimensi foto sebelum
 * diperkecil — melempar "success is not a function" dan menggagalkan seluruh suite.
 *
 * React Native 0.86 mendukung kedua bentuk (Libraries/Image/Image.ios.js
 * mengembalikan Promise bila callback tidak diberikan), jadi shim ini meniru
 * perilaku aslinya: Promise untuk pemanggilan tanpa callback, callback untuk
 * pemanggilan lama. Hanya dipakai selama pengujian (lihat `setupFiles` di
 * jest.config.js).
 *
 * Ukuran default 1200×900 dipilih agar berada di bawah batas perkecil foto
 * kendaraan (1600 px): test yang tidak peduli kompresi tetap mengunggah berkas
 * aslinya, dan test yang peduli dapat menimpanya dengan `jest.spyOn`.
 */
const { Image } = require('react-native');

const DEFAULT_DIMENSIONS = { width: 1200, height: 900 };

Image.getSize = function getSize(uri, success, failure) {
  const promise = Promise.resolve(DEFAULT_DIMENSIONS);

  if (typeof success !== 'function') return promise;

  promise.then((size) => success(size.width, size.height)).catch(failure ?? (() => {}));
  return undefined;
};

/**
 * `getSizeWithHeaders` punya bentuk tambahan `headers`; dipakai agar import yang
 * tidak terduga tidak kembali ke mock bawaan yang hanya callback.
 */
Image.getSizeWithHeaders = function getSizeWithHeaders(uri, headers, success, failure) {
  return Image.getSize(uri, success, failure);
};
