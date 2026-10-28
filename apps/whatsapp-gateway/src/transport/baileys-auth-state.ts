import {
  type AuthenticationCreds,
  type AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  type SignalDataTypeMap,
} from 'baileys';
import type { CredentialStore } from './whatsapp-transport.js';

/** The store key of Baileys' credentials; every other key is `<type>:<id>` of its key store. */
const CREDS_KEY = 'creds';

/**
 * Baileys' authentication state over a `CredentialStore`, as its `useMultiFileAuthState` keeps it
 * in files: the credentials and every key-store entry as JSON (Buffers through `BufferJSON`). The
 * store seals them (spec S03 rule 3); one `keys.set` is one write of all its entries.
 */
export async function credentialAuthState(
  store: CredentialStore,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const stored = (await store.get([CREDS_KEY])).get(CREDS_KEY);
  const creds: AuthenticationCreds = stored
    ? JSON.parse(stored, BufferJSON.reviver)
    : initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const values = await store.get(ids.map((id) => `${type}:${id}`));
          const found: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            const raw = values.get(`${type}:${id}`);
            if (raw === undefined) continue;
            const value = JSON.parse(raw, BufferJSON.reviver);
            found[id] =
              type === 'app-state-sync-key'
                ? (proto.Message.AppStateSyncKeyData.fromObject(
                    value,
                  ) as unknown as SignalDataTypeMap[T])
                : value;
          }
          return found;
        },
        set: async (data) => {
          const entries: Record<string, string | null> = {};
          for (const [type, values] of Object.entries(data)) {
            for (const [id, value] of Object.entries(values ?? {})) {
              entries[`${type}:${id}`] = value ? JSON.stringify(value, BufferJSON.replacer) : null;
            }
          }
          if (Object.keys(entries).length > 0) await store.set(entries);
        },
      },
    },
    saveCreds: () => store.set({ [CREDS_KEY]: JSON.stringify(creds, BufferJSON.replacer) }),
  };
}
