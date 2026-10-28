import { proto } from 'baileys';
import { describe, expect, it } from 'vitest';
import { memoryCredentials } from '../../test/credentials.js';
import { credentialAuthState } from './baileys-auth-state.js';

describe('Baileys auth state over a CredentialStore', () => {
  it('starts with new credentials, saves them and reads them back with their buffers', async () => {
    const store = memoryCredentials();
    const first = await credentialAuthState(store);
    expect(first.state.creds.me).toBeUndefined();
    first.state.creds.me = { id: '999000000001:3@s.whatsapp.net' };
    await first.saveCreds();
    expect([...store.entries.keys()]).toEqual(['creds']);

    const again = await credentialAuthState(store);
    expect(again.state.creds.me?.id).toBe('999000000001:3@s.whatsapp.net');
    expect(Buffer.from(again.state.creds.noiseKey.private)).toEqual(
      Buffer.from(first.state.creds.noiseKey.private),
    );
  });

  it('writes key-store entries together, removes nulls and revives their types', async () => {
    const store = memoryCredentials();
    const { state } = await credentialAuthState(store);
    const session = Buffer.from([1, 2, 3]);
    await state.keys.set({
      session: { '999100000001.0': session, '999100000002.0': Buffer.from([4]) },
      'app-state-sync-key': { AAAA: { keyData: Buffer.from([9]) } },
    });
    expect(store.entries.size).toBe(3);

    const sessions = await state.keys.get('session', ['999100000001.0', 'missing']);
    expect(Object.keys(sessions)).toEqual(['999100000001.0']);
    expect(Buffer.from(sessions['999100000001.0'] as Uint8Array)).toEqual(session);
    const syncKeys = await state.keys.get('app-state-sync-key', ['AAAA']);
    expect(syncKeys.AAAA).toBeInstanceOf(proto.Message.AppStateSyncKeyData);

    await state.keys.set({ session: { '999100000002.0': null } });
    expect(store.entries.has('session:999100000002.0')).toBe(false);
  });
});
