/**
 * Generator aset statis RodaKawan (ikon, adaptive icon, splash mark).
 *
 * Aset dibuat dari kode agar dapat diregenerasi saat identitas visual final
 * ditetapkan (lihat ADR-001 pada docs/PROJECT_DECISIONS.md). Script ini hanya
 * memakai modul bawaan Node (zlib), tanpa dependency tambahan.
 *
 * Jalankan: npm run assets:generate
 *
 * Palet mengikuti src/constants/theme.ts: charcoal #0B0D10 dan amber #F59E0B.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(projectRoot, 'assets');

const CHARCOAL = { r: 0x0b, g: 0x0d, b: 0x10 };
const AMBER = { r: 0xf5, g: 0x9e, b: 0x0b };
const AMBER_SOFT = { r: 0xff, g: 0xc4, b: 0x6b };
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

/* ------------------------------------------------------------------ PNG ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function encodePng({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(6, 9); // color type: RGBA
  header.writeUInt8(0, 10); // compression
  header.writeUInt8(0, 11); // filter
  header.writeUInt8(0, 12); // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: None
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- raster ---- */

class Canvas {
  constructor(size) {
    this.size = size;
    this.pixels = new Uint8Array(size * size * 4);
  }

  fill(color) {
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = color.r;
      this.pixels[i + 1] = color.g;
      this.pixels[i + 2] = color.b;
      this.pixels[i + 3] = color.a === undefined ? 255 : color.a;
    }
  }

  blendAt(x, y, color, coverage) {
    if (coverage <= 0) return;
    const alpha = (color.a === undefined ? 1 : color.a) * Math.min(coverage, 1);
    const index = (y * this.size + x) * 4;
    const src = { r: color.r, g: color.g, b: color.b };
    const dstAlpha = this.pixels[index + 3] / 255;

    for (let channel = 0; channel < 3; channel += 1) {
      const dst = this.pixels[index + channel];
      const srcValue = channel === 0 ? src.r : channel === 1 ? src.g : src.b;
      const out = srcValue * alpha + dst * (1 - alpha);
      this.pixels[index + channel] = Math.round(out);
    }
    this.pixels[index + 3] = Math.round((alpha + dstAlpha * (1 - alpha)) * 255);
  }

  /**
   * Menggambar bentuk dengan anti-aliasing sederhana: setiap piksel diuji pada
   * 4x4 titik sampel, lalu dicampur sesuai cakupan (coverage).
   */
  drawShape(predicate, color, bounds) {
    const samples = 4;
    const step = 1 / samples;
    const offset = step / 2;

    const minX = Math.max(0, Math.floor(bounds.minX));
    const maxX = Math.min(this.size - 1, Math.ceil(bounds.maxX));
    const minY = Math.max(0, Math.floor(bounds.minY));
    const maxY = Math.min(this.size - 1, Math.ceil(bounds.maxY));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        let hits = 0;
        for (let sy = 0; sy < samples; sy += 1) {
          for (let sx = 0; sx < samples; sx += 1) {
            if (predicate(x + offset + sx * step, y + offset + sy * step)) hits += 1;
          }
        }
        if (hits > 0) this.blendAt(x, y, color, hits / (samples * samples));
      }
    }
  }

  ring(cx, cy, radius, thickness, color) {
    const outer = radius + thickness / 2;
    this.drawShape(
      (x, y) => {
        const distance = Math.hypot(x - cx, y - cy);
        return Math.abs(distance - radius) <= thickness / 2;
      },
      color,
      { minX: cx - outer - 2, maxX: cx + outer + 2, minY: cy - outer - 2, maxY: cy + outer + 2 },
    );
  }

  disc(cx, cy, radius, color) {
    this.drawShape((x, y) => Math.hypot(x - cx, y - cy) <= radius, color, {
      minX: cx - radius - 2,
      maxX: cx + radius + 2,
      minY: cy - radius - 2,
      maxY: cy + radius + 2,
    });
  }
}

/* --------------------------------------------------------------- marks ---- */

/** Mark "roda": cincin amber dengan hub terang, dipakai di semua aset. */
function drawWheelMark(canvas, { cx, cy, radius, thickness }) {
  canvas.ring(cx, cy, radius, thickness, AMBER);
  canvas.disc(cx, cy, Math.round(radius * 0.26), AMBER_SOFT);
}

function buildIcon(size) {
  const canvas = new Canvas(size);
  canvas.fill({ ...CHARCOAL, a: 1 });
  drawWheelMark(canvas, {
    cx: size * 0.5,
    cy: size * 0.5,
    radius: size * 0.29,
    thickness: size * 0.085,
  });
  return canvas;
}

function buildAdaptiveIcon(size) {
  const canvas = new Canvas(size);
  canvas.fill(TRANSPARENT);
  // Konten dibatasi di sekitar 50% area agar aman dari masking adaptive icon.
  drawWheelMark(canvas, {
    cx: size * 0.5,
    cy: size * 0.5,
    radius: size * 0.22,
    thickness: size * 0.07,
  });
  return canvas;
}

function buildSplashMark(size) {
  const canvas = new Canvas(size);
  canvas.fill(TRANSPARENT);
  drawWheelMark(canvas, {
    cx: size * 0.5,
    cy: size * 0.5,
    radius: size * 0.26,
    thickness: size * 0.08,
  });
  return canvas;
}

/* --------------------------------------------------------------- write ---- */

const outputs = [
  ['icon.png', buildIcon(1024)],
  ['adaptive-icon.png', buildAdaptiveIcon(1024)],
  ['splash-icon.png', buildSplashMark(1024)],
];

mkdirSync(assetsDir, { recursive: true });

for (const [fileName, canvas] of outputs) {
  const buffer = encodePng({ width: canvas.size, height: canvas.size, pixels: canvas.pixels });
  writeFileSync(join(assetsDir, fileName), buffer);
  console.log(`✔ assets/${fileName} (${canvas.size}x${canvas.size}, ${buffer.length} bytes)`);
}
