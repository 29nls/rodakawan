import { extractEmailLinkParams, hasCompletableParams } from '@/features/auth/linkParams';

describe('extractEmailLinkParams', () => {
  it('membaca kode PKCE dari query string', () => {
    const params = extractEmailLinkParams('rodakawan://auth/callback?code=abc-123');

    expect(params.code).toBe('abc-123');
    expect(hasCompletableParams(params)).toBe(true);
  });

  it('membaca kode PKCE dari tautan Expo Go dengan path berlapis', () => {
    const params = extractEmailLinkParams(
      'exp://192.168.0.2:8081/--/auth/callback?code=xyz&type=signup',
    );

    expect(params.code).toBe('xyz');
    expect(params.type).toBe('signup');
  });

  it('membaca token hash dan tipe pemulihan', () => {
    const params = extractEmailLinkParams(
      'rodakawan://auth/callback?token_hash=hash123&type=recovery',
    );

    expect(params.tokenHash).toBe('hash123');
    expect(params.type).toBe('recovery');
  });

  it('membaca parameter dari fragment (implicit flow)', () => {
    const params = extractEmailLinkParams(
      'rodakawan://auth/callback#access_token=aaa&refresh_token=bbb&type=signup',
    );

    expect(params.accessToken).toBe('aaa');
    expect(params.refreshToken).toBe('bbb');
    expect(hasCompletableParams(params)).toBe(true);
  });

  it('membaca error tautan kedaluwarsa', () => {
    const params = extractEmailLinkParams(
      'rodakawan://auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid',
    );

    expect(params.errorCode).toBe('otp_expired');
    expect(params.errorDescription).toContain('Email link is invalid');
    expect(hasCompletableParams(params)).toBe(true);
  });

  it('mengutamakan error_code dan menghargai nilai yang ter-encode', () => {
    const params = extractEmailLinkParams(
      'rodakawan://auth/callback?error=access_denied&error_code=otp_expired&error_description=Rincian%20panjang%20di%20sini',
    );

    expect(params.errorCode).toBe('otp_expired');
    expect(params.errorDescription).toBe('Rincian panjang di sini');
  });

  it('mengembalikan objek kosong untuk tautan tanpa parameter atau null', () => {
    expect(hasCompletableParams(extractEmailLinkParams('rodakawan://auth/callback'))).toBe(false);
    expect(hasCompletableParams(extractEmailLinkParams(null))).toBe(false);
    expect(hasCompletableParams(extractEmailLinkParams(undefined))).toBe(false);
    expect(hasCompletableParams(extractEmailLinkParams(''))).toBe(false);
  });

  it('tidak menganggap token tunggal tanpa pasangannya sebagai tautan lengkap', () => {
    const params = extractEmailLinkParams('rodakawan://auth/callback#access_token=aaa');

    expect(hasCompletableParams(params)).toBe(false);
  });
});
