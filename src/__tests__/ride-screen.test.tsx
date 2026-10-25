import { isFetchFailure } from '@/features/auth/errors';

describe('RideScreen state patterns - error classification', () => {
  it('isFetchFailure mengklasifikasi error jaringan dengan name AuthRetryableFetchError', () => {
    const networkError = { name: 'AuthRetryableFetchError', message: 'Network timeout' };
    expect(isFetchFailure(networkError)).toBe(true);
  });

  it('isFetchFailure tidak mengklasifikasi error not_found sebagai network error', () => {
    const notFoundError = { code: 'not_found', message: 'Club not found' };
    expect(isFetchFailure(notFoundError)).toBe(false);
  });

  it('isFetchFailure mengklasifikasi error dengan status 0 sebagai network error', () => {
    const statusZeroError = { status: 0, message: 'Connection failed' };
    expect(isFetchFailure(statusZeroError)).toBe(true);
  });

  it('isFetchFailure mengklasifikasi error dengan message "network request failed" sebagai network error', () => {
    const networkMessageError = { message: 'network request failed' };
    expect(isFetchFailure(networkMessageError)).toBe(true);
  });

  it('isFetchFailure mengklasifikasi error dengan name FunctionsFetchError sebagai network error', () => {
    const functionsFetchError = { name: 'FunctionsFetchError' };
    expect(isFetchFailure(functionsFetchError)).toBe(true);
  });
});
