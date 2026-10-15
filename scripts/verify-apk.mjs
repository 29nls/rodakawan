#!/usr/bin/env node
/**
 * Memverifikasi bahwa APK hasil build adalah paket Android yang benar-benar
 * ditandatangani dan tidak berubah sejak ditandatangani. Dipakai oleh kedua workflow
 * rilis (`release-on-push.yml` dan `android-release.yml`) sebelum APK diunggah atau
 * dilampirkan ke GitHub Release.
 *
 * Kenapa implementasi sendiri, bukan `apksigner`: pemeriksaan ini adalah gerbang
 * terakhir sebelum berkasnya terbit, dan gerbang itu tidak boleh bergantung pada
 * toolchain yang sedang diverifikasi (JDK/AGP/Gradle di job yang sama). Ditulis di
 * sini, ia juga bisa diuji langsung terhadap `apksig` (library resmi yang dipakai AGP
 * untuk menandatangani).
 *
 * Yang diperiksa, dari luar ke dalam:
 *
 *   1. Struktur ZIP — EOCD harus berakhir tepat di akhir berkas (tidak ada byte
 *      tersembunyi setelahnya), Central Directory konsisten dengan header lokal, dan
 *      CRC-32 serta ukuran tiap entri cocok dengan isinya. Berkas yang terpotong,
 *      rusak, atau menyisipkan entri baru selalu tertangkap di sini.
 *   2. Skema v2/v3 (APK Signing Block) — digest konten gaya chunk 1 MiB dibandingkan
 *      dengan digest yang ditandatangani, lalu tanda tangan atas `signedData`
 *      diverifikasi memakai sertifikat yang tertanam.
 *   3. Skema v1 (JAR signing) — rantai digest entri → MANIFEST.MF → .SF → berkas
 *      PKCS#7, termasuk tanda tangan atas signed attributes.
 *
 * APK dinyatakan lolos hanya bila setidaknya satu skema terverifikasi dan tidak ada
 * skema yang hadir dalam keadaan tidak valid (perilaku yang sama dengan `apksigner`).
 *
 * Pemakaian:
 *   node scripts/verify-apk.mjs <berkas.apk>
 *
 * Keluar dengan kode 0 bila valid; selain itu kode 1 dengan pesan `::error::…` yang
 * langsung terbaca di log Actions.
 */

import { constants, createHash, X509Certificate, verify as verifySignature } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const CHUNK_SIZE = 1024 * 1024;
const SIGNING_BLOCK_MAGIC = 'APK Sig Block 42';

/** Blok skema tanda tangan di dalam APK Signing Block. */
const SCHEME_BLOCKS = [
  { id: 0x7109871a, name: 'v2', sdkBoundsInSignedData: false },
  { id: 0xf05368c0, name: 'v3', sdkBoundsInSignedData: true },
  // v3.1 memakai tata letak yang sama dengan v3 dan selalu hadir bersama blok v3,
  // jadi kegagalan membacanya cukup jadi peringatan selama skema lain lolos.
  { id: 0x1b93ad61, name: 'v3.1', sdkBoundsInSignedData: true, tolerant: true },
];

/**
 * Algoritma tanda tangan skema v2/v3: id → fungsi verifikasi + digest kontennya.
 * `saltLength` hanya dipakai RSA-PSS dan mengikuti panjang digest, sesuai apksig.
 */
const SIGNATURE_ALGORITHMS = new Map([
  [0x0101, { label: 'RSA-PSS/SHA-256', hash: 'sha256', rsaPss: true, saltLength: 32 }],
  [0x0102, { label: 'RSA-PSS/SHA-512', hash: 'sha512', rsaPss: true, saltLength: 64 }],
  [0x0103, { label: 'RSA-PKCS#1/SHA-256', hash: 'sha256', rsaPss: false }],
  [0x0104, { label: 'RSA-PKCS#1/SHA-512', hash: 'sha512', rsaPss: false }],
  [0x0201, { label: 'ECDSA/SHA-256', hash: 'sha256' }],
  [0x0202, { label: 'ECDSA/SHA-512', hash: 'sha512' }],
  [0x0301, { label: 'DSA/SHA-256', hash: 'sha256' }],
]);

/** Nama digest JAR (v1) → nama hash Node. Diurutkan dari yang terkuat. */
const JAR_DIGESTS = [
  ['SHA-512', 'sha512'],
  ['SHA-384', 'sha384'],
  ['SHA-256', 'sha256'],
  ['SHA1', 'sha1'],
  ['SHA-1', 'sha1'],
];

/** OID digest PKCS#7 → nama hash Node. */
const HASH_BY_OID = new Map([
  ['2.16.840.1.101.3.4.2.1', 'sha256'],
  ['2.16.840.1.101.3.4.2.2', 'sha384'],
  ['2.16.840.1.101.3.4.2.3', 'sha512'],
  ['1.3.14.3.2.26', 'sha1'],
]);

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_CONTENT_TYPE = '1.2.840.113549.1.9.3';

/** OID algoritma tanda tangan PKCS#7 → hash yang diharapkan (null = bebas). */
const SIGNATURE_OID_HASH = new Map([
  ['1.2.840.113549.1.1.1', null], // rsaEncryption
  ['1.2.840.113549.1.1.5', 'sha1'],
  ['1.2.840.113549.1.1.11', 'sha256'],
  ['1.2.840.113549.1.1.12', 'sha384'],
  ['1.2.840.113549.1.1.13', 'sha512'],
  ['1.2.840.10045.4.1', 'sha1'],
  ['1.2.840.10045.4.3.2', 'sha256'],
  ['1.2.840.10045.4.3.3', 'sha384'],
  ['1.2.840.10045.4.3.4', 'sha512'],
  ['2.16.840.1.101.3.4.3.2', 'sha256'],
]);

/** Kegagalan verifikasi yang bisa ditampilkan sebagai `::error::`. */
class VerifyError extends Error {}

function fail(message, extraLines = []) {
  console.error(`::error::${message}`);
  for (const line of extraLines) console.error(line);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Alat bantu biner
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readUInt64LE(buffer, offset, what) {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new VerifyError(`Nilai 64-bit di ${what} terlalu besar untuk diproses.`);
  }
  return Number(value);
}

function bufferEquals(a, b) {
  return a.length === b.length && a.equals(b);
}

function hex(buffer) {
  return Buffer.from(buffer).toString('hex');
}

function fingerprintOf(certificate) {
  return createHash('sha256').update(certificate.raw).digest('hex');
}

/** Membaca TLV DER secara minimal (format panjang saja, tanpa panjang tak tentu). */
class DerReader {
  constructor(buffer, start = 0, end = buffer.length) {
    this.buffer = buffer;
    this.offset = start;
    this.end = end;
  }

  get remaining() {
    return this.end - this.offset;
  }

  readTlv() {
    if (this.remaining < 2) throw new VerifyError('DER terpotong: header tidak lengkap.');
    const start = this.offset;
    const tag = this.buffer[start];
    let cursor = start + 1;
    let length = this.buffer[cursor++];
    if (length === 0x80) throw new VerifyError('DER dengan panjang tak tentu tidak didukung.');
    if (length & 0x80) {
      const count = length & 0x7f;
      if (count > 4) throw new VerifyError('Panjang DER memakai lebih dari 4 byte.');
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + this.buffer[cursor++];
    }
    const contentStart = cursor;
    const contentEnd = contentStart + length;
    if (contentEnd > this.end) throw new VerifyError('DER terpotong: isi melewati batas data.');
    this.offset = contentEnd;
    return {
      tag,
      contentStart,
      contentEnd,
      raw: this.buffer.subarray(start, contentEnd),
      content: this.buffer.subarray(contentStart, contentEnd),
    };
  }

  readExpectedTag(tag, what) {
    const tlv = this.readTlv();
    if (tlv.tag !== tag) {
      throw new VerifyError(`DER tidak sesuai: ${what} ditandai 0x${tlv.tag.toString(16)}.`);
    }
    return tlv;
  }

  readSequence(what) {
    return this.readExpectedTag(0x30, what);
  }
}

function decodeOid(bytes) {
  if (bytes.length === 0) throw new VerifyError('OID kosong di struktur DER.');
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    value = value * 128 + (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

function readOid(reader, what) {
  const tlv = reader.readExpectedTag(0x06, what);
  return decodeOid(tlv.content);
}

/** Menyusun ulang signed attributes sebagai SET OF sebelum diverifikasi. */
function asSetOf(rawAttributes) {
  const copy = Buffer.from(rawAttributes);
  copy[0] = 0x31;
  return copy;
}

// ---------------------------------------------------------------------------
// Struktur ZIP
// ---------------------------------------------------------------------------

function findEndOfCentralDirectory(apk) {
  if (apk.length < 22) {
    throw new VerifyError('Berkas terlalu kecil untuk jadi arsip ZIP (APK).');
  }
  const lowest = Math.max(0, apk.length - (22 + 0xffff));
  for (let offset = apk.length - 22; offset >= lowest; offset--) {
    if (apk.readUInt32LE(offset) !== 0x06054b50) continue;
    // EOCD harus berakhir tepat di akhir berkas: byte tambahan setelahnya tidak
    // dilindungi tanda tangan, jadi berkas seperti itu ditolak.
    if (offset + 22 + apk.readUInt16LE(offset + 20) === apk.length) return offset;
  }
  throw new VerifyError(
    'Struktur ZIP tidak valid: End of Central Directory tidak ditemukan tepat di akhir berkas.',
    ['Berkas kemungkinan terpotong, bukan APK, atau ada byte tersembunyi setelah arsip.'],
  );
}

function readZipEntries(apk, eocdOffset) {
  const entryCount = apk.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = apk.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = apk.readUInt32LE(eocdOffset + 16);

  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new VerifyError('APK memakai ZIP64, yang tidak didukung Android maupun alur rilis ini.', [
      'Build yang benar tidak pernah menghasilkan ZIP64; periksa kembali proses build.',
    ]);
  }
  if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
    throw new VerifyError(
      'Central Directory tidak berakhir tepat di awal End of Central Directory.',
      [
        `Perkiraan: offset ${centralDirectoryOffset} + ukuran ${centralDirectorySize} ≠ ${eocdOffset}.`,
      ],
    );
  }

  const entries = [];
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > eocdOffset || apk.readUInt32LE(cursor) !== 0x02014b50) {
      throw new VerifyError(`Entri Central Directory ke-${index + 1} tidak lengkap atau rusak.`);
    }
    const flags = apk.readUInt16LE(cursor + 8);
    const method = apk.readUInt16LE(cursor + 10);
    const crc = apk.readUInt32LE(cursor + 16);
    const compressedSize = apk.readUInt32LE(cursor + 20);
    const uncompressedSize = apk.readUInt32LE(cursor + 24);
    const nameLength = apk.readUInt16LE(cursor + 28);
    const extraLength = apk.readUInt16LE(cursor + 30);
    const commentLength = apk.readUInt16LE(cursor + 32);
    const localHeaderOffset = apk.readUInt32LE(cursor + 42);
    const name = apk.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    if (localHeaderOffset + 30 > centralDirectoryOffset) {
      throw new VerifyError(`Header lokal entri ${name} berada di luar area entri ZIP.`);
    }
    if (apk.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new VerifyError(`Header lokal entri ${name} tidak ditemukan.`);
    }
    const localNameLength = apk.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = apk.readUInt16LE(localHeaderOffset + 28);
    const localName = apk
      .subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength)
      .toString('utf8');
    if (localName !== name) {
      throw new VerifyError(
        `Nama entri ${name} tidak sama antara header lokal dan Central Directory.`,
      );
    }
    // Bila bit 3 tidak diset, ukuran dan CRC harus sudah ada di header lokal.
    const descriptorFlag = (flags & 0x08) !== 0;
    if (!descriptorFlag) {
      if (
        apk.readUInt32LE(localHeaderOffset + 14) !== crc ||
        apk.readUInt32LE(localHeaderOffset + 18) !== compressedSize ||
        apk.readUInt32LE(localHeaderOffset + 22) !== uncompressedSize
      ) {
        throw new VerifyError(
          `Header lokal entri ${name} tidak konsisten dengan Central Directory.`,
        );
      }
    }

    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralDirectoryOffset) {
      throw new VerifyError(`Isi entri ${name} melewati area Central Directory.`);
    }
    entries.push({
      name,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataStart,
      dataEnd,
      isDirectory: name.endsWith('/'),
    });
  }

  // Entri tidak boleh saling menimpa; itu tanda arsip hasil rekayasa.
  const ranges = entries
    .map((entry) => [entry.localHeaderOffset, entry.dataEnd, entry.name])
    .sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] < ranges[i - 1][1]) {
      throw new VerifyError(
        `Entri ${ranges[i][2]} menimpa entri ${ranges[i - 1][2]} di dalam arsip.`,
      );
    }
  }
  if (ranges.length > 0 && ranges[ranges.length - 1][1] > centralDirectoryOffset) {
    throw new VerifyError(`Entri ${ranges[ranges.length - 1][2]} melewati awal Central Directory.`);
  }
  return { entries, centralDirectoryOffset, centralDirectorySize, entryCount };
}

function readEntryContent(apk, entry) {
  const raw = apk.subarray(entry.dataStart, entry.dataEnd);
  if (entry.isDirectory) return Buffer.alloc(0);
  let content;
  if (entry.method === 0) content = Buffer.from(raw);
  else if (entry.method === 8) {
    try {
      content = inflateRawSync(raw);
    } catch (error) {
      throw new VerifyError(`Entri ${entry.name} tidak bisa didekompresi (data rusak).`);
    }
  } else {
    throw new VerifyError(
      `Entri ${entry.name} memakai metode kompresi ${entry.method} yang tidak dikenal Android.`,
    );
  }
  if (content.length !== entry.uncompressedSize) {
    throw new VerifyError(
      `Ukuran entri ${entry.name} tidak sesuai: ${content.length} byte terbaca, ${entry.uncompressedSize} byte tercatat.`,
    );
  }
  return content;
}

/**
 * Memeriksa integritas isi seluruh entri dan menghitung digest tiap entri sekaligus
 * (dipakai oleh rantai digest skema v1).
 */
function digestEntries(apk, entries) {
  const digests = new Map();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const content = readEntryContent(apk, entry);
    const actualCrc = crc32(content);
    if (actualCrc !== entry.crc) {
      throw new VerifyError(
        `CRC-32 entri ${entry.name} tidak cocok — berkas APK rusak atau terpotong.`,
        [
          `Tercatat 0x${entry.crc.toString(16).padStart(8, '0')}, terhitung 0x${actualCrc
            .toString(16)
            .padStart(8, '0')}.`,
        ],
      );
    }
    digests.set(entry.name, {
      size: content.length,
      sha1: createHash('sha1').update(content).digest(),
      sha256: createHash('sha256').update(content).digest(),
      sha384: createHash('sha384').update(content).digest(),
      sha512: createHash('sha512').update(content).digest(),
    });
  }
  return digests;
}

// ---------------------------------------------------------------------------
// APK Signing Block
// ---------------------------------------------------------------------------

function readSigningBlock(apk, centralDirectoryOffset) {
  if (
    centralDirectoryOffset < 24 ||
    apk.subarray(centralDirectoryOffset - 16, centralDirectoryOffset).toString('latin1') !==
      SIGNING_BLOCK_MAGIC
  ) {
    return null;
  }
  const size = readUInt64LE(apk, centralDirectoryOffset - 24, 'footer APK Signing Block');
  const start = centralDirectoryOffset - size - 8;
  if (start < 0) throw new VerifyError('Ukuran APK Signing Block melewati awal berkas.');
  if (readUInt64LE(apk, start, 'header APK Signing Block') !== size) {
    throw new VerifyError('Ukuran APK Signing Block tidak konsisten antara header dan footer.');
  }

  const pairs = new Map();
  let cursor = start + 8;
  const end = centralDirectoryOffset - 24;
  while (cursor < end) {
    const pairSize = readUInt64LE(apk, cursor, 'pasangan APK Signing Block');
    const id = apk.readUInt32LE(cursor + 8);
    const valueStart = cursor + 12;
    const valueEnd = cursor + 8 + pairSize;
    if (pairSize < 4 || valueEnd > end) {
      throw new VerifyError('Ada entri APK Signing Block yang ukurannya tidak masuk akal.');
    }
    pairs.set(id, apk.subarray(valueStart, valueEnd));
    cursor = valueEnd;
  }
  if (cursor !== end)
    throw new VerifyError('APK Signing Block tidak berakhir tepat sebelum Central Directory.');
  return { start, end: centralDirectoryOffset, pairs };
}

/** Digest konten APK (gaya chunk 1 MiB) sesuai APK Signature Scheme v2/v3. */
function computeContentDigest(apk, hashName, block, endOfCentralDirectory) {
  if (contentDigestCache.has(hashName)) return contentDigestCache.get(hashName);
  const sections = [
    apk.subarray(0, block.start),
    apk.subarray(block.end, endOfCentralDirectory),
    (() => {
      // Salinan EOCD dengan kolom offset Central Directory diarahkan ke awal blok
      // tanda tangan, persis seperti yang dilakukan apksig saat menandatangani.
      const eocd = Buffer.from(apk.subarray(endOfCentralDirectory));
      eocd.writeUInt32LE(block.start, 16);
      return eocd;
    })(),
  ];

  const chunkDigests = [];
  for (const section of sections) {
    for (let offset = 0; offset < section.length; offset += CHUNK_SIZE) {
      const chunk = section.subarray(offset, Math.min(offset + CHUNK_SIZE, section.length));
      const chunkHash = createHash(hashName);
      const lengthBytes = Buffer.alloc(4);
      lengthBytes.writeUInt32LE(chunk.length);
      chunkHash.update(Buffer.from([0xa5]));
      chunkHash.update(lengthBytes);
      chunkHash.update(chunk);
      chunkDigests.push(chunkHash.digest());
    }
  }

  const total = createHash(hashName);
  const countBytes = Buffer.alloc(4);
  countBytes.writeUInt32LE(chunkDigests.length);
  total.update(Buffer.from([0x5a]));
  total.update(countBytes);
  for (const digest of chunkDigests) total.update(digest);
  const result = total.digest();
  contentDigestCache.set(hashName, result);
  return result;
}

/** Pembaca sederhana untuk struktur berawalan panjang 4 byte little-endian. */
const contentDigestCache = new Map();

class DerLite {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  get remaining() {
    return this.buffer.length - this.offset;
  }

  readUInt32(what) {
    if (this.remaining < 4) throw new VerifyError(`Struktur ${what} terpotong.`);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readBytes(length, what) {
    if (length < 0 || this.remaining < length) throw new VerifyError(`Struktur ${what} terpotong.`);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readLengthPrefixed(what) {
    return this.readBytes(this.readUInt32(what), what);
  }

  /** Membaca rangkaian item berawalan panjang sampai buffer habis. */
  readAll(what) {
    const items = [];
    while (this.remaining > 0) items.push(this.readLengthPrefixed(what));
    return items;
  }

  assertEmpty(what) {
    if (this.remaining !== 0) {
      throw new VerifyError(`Struktur ${what} menyisakan ${this.remaining} byte tak terpakai.`);
    }
  }
}

function parseSchemeSigners(value, scheme) {
  const outer = new DerLite(value);
  const signerList = outer.readLengthPrefixed(`daftar penandatangan ${scheme.name}`);
  outer.assertEmpty(`blok ${scheme.name}`);
  const signers = [];
  for (const signerBytes of new DerLite(signerList).readAll(`penandatangan ${scheme.name}`)) {
    const reader = new DerLite(signerBytes);
    const signedData = reader.readLengthPrefixed(`signedData ${scheme.name}`);
    let sdkRange = null;
    if (scheme.sdkBoundsInSignedData) {
      const minSdk = reader.readUInt32(`minSdk ${scheme.name}`);
      const maxSdk = reader.readUInt32(`maxSdk ${scheme.name}`);
      sdkRange = { minSdk, maxSdk };
    }
    const signatures = reader.readLengthPrefixed(`signatures ${scheme.name}`);
    const publicKey = reader.readLengthPrefixed(`publicKey ${scheme.name}`);

    // Tata letak `signedData` berbeda antara v2 dan v3: v2 diakhiri elemen kosong
    // tambahan, v3 memuat minSdk/maxSdk setelah sertifikat. Sisa byte diabaikan
    // seperti apksig — semua isi tetap tercakup tanda tangan atas `signedData`.
    const signedReader = new DerLite(signedData);
    const digests = signedReader.readLengthPrefixed(`digests ${scheme.name}`);
    const certificates = signedReader.readLengthPrefixed(`certificates ${scheme.name}`);
    let signedSdkRange = null;
    if (scheme.sdkBoundsInSignedData) {
      signedSdkRange = {
        minSdk: signedReader.readUInt32(`minSdk signedData ${scheme.name}`),
        maxSdk: signedReader.readUInt32(`maxSdk signedData ${scheme.name}`),
      };
    }
    signedReader.readLengthPrefixed(`attributes ${scheme.name}`);

    const digestItems = new DerLite(digests).readAll(`digest ${scheme.name}`).map((item) => {
      const reader2 = new DerLite(item);
      const id = reader2.readUInt32(`id algoritma digest ${scheme.name}`);
      const digest = reader2.readLengthPrefixed(`nilai digest ${scheme.name}`);
      reader2.assertEmpty(`item digest ${scheme.name}`);
      return { id, digest };
    });
    const signatureItems = new DerLite(signatures)
      .readAll(`signature ${scheme.name}`)
      .map((item) => {
        const reader2 = new DerLite(item);
        const id = reader2.readUInt32(`id algoritma signature ${scheme.name}`);
        const signature = reader2.readLengthPrefixed(`nilai signature ${scheme.name}`);
        reader2.assertEmpty(`item signature ${scheme.name}`);
        return { id, signature };
      });
    const certificateList = new DerLite(certificates)
      .readAll(`sertifikat ${scheme.name}`)
      .map((der) => new X509Certificate(der));

    signers.push({
      signedData,
      sdkRange,
      signedSdkRange,
      publicKey,
      digestItems,
      signatureItems,
      certificates: certificateList,
    });
  }
  return signers;
}

function verifySchemeBlock(apk, block, endOfCentralDirectory, scheme) {
  const value = block.pairs.get(scheme.id);
  if (value === undefined) return null;

  const signers = parseSchemeSigners(value, scheme);
  if (signers.length === 0) {
    throw new VerifyError(`Blok ${scheme.name} tidak memuat penandatangan.`);
  }

  const fingerprints = [];
  for (const signer of signers) {
    if (signer.certificates.length === 0) {
      throw new VerifyError(`Penandatangan ${scheme.name} tidak menyertakan sertifikat.`);
    }
    const leaf = signer.certificates[0];
    if (!bufferEquals(signer.publicKey, leaf.publicKey.export({ type: 'spki', format: 'der' }))) {
      throw new VerifyError(
        `Kunci publik penandatangan ${scheme.name} tidak sama dengan sertifikatnya.`,
      );
    }
    if (signer.digestItems.length !== signer.signatureItems.length) {
      throw new VerifyError(`Jumlah digest dan tanda tangan ${scheme.name} tidak sama.`);
    }
    if (signer.sdkRange && signer.signedSdkRange) {
      if (
        signer.sdkRange.minSdk !== signer.signedSdkRange.minSdk ||
        signer.sdkRange.maxSdk !== signer.signedSdkRange.maxSdk
      ) {
        throw new VerifyError(
          `Rentang SDK penandatangan ${scheme.name} berbeda dari yang ditandatangani.`,
        );
      }
    }

    let verified = 0;
    for (let index = 0; index < signer.digestItems.length; index++) {
      const digestItem = signer.digestItems[index];
      const signatureItem = signer.signatureItems[index];
      if (digestItem.id !== signatureItem.id) {
        throw new VerifyError(
          `Urutan algoritma digest dan tanda tangan ${scheme.name} tidak sama.`,
        );
      }
      const algorithm = SIGNATURE_ALGORITHMS.get(digestItem.id);
      if (!algorithm) continue; // Algoritma di luar yang didukung; abaikan seperti apksig.

      const contentDigest = computeContentDigest(apk, algorithm.hash, block, endOfCentralDirectory);
      if (!bufferEquals(contentDigest, digestItem.digest)) {
        throw new VerifyError(
          `Isi APK tidak cocok dengan digest yang ditandatangani (${scheme.name}, ${algorithm.label}).`,
          ['Berkas berubah setelah ditandatangani, atau tanda tangan berasal dari berkas lain.'],
        );
      }
      const options = { key: leaf.publicKey };
      if (algorithm.rsaPss) {
        options.padding = constants.RSA_PKCS1_PSS_PADDING;
        options.saltLength = algorithm.saltLength;
      }
      if (!verifySignature(algorithm.hash, signer.signedData, options, signatureItem.signature)) {
        throw new VerifyError(
          `Tanda tangan ${scheme.name} (${algorithm.label}) tidak valid untuk sertifikat di dalam APK.`,
        );
      }
      verified++;
    }
    if (verified === 0) {
      throw new VerifyError(
        `Penandatangan ${scheme.name} tidak memakai algoritma tanda tangan yang bisa diverifikasi.`,
        [
          `Algoritma yang terdaftar: ${signer.digestItems.map((item) => `0x${item.id.toString(16)}`).join(', ')}`,
        ],
      );
    }
    fingerprints.push(fingerprintOf(leaf));
    if (signer.sdkRange) {
      signer.sdkRange.label = `SDK ${signer.sdkRange.minSdk}..${signer.sdkRange.maxSdk}`;
    }
  }
  return { fingerprints };
}

// ---------------------------------------------------------------------------
// Skema v1 (JAR signing)
// ---------------------------------------------------------------------------

/** Memecah berkas manifest/signature menjadi baris-baris tanpa pemisahnya. */
function splitLines(buffer) {
  const lines = [];
  let start = 0;
  for (let index = 0; index <= buffer.length; index++) {
    const isBreak = index === buffer.length || buffer[index] === 0x0a || buffer[index] === 0x0d;
    if (!isBreak) continue;
    let end = index;
    while (end > start && (buffer[end - 1] === 0x0a || buffer[end - 1] === 0x0d)) end--;
    lines.push(buffer.subarray(start, end).toString('utf8'));
    if (index < buffer.length && buffer[index] === 0x0d && buffer[index + 1] === 0x0a) index++;
    start = index + 1;
  }
  return lines;
}

/** Parsing manifest bergaya JAR, dengan offset mentah tiap bagian. */
function parseJarManifest(buffer) {
  const sections = [];
  let current = null;
  let lineStart = 0;
  let cursor = 0;

  const flush = (endOffset) => {
    if (current) sections.push({ ...current, raw: buffer.subarray(current.start, endOffset) });
    current = null;
  };

  while (cursor < buffer.length) {
    let lineEnd = cursor;
    while (lineEnd < buffer.length && buffer[lineEnd] !== 0x0a && buffer[lineEnd] !== 0x0d)
      lineEnd++;
    let after = lineEnd;
    if (after < buffer.length && buffer[after] === 0x0d) after++;
    if (after < buffer.length && buffer[after] === 0x0a) after++;

    const line = buffer.subarray(cursor, lineEnd).toString('utf8');
    if (line.trim() === '') {
      // Baris kosong mengakhiri bagian; pemisahnya ikut dihitung seperti JDK.
      flush(after);
    } else {
      if (!current) current = { start: lineStart, attributes: new Map() };
      // Baris lanjutan (diawali satu spasi) menyambung nilai sebelumnya.
      if (line.startsWith(' ') && current.lastKey) {
        current.attributes.set(
          current.lastKey,
          current.attributes.get(current.lastKey) + line.slice(1),
        );
      } else {
        const separator = line.indexOf(':');
        if (separator > 0) {
          const key = line.slice(0, separator).trim().toLowerCase();
          const value = line.slice(separator + 1).trim();
          current.attributes.set(key, value);
          current.lastKey = key;
        }
      }
    }
    cursor = after;
    lineStart = after;
  }
  flush(buffer.length);
  return sections;
}

function manifestAttribute(section, name) {
  return section?.attributes.get(name.toLowerCase());
}

/** Digest JAR terkuat yang tersedia untuk atribut berakhiran `suffix`. */
function strongestJarDigest(section, suffix) {
  if (!section) return null;
  for (const [label, hash] of JAR_DIGESTS) {
    const value = manifestAttribute(section, `${label}-${suffix}`);
    if (value) return { label, hash, value };
  }
  return null;
}

function parsePkcs7(der) {
  const reader = new DerReader(der);
  const contentInfo = reader.readSequence('ContentInfo');
  const contentReader = new DerReader(der, contentInfo.contentStart, contentInfo.contentEnd);
  const contentType = readOid(contentReader, 'ContentInfo.contentType');
  if (contentType !== OID_SIGNED_DATA) {
    throw new VerifyError(`Berkas tanda tangan v1 bukan PKCS#7 SignedData (OID ${contentType}).`);
  }
  const explicit = contentReader.readExpectedTag(0xa0, 'SignedData');
  const signedReader = new DerReader(der, explicit.contentStart, explicit.contentEnd);
  const signedData = signedReader.readSequence('SignedData');

  const fields = new DerReader(der, signedData.contentStart, signedData.contentEnd);
  fields.readExpectedTag(0x02, 'SignedData.version');
  fields.readExpectedTag(0x31, 'SignedData.digestAlgorithms');
  const encapsulated = fields.readSequence('SignedData.encapContentInfo');
  const encapsulatedReader = new DerReader(der, encapsulated.contentStart, encapsulated.contentEnd);
  const encapsulatedType = readOid(encapsulatedReader, 'encapContentInfo.eContentType');

  let certificatesField = fields.readTlv();
  const certificates = [];
  if (certificatesField.tag === 0xa0) {
    const certReader = new DerReader(
      der,
      certificatesField.contentStart,
      certificatesField.contentEnd,
    );
    while (certReader.remaining > 0) certificates.push(certReader.readTlv().raw);
    certificatesField = fields.readTlv();
  }
  if (certificatesField.tag === 0xa1) certificatesField = fields.readTlv();
  if (certificatesField.tag !== 0x31) {
    throw new VerifyError('Struktur PKCS#7 tidak memuat daftar SignerInfo.');
  }

  const signerReaders = new DerReader(
    der,
    certificatesField.contentStart,
    certificatesField.contentEnd,
  );
  const signerInfos = [];
  while (signerReaders.remaining > 0) {
    const signerInfo = signerReaders.readSequence('SignerInfo');
    const info = new DerReader(der, signerInfo.contentStart, signerInfo.contentEnd);
    info.readExpectedTag(0x02, 'SignerInfo.version');
    const sid = info.readTlv();
    let issuerRaw = null;
    let serial = null;
    if (sid.tag === 0x30) {
      const sidReader = new DerReader(der, sid.contentStart, sid.contentEnd);
      issuerRaw = sidReader.readSequence('issuerAndSerialNumber.issuer').raw;
      const serialTlv = sidReader.readExpectedTag(0x02, 'issuerAndSerialNumber.serialNumber');
      serial = BigInt(`0x${hex(serialTlv.content).replace(/^00/, '') || '0'}`);
    }
    const digestAlgorithm = info.readSequence('SignerInfo.digestAlgorithm');
    const digestOid = readOid(
      new DerReader(der, digestAlgorithm.contentStart, digestAlgorithm.contentEnd),
      'digestAlgorithm.algorithm',
    );
    let signedAttributes = null;
    let next = info.readTlv();
    if (next.tag === 0xa0) {
      signedAttributes = next.raw;
      next = info.readTlv();
    }
    if (next.tag !== 0x30) throw new VerifyError('SignerInfo tidak memuat signatureAlgorithm.');
    const signatureAlgorithmOid = readOid(
      new DerReader(der, next.contentStart, next.contentEnd),
      'signatureAlgorithm.algorithm',
    );
    const signature = info.readExpectedTag(0x04, 'SignerInfo.signature').content;

    signerInfos.push({
      issuerRaw,
      serial,
      digestOid,
      signedAttributes,
      signatureAlgorithmOid,
      signature,
    });
  }
  return { encapsulatedType, certificates, signerInfos };
}

/** Sertifikat yang cocok dengan SignerInfo: issuer + serial (seperti apksig). */
function findSignerCertificate(certificates, signerInfo) {
  if (signerInfo.issuerRaw === null || signerInfo.serial === null) return null;
  for (const der of certificates) {
    const reader = new DerReader(der);
    const certificate = reader.readSequence('Certificate');
    const body = new DerReader(der, certificate.contentStart, certificate.contentEnd);
    const tbs = body.readSequence('tbsCertificate');
    const tbsReader = new DerReader(der, tbs.contentStart, tbs.contentEnd);
    let field = tbsReader.readTlv();
    if (field.tag === 0xa0) field = tbsReader.readTlv();
    if (field.tag !== 0x02)
      throw new VerifyError('tbsCertificate tidak dimulai dengan serialNumber.');
    const serial = BigInt(`0x${hex(field.content).replace(/^00/, '') || '0'}`);
    tbsReader.readSequence('tbsCertificate.signature');
    const issuer = tbsReader.readSequence('tbsCertificate.issuer');
    if (serial === signerInfo.serial && bufferEquals(issuer.raw, signerInfo.issuerRaw)) {
      return new X509Certificate(der);
    }
  }
  return null;
}

function parseAttributeSet(raw) {
  const container = new DerReader(raw);
  const set = container.readTlv();
  const attributes = new Map();
  const setReader = new DerReader(raw, set.contentStart, set.contentEnd);
  while (setReader.remaining > 0) {
    const attribute = setReader.readSequence('Attribute');
    const attributeReader = new DerReader(raw, attribute.contentStart, attribute.contentEnd);
    const oid = readOid(attributeReader, 'Attribute.attrType');
    const values = attributeReader.readExpectedTag(0x31, 'Attribute.attrValues');
    const valuesReader = new DerReader(raw, values.contentStart, values.contentEnd);
    const parsed = [];
    while (valuesReader.remaining > 0) parsed.push(valuesReader.readTlv().content);
    attributes.set(oid, parsed);
  }
  return attributes;
}

function verifyV1(apk, entries, digests) {
  const manifestEntry = entries.find(
    (entry) => entry.name.toUpperCase() === 'META-INF/MANIFEST.MF',
  );
  if (!manifestEntry) {
    throw new VerifyError('APK punya berkas .SF tetapi tanpa META-INF/MANIFEST.MF.');
  }
  const manifestBytes = readEntryContent(apk, manifestEntry);
  const manifestSections = parseJarManifest(manifestBytes);
  const namedSections = new Map();
  for (const section of manifestSections) {
    const name = manifestAttribute(section, 'Name');
    if (name !== undefined) namedSections.set(name, section);
  }

  const signatureFiles = entries.filter((entry) => /^META-INF\/[^/]+\.SF$/i.test(entry.name));

  const fingerprints = [];
  for (const signatureFile of signatureFiles) {
    const base = signatureFile.name.slice(0, signatureFile.name.length - 3);
    const blockEntry = entries.find((entry) =>
      ['.RSA', '.DSA', '.EC'].some(
        (extension) => entry.name.toUpperCase() === `${base}${extension}`.toUpperCase(),
      ),
    );
    if (!blockEntry) {
      throw new VerifyError(
        `Tidak ada blok tanda tangan (.RSA/.DSA/.EC) untuk ${signatureFile.name}.`,
      );
    }

    const signatureBytes = readEntryContent(apk, signatureFile);
    const pkcs7 = parsePkcs7(readEntryContent(apk, blockEntry));

    // 1. Rantai sertifikat: tanda tangan atas isi .SF.
    let signedAnything = false;
    for (const signerInfo of pkcs7.signerInfos) {
      const certificate = findSignerCertificate(pkcs7.certificates, signerInfo);
      if (!certificate) {
        throw new VerifyError(
          `Sertifikat penandatangan ${blockEntry.name} tidak ada di dalam PKCS#7.`,
        );
      }
      const hash = HASH_BY_OID.get(signerInfo.digestOid);
      if (!hash) {
        throw new VerifyError(
          `Algoritma digest ${signerInfo.digestOid} di ${blockEntry.name} belum didukung.`,
        );
      }
      const expectedHash = SIGNATURE_OID_HASH.get(signerInfo.signatureAlgorithmOid);
      if (expectedHash !== undefined && expectedHash !== null && expectedHash !== hash) {
        throw new VerifyError(
          `Algoritma tanda tangan di ${blockEntry.name} tidak cocok dengan digest yang dipakai.`,
        );
      }

      let data = signatureBytes;
      if (signerInfo.signedAttributes) {
        const attributes = parseAttributeSet(signerInfo.signedAttributes);
        const messageDigest = attributes.get(OID_MESSAGE_DIGEST)?.[0];
        if (!messageDigest) {
          throw new VerifyError(
            `Signed attributes di ${blockEntry.name} tanpa atribut messageDigest.`,
          );
        }
        const computed = createHash(hash).update(signatureBytes).digest();
        if (!bufferEquals(computed, messageDigest)) {
          throw new VerifyError(
            `Digest isi ${signatureFile.name} (atribut messageDigest) tidak cocok — berkas berubah setelah ditandatangani.`,
          );
        }
        const contentType = attributes.get(OID_CONTENT_TYPE)?.[0];
        if (contentType && decodeOid(contentType) === pkcs7.encapsulatedType) {
          // Cocok, tidak ada yang perlu dilakukan.
        } else if (contentType) {
          throw new VerifyError(
            `Atribut contentType di ${blockEntry.name} tidak sesuai isi PKCS#7.`,
          );
        }
        data = asSetOf(signerInfo.signedAttributes);
      }
      if (!verifySignature(hash, data, certificate.publicKey, signerInfo.signature)) {
        throw new VerifyError(
          `Tanda tangan v1 di ${blockEntry.name} tidak valid untuk sertifikat di dalam APK.`,
        );
      }
      fingerprints.push(fingerprintOf(certificate));
      signedAnything = true;
    }
    if (!signedAnything) {
      throw new VerifyError(`Tidak ada SignerInfo yang bisa diverifikasi di ${blockEntry.name}.`);
    }

    // 2. Hubungan .SF → MANIFEST.MF: digest seluruh manifest, atau digest per bagian.
    const sfSections = parseJarManifest(signatureBytes);
    const sfSectionsByName = new Map();
    let wholeManifest = null;
    for (const section of sfSections) {
      if (!wholeManifest) wholeManifest = strongestJarDigest(section, 'Digest-Manifest');
      const name = manifestAttribute(section, 'Name');
      if (name !== undefined) sfSectionsByName.set(name, section);
    }
    let manifestAuthenticatedAsWhole = false;
    if (wholeManifest) {
      const computed = createHash(wholeManifest.hash).update(manifestBytes).digest();
      manifestAuthenticatedAsWhole = bufferEquals(
        computed,
        Buffer.from(wholeManifest.value, 'base64'),
      );
    }

    // Yang mengikat bagian MANIFEST.MF ke .SF adalah digest di dalam .SF, bukan
    // digest di manifest itu sendiri — kalau tidak, bagian yang disisipkan belakangan
    // akan lolos dengan sendirinya.
    let authenticatedSections = 0;
    const sectionAuthenticated = (name) => {
      if (manifestAuthenticatedAsWhole) return true;
      const sectionDigest = strongestJarDigest(sfSectionsByName.get(name), 'Digest');
      const manifestSection = namedSections.get(name);
      if (!sectionDigest || !manifestSection) return false;
      const computed = createHash(sectionDigest.hash).update(manifestSection.raw).digest();
      if (!bufferEquals(computed, Buffer.from(sectionDigest.value, 'base64'))) return false;
      authenticatedSections++;
      return true;
    };

    // 3. Hubungan MANIFEST.MF → isi entri.
    for (const entry of entries) {
      if (entry.isDirectory || entry.name.toUpperCase().startsWith('META-INF/')) continue;
      const section = namedSections.get(entry.name);
      if (!section) {
        throw new VerifyError(`Entri ${entry.name} tidak punya digest di META-INF/MANIFEST.MF.`, [
          'Entri yang tidak ditandatangani tidak boleh ikut dirilis.',
        ]);
      }
      if (!sectionAuthenticated(entry.name)) {
        throw new VerifyError(
          `Bagian ${entry.name} di META-INF/MANIFEST.MF tidak diikat tanda tangan v1.`,
        );
      }
      const entryDigest = strongestJarDigest(section, 'Digest');
      if (!entryDigest) {
        throw new VerifyError(
          `Entri ${entry.name} tidak punya digest dengan algoritma yang didukung.`,
        );
      }
      const computed = digests.get(entry.name)?.[entryDigest.hash];
      if (!computed || !bufferEquals(computed, Buffer.from(entryDigest.value, 'base64'))) {
        throw new VerifyError(
          `Digest entri ${entry.name} tidak cocok dengan META-INF/MANIFEST.MF.`,
          ['Isi APK berubah setelah ditandatangani.'],
        );
      }
    }
    if (!manifestAuthenticatedAsWhole && authenticatedSections === 0) {
      throw new VerifyError(
        `Tanda tangan v1 tidak mengikat isi META-INF/MANIFEST.MF (tidak ada digest manifest maupun digest bagian).`,
      );
    }
  }
  return { fingerprints };
}

// ---------------------------------------------------------------------------
// Alur utama
// ---------------------------------------------------------------------------

function main() {
  const [apkPath] = process.argv.slice(2);
  if (!apkPath || apkPath.startsWith('-')) {
    fail('Pemakaian: node scripts/verify-apk.mjs <berkas.apk>');
  }
  let apk;
  try {
    apk = readFileSync(apkPath);
  } catch (error) {
    fail(`Tidak bisa membaca berkas APK (${apkPath}).`, [String(error.message ?? error)]);
  }
  if (apk.length === 0) fail('Berkas APK kosong.');
  if (apk[0] !== 0x50 || apk[1] !== 0x4b) {
    fail('Berkas yang diperiksa bukan APK (arsip ZIP), kemungkinan halaman error yang terunduh.');
  }

  const eocdOffset = findEndOfCentralDirectory(apk);
  const { entries, centralDirectoryOffset } = readZipEntries(apk, eocdOffset);
  const block = readSigningBlock(apk, centralDirectoryOffset);
  const digests = digestEntries(apk, entries);

  const verifiedSchemes = [];
  const warnings = [];
  const fingerprints = [];
  const presentSchemes = [];

  for (const scheme of SCHEME_BLOCKS) {
    if (!block || !block.pairs.has(scheme.id)) continue;
    presentSchemes.push(scheme.name);
    try {
      const result = verifySchemeBlock(apk, block, eocdOffset, scheme);
      verifiedSchemes.push(scheme.name);
      fingerprints.push(...result.fingerprints);
    } catch (error) {
      if (!(error instanceof VerifyError)) throw error;
      if (scheme.tolerant) {
        warnings.push(`Blok ${scheme.name} dilewati: ${error.message}`);
        continue;
      }
      throw error;
    }
  }

  // Skema v1 dianggap hadir hanya bila ada berkas .SF. MANIFEST.MF sendirian
  // (mis. sisa dependensi JAR) bukan tanda tangan dan tidak perlu diperiksa.
  if (entries.some((entry) => /^META-INF\/[^/]+\.SF$/i.test(entry.name))) {
    presentSchemes.push('v1');
    const result = verifyV1(apk, entries, digests);
    verifiedSchemes.push('v1');
    fingerprints.push(...result.fingerprints);
  }

  if (block && verifiedSchemes.length === 0) {
    throw new VerifyError(
      'APK punya APK Signing Block tetapi tanda tangannya tidak bisa diverifikasi.',
      [`Blok yang ada: ${presentSchemes.join(', ') || 'tidak ada'}`],
    );
  }
  if (verifiedSchemes.length === 0) {
    throw new VerifyError(
      'APK tidak ditandatangani: tidak ada skema tanda tangan (v1/v2/v3) yang terverifikasi.',
      ['APK tanpa tanda tangan tidak bisa dipasang di Android dan tidak boleh dirilis.'],
    );
  }

  for (const warning of warnings) console.error(`::warning::${warning}`);
  console.log(`apk=${apkPath.split(/[\\/]/).pop()}`);
  console.log(`ukuran=${apk.length}`);
  console.log(`entri=${entries.length}`);
  console.log('crc32=cocok');
  console.log(`skema=${verifiedSchemes.join(',')}`);
  console.log(`penandatangan_sha256=${[...new Set(fingerprints)].join(',')}`);
}

try {
  main();
} catch (error) {
  if (error instanceof VerifyError) fail(error.message, error.extraLines ?? []);
  fail('Verifikasi APK gagal karena kesalahan tak terduga.', [String(error?.stack ?? error)]);
}
