import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// The canonical JSON of S04 rule 4, defined once here: object keys sorted by UTF-16 code units, no
// insignificant whitespace, strings escaped as JSON.stringify escapes them, numbers as safe integers
// only, keys whose value is undefined left out (as JSON.stringify and a parse round trip do). Hashes
// and signatures are computed over it, so the PC, the hub and the server agree byte for byte.

export class CanonicalJsonError extends Error {
  override readonly name = 'CanonicalJsonError';
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function write(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalJsonError(`${path} is not a safe integer`);
      }
      // -0 is written as 0, as JSON.stringify writes it.
      return String(value === 0 ? 0 : value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => write(item === undefined ? null : item, `${path}[${i}]`)).join(',')}]`;
      }
      if (!isPlainObject(value)) throw new CanonicalJsonError(`${path} is not a plain object`);
      const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${write(item, `${path}.${key}`)}`).join(',')}}`;
    }
    default:
      throw new CanonicalJsonError(`${path} is a ${typeof value}`);
  }
}

/** The canonical JSON text of `value`; throws `CanonicalJsonError` on what it cannot hold. */
export function canonicalJson(value: unknown): string {
  return write(value, '$');
}

/** SHA-256 of a text's UTF-8 bytes, in lower-case hex. */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** A command's `payloadHash`: SHA-256 of the canonical JSON of `{ payload, resolved }` (rule 3). */
export function commandPayloadHash(payload: unknown, resolved: unknown): string {
  return sha256Hex(canonicalJson({ payload, resolved }));
}
