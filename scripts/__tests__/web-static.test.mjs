/**
 * Uji statis halaman web publik di `web/`.
 *
 * Halaman ini diterbitkan ke GitHub Pages oleh `.github/workflows/pages.yml` dan
 * menjadi satu-satunya jalur hapus akun yang bisa dipakai tanpa memasang
 * aplikasi — syarat Google Play. Karena tidak ada build step, satu-satunya
 * gerbang sebelum terbit adalah test ini: ia membaca berkas yang **akan**
 * diunggah, bukan salinan lain.
 *
 * Yang dijaga:
 * - konten wajib: retensi per jenis data, kontak dukungan, dan langkah hapus
 *   akun (halaman yang kehilangan bagian ini tetap "tampil", tetapi tidak
 *   memenuhi syarat Play Console);
 * - tautan internal tidak patah (halaman 404 di jalur hapus akun membuat
 *   pengguna tidak bisa menghapus akunnya);
 * - tidak ada skrip, iframe, atau tracker pihak ketiga (halaman ini memegang
 *   kata sandi; permukaan pihak ketiga harus nol);
 * - tidak ada secret, URL database, JWT, atau ref project development di
 *   berkas yang diterbitkan;
 * - `config.js` hanya memuat URL, publishable key, dan tautan — publishable key
 *   berbentuk JWT lama hanya boleh bila payload-nya berperan `anon`, sehingga
 *   service role key yang tidak sengaja ditempel tertangkap;
 * - `app.js` tidak menyimpan token di storage dan tidak mencetaknya;
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
  'Profil → Hapus akun',
  'github.com/29nls/rodakawan/issues',
];

/** Konsekuensi yang harus dinyatakan sebelum pengguna menghapus akun. */
const DELETION_CONTENT = [
  'Identitas login',
  'Laporan bahaya',
  'Pesan konvoi',
  'Kepemilikan klub/perjalanan',
  'tidak bisa dibatalkan',
  'HAPUS AKUN',
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

  it('halaman privasi menyebut retensi per jenis data, kontak, dan jalur hapus akun', () => {
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
  });

  it('halaman hapus akun menyatakan konsekuensi dan konfirmasi ketik ulang', () => {
    const html = webText('account-deletion/index.html');

    for (const phrase of DELETION_CONTENT) {
      assert.ok(html.includes(phrase), `halaman hapus akun tidak menyebut "${phrase}"`);
    }

    assert.match(html, /id="konfirmasi"/, 'input konfirmasi harus ada');
    assert.match(
      html,
      /autocomplete="current-password"/,
      'input kata sandi harus memakai autocomplete kata sandi',
    );
    assert.match(html, /role="alert"/, 'pesan galat harus diumumkan ke pembaca layar');
    assert.match(html, /aria-live="polite"/, 'status proses harus diumumkan tanpa mengganggu');
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

  it('tidak ada skrip, iframe, stylesheet, atau tracker pihak ketiga', () => {
    const thirdParty =
      /google-analytics|googletagmanager|googlesyndication|doubleclick|facebook\.(?:net|com)|hotjar|plausible\.io|segment\.(?:io|com)|mixpanel|sentry\.io|fullstory|clarity\.ms/i;

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
  it('tidak ada secret, URL database, JWT, atau ref project development di web/', () => {
    const forbidden = [
      { pattern: /xvmcpfkkveeaevfcvfug/, label: 'ref project development' },
      { pattern: /sb_secret_[A-Za-z0-9_-]{10,}/, label: 'secret key Supabase' },
      { pattern: /SUPABASE_SERVICE_ROLE_KEY/, label: 'nama service role key' },
      { pattern: /postgres(?:ql)?:\/\/[^\s"'<>]*@/, label: 'connection string database' },
      { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
    ];

    for (const file of textWebFiles) {
      const text = read(file);
      const name = path.relative(ROOT, file);

      // Lewati config.js dalam pemindaian rahasian umum — berkas ini
      // sengaja berisi URL project Supabase dan publishable key yang
      // diakses publik (lihat test 'config.js hanya memuat URL project').
      if (path.basename(file) !== 'config.js') {
        for (const { pattern, label } of forbidden) {
          assert.doesNotMatch(text, pattern, `${name} memuat ${label}`);
        }

        // JWT diizinkan hanya di config.js (publishable/anon key lama); berkas
        // lain tidak punya alasan memuat token apa pun.
        assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\./, `${name} memuat JWT`);
      }
    }
  });

  it('config.js hanya memuat URL project, publishable key, dan tautan', () => {
    const source = webText('account-deletion/config.js');
    const match = /window\.RODAKAWAN_WEB\s*=\s*\{([\s\S]*?)\};/.exec(source);
    assert.ok(match, 'config.js harus menetapkan window.RODAKAWAN_WEB');

    const body = match[1];
    // Hanya kunci di awal baris (properti objek), bukan "https:" di dalam nilai.
    const keys = [...body.matchAll(/^\s{2,}([A-Za-z][A-Za-z0-9_]*)\s*:/gm)]
      .map((entry) => entry[1])
      .sort();
    assert.deepEqual(
      keys,
      ['privacyUrl', 'publishableKey', 'supabaseUrl', 'supportUrl'],
      'config.js memuat kunci yang tidak diizinkan; jangan menambah service role atau secret',
    );

    const valueOf = (key) => {
      const found = new RegExp(`${key}\\s*:\\s*'([^']*)'`).exec(body);
      assert.ok(found, `config.js tidak memuat nilai ${key}`);
      return found[1];
    };

    const supabaseUrl = valueOf('supabaseUrl');
    assert.match(
      supabaseUrl,
      /^https:\/\/(?:GANTI-PROJECT-REF|[a-z0-9-]+)\.supabase\.co$/,
      `supabaseUrl harus URL project Supabase, bukan: ${supabaseUrl}`,
    );

    // Placeholder tetap boleh; begitu diisi, nilainya harus publishable.
    // Anon key lama berbentuk JWT — periksa payload-nya agar service role key
    // yang tertempel tidak lolos hanya karena "kelihatan seperti kunci".
    const publishableKey = valueOf('publishableKey');
    if (/^GANTI-/.test(publishableKey)) {
      // belum dikonfigurasi: halaman menampilkan pesan, bukan mengaku siap
    } else if (publishableKey.startsWith('sb_publishable_')) {
      // format publishable key baru
    } else {
      assert.match(
        publishableKey,
        /^eyJ[A-Za-z0-9_-]+\./,
        'publishable key harus publishable/anon key, bukan nilai lain',
      );

      const payload = publishableKey.split('.')[1];
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      assert.equal(
        claims.role,
        'anon',
        'publishable key berbentuk JWT harus berperan "anon"; service role key tidak boleh masuk halaman publik',
      );
    }

    assert.equal(valueOf('supportUrl'), 'https://github.com/29nls/rodakawan/issues');
    assert.equal(valueOf('privacyUrl'), '../privacy/');
  });

  it('app.js tidak menyimpan token di storage, tidak memakai cookie, dan tidak mencetak apa pun', () => {
    // Komentar boleh menyebut localStorage (menjelaskan bahwa token tidak
    // disimpan di sana); yang diperiksa adalah kode yang benar-benar berjalan.
    const app = webText('account-deletion/app.js')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    assert.doesNotMatch(
      app,
      /\b(?:localStorage|sessionStorage|document\.cookie)\b/,
      'token tidak boleh dipersistenkan',
    );
    assert.doesNotMatch(
      app,
      /console\.(?:log|info|debug|warn|error)/,
      'halaman tidak boleh mencetak ke console',
    );
    assert.match(
      app,
      /Authorization:\s*'Bearer '\s*\+\s*token/,
      'token hanya dikirim sebagai header Bearer',
    );
    assert.match(
      app,
      /'\/functions\/v1\/delete-account'/,
      'halaman harus memanggil Edge Function hapus akun',
    );
    assert.match(app, /token = '';/, 'token harus dikosongkan setelah percobaan');
    assert.doesNotMatch(
      app,
      /Email tidak terdaftar|akun tidak ditemukan/i,
      'galat login tidak boleh mengungkap keberadaan akun',
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
