/**
 * Polyfill runtime kripto untuk Hermes.
 *
 * Alasan keberadaan file ini (diverifikasi langsung dari paket yang terpasang):
 * - React Native 0.86 + Hermes tidak menyediakan `crypto`, `TextEncoder`, maupun
 *   `btoa`/`atob`.
 * - Expo SDK 57 (runtime "winter") menyediakan `URL`, `URLSearchParams`,
 *   `TextDecoder`, `DOMException`, `structuredClone`, dan `fetch` — tetapi tidak
 *   menyediakan `TextEncoder`, `crypto`, atau `btoa`.
 * - `@supabase/auth-js` memakai `crypto.getRandomValues` (verifier PKCE),
 *   `crypto.subtle.digest('SHA-256')` + `TextEncoder` (challenge PKCE), dan `btoa`.
 *   Tanpa polyfill, auth-js menurunkan metode challenge PKCE menjadi `plain` dan
 *   memakai Math.random untuk verifier — pelemahan keamanan yang tidak perlu.
 *
 * Aturan pemasangan:
 * - Setiap global hanya dipasang jika belum ada, jadi polyfill aman dipanggil
 *   berkali-kali dan tidak menimpa implementasi asli (web/Node saat pengujian).
 * - Primitif kripto disuntikkan (`WebCryptoPrimitives`) agar bisa diuji tanpa
 *   bergantung pada modul native.
 */

import * as ExpoCrypto from 'expo-crypto';

export type TypedArrayInput = Uint8Array | Uint32Array;

export type TextEncoderLike = {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
};

export type WebCryptoPrimitives = {
  /** Mengisi typed array dengan byte acak dari sumber acak platform. */
  fillRandom: (array: TypedArrayInput) => void;
  /** SHA-256 dari byte yang diberikan. */
  digestSha256: (data: Uint8Array) => Promise<ArrayBuffer>;
  /** Kelas yang dipasang sebagai global `TextEncoder`. */
  TextEncoderImpl: new () => TextEncoderLike;
};

/** Cakupan global yang boleh dipasangi polyfill. */
export type GlobalScope = {
  crypto?: {
    getRandomValues?: (array: TypedArrayInput) => TypedArrayInput;
    subtle?: { digest?: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer> };
  };
  TextEncoder?: unknown;
  btoa?: unknown;
  atob?: unknown;
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encoder UTF-8 minimal yang mengikuti perilaku TextEncoder untuk input string.
 * Diverifikasi terhadap TextEncoder standar pada `webcrypto.test.ts`.
 */
export class Utf8TextEncoder implements TextEncoderLike {
  readonly encoding = 'utf-8';

  encode(input = ''): Uint8Array {
    const bytes: number[] = [];

    for (let index = 0; index < input.length; index += 1) {
      let codePoint = input.charCodeAt(index);

      if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < input.length) {
        const next = input.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
          index += 1;
        }
      }

      if (codePoint < 0x80) {
        bytes.push(codePoint);
      } else if (codePoint < 0x800) {
        bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
      } else if (codePoint < 0x10000) {
        bytes.push(
          0xe0 | (codePoint >> 12),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      } else {
        bytes.push(
          0xf0 | (codePoint >> 18),
          0x80 | ((codePoint >> 12) & 0x3f),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      }
    }

    return new Uint8Array(bytes);
  }
}

export function createUtf8Encoder(): TextEncoderLike {
  return new Utf8TextEncoder();
}

/**
 * `btoa` semantik Latin-1: input dianggap satu byte per karakter.
 * Karakter di atas U+00FF ditolak seperti perilaku browser.
 */
export function encodeBase64Binary(binary: string): string {
  let output = '';

  for (let index = 0; index < binary.length; index += 3) {
    const first = binary.charCodeAt(index);
    if (first > 0xff) throw new Error('btoa: karakter di luar rentang Latin-1');

    const hasSecond = index + 1 < binary.length;
    const hasThird = index + 2 < binary.length;
    const second = hasSecond ? binary.charCodeAt(index + 1) : 0;
    const third = hasThird ? binary.charCodeAt(index + 2) : 0;
    if (second > 0xff || third > 0xff) throw new Error('btoa: karakter di luar rentang Latin-1');

    const chunk = (first << 16) | (second << 8) | third;
    const block = [
      BASE64_ALPHABET[(chunk >> 18) & 0x3f],
      BASE64_ALPHABET[(chunk >> 12) & 0x3f],
      hasSecond ? BASE64_ALPHABET[(chunk >> 6) & 0x3f] : '=',
      hasThird ? BASE64_ALPHABET[chunk & 0x3f] : '=',
    ].join('');

    output += block;
  }

  return output;
}

export function decodeBase64ToBinary(value: string): string {
  const normalized = value.replace(/[=\s]/g, '');
  let output = '';
  let buffer = 0;
  let bits = 0;

  for (const character of normalized) {
    const digit = BASE64_ALPHABET.indexOf(character);
    if (digit === -1) throw new Error('atob: karakter base64 tidak valid');

    buffer = ((buffer << 6) | digit) & 0xffffff;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  return output;
}

/** Primitif nyata perangkat: expo-crypto, tersedia juga di Expo Go. */
const expoCryptoPrimitives: WebCryptoPrimitives = {
  fillRandom: (array) => {
    ExpoCrypto.getRandomValues(array as Parameters<typeof ExpoCrypto.getRandomValues>[0]);
  },
  // Cast diperlukan: tipe lib.dom terbaru memakai `BufferSource<ArrayBuffer>`, sementara
  // `Uint8Array` punya tipe `Uint8Array<ArrayBufferLike>`. Nilainya identik saat runtime.
  digestSha256: (data) =>
    ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data as unknown as BufferSource),
  TextEncoderImpl: Utf8TextEncoder,
};

function defineGlobal(target: GlobalScope, name: keyof GlobalScope, value: unknown): void {
  Object.defineProperty(target, name, {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

/** @returns `true` bila polyfill benar-benar dipasang (global sebelumnya kosong). */
export function installTextEncoder(target: GlobalScope, primitives: WebCryptoPrimitives): boolean {
  if (typeof target.TextEncoder !== 'undefined') return false;
  defineGlobal(target, 'TextEncoder', primitives.TextEncoderImpl);
  return true;
}

export function installBase64Globals(target: GlobalScope): boolean {
  let installed = false;

  if (typeof target.btoa === 'undefined') {
    defineGlobal(target, 'btoa', encodeBase64Binary);
    installed = true;
  }
  if (typeof target.atob === 'undefined') {
    defineGlobal(target, 'atob', decodeBase64ToBinary);
    installed = true;
  }

  return installed;
}

export function installCrypto(target: GlobalScope, primitives: WebCryptoPrimitives): boolean {
  const existingCrypto = target.crypto;
  const cryptoObject = existingCrypto ?? {};
  let installed = existingCrypto === undefined;

  if (typeof cryptoObject.getRandomValues !== 'function') {
    cryptoObject.getRandomValues = (array) => {
      primitives.fillRandom(array);
      return array;
    };
    installed = true;
  }

  if (typeof cryptoObject.subtle?.digest !== 'function') {
    cryptoObject.subtle = {
      digest: (algorithm: string, data: Uint8Array) => {
        const name = algorithm.toUpperCase();
        if (name !== 'SHA-256') {
          return Promise.reject(new Error(`Algoritma digest ${algorithm} tidak didukung polyfill`));
        }
        return primitives.digestSha256(data);
      },
    };
    installed = true;
  }

  if (existingCrypto === undefined) {
    defineGlobal(target, 'crypto', cryptoObject);
  }

  return installed;
}

export type CryptoSupport = {
  textEncoder: boolean;
  base64: boolean;
  randomValues: boolean;
  sha256: boolean;
  /** `true` bila PKCE dengan challenge S256 dapat dijalankan. */
  pkceSha256Ready: boolean;
};

export function inspectCryptoSupport(target: GlobalScope): CryptoSupport {
  const textEncoder = typeof target.TextEncoder !== 'undefined';
  const base64 = typeof target.btoa !== 'undefined' && typeof target.atob !== 'undefined';
  const randomValues = typeof target.crypto?.getRandomValues === 'function';
  const sha256 = typeof target.crypto?.subtle?.digest === 'function';

  return {
    textEncoder,
    base64,
    randomValues,
    sha256,
    pkceSha256Ready: textEncoder && base64 && randomValues && sha256,
  };
}

/**
 * Memasang semua global yang dibutuhkan Supabase Auth, lalu mengembalikan status
 * dukungan kripto setelah pemasangan (dipakai layar Fondasi & sistem).
 */
export function installWebCrypto(
  target: GlobalScope = globalThis as GlobalScope,
  primitives: WebCryptoPrimitives = expoCryptoPrimitives,
): CryptoSupport {
  installTextEncoder(target, primitives);
  installBase64Globals(target);
  installCrypto(target, primitives);

  return inspectCryptoSupport(target);
}
