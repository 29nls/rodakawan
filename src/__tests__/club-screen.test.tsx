import { isFetchFailure } from '@/features/auth/errors';

describe('ClubScreen state patterns - error classification', () => {
  it('isFetchFailure mengklasifikasi error jaringan dengan name AuthRetryableFetchError', () => {
    const networkError = {
      name: 'AuthRetryableFetchError',
      message: 'Network request failed',
      status: 0,
    };

    expect(isFetchFailure(networkError)).toBe(true);
  });

  it('isFetchFailure tidak mengklasifikasi error not_found sebagai network error', () => {
    const notFoundError = {
      code: 'not_found',
      message: 'Club not found',
      retryable: false,
    };

    expect(isFetchFailure(notFoundError)).toBe(false);
  });

  it('isFetchFailure mengklasifikasi error dengan status 0 sebagai network error', () => {
    const statusZeroError = {
      name: undefined,
      message: 'Some error',
      status: 0,
    };

    expect(isFetchFailure(statusZeroError)).toBe(true);
  });

  it('isFetchFailure mengklasifikasi error dengan message "network request failed" sebagai network error', () => {
    const networkMessageError = {
      name: undefined,
      message: 'network request failed',
      status: undefined,
    };

    expect(isFetchFailure(networkMessageError)).toBe(true);
  });

  it('isFetchFailure mengklasifikasi error dengan name FunctionsFetchError sebagai network error', () => {
    const functionsFetchError = {
      name: 'FunctionsFetchError',
      message: 'Function fetch failed',
      status: undefined,
    };

    expect(isFetchFailure(functionsFetchError)).toBe(true);
  });
});
