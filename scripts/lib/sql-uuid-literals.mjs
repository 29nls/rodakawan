/**
 * Pemeriksaan statis untuk berkas uji SQL: literal teks yang diberikan ke
 * parameter bertipe `uuid`.
 *
 * Kenapa pemeriksaan ini ada:
 * - PostgreSQL meng-cast literal string ke tipe parameter saat pemanggilan
 *   fungsi. Jadi `public.create_hazard(..., 'a-client-001')` pada fungsi yang
 *   parameter ketujuhnya `uuid` gagal dengan SQLSTATE `22P02` ("invalid input
 *   syntax for type uuid") — **sebelum badan fungsi dijalankan**. Galatnya
 *   muncul di berkas uji, bukan di schema, dan baru ketahuan setelah
 *   database dibuka. Satu literal salah di berkas uji memblokir seluruh berkas
 *   uji lain, karena runner berhenti pada galat pertama.
 * - Aplikasi sudah benar: `client_report_id` dan `client_message_id` dibuat
 *   dengan `Crypto.randomUUID()`. Yang keliru adalah nilai di berkas uji, dan
 *   nilai keliru itu tidak bisa ditangkap typecheck (SQL bukan TypeScript) atau
 *   `npm test` (Jest tidak menyentuh `.sql`).
 *
 * Yang diperiksa:
 *   1. Tanda tangan fungsi diambil dari `supabase/migrations/*.sql`, jadi daftar
 *      parameter bertipe `uuid` selalu mengikuti skema yang benar-benar dipakai
 *      — bukan daftar manual yang bisa basi.
 *   2. Setiap pemanggilan fungsi di `supabase/tests/*.sql` dipetakan ke
 *      parameternya (posisional maupun bernama, mis. `p_client_report_id => …`).
 *   3. Argumen yang berupa literal teks tunggal dan jatuh ke parameter `uuid`
 *      harus berbentuk UUID. Selain bentuk kanonis (8-4-4-4-12 heksadesimal),
 *      bentuk tanpa tanda hubung dan bentuk berkurung kurawal juga diterima
 *      PostgreSQL, jadi keduanya dianggap sah.
 *
 * Yang SENGAJA tidak diperiksa:
 * - Argumen yang bukan literal tunggal: variabel, subquery, `null`, atau
 *   `gen_random_uuid()`. Nilainya belum diketahui saat pemrosesan statis, jadi
 *   satu-satunya cara menilainya adalah menjalankannya.
 * - Parameter bertipe selain `uuid`. Mengoper literal teks ke parameter `text`
 *   memang hal yang wajar.
 * - Nama fungsi yang muncul di dalam literal string atau komentar: keduanya
 *   ditutup oleh `maskNonCode` sebelum pemindaian.
 *
 * Bentuk UUID yang diterima PostgreSQL dan dianggap sah di sini: kanonis
 * (8-4-4-4-12 heksadesimal), tanpa tanda hubung (32 heksadesimal), dan
 * berkurung kurawal (`{…}`). `{}` — UUID nil — juga sah.
 *
 * Semua fungsi di berkas ini murni (tanpa I/O) supaya bisa diuji langsung.
 */

/** Bentuk kanonis UUID: 8-4-4-4-12 heksadesimal. */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bentuk tanpa tanda hubung (32 heksadesimal) juga diterima PostgreSQL. */
const UNHYPHENATED_UUID = /^[0-9a-f]{32}$/i;

/** Definisi fungsi SQL: `create [or replace] function <nama>(`. */
const FUNCTION_DEFINITION =
  /\bcreate\s+(?:or\s+replace\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\(/gi;

/** Argumen bernama: `p_nama => nilai`. */
const NAMED_ARGUMENT = /^([A-Za-z_][A-Za-z0-9_]*)\s*=>\s*([\s\S]*)$/;

/**
 * Literal teks tunggal, opsional diikuti cast (`'…'::uuid`).
 * Rangkaian (`'a' || 'b'`) sengaja TIDAK cocok: nilainya bukan satu literal,
 * jadi tidak bisa dinilai statis.
 */
const SINGLE_STRING_LITERAL = /^'((?:[^']|'')*)'\s*(?:::\s*[A-Za-z_][A-Za-z0-9_.]*\s*)*$/;

/** Jendela pencarian tag dollar-quoted (`$body$`, `$$`). */
const DOLLAR_TAG_WINDOW = 128;

/**
 * Menyalin teks dan replaces isi string, identifier berpetik, dan komentar
 * dengan spasi, sehingga panjang teks tetap sama dan nomor baris tidak bergeser.
 *
 * Dipakai sebagai "topeng kode": hanya isi yang masih berupa kode yang boleh
 * dipindai. Tanpa ini, nama fungsi yang muncul di dalam literal string
 * (`to_regprocedure('public.create_hazard(…)')`) akan terlihat seperti
 * pemanggilan fungsi sungguhan.
 *
 * `blankDollarQuoted` mengatur perlakuan terhadap region dollar-quoted
 * (`$$…$$`, `$tag$…$tag$`):
 * - `false` (bawaan): isinya dianggap KODE dan dibiarkan utuh. Ini yang
 *   dibutuhkan untuk memindai berkas uji, karena badan PL/pgSQL di dalam
 *   `do $$ … $$` memuat pemanggilan fungsi yang justru harus diperiksa.
 * - `true`: isinya dikosongkan. Ini yang dibutuhkan untuk memindai
 *   migration, agar `create function` di dalam badan fungsi lain tidak
 *   terbaca sebagai definisi baru.
 *
 * `blankStrings` mengatur perlakuan terhadap string:
 * - `true` (bawaan): isi string ikut dikosongkan. Dipakai saat memindai
 *   struktur kode, supaya koma atau kurung di dalam string tidak ikut
 *   terhitung.
 * - `false`: string dibiarkan utuh, hanya komentar yang dikosongkan. Dipakai
 *   saat mengambil isi literal, karena isinya justru yang perlu dibaca.
 */
export function maskNonCode(sql, { blankDollarQuoted = false, blankStrings = true } = {}) {
  const source = String(sql ?? '');
  const chars = source.split('');
  const length = chars.length;
  let index = 0;

  /** Marker penutup region dollar-quoted yang sedang aktif, atau -1. */
  let dollarClose = -1;
  /** Panjang marker pembuka yang sedang aktif. */
  let dollarMarkerLength = 0;

  /** Mengosongkan rentang, kecuali baris baru yang harus tetap utuh. */
  const blank = (from, to) => {
    for (let position = from; position < to; position += 1) {
      if (chars[position] !== '\n' && chars[position] !== '\r') chars[position] = ' ';
    }
  };

  while (index < length) {
    // Sampai penutup region dollar-quoted: lewati penandanya.
    if (dollarClose !== -1 && index === dollarClose) {
      index = dollarClose + dollarMarkerLength;
      dollarClose = -1;
      dollarMarkerLength = 0;
      continue;
    }

    const char = chars[index];

    // Komentar baris: `-- ...` sampai baris baru.
    if (char === '-' && chars[index + 1] === '-') {
      let end = index;
      while (end < length && chars[end] !== '\n') end += 1;
      blank(index, end);
      index = end;
      continue;
    }

    // Komentar blok: `/* ... */`.
    if (char === '/' && chars[index + 1] === '*') {
      let end = index + 2;
      while (end < length && !(chars[end] === '*' && chars[end + 1] === '/')) end += 1;
      end = Math.min(end + 2, length);
      blank(index, end);
      index = end;
      continue;
    }

    // String dengan tanda kutip tunggal; `''` adalah escape, bukan penutup.
    if (char === "'") {
      let end = index + 1;
      while (end < length) {
        if (chars[end] === "'") {
          if (chars[end + 1] === "'") {
            end += 2;
            continue;
          }
          end += 1;
          break;
        }
        end += 1;
      }
      if (blankStrings) blank(index, end);
      index = end;
      continue;
    }

    // Identifier dengan tanda kutip ganda; `""` adalah escape.
    if (char === '"') {
      let end = index + 1;
      while (end < length) {
        if (chars[end] === '"') {
          if (chars[end + 1] === '"') {
            end += 2;
            continue;
          }
          end += 1;
          break;
        }
        end += 1;
      }
      blank(index, end);
      index = end;
      continue;
    }

    // String dollar-quoted: `$$…$$` atau `$tag$…$tag$`.
    //
    // Dua perlakuan:
    // - `blankDollarQuoted` (dipakai saat memindai migration): seluruh region
    //   dikosongkan, jadi `create function` di dalam badan fungsi lain tidak
    //   terbaca sebagai definisi baru.
    // - Selain itu (dipakai saat memindai berkas uji): isi region diperlakukan
    //   sebagai KODE dan dipindai terus — badan PL/pgSQL di dalam
    //   `do $$ … $$` justru memuat pemanggilan yang harus diperiksa. Penanda
    //   `$` di dalam badan tidak boleh dibaca sebagai pembuka quote baru, jadi
    //   penutupnya dicatat lebih dulu lalu dilewati.
    if (char === '$' && dollarClose === -1) {
      const window = source.slice(index, index + DOLLAR_TAG_WINDOW);
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(window);

      if (tag) {
        const marker = tag[0];
        const closing = source.indexOf(marker, index + marker.length);

        if (blankDollarQuoted) {
          const end = closing === -1 ? length : closing + marker.length;
          blank(index, end);
          index = end;
          continue;
        }

        dollarMarkerLength = marker.length;
        dollarClose = closing === -1 ? length : closing;
        index += marker.length;
        continue;
      }
    }

    index += 1;
  }

  return chars.join('');
}

/**
 * Indeks kurung penutup yang cocok dengan kurung buka di `openIndex`.
 * Mengembalikan -1 bila tidak pernah tertutup.
 *
 * Masukan idealnya sudah dimask, sehingga kurung di dalam string atau komentar
 * tidak ikut terhitung.
 */
export function findMatchingParen(masked, openIndex) {
  let depth = 0;

  for (let index = openIndex; index < masked.length; index += 1) {
    if (masked[index] === '(') depth += 1;
    else if (masked[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * Membagi teks pada koma di level terluar.
 * Mengembalikan rentang `{ start, end }` (end eksklusif) relatif terhadap teks
 * masukan, supaya pemanggil bisa mengambil teks aslinya dari SQL.
 */
export function splitTopLevel(masked) {
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index];

    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push({ start, end: index });
      start = index + 1;
    }
  }

  parts.push({ start, end: masked.length });
  return parts;
}

/**
 * Posisi kata `keyword` di level terluar (di luar kurung dan kurung siku),
 * atau -1 bila tidak ada. Memakai teks yang sudah dimask, jadi kata kunci di
 * dalam string atau komentar tidak ikut terhitung.
 */
function findTopLevelKeyword(masked, keyword) {
  const pattern = new RegExp(`\\b${keyword}\\b`, 'gi');
  let depth = 0;

  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index];

    if (char === '(' || char === '[') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;

    pattern.lastIndex = index;
    const match = pattern.exec(masked);
    if (match && match.index === index) return index;
  }

  return -1;
}

/** Menormalkan nama tipe parameter: huruf kecil, spasi dirapatkan. */
function normalizeType(type) {
  return String(type ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Mode parameter PostgreSQL: `IN`, `OUT`, `INOUT`, `VARIADIC`.
 * `CREATE FUNCTION` hanya menerima `IN` dan `VARIADIC`, tapi `CREATE PROCEDURE`
 * juga menerima `OUT`/`INOUT` — semuanya dilepas supaya tipe parameter dibaca
 * dengan benar.
 */
const PARAMETER_MODE = /^(?:inout|in|out|variadic)\s+/i;

/**
 * Mengurai satu parameter fungsi: nama, tipe, dan apakah punya nilai default.
 * Mengembalikan `null` bila bukan parameter bernama yang bisa dipahami.
 */
function parseParameter(maskedParameter) {
  const text = maskedParameter.trim();
  if (text === '') return null;

  const withoutMode = text.replace(PARAMETER_MODE, '');
  if (withoutMode === '') return null;

  const defaultAt = findTopLevelKeyword(withoutMode, 'default');
  const head = (defaultAt === -1 ? withoutMode : withoutMode.slice(0, defaultAt)).trim();

  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+([\s\S]+)$/.exec(head);
  if (!match) return null;

  return {
    name: match[1],
    type: normalizeType(match[2]),
    hasDefault: defaultAt !== -1,
  };
}

/**
 * Mengambil tanda tangan fungsi dari satu berkas SQL.
 * Mengembalikan daftar `{ name, params }` dengan `name` tanpa prefik skema.
 */
export function parseFunctionSignatures(sql) {
  const source = String(sql ?? '');
  // Badan fungsi (`as $$ … $$`) dikosongkan supaya `create function` di dalam
  // badan tidak terbaca sebagai definisi baru.
  const masked = maskNonCode(source, { blankDollarQuoted: true });
  const signatures = [];

  for (const match of masked.matchAll(FUNCTION_DEFINITION)) {
    const openParen = match.index + match[0].length - 1;
    const closeParen = findMatchingParen(masked, openParen);
    if (closeParen === -1) continue;

    const params = [];
    const list = masked.slice(openParen + 1, closeParen);

    for (const part of splitTopLevel(list)) {
      const parameter = parseParameter(list.slice(part.start, part.end));
      if (parameter) params.push(parameter);
    }

    const qualified = match[1];
    const name = qualified.includes('.') ? qualified.split('.').pop() : qualified;

    signatures.push({ name, qualifiedName: qualified, params });
  }

  return signatures;
}

/**
 * Menggabungkan tanda tangan dari banyak berkas migration menjadi peta
 * nama fungsi → daftar tanda tangan.
 *
 * Berkas dibaca berurutan (nama berkas), jadi definisi yang lebih baru
 * menimpa definisi lama — sama seperti saat migration diterapkan.
 */
export function collectSignatures(files) {
  const byName = new Map();

  for (const file of files) {
    for (const signature of parseFunctionSignatures(file.sql)) {
      const key = signature.name.toLowerCase();
      const existing = byName.get(key) ?? [];

      // PostgreSQL hanya mengganti definisi lama bila nama DAN tipe parameternya
      // sama persis. Bila tipenya beda, `create or replace` menambah overload
      // baru — jadi keduanya harus tetap tercatat.
      const sameShape = existing.findIndex(
        (candidate) =>
          candidate.params.length === signature.params.length &&
          candidate.params.every(
            (parameter, index) =>
              parameter.name === signature.params[index].name &&
              parameter.type === signature.params[index].type,
          ),
      );

      if (sameShape === -1) existing.push(signature);
      else existing[sameShape] = signature;

      byName.set(key, existing);
    }
  }

  return byName;
}

/** Meloloskan karakter regex pada nama fungsi. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apakah isi literal teks tersebut adalah UUID yang sah menurut PostgreSQL?
 * Bentuk kanonis, tanpa tanda hubung, dan berkurung kurawal 모두 diterima.
 */
export function isUuidLiteral(content) {
  const text = String(content ?? '').trim();

  if (text.startsWith('{') && text.endsWith('}')) {
    const inner = text.slice(1, -1).trim();
    // `{}` adalah UUID nil yang sah.
    if (inner === '') return true;
    return CANONICAL_UUID.test(inner) || UNHYPHENATED_UUID.test(inner);
  }

  return CANONICAL_UUID.test(text) || UNHYPHENATED_UUID.test(text);
}

/**
 * Mencari literal teks tunggal di dalam sebuah argumen.
 *
 * Mengembalikan `{ literal, index }` dengan `index` adalah posisi pembuka
 * kutip di dalam teks argumen — dipakai untuk menunjuk lokasi yang tepat di
 * pesan galat. Mengembalikan `null` bila argumen bukan literal tunggal.
 */
function matchStringLiteral(argument) {
  const match = SINGLE_STRING_LITERAL.exec(String(argument ?? '').trim());
  if (!match) return null;

  return { literal: match[1].replace(/''/g, "'"), index: match.index };
}

/**
 * Mengambil isi literal teks tunggal dari sebuah argumen.
 * Mengembalikan `null` bila argumen bukan literal tunggal.
 */
export function singleStringLiteral(argument) {
  return matchStringLiteral(argument)?.literal ?? null;
}

/**
 * Menemukan parameter yang sesuai untuk argumen ke-`index`.
 * Mengembalikan `null` bila argumen.named tidak dikenal pada tanda tangan itu.
 */
function resolveParameter(params, index, name) {
  if (name !== null) {
    const wanted = name.toLowerCase();
    return params.find((parameter) => parameter.name.toLowerCase() === wanted) ?? null;
  }

  return params[index] ?? null;
}

/**
 * Membelah argumen menjadi nama parameter dan nilainya.
 *
 * PostgreSQL menerima dua penulisan argumen:
 * - posisional: f('a', 'b')
 * - bernama:     f(p_a => 'a', p_b => 'b')
 *
 * Keduanya harus bisa dinilai. Untuk argumen bernama, hanya bagian nilainya
 * yang boleh jadi literal; nama parameternya bukan data.
 *
 * Mengembalikan `{ name, value }` dengan `name` berupa `null` untuk argumen
 * posisional.
 */
export function splitArgument(argument) {
  const text = String(argument ?? '').trim();
  const named = NAMED_ARGUMENT.exec(text);

  if (named) {
    const value = named[2];
    // Posisi nilai relatif terhadap teks argumen yang sudah dirapikan.
    const valueIndex = named.index + named[0].length - value.length;
    return { name: named[1], value: value.trim(), valueIndex };
  }

  return { name: null, value: text, valueIndex: 0 };
}

/**
 * Memangkas rentang teks yang hanya berisi spasi di kedua ujungnya.
 * Mengembalikan `{ start, end }` dengan `end` eksklusif.
 */
function trimRange(text, start, end) {
  let from = start;
  let to = end;

  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;

  return { start: from, end: to };
}

/**
 * Memeriksa satu berkas SQL terhadap daftar tanda tangan fungsi.
 * Mengembalikan daftar pelanggaran:
 *   `{ line, column, functionName, paramName, literal }`
 */
export function findUuidLiteralViolations(sql, signatures) {
  const source = String(sql ?? '');
  // Struktur kode: string dikosongkan supaya koma dan kurung di dalamnya tidak
  // ikut terhitung.
  const masked = maskNonCode(source);
  // Teks argumen: komentar dikosongkan, tapi string dibiarkan utuh karena
  // isinya justru yang perlu dinilai.
  const readable = maskNonCode(source, { blankStrings: false });
  const violations = [];
  const seen = new Set();

  for (const [name, overloads] of signatures) {
    const callPattern = new RegExp(
      `(?<![A-Za-z0-9_."])((?:[A-Za-z_][A-Za-z0-9_]*\\.)?${escapeRegExp(name)})\\s*\\(`,
      'gi',
    );

    for (const call of masked.matchAll(callPattern)) {
      const openParen = call.index + call[0].length - 1;
      const closeParen = findMatchingParen(masked, openParen);
      if (closeParen === -1) continue;

      const list = masked.slice(openParen + 1, closeParen);
      const argumentsList = splitTopLevel(list);

      for (const [index, part] of argumentsList.entries()) {
        const range = trimRange(readable, openParen + 1 + part.start, openParen + 1 + part.end);
        const {
          name: argumentName,
          value,
          valueIndex,
        } = splitArgument(readable.slice(range.start, range.end));

        const match = matchStringLiteral(value);
        if (match === null) continue;

        // Posisi literal di dalam berkas: argumen dirapikan lebih dulu, lalu
        // nilai di dalamnya dihitung relatif terhadap argumen itu.
        const literalStart = range.start + valueIndex + match.index;

        for (const overload of overloads) {
          const parameter = resolveParameter(overload.params, index, argumentName);
          if (!parameter || parameter.type !== 'uuid') continue;
          if (isUuidLiteral(match.literal)) continue;

          const before = source.slice(0, literalStart);
          const line = before.split('\n').length;
          const column = literalStart - (before.lastIndexOf('\n') + 1) + 1;

          const key = `${line}:${column}:${overload.name}:${parameter.name}:${match.literal}`;
          if (seen.has(key)) continue;
          seen.add(key);

          violations.push({
            line,
            column,
            functionName: overload.qualifiedName ?? overload.name,
            paramName: parameter.name,
            literal: match.literal,
          });
        }
      }
    }
  }

  return violations.sort((left, right) =>
    left.line === right.line ? left.column - right.column : left.line - right.line,
  );
}

/**
 * Memeriksa sekumpulan berkas uji terhadap tanda tangan dari migration.
 * `migrations` dan `tests` berupa `{ path, sql }`.
 */
export function checkTestFiles(migrations, tests) {
  const signatures = collectSignatures(migrations);
  const findings = [];

  for (const test of tests) {
    for (const violation of findUuidLiteralViolations(test.sql, signatures)) {
      findings.push({ file: test.path, ...violation });
    }
  }

  return findings;
}

/**
 * Menghitung nomor baris untuk offset tertentu pada teks.
 * Dipakai di luar modul ini untuk memformat pesan.
 */
export function lineOf(text, offset) {
  return String(text ?? '')
    .slice(0, offset)
    .split('\n').length;
}
