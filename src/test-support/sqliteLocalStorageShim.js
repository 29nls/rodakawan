/**
 * Shim untuk Jest: meniru `localStorage` yang biasanya disediakan
 * `expo-sqlite/localStorage/install` (butuh modul native di perangkat).
 *
 * Hanya dipakai selama pengujian (lihat moduleNameMapper di jest.config.js).
 * Implementasi sengaja sederhana: Map + API web storage standar.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();

  const localStorageShim = {
    getItem(key) {
      const normalized = String(key);
      return store.has(normalized) ? store.get(normalized) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
    key(index) {
      const keys = Array.from(store.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    get length() {
      return store.size;
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageShim,
    configurable: true,
    writable: true,
  });
}
