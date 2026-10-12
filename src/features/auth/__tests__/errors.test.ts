import { mapAuthError, mapProfileError } from '@/features/auth/errors';

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
