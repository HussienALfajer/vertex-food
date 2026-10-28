import type { CredentialStore } from '../src/transport/whatsapp-transport.js';

/** A session's credentials in memory, the unit tests' stand-in for the sealed database store. */
export function memoryCredentials(): CredentialStore & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get: async (keys) =>
      new Map(keys.flatMap((key) => (entries.has(key) ? [[key, entries.get(key) as string]] : []))),
    set: async (changes) => {
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) entries.delete(key);
        else entries.set(key, value);
      }
    },
  };
}

/**
 * Synthetic numbers in the unassigned country code 999: never a real person's. The platform
 * numbers and the people they write to.
 */
export const SYRIAN_NUMBER = '+999000000001';
export const TURKISH_NUMBER = '+999000000002';
export const OTHER_NUMBER = '+999000000003';
export const STAFF_PHONE = '+999100000001';
export const ADMIN_PHONE = '+999100000002';
export const SECOND_ADMIN_PHONE = '+999100000003';
export const STRANGER_PHONE = '+999100000009';
