import {
  createUtf8Encoder,
  decodeBase64ToBinary,
  encodeBase64Binary,
  installWebCrypto,
  inspectCryptoSupport,
  Utf8TextEncoder,
  type GlobalScope,
  type TextEncoderLike,
  type WebCryptoPrimitives,
} from '@/lib/crypto/webcrypto';

/** TextEncoder standar (tersedia di Node saat pengujian) sebagai acuan. */
function referenceEncoder(): TextEncoderLike {
  const globalWithEncoder = globalThis as unknown as { TextEncoder: new () => TextEncoderLike };
  return new globalWithEncoder.TextEncoder();
}

function toBytes(value: Uint8Array): number[] {
  return Array.from(value);
}

describe('createUtf8Encoder', () => {
  it('menghasilkan byte yang sama dengan TextEncoder standar', () => {
    const encoder = createUtf8Encoder();
    const reference = referenceEncoder();
    const samples = [
      '',
      'RodaKawan',
      'kawan@contoh.id',
      'Kata sandi dengan spasi & simbol: #$%^',
      'touring ke Dieng — 350 km',
      'emoji 🏍️ dan aksen éüñ',
    ];

    for (const sample of samples) {
      expect(toBytes(encoder.encode(sample))).toEqual(toBytes(reference.encode(sample)));
    }
  });

  it('menganggap input kosong sebagai string kosong', () => {
    expect(toBytes(createUtf8Encoder().encode())).toEqual([]);
  });
});

describe('encodeBase64Binary / decodeBase64ToBinary', () => {
  it('menghasilkan base64 yang sama dengan btoa standar', () => {
    const samples = ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', '\xff\xfe\x00'];

    for (const sample of samples) {
      expect(encodeBase64Binary(sample)).toBe(btoa(sample));
    }
  });

  it('mengembalikan string biner yang sama dengan atob standar', () => {
    const encoded = btoa('halo roda kawan');

    expect(decodeBase64ToBinary(encoded)).toBe('halo roda kawan');
    expect(globalThis.atob(encoded)).toBe('halo roda kawan');
  });

  it('menolak karakter di luar Latin-1', () => {
    expect(() => encodeBase64Binary('🏍️')).toThrow();
  });

  it('menolak karakter base64 tidak valid', () => {
    expect(() => decodeBase64ToBinary('bukan base64!')).toThrow();
  });
});

describe('installWebCrypto', () => {
  /** Primitif palsu yang mencatat pemakaian. */
  function fakePrimitives() {
    const calls: { random: number[][]; digest: number[][] } = { random: [], digest: [] };

    const primitives: WebCryptoPrimitives = {
      fillRandom: (array) => {
        calls.random.push([array.length]);
        array.fill(7);
      },
      digestSha256: (data) => {
        calls.digest.push(toBytes(data));
        return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
      },
      TextEncoderImpl: Utf8TextEncoder,
    };

    return { primitives, calls };
  }

  it('memasang global yang hilang pada runtime tanpa kripto', () => {
    const scope: GlobalScope = {};
    const { primitives } = fakePrimitives();

    const support = installWebCrypto(scope, primitives);

    expect(support).toEqual({
      textEncoder: true,
      base64: true,
      randomValues: true,
      sha256: true,
      pkceSha256Ready: true,
    });
    expect(typeof scope.btoa).toBe('function');
    expect(typeof scope.atob).toBe('function');
  });

  it('tidak menimpa global yang sudah tersedia', () => {
    const existingEncoder = referenceEncoder();
    const scope: GlobalScope = { TextEncoder: existingEncoder, btoa: globalThis.btoa };
    const { primitives } = fakePrimitives();

    installWebCrypto(scope, primitives);

    expect(scope.TextEncoder).toBe(existingEncoder);
    expect(scope.btoa).toBe(globalThis.btoa);
    expect(typeof scope.atob).toBe('function');
  });

  it('meneruskan permintaan acak dan digest ke primitif yang diberikan', async () => {
    const scope: GlobalScope = {};
    const { primitives, calls } = fakePrimitives();
    installWebCrypto(scope, primitives);

    const randomArray = new Uint32Array(4);
    scope.crypto?.getRandomValues?.(randomArray);
    expect(calls.random).toEqual([[4]]);
    expect(Array.from(randomArray)).toEqual([7, 7, 7, 7]);

    const digest = await scope.crypto?.subtle?.digest?.('SHA-256', new Uint8Array([9]));
    expect(calls.digest).toEqual([[9]]);
    expect(Array.from(new Uint8Array(digest ?? new ArrayBuffer(0)))).toEqual([1, 2, 3]);
  });

  it('menolak algoritma digest selain SHA-256', async () => {
    const scope: GlobalScope = {};
    const { primitives } = fakePrimitives();
    installWebCrypto(scope, primitives);

    await expect(scope.crypto?.subtle?.digest?.('SHA-512', new Uint8Array([1]))).rejects.toThrow(
      /tidak didukung/,
    );
  });
});

describe('inspectCryptoSupport dengan primitif Web Crypto nyata (Node)', () => {
  const nodeCrypto = globalThis.crypto;
  const nodePrimitives: WebCryptoPrimitives = {
    fillRandom: (array) =>
      nodeCrypto.getRandomValues(array as Parameters<typeof nodeCrypto.getRandomValues>[0]),
    digestSha256: (data) =>
      nodeCrypto.subtle.digest('SHA-256', data as unknown as BufferSource) as Promise<ArrayBuffer>,
    TextEncoderImpl: Utf8TextEncoder,
  };

  it('menghasilkan SHA-256 yang benar untuk verifier PKCE', async () => {
    const scope: GlobalScope = {};
    installWebCrypto(scope, nodePrimitives);

    // SHA-256("abc") — nilai uji standar (FIPS 180-4).
    const expectedHex = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

    const digest = await scope.crypto?.subtle?.digest?.(
      'SHA-256',
      createUtf8Encoder().encode('abc'),
    );
    const actualHex = Array.from(new Uint8Array(digest ?? new ArrayBuffer(0)))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    expect(actualHex).toBe(expectedHex);
  });

  it('melaporkan status dukungan sebelum dan sesudah pemasangan', () => {
    const scope: GlobalScope = {};

    expect(inspectCryptoSupport(scope).pkceSha256Ready).toBe(false);

    installWebCrypto(scope, nodePrimitives);

    const support = inspectCryptoSupport(scope);
    expect(support.pkceSha256Ready).toBe(true);
  });

  it('mengisi typed array acak dengan nilai dari platform', () => {
    const scope: GlobalScope = {};
    installWebCrypto(scope, nodePrimitives);

    const bytes = new Uint8Array(16);
    scope.crypto?.getRandomValues?.(bytes);

    expect(bytes.some((byte) => byte !== 0)).toBe(true);
  });
});
