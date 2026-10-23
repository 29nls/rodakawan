import { deleteMyAccount, type AccountClient } from '@/features/account/api';

type Invoke = (name: string, options: { body: Record<string, unknown> }) => Promise<unknown>;

function clientWith(invoke: jest.Mock): AccountClient {
  return { functions: { invoke } } as unknown as AccountClient;
}

function functionError(tag: string) {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: {
      status: 502,
      json: async () => ({ error: tag }),
    },
  };
}

describe('deleteMyAccount', () => {
  it('memanggil Edge Function delete-account tanpa mengirim target dari klien', async () => {
    const invoke = jest.fn<ReturnType<Invoke>, Parameters<Invoke>>(async () => ({
      data: { status: 'completed', alreadyCompleted: false },
      error: null,
    }));

    const result = await deleteMyAccount(clientWith(invoke));

    expect(result).toEqual({
      ok: true,
      data: { status: 'completed', alreadyCompleted: false },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: {} });
  });

  it('menerima job yang sudah selesai sebagai sukses idempoten', async () => {
    const invoke = jest.fn(async () => ({
      data: { status: 'completed', alreadyCompleted: true },
      error: null,
    }));

    const result = await deleteMyAccount(clientWith(invoke));

    expect(result).toEqual({
      ok: true,
      data: { status: 'completed', alreadyCompleted: true },
    });
  });

  it('memetakan tag server menjadi pesan yang bisa ditindaklanjuti', async () => {
    const invoke = jest.fn(async () => ({
      data: null,
      error: functionError('account_deletion_incomplete'),
    }));

    const result = await deleteMyAccount(clientWith(invoke));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('tidak mungkin');
    expect(result.error.code).toBe('deletion_incomplete');
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toMatch(/belum selesai sepenuhnya/i);
  });

  it('memetakan batas laju tanpa menyarankan pengulangan cepat', async () => {
    const invoke = jest.fn(async () => ({
      data: null,
      error: functionError('account_deletion_rate_limited'),
    }));

    const result = await deleteMyAccount(clientWith(invoke));

    if (result.ok) throw new Error('tidak mungkin');
    expect(result.error.code).toBe('rate_limited');
    expect(result.error.message).toMatch(/Beberapa menit/i);
  });

  it.each([
    ['account_deletion_in_progress', 'deletion_in_progress'],
    ['account_deletion_incomplete', 'deletion_incomplete'],
    ['account_deletion_unavailable', 'backend_not_configured'],
    ['account_deletion_rate_limited', 'rate_limited'],
  ])('memetakan tag %s menjadi kode %s yang bisa diulang', async (tag, code) => {
    const invoke = jest.fn(async () => ({ data: null, error: functionError(tag) }));

    const result = await deleteMyAccount(clientWith(invoke));

    if (result.ok) throw new Error('tidak mungkin');
    expect(result.error.code).toBe(code);
    expect(result.error.retryable).toBe(true);
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it('menjelaskan bahwa penghapusan sedang berjalan tanpa menyarankan pengulangan cepat', async () => {
    const invoke = jest.fn(async () => ({
      data: null,
      error: functionError('account_deletion_in_progress'),
    }));

    const result = await deleteMyAccount(clientWith(invoke));

    if (result.ok) throw new Error('tidak mungkin');
    expect(result.error.message).toMatch(/sedang diproses server/i);
    expect(result.error.message).toMatch(/jangan ulang berkali-kali/i);
  });

  it('menyatakan layanan belum tersedia sebagai masalah server, bukan penghapusan gagal', async () => {
    const invoke = jest.fn(async () => ({
      data: null,
      error: functionError('account_deletion_unavailable'),
    }));

    const result = await deleteMyAccount(clientWith(invoke));

    if (result.ok) throw new Error('tidak mungkin');
    expect(result.error.code).toBe('backend_not_configured');
    expect(result.error.message).toMatch(/hubungi dukungan/i);
  });

  it('menolak respons sukses yang tidak menyatakan status selesai', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'running' }, error: null }));

    const result = await deleteMyAccount(clientWith(invoke));

    if (result.ok) throw new Error('tidak mungkin');
    expect(result.error.code).toBe('deletion_incomplete');
  });

  it('menampilkan galat generik bila badan galat bukan JSON', async () => {
    const invoke = jest.fn(async () => ({
      data: null,
      error: {
        name: 'FunctionsHttpError',
        message: 'non-2xx',
        context: { json: async () => Promise.reject(new Error('bukan json')) },
      },
    }));

    const result = await deleteMyAccount(clientWith(invoke));

    if (result.ok) throw new Error('tidak mungkin');
    expect(result.error.code).toBe('deletion_failed');
    expect(result.error.retryable).toBe(true);
  });

  it('tidak melempar saat invoke gagal di jaringan', async () => {
    const invoke = jest.fn(async () => {
      throw new Error('Network request failed');
    });

    const result = await deleteMyAccount(clientWith(invoke));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('tidak mungkin');
    expect(result.error.message.length).toBeGreaterThan(0);
  });
});
