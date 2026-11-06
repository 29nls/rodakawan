import { mapAuthError, mapProfileError, mapRpcError, mapTableError } from '@/features/auth/errors';

describe('mapAuthError', () => {
  it('mengenali kegagalan jaringan dari beberapa bentuk error', () => {
    expect(mapAuthError({ name: 'AuthRetryableFetchError' }).code).toBe('network');
    expect(mapAuthError({ status: 0 }).code).toBe('network');
    expect(mapAuthError({ message: 'Network request failed' }).code).toBe('network');
    expect(mapAuthError(new TypeError('Failed to fetch')).code).toBe('network');
  });

  it('memetakan Anonymous sign-ins yang belum diaktifkan ke langkah pemilik project', () => {
    const error = mapAuthError({ code: 'anonymous_provider_disabled', status: 422 });

    expect(error.code).toBe('anonymous_sign_in_disabled');
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/Anonymous sign-ins belum diaktifkan/);
    expect(error.message).toMatch(/enable_anonymous_sign_ins = true/);
  });

  it('tidak lagi memetakan error khusus email dan kata sandi', () => {
    // Kode ini tidak mungkin muncul di alur tanpa akun; memetakannya ke pesan
    // email akan menyesatkan. Semua jatuh ke error umum yang bisa diulang.
    for (const code of [
      'invalid_credentials',
      'email_not_confirmed',
      'user_already_exists',
      'email_exists',
      'weak_password',
      'same_password',
      'validation_failed',
      'otp_expired',
      'flow_state_expired',
    ]) {
      expect(mapAuthError({ code }).code).toBe('unknown');
    }
  });

  it('memetakan rate limit dari kode maupun status', () => {
    expect(mapAuthError({ code: 'over_request_rate_limit' }).code).toBe('rate_limited');
    expect(mapAuthError({ status: 429 }).code).toBe('rate_limited');
    expect(mapAuthError({ code: 'over_request_rate_limit' }).retryable).toBe(true);
  });

  it('memetakan sesi yang tidak dapat dipulihkan ke saran identitas baru', () => {
    const error = mapAuthError({ code: 'refresh_token_not_found' });

    expect(error.code).toBe('session_expired');
    expect(error.message).toMatch(/identitas baru/i);
    expect(error.message).toMatch(/tidak akan terbawa/);
    expect(mapAuthError({ code: 'session_not_found' }).code).toBe('session_expired');
  });

  it('memberi pesan umum yang bisa ditindaklanjuti untuk error tak dikenal', () => {
    const error = mapAuthError({ code: 'sesuatu_yang_baru', message: 'boom' });

    expect(error.code).toBe('unknown');
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/Coba lagi/);
  });
});

describe('mapProfileError', () => {
  it('memetakan pelanggaran unik menjadi username sudah dipakai', () => {
    const error = mapProfileError({ code: '23505', message: 'duplicate key value' });

    expect(error.code).toBe('username_taken');
    expect(error.message).toMatch(/Username sudah dipakai/);
    expect(error.retryable).toBe(false);
  });

  it('memetakan pelanggaran CHECK menjadi pesan aturan data', () => {
    expect(mapProfileError({ code: '23514' }).code).toBe('profile_missing');
  });

  it('memetakan penolakan RLS dan JWT kedaluwarsa', () => {
    expect(mapProfileError({ code: '42501' }).code).toBe('not_authorized');
    expect(mapProfileError({ code: 'PGRST301' }).code).toBe('not_authorized');
  });

  it('memetakan 0 baris terpengaruh sebagai kegagalan, bukan sukses palsu', () => {
    const error = mapProfileError({ code: 'PGRST116' });

    expect(error.code).toBe('profile_missing');
    expect(error.message).toMatch(/bukan milik identitas perangkat ini/);
  });

  it('memetakan tabel yang belum ada (migration belum dijalankan)', () => {
    expect(mapProfileError({ code: 'PGRST205' }).message).toMatch(/migration/i);
    expect(mapProfileError({ code: '42P01' }).code).toBe('profile_missing');
  });

  it('memetakan kegagalan jaringan', () => {
    expect(mapProfileError({ message: 'Network request failed' }).code).toBe('network');
  });

  it('memberi pesan umum untuk error tak dikenal', () => {
    expect(mapProfileError({ code: 'XX000' }).code).toBe('unknown');
  });
});

describe('mapRpcError — rate limit jalur tulis', () => {
  it.each([
    ['club_create_rate_limit', /10 klub baru per jam/],
    ['ride_create_rate_limit', /10 perjalanan baru per jam/],
    ['location_publish_rate_limit', /Lokasi belum dikirim/],
    ['ride_update_rate_limit', /Perubahan perjalanan terlalu sering/],
  ])('memetakan %s menjadi pesan yang bisa ditindaklanjuti', (details, expected) => {
    const error = mapRpcError({ code: 'P0001', details, message: 'raw database message' });

    expect(error.code).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(expected);
    expect(error.message).toMatch(/Tunggu/);
    expect(error.message).not.toMatch(
      /P0001|club_create_rate_limit|ride_create_rate_limit|location_publish_rate_limit|ride_update_rate_limit/,
    );
  });

  it('menerima detail dalam bentuk detail (selain details PostgREST)', () => {
    expect(mapRpcError({ code: 'P0001', detail: 'ride_create_rate_limit' }).code).toBe(
      'rate_limited',
    );
  });

  it('tidak mengubah rate limit lain yang tidak dikenal menjadi sukses', () => {
    expect(mapRpcError({ code: 'P0001', details: 'tag_lain' }).code).toBe('unknown');
  });
});

describe('mapTableError', () => {
  it('memetakan benturan unique menjadi conflict dengan saran yang sesuai tabel', () => {
    const error = mapTableError({ code: '23505', message: 'duplicate key value' });

    expect(error.code).toBe('conflict');
    expect(error.retryable).toBe(false);
    // Pesannya tidak boleh menyebut username: konflik pada klub/garasi bukan itu.
    expect(error.message).not.toMatch(/Username/);
  });

  it('memetakan pelanggaran CHECK menjadi invalid_data', () => {
    expect(mapTableError({ code: '23514' }).code).toBe('invalid_data');
    expect(mapTableError({ code: '23503' }).message).toMatch(/masih dipakai|tidak ada/);
  });

  it('memetakan penolakan policy menjadi not_authorized', () => {
    expect(mapTableError({ code: '42501' }).code).toBe('not_authorized');
    expect(mapTableError({ code: 'PGRST301' }).code).toBe('not_authorized');
  });

  it('memetakan 0 baris terpengaruh sebagai not_found', () => {
    expect(mapTableError({ code: 'PGRST116' }).code).toBe('not_found');
  });

  it('memetakan tabel yang belum ada ke table_missing', () => {
    expect(mapTableError({ code: 'PGRST205' }).code).toBe('table_missing');
    expect(mapTableError({ code: '42P01' }).message).toMatch(/migration/i);
  });

  it('memetakan kegagalan jaringan dan error tak dikenal', () => {
    expect(mapTableError({ message: 'Network request failed' }).code).toBe('network');
    expect(mapTableError({ code: 'XX000' }).code).toBe('unknown');
  });
});
