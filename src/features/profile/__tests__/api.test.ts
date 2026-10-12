import { createOwnProfile, fetchOwnProfile, updateOwnProfile } from '@/features/profile/api';
import { buildProfileRow, createProfilesClient } from '@/test-support/fakeSupabase';

const SESSION_USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';

describe('fetchOwnProfile', () => {
  it('membaca profil dengan filter id milik sesi', async () => {
    const row = buildProfileRow({ id: SESSION_USER_ID });
    const { client, log } = createProfilesClient({ data: row });

    const result = await fetchOwnProfile(client, SESSION_USER_ID);

    expect(log.table).toBe('profiles');
    expect(log.filters).toEqual([{ column: 'id', value: SESSION_USER_ID }]);
    expect(log.maybeSingleCalls).toBe(1);
    expect(result).toEqual({ ok: true, data: row });
  });

  it('mengembalikan null bila pengguna belum punya baris profil', async () => {
    const { client } = createProfilesClient({ data: null });

    expect(await fetchOwnProfile(client, SESSION_USER_ID)).toEqual({ ok: true, data: null });
  });

  it('memetakan penolakan akses dari database', async () => {
    const { client } = createProfilesClient({
      error: { code: '42501', message: 'permission denied' },
    });

    const result = await fetchOwnProfile(client, SESSION_USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_authorized');
  });
});

describe('createOwnProfile', () => {
  it('selalu memakai id dari sesi dan menormalkan nilai', async () => {
    const row = buildProfileRow({ id: SESSION_USER_ID, username: 'budi_solo' });
    const { client, log } = createProfilesClient({ data: row });

    const result = await createOwnProfile(client, SESSION_USER_ID, {
      username: '  Budi_Solo ',
      displayName: '  Budi  ',
      bio: '   ',
      city: ' Bandung ',
    });

    expect(log.insertValues).toEqual({
      id: SESSION_USER_ID,
      username: 'budi_solo',
      display_name: 'Budi',
      bio: null,
      city: 'Bandung',
    });
    expect(result).toEqual({ ok: true, data: row });
  });

  it('menolak membuat profil milik pengguna lain di sisi aplikasi', async () => {
    const { client, log } = createProfilesClient({ data: buildProfileRow() });

    await createOwnProfile(client, OTHER_USER_ID, {
      username: 'palsu',
      displayName: 'Palsu',
      bio: '',
      city: '',
    });

    expect(log.insertValues).toMatchObject({ id: OTHER_USER_ID });
    // Catatan: penolakan sesungguhnya dilakukan RLS + policy `profiles_insert_self`
    // (`with check (id = auth.uid())`), diuji pada supabase/tests/rls_profiles_test.sql.
  });

  it('memetakan username duplikat menjadi pesan yang bisa dipahami', async () => {
    const { client } = createProfilesClient({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    const result = await createOwnProfile(client, SESSION_USER_ID, {
      username: 'budi_solo',
      displayName: 'Budi',
      bio: '',
      city: '',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('username_taken');
      expect(result.error.message).toMatch(/Username sudah dipakai/);
    }
  });
});

describe('updateOwnProfile', () => {
  it('membatasi update dengan filter id milik sesi', async () => {
    const row = buildProfileRow({ id: SESSION_USER_ID, display_name: 'Budi Baru' });
    const { client, log } = createProfilesClient({ data: row });

    await updateOwnProfile(client, SESSION_USER_ID, {
      username: 'budi_solo',
      displayName: 'Budi Baru',
      bio: 'Suka touring',
      city: 'Solo',
    });

    expect(log.filters).toEqual([{ column: 'id', value: SESSION_USER_ID }]);
    expect(log.updateValues).toEqual({
      username: 'budi_solo',
      display_name: 'Budi Baru',
      bio: 'Suka touring',
      city: 'Solo',
    });
    expect(log.singleCalls).toBe(1);
  });

  it('tidak melaporkan sukses palsu ketika 0 baris terpengaruh (mis. mencoba baris user lain)', async () => {
    const { client, log } = createProfilesClient({
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
    });

    const result = await updateOwnProfile(client, OTHER_USER_ID, {
      username: 'palsu',
      displayName: 'Palsu',
      bio: '',
      city: '',
    });

    expect(log.filters).toEqual([{ column: 'id', value: OTHER_USER_ID }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('profile_missing');
  });

  it('memetakan benturan username saat mengubah username', async () => {
    const { client } = createProfilesClient({ error: { code: '23505', message: 'duplicate' } });

    const result = await updateOwnProfile(client, SESSION_USER_ID, {
      username: 'sudah_dipakai',
      displayName: 'Budi',
      bio: '',
      city: '',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('username_taken');
  });
});
