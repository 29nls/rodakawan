import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { projectRefFromDatabaseUrl } from '../lib/shared-ride.mjs';
import {
  evaluateAuthSettings,
  evaluateBetaTarget,
  evaluateBuckets,
  evaluateFunctionAuth,
  evaluateRls,
  isTestAccountEmail,
  migrationVersionFromFilename,
  summarizeMigrationSync,
} from '../lib/beta-preflight.mjs';

describe('projectRefFromDatabaseUrl', () => {
  it('menerima ref hanya dari host Supabase langsung atau pooler yang valid', () => {
    assert.equal(
      projectRefFromDatabaseUrl(
        'postgresql://postgres.beta123:password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
      ),
      'beta123',
    );
    assert.equal(
      projectRefFromDatabaseUrl('postgres://user:password@db.beta123.supabase.co/postgres'),
      'beta123',
    );
    assert.equal(
      projectRefFromDatabaseUrl('postgresql://postgres.beta123:password@attacker.example/postgres'),
      null,
    );
    assert.equal(
      projectRefFromDatabaseUrl(
        'https://postgres.beta123@aws-0-region.pooler.supabase.com/postgres',
      ),
      null,
    );
  });
});

describe('evaluateBetaTarget', () => {
  const supabaseUrl = 'https://beta123.supabase.co';
  const databaseUrl =
    'postgresql://postgres.beta123:password@aws-0-region.pooler.supabase.com:5432/postgres';

  it('menerima URL API dan database dengan ref beta yang cocok dan eksplisit', () => {
    assert.deepEqual(
      evaluateBetaTarget({ supabaseUrl, databaseUrl, expectedProjectRef: 'beta123' }),
      { ok: true, reasons: [], projectRef: 'beta123' },
    );
  });

  it('menolak project development, ref tidak cocok, dan ref database tak terbaca', () => {
    const devUrl = 'https://xvmcpfkkveeaevfcvfug.supabase.co';
    const devDatabaseUrl =
      'postgresql://postgres.xvmcpfkkveeaevfcvfug:password@aws-0-region.pooler.supabase.com:5432/postgres';

    assert.equal(
      evaluateBetaTarget({
        supabaseUrl: devUrl,
        databaseUrl: devDatabaseUrl,
        expectedProjectRef: 'xvmcpfkkveeaevfcvfug',
      }).ok,
      false,
    );
    assert.ok(
      evaluateBetaTarget({
        supabaseUrl,
        databaseUrl,
        expectedProjectRef: 'other123',
      }).reasons.includes('supabase_project_ref_mismatch'),
    );
    assert.ok(
      evaluateBetaTarget({
        supabaseUrl,
        databaseUrl: 'postgresql://user:password@db.example.test/postgres',
        expectedProjectRef: 'beta123',
      }).reasons.includes('database_project_ref_unverifiable'),
    );
  });
});

describe('migrationVersionFromFilename', () => {
  it('mengambil versi dari nama berkas migration Supabase', () => {
    assert.equal(
      migrationVersionFromFilename('20261013022938_initial_schema.sql'),
      '20261013022938',
    );
    assert.equal(
      migrationVersionFromFilename('20261023120000_account_deletion_reliability.sql'),
      '20261023120000',
    );
  });

  it('menolak nama yang tidak mengikuti pola', () => {
    assert.equal(migrationVersionFromFilename('README.md'), null);
    assert.equal(migrationVersionFromFilename('20261013_harus_14_digit.sql'), null);
    assert.equal(migrationVersionFromFilename('20261013022938_HurufKapital.sql'), null);
    assert.equal(migrationVersionFromFilename(null), null);
  });
});

describe('summarizeMigrationSync', () => {
  const lokal = ['20261013022938', '20261016093000', '20261019120000'];

  it('lulus bila set versi identik meski urutan berbeda', () => {
    const hasil = summarizeMigrationSync(lokal, [
      '20261019120000',
      '20261013022938',
      '20261016093000',
    ]);
    assert.equal(hasil.ok, true);
    assert.equal(hasil.localCount, 3);
    assert.equal(hasil.remoteCount, 3);
    assert.deepEqual(hasil.missing, []);
    assert.deepEqual(hasil.extra, []);
  });

  it('melaporkan versi yang belum diterapkan dan versi asing', () => {
    const hasil = summarizeMigrationSync(lokal, ['20261013022938', '20269999999999']);
    assert.equal(hasil.ok, false);
    assert.deepEqual(hasil.missing, ['20261016093000', '20261019120000']);
    assert.deepEqual(hasil.extra, ['20269999999999']);
  });

  it('gagal bila jumlah berbeda walaupun semua versi lokal ada', () => {
    const hasil = summarizeMigrationSync(lokal, [...lokal, '20261020000000']);
    assert.equal(hasil.ok, false);
    assert.equal(hasil.extra.length, 1);
  });
});

describe('evaluateRls', () => {
  it('lulus bila semua tabel public ber-RLS', () => {
    const hasil = evaluateRls([
      { tablename: 'clubs', rowsecurity: true },
      { tablename: 'rides', rowsecurity: true },
    ]);
    assert.equal(hasil.ok, true);
    assert.equal(hasil.total, 2);
    assert.deepEqual(hasil.tanpaRls, []);
  });

  it('menyebut nama tabel yang tanpa RLS', () => {
    const hasil = evaluateRls([
      { tablename: 'clubs', rowsecurity: true },
      { tablename: 'rides', rowsecurity: false },
    ]);
    assert.equal(hasil.ok, false);
    assert.deepEqual(hasil.tanpaRls, ['rides']);
  });

  it('gagal untuk daftar kosong (kueri tidak mengembalikan tabel)', () => {
    assert.equal(evaluateRls([]).ok, false);
    assert.equal(evaluateRls(undefined).ok, false);
  });
});

describe('evaluateBuckets', () => {
  const privat = [
    { name: 'avatars', public: false },
    { name: 'vehicle-photos', public: false },
    { name: 'club-logos', public: false },
  ];

  it('lulus bila ketiga bucket ada dan privat', () => {
    assert.equal(evaluateBuckets(privat).ok, true);
  });

  it('menandai bucket yang hilang', () => {
    const hasil = evaluateBuckets(privat.slice(0, 2));
    assert.equal(hasil.ok, false);
    assert.deepEqual(hasil.hilang, ['club-logos']);
  });

  it('menandai bucket yang publik', () => {
    const hasil = evaluateBuckets([...privat.slice(0, 2), { name: 'club-logos', public: true }]);
    assert.equal(hasil.ok, false);
    assert.deepEqual(hasil.publik, ['club-logos']);
  });
});

describe('evaluateAuthSettings', () => {
  it('lulus bila autoconfirm nonaktif', () => {
    assert.equal(evaluateAuthSettings({ autoconfirm: false, mailer_autoconfirm: false }).ok, true);
  });

  it('gagal bila autoconfirm aktif lewat salah satu nama', () => {
    assert.equal(evaluateAuthSettings({ autoconfirm: true }).ok, false);
    assert.equal(evaluateAuthSettings({ mailer_autoconfirm: true }).ok, false);
  });

  it('gagal untuk respons yang tidak berbentuk objek', () => {
    assert.equal(evaluateAuthSettings(null).ok, false);
    assert.equal(evaluateAuthSettings('bukan objek').ok, false);
  });
});

describe('evaluateFunctionAuth', () => {
  it('lulus hanya untuk 401', () => {
    assert.equal(evaluateFunctionAuth(401, 'tanpa header').ok, true);
    assert.equal(evaluateFunctionAuth(200, 'tanpa header').ok, false);
    assert.equal(evaluateFunctionAuth(403, 'tanpa header').ok, false);
    assert.equal(evaluateFunctionAuth(null, 'tanpa header').ok, false);
  });

  it('menyebut label dan status pada pesan galat', () => {
    assert.ok(evaluateFunctionAuth(200, 'probe A').alasan.includes('probe A'));
    assert.ok(evaluateFunctionAuth(200, 'probe A').alasan.includes('200'));
    assert.ok(evaluateFunctionAuth(null, 'probe A').alasan.includes('respons'));
  });
});

describe('isTestAccountEmail', () => {
  it('mengenali domain uji contoh.test tanpa memedulikan huruf besar', () => {
    assert.equal(isTestAccountEmail('e2e.shared.a.abc@contoh.test'), true);
    assert.equal(isTestAccountEmail('uji.STORAGE.a@CONTOH.TEST'), true);
  });

  it('menolak surel pengguna nyata dan nilai tidak sah', () => {
    assert.equal(isTestAccountEmail('budi@contoh.test.co'), false);
    assert.equal(isTestAccountEmail('budi@gmail.com'), false);
    assert.equal(isTestAccountEmail(''), false);
    assert.equal(isTestAccountEmail(null), false);
  });
});
