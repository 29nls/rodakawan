/**
 * Uji statis halaman web publik di `web/`.
 *
 * Halaman ini diterbitkan ke GitHub Pages oleh `.github/workflows/pages.yml` dan
 * menjadi satu-satunya halaman hapus data yang bisa dibuka tanpa memasang
 * aplikasi. Karena tidak ada build step, satu-satunya gerbang sebelum terbit
 * adalah test ini: ia membaca berkas yang **akan** diunggah, bukan salinan lain.
 *
 * Sejak RodaKawan tidak punya akun (ADR-083), halaman hapus data tidak lagi
 * punya formulir login: penghapusan terjadi di aplikasi, dan halaman hanya
 * menjelaskan langkah serta konsekuensinya. Yang dijaga di sini:
 * - konten wajib: retensi per jenis data, kontak dukungan, dan langkah hapus
 *   data (halaman yang kehilangan bagian ini tetap "tampil", tetapi tidak
 *   memenuhi syarat Play Console);
 * - tidak ada formulir email/kata sandi yang menjanjikan jalur yang tidak ada;
 * - tidak ada JavaScript yang mengirim data ke Supabase dari halaman publik;
 * - tautan internal tidak patah;
 * - tidak ada skrip, iframe, atau tracker pihak ketiga;
 * - tidak ada secret, URL project, JWT, atau connection string database;
 * - workflow Pages hanya mengunggah `web/` dengan izin minimal.
 *
 * Jalankan: `npm run test:scripts` (atau `node --test scripts/__tests__/web-static.test.mjs`).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const WEB = path.join(ROOT, 'web');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'pages.yml');

const PAGES = ['index.html', 'privacy/index.html', 'account-deletion/index.html'];
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.css', '.md', '.txt', '.json', '.svg']);

const read = (file) => fs.readFileSync(file, 'utf8').split('\r\n').join('\n');
const webFile = (relative) => path.join(WEB, relative);
const webText = (relative) => read(webFile(relative));

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
}

const allWebFiles = walk(WEB);
const textWebFiles = allWebFiles.filter((file) => TEXT_EXTENSIONS.has(path.extname(file)));

/** Konten yang harus ada di halaman privasi (retensi + kontak + jalur hapus). */
const PRIVACY_CONTENT = [
  'Posisi terakhir',
  'Pesan konvoi',
  'Laporan bahaya',
  'Setelah penghapusan akun',
  'Metadata status penghapusan',
  'Profil → Hapus data saya',
  'github.com/29nls/rodakawan/issues',
];

/** Konsekuensi yang harus dinyatakan sebelum pengguna menghapus data. */
const DELETION_CONTENT = [
  'Profil → Hapus data saya',
  'Identitas anonim',
  'Laporan bahaya',
  'Pesan konvoi',
  'Kepemilikan klub/perjalanan',
  'tidak bisa dibatalkan',
  'github.com/29nls/rodakawan/issues',
];

describe('Halaman web publik: isi wajib', () => {
  it('tiga halaman statis ada dan memakai struktur dasar yang sama', () => {
    for (const page of PAGES) {
      const html = webText(page);
      assert.match(html, /^<!doctype html>/i, `${page} harus diawali <!doctype html>`);
      assert.match(html, /<html lang="id">/, `${page} harus menyatakan bahasa Indonesia`);
      assert.match(html, /<meta charset="utf-8"\s*\/?>/i, `${page} harus menyatakan charset`);
      assert.match(html, /<meta name="viewport"/, `${page} harus punya viewport`);
      assert.match(html, /<title>[^<]{5,}<\/title>/, `${page} harus punya judul`);
    }
  });

  it('halaman privasi menyebut retensi per jenis data, kontak, dan jalur hapus data', () => {
    const html = webText('privacy/index.html');

    for (const phrase of PRIVACY_CONTENT) {
      assert.ok(html.includes(phrase), `halaman privasi tidak menyebut "${phrase}"`);
    }

    // Retensi tidak boleh hanya "disimpan selama diperlukan" tanpa menyebut
    // data yang dipertahankan setelah akun dihapus; dua bagian ini yang dipakai
    // Play Console untuk menilai kebijakan.
    assert.match(
      html,
      /Setelah penghapusan akun[\s\S]{0,400}dihapus/,
      'retensi setelah hapus akun tidak dijelaskan',
    );
    assert.match(
      html,
      /tidak lagi menunjuk identitas Anda/,
      'halaman harus menyatakan konten yang dipertahankan tidak lagi menunjuk identitas',
    );
    assert.doesNotMatch(html, /email \(dikelola/, 'halaman masih menggambarkan akun email');
  });

  it('halaman hapus data menjelaskan langkah aplikasi tanpa formulir login', () => {
    const html = webText('account-deletion/index.html');

    for (const phrase of DELETION_CONTENT) {
      assert.ok(html.includes(phrase), `halaman hapus data tidak menyebut "${phrase}"`);
    }

    // Tidak ada formulir: tidak ada akun, jadi tidak ada yang bisa "masuk".
    assert.doesNotMatch(html, /<form\b/i, 'halaman tidak boleh punya formulir');
    assert.doesNotMatch(html, /<input\b/i, 'halaman tidak boleh punya kolom input');
    assert.doesNotMatch(html, /type="password"/i, 'halaman tidak boleh meminta kata sandi');
    assert.doesNotMatch(html, /type="email"/i, 'halaman tidak boleh meminta email');
    assert.doesNotMatch(
      html,
      /autocomplete="current-password"/i,
      'halaman tidak boleh menyiratkan login kata sandi',
    );

    // Halaman harus menyatakan batasnya, bukan menawarkan jalur yang tidak ada.
    assert.match(
      html,
      /tidak ada jalur penghapusan dari browser|tidak bisa dipulihkan dari luar|hanya ada di perangkat/i,
      'halaman harus menyatakan bahwa penghapusan tidak dilakukan dari browser',
    );
  });

  it('halaman tidak mengklaim URL publik yang belum diverifikasi', () => {
    // README menjelaskan pola URL dan justru melarang menebaknya; yang diperiksa
    // adalah halaman yang benar-benar tampil ke pengguna.
    for (const page of PAGES) {
      const html = webText(page);
      assert.doesNotMatch(html, /github\.io/i, `${page} menyebut URL Pages yang belum tentu aktif`);
      assert.doesNotMatch(
        html,
        /https?:\/\/(?:www\.)?rodakawan\.[a-z]/i,
        `${page} mengarang domain produk`,
      );
    }
  });
});

describe('Halaman web publik: tautan dan pihak ketiga', () => {
  /** Ambil href/src lokal dari HTML, lalu pastikan berkas tujuannya ada. */
  it('seluruh tautan dan aset internal menunjuk berkas yang ada', () => {
    for (const page of PAGES) {
      const html = webText(page);
      const base = path.dirname(webFile(page));
      const references = [
        ...html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi),
        ...html.matchAll(/<link\b[^>]*\bhref\s*=\s*"([^"]+)"/gi),
        ...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi),
      ].map((match) => match[1]);

      assert.ok(references.length >= 2, `${page} harus punya tautan navigasi`);

      for (const reference of references) {
        if (/^(?:https?:|mailto:|#)/i.test(reference)) continue;

        const target = reference.endsWith('/')
          ? path.join(base, reference, 'index.html')
          : path.extname(reference)
            ? path.join(base, reference)
            : path.join(base, reference, 'index.html');

        const resolved = path.resolve(target);
        assert.ok(
          resolved === WEB || resolved.startsWith(WEB + path.sep),
          `${page}: tautan "${reference}" keluar dari folder web/`,
        );
        assert.ok(
          fs.existsSync(resolved),
          `${page}: tautan "${reference}" menunjuk berkas yang tidak ada (${path.relative(ROOT, resolved)})`,
        );
      }
    }
  });

  it('tidak ada JavaScript, skrip, iframe, stylesheet, atau tracker pihak ketiga', () => {
    const thirdParty =
      /google-analytics|googletagmanager|googlesyndication|doubleclick|facebook\.(?:net|com)|hotjar|plausible\.io|segment\.(?:io|com)|mixpanel|sentry\.io|fullstory|clarity\.ms/i;

    for (const page of PAGES) {
      const html = webText(page);
      assert.doesNotMatch(
        html,
        /<script\b/i,
        `${page} memuat skrip; halaman hapus data tidak boleh menjalankan JavaScript`,
      );
    }

    for (const file of textWebFiles) {
      const text = read(file);
      const name = path.relative(ROOT, file);

      assert.doesNotMatch(
        text,
        /<script\b[^>]*\bsrc\s*=\s*["']https?:/i,
        `${name} memuat skrip eksternal`,
      );
      assert.doesNotMatch(text, /<iframe\b/i, `${name} memuat iframe`);
      assert.doesNotMatch(
        text,
        /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']https?:/i,
        `${name} memuat stylesheet eksternal`,
      );
      assert.doesNotMatch(text, thirdParty, `${name} menyebut layanan pelacak pihak ketiga`);
    }
  });
});

describe('Halaman web publik: rahasia dan konfigurasi', () => {
  it('tidak ada secret, URL project, JWT, atau connection string di web/', () => {
    const forbidden = [
      { pattern: /xvmcpfkkveeaevfcvfug/, label: 'ref project development' },
      { pattern: /[a-z0-9]{20}\.supabase\.co/i, label: 'URL project Supabase' },
      { pattern: /sb_publishable_[A-Za-z0-9_-]{10,}/, label: 'publishable key' },
      { pattern: /sb_secret_[A-Za-z0-9_-]{10,}/, label: 'secret key Supabase' },
      { pattern: /SUPABASE_SERVICE_ROLE_KEY/, label: 'nama service role key' },
      { pattern: /postgres(?:ql)?:\/\/[^\s"'<>]*@/, label: 'connection string database' },
      { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
      { pattern: /eyJ[A-Za-z0-9_-]{10,}\./, label: 'JWT' },
    ];

    for (const file of textWebFiles) {
      const text = read(file);
      const name = path.relative(ROOT, file);

      for (const { pattern, label } of forbidden) {
        assert.doesNotMatch(text, pattern, `${name} memuat ${label}`);
      }

      assert.doesNotMatch(text, /\bstorage:/i, `${name} menyentuh localStorage/sessionStorage`);
    }
  });

  it('halaman hapus data tidak lagi bergantung pada berkas konfigurasi', () => {
    // Halaman yang butuh config cenderung butuh URL + kunci; keduanya sekarang
    // dilarang. Bila kebutuhan itu muncul lagi, ubah ADR-083 lebih dulu.
    assert.equal(
      fs.existsSync(webFile('account-deletion/config.js')),
      false,
      'config.js tidak boleh kembali tanpa keputusan produk baru',
    );
    assert.equal(
      fs.existsSync(webFile('account-deletion/app.js')),
      false,
      'app.js tidak boleh kembali: halaman tidak menjalankan JavaScript',
    );
  });
});

describe('Workflow GitHub Pages', () => {
  it('workflow ada dan menerbitkan folder web/ dengan izin minimal', () => {
    const workflow = read(WORKFLOW);

    assert.match(workflow, /^\s*-\s*'web\/\*\*'/m, 'trigger harus dibatasi pada web/**');
    assert.match(workflow, /^\s*workflow_dispatch:/m, 'harus bisa dijalankan manual');
    assert.doesNotMatch(
      workflow,
      /^\s*pull_request:/m,
      'halaman publik tidak boleh terbit dari pull request',
    );
    assert.match(workflow, /path:\s*web\b/, 'artefak harus hanya folder web/');
    assert.match(
      workflow,
      /uses:\s*actions\/upload-pages-artifact@v\d+/,
      'harus mengunggah artefak Pages',
    );
    assert.match(workflow, /uses:\s*actions\/deploy-pages@v\d+/, 'harus memakai deploy-pages');
    assert.match(workflow, /pages:\s*write/, 'job deploy membutuhkan pages: write');
    assert.match(workflow, /id-token:\s*write/, 'job deploy membutuhkan id-token: write');
    assert.doesNotMatch(workflow, /secrets\./, 'workflow ini tidak boleh memakai secret');
  });

  it('halaman yang diuji adalah halaman yang diunggah', () => {
    // Kalau `path` berubah (mis. ke root repository), test ini tetap lulus
    // tetapi yang terbit bukan halaman ini — dan `.env*` bisa ikut. Karena itu
    // path artifact dan folder yang dibaca test harus tetap sama.
    const workflow = read(WORKFLOW);
    assert.match(workflow, /path:\s*web\s*$/m);

    const buildStep = /node --test scripts\/__tests__\/web-static\.test\.mjs/.test(workflow);
    assert.equal(buildStep, true, 'step uji statis harus berjalan sebelum unggah');
  });
});
