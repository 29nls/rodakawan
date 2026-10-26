import { mapAuthError, mapProfileError, mapRpcError, mapTableError } from '@/features/auth/errors';

describe('mapAuthError', () => {
  it('mengenali kegagalan jaringan dari beberapa bentuk error', () => {
    expect(mapAuthError({ name: 'AuthRetryableFetchError' }).code).toBe('network');
    expect(mapAuthError({ status: 0 }).code).toBe('network');
    expect(mapAuthError({ message: 'Network request failed' }).code).toBe('network');
    expect(mapAuthError(new TypeError('Failed to fetch')).code).toBe('network');
  });

  it('memetakan kredensial salah', () => {
    const error = mapAuthError({ code: 'invalid_credentials', status: 400 });

    expect(error.code).toBe('invalid_credentials');
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/Email atau kata sandi/);
  });

  it('memetakan email belum dikonfirmasi', () => {
    expect(mapAuthError({ code: 'email_not_confirmed' }).code).toBe('email_not_confirmed');
  });

  it('memetakan email yang sudah terdaftar', () => {
    expect(mapAuthError({ code: 'user_already_exists' }).code).toBe('email_taken');
    expect(mapAuthError({ code: 'email_exists' }).code).toBe('email_taken');
  });

  it('memetakan kata sandi lemah beserta alasannya', () => {
    const error = mapAuthError({ code: 'weak_password', reasons: ['length', 'pwned'] });

    expect(error.code).toBe('password_weak');
    expect(error.message).toContain('length, pwned');
  });

  it('memetakan kata sandi yang sama dengan sebelumnya', () => {
    expect(mapAuthError({ code: 'same_password' }).code).toBe('same_password');
  });

  it('memetakan validasi email dari server', () => {
    expect(mapAuthError({ code: 'validation_failed' }).code).toBe('email_invalid');
  });

  it('memetakan rate limit dari kode maupun status', () => {
    expect(mapAuthError({ code: 'over_email_send_rate_limit' }).code).toBe('rate_limited');
    expect(mapAuthError({ code: 'over_request_rate_limit' }).code).toBe('rate_limited');
    expect(mapAuthError({ status: 429 }).code).toBe('rate_limited');
    expect(mapAuthError({ code: 'over_request_rate_limit' }).retryable).toBe(true);
  });

  it('memetakan tautan kedaluwarsa', () => {
    expect(mapAuthError({ code: 'otp_expired' }).code).toBe('link_expired');
    expect(mapAuthError({ code: 'flow_state_expired' }).code).toBe('link_expired');
    expect(mapAuthError({ code: 'otp_expired' }).message).toMatch(/kedaluwarsa|dipakai/);
  });

  it('memetakan sesi yang berakhir', () => {
    expect(mapAuthError({ code: 'refresh_token_not_found' }).code).toBe('session_expired');
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
    expect(error.message).toMatch(/bukan milik akun Anda/);
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
  ])('memetakan %s menjadi pesan yang bisa ditindaklanjuti', (details, expected) => {
    const error = mapRpcError({ code: 'P0001', details, message: 'raw database message' });

    expect(error.code).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(expected);
    expect(error.message).toMatch(/Tunggu/);
    expect(error.message).not.toMatch(
      /P0001|club_create_rate_limit|ride_create_rate_limit|location_publish_rate_limit/,
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
