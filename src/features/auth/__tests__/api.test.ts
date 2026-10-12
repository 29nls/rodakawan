import {
  completeEmailLink,
  readCurrentSession,
  requestPasswordReset,
  resendSignUpEmail,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  updatePassword,
} from '@/features/auth/api';
import { createAuthClient } from '@/test-support/fakeSupabase';

const session = { access_token: 'token', refresh_token: 'refresh' };

describe('signUpWithEmail', () => {
  it('mengirim email ternormalisasi, metadata username, dan URL callback', async () => {
    const { client, auth } = createAuthClient({
      signUp: jest.fn(async () => ({
        data: { user: { id: 'user-1' }, session: null },
        error: null,
      })),
    });

    const result = await signUpWithEmail(client, {
      email: '  Budi@Contoh.COM ',
      password: 'touring2026',
      username: '  Budi_Solo ',
      displayName: '  Budi  ',
      emailRedirectTo: 'rodakawan://auth/callback',
    });

    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'budi@contoh.com',
      password: 'touring2026',
      options: {
        emailRedirectTo: 'rodakawan://auth/callback',
        data: {
          username: 'budi_solo',
          display_name: 'Budi',
          requested_username: 'budi_solo',
        },
      },
    });
    expect(result).toEqual({
      ok: true,
      data: { userId: 'user-1', sessionCreated: false },
    });
  });

  it('melaporkan sesi yang langsung dibuat ketika konfirmasi email dimatikan', async () => {
    const { client } = createAuthClient({
      signUp: jest.fn(async () => ({ data: { user: { id: 'user-2' }, session }, error: null })),
    });

    const result = await signUpWithEmail(client, {
      email: 'rider@contoh.com',
      password: 'touring2026',
      username: 'rider_uji',
      displayName: 'Rider',
      emailRedirectTo: 'rodakawan://auth/callback',
    });

    expect(result).toMatchObject({ ok: true, data: { sessionCreated: true, userId: 'user-2' } });
  });

  it('mengembalikan pesan yang bisa dipahami saat gagal', async () => {
    const { client } = createAuthClient({
      signUp: jest.fn(async () => ({
        data: { user: null, session: null },
        error: { code: 'user_already_exists', status: 422, message: 'User already registered' },
      })),
    });

    const result = await signUpWithEmail(client, {
      email: 'rider@contoh.com',
      password: 'touring2026',
      username: 'rider_uji',
      displayName: 'Rider',
      emailRedirectTo: 'rodakawan://auth/callback',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('email_taken');
  });
});

describe('resendSignUpEmail', () => {
  it('meminta kirim ulang email konfirmasi', async () => {
    const { client, auth } = createAuthClient();

    const result = await resendSignUpEmail(client, {
      email: 'Rider@Contoh.com',
      emailRedirectTo: 'rodakawan://auth/callback',
    });

    expect(auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'rider@contoh.com',
      options: { emailRedirectTo: 'rodakawan://auth/callback' },
    });
    expect(result.ok).toBe(true);
  });

  it('meneruskan rate limit sebagai pesan yang bisa ditindaklanjuti', async () => {
    const { client } = createAuthClient({
      resend: jest.fn(async () => ({
        data: {},
        error: { code: 'over_email_send_rate_limit', status: 429, message: 'too many' },
      })),
    });

    const result = await resendSignUpEmail(client, {
      email: 'rider@contoh.com',
      emailRedirectTo: 'rodakawan://auth/callback',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('rate_limited');
  });
});

describe('signInWithEmail', () => {
  it('mengembalikan id pengguna saat berhasil', async () => {
    const { client, auth } = createAuthClient({
      signInWithPassword: jest.fn(async () => ({
        data: { user: { id: 'user-1' }, session },
        error: null,
      })),
    });

    const result = await signInWithEmail(client, {
      email: 'Rider@Contoh.com',
      password: 'touring2026',
    });

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'rider@contoh.com',
      password: 'touring2026',
    });
    expect(result).toEqual({ ok: true, data: { userId: 'user-1' } });
  });

  it('memetakan kredensial salah', async () => {
    const { client } = createAuthClient({
      signInWithPassword: jest.fn(async () => ({
        data: { user: null, session: null },
        error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
      })),
    });

    const result = await signInWithEmail(client, { email: 'rider@contoh.com', password: 'salah' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_credentials');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('tidak mengklaim berhasil bila server tidak mengirim data pengguna', async () => {
    const { client } = createAuthClient({
      signInWithPassword: jest.fn(async () => ({
        data: { user: null, session: null },
        error: null,
      })),
    });

    const result = await signInWithEmail(client, { email: 'rider@contoh.com', password: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.retryable).toBe(true);
  });
});

describe('signOut', () => {
  it('melaporkan pencabutan server saat berhasil', async () => {
    const { client, auth } = createAuthClient({ signOut: jest.fn(async () => ({ error: null })) });

    const result = await signOut(client);

    expect(auth.signOut).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: { signedOut: true, revokedRemotely: true } });
  });

  it('tetap menganggap keluar berhasil ketika jaringan gagal (sesi lokal dibersihkan SDK)', async () => {
    const { client } = createAuthClient({
      signOut: jest.fn(async () => ({ error: { status: 0, message: 'Network request failed' } })),
    });

    const result = await signOut(client);

    expect(result).toEqual({ ok: true, data: { signedOut: true, revokedRemotely: false } });
  });

  it('mengembalikan error bila kegagalannya bukan jaringan', async () => {
    const { client } = createAuthClient({
      signOut: jest.fn(async () => ({ error: { code: 'unexpected_failure', status: 500 } })),
    });

    const result = await signOut(client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown');
  });
});

describe('requestPasswordReset', () => {
  it('menormalisasi email dan mengirim redirectTo', async () => {
    const { client, auth } = createAuthClient();

    const result = await requestPasswordReset(client, {
      email: ' Rider@Contoh.com ',
      redirectTo: 'rodakawan://auth/callback',
    });

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('rider@contoh.com', {
      redirectTo: 'rodakawan://auth/callback',
    });
    expect(result.ok).toBe(true);
  });
});

describe('updatePassword', () => {
  it('mengirim kata sandi baru ke updateUser', async () => {
    const { client, auth } = createAuthClient();

    const result = await updatePassword(client, { password: 'touring2027' });

    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'touring2027' });
    expect(result.ok).toBe(true);
  });

  it('memetakan penolakan kata sandi lemah dari server', async () => {
    const { client } = createAuthClient({
      updateUser: jest.fn(async () => ({
        data: { user: null },
        error: { code: 'weak_password', status: 422, message: 'Weak password' },
      })),
    });

    const result = await updatePassword(client, { password: '12345678' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('password_weak');
  });
});

describe('completeEmailLink', () => {
  it('menukar kode PKCE dan mengenali alur pemulihan', async () => {
    const { client, auth } = createAuthClient({
      exchangeCodeForSession: jest.fn(async () => ({
        data: { session, user: { id: 'user-1' }, redirectType: 'recovery' },
        error: null,
      })),
    });

    const outcome = await completeEmailLink(client, { code: 'abc' });

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(outcome).toEqual({ status: 'recovery' });
  });

  it('menandai konfirmasi pendaftaran sebagai berhasil masuk', async () => {
    const { client } = createAuthClient({
      exchangeCodeForSession: jest.fn(async () => ({
        data: { session, user: { id: 'user-1' }, redirectType: null },
        error: null,
      })),
    });

    expect(await completeEmailLink(client, { code: 'abc' })).toEqual({ status: 'signed-in' });
  });

  it('melaporkan tautan kedaluwarsa dari parameter error', async () => {
    const { client, auth } = createAuthClient();

    const outcome = await completeEmailLink(client, {
      errorCode: 'otp_expired',
      errorDescription: 'Email link is invalid or has expired',
    });

    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error.code).toBe('link_expired');
  });

  it('menukar token hash untuk template email berbasis token', async () => {
    const { client, auth } = createAuthClient({
      verifyOtp: jest.fn(async () => ({ data: { session, user: { id: 'user-1' } }, error: null })),
    });

    const outcome = await completeEmailLink(client, { tokenHash: 'hash', type: 'recovery' });

    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash', type: 'recovery' });
    expect(outcome).toEqual({ status: 'recovery' });
  });

  it('memakai tipe email yang aman bila tipe tidak dikenal', async () => {
    const { client, auth } = createAuthClient({
      verifyOtp: jest.fn(async () => ({ data: { session, user: { id: 'user-1' } }, error: null })),
    });

    await completeEmailLink(client, { tokenHash: 'hash', type: 'sesuatu' });

    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash', type: 'email' });
  });

  it('memasang sesi dari token implicit flow dan tetap menghormati tipe recovery', async () => {
    const { client, auth } = createAuthClient();

    const outcome = await completeEmailLink(client, {
      accessToken: 'aaa',
      refreshToken: 'bbb',
      type: 'recovery',
    });

    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'aaa', refresh_token: 'bbb' });
    expect(outcome).toEqual({ status: 'recovery' });
  });

  it('melaporkan kegagalan penukaran kode', async () => {
    const { client } = createAuthClient({
      exchangeCodeForSession: jest.fn(async () => ({
        data: { session: null, user: null },
        error: { code: 'flow_state_expired', status: 400, message: 'expired' },
      })),
    });

    const outcome = await completeEmailLink(client, { code: 'abc' });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error.code).toBe('link_expired');
  });

  it('mengembalikan status none untuk tautan tanpa parameter yang bisa diproses', async () => {
    const { client, auth } = createAuthClient();

    expect(await completeEmailLink(client, {})).toEqual({ status: 'none' });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
});

describe('readCurrentSession', () => {
  it('mengembalikan sesi tersimpan', async () => {
    const { client } = createAuthClient({
      getSession: jest.fn(async () => ({ data: { session }, error: null })),
    });

    expect(await readCurrentSession(client)).toEqual({ ok: true, data: { session } });
  });

  it('memetakan kegagalan pembacaan sesi', async () => {
    const { client } = createAuthClient({
      getSession: jest.fn(async () => ({
        data: { session: null },
        error: { code: 'refresh_token_not_found', status: 400 },
      })),
    });

    const result = await readCurrentSession(client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('session_expired');
  });
});
