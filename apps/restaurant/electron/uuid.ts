import { randomBytes } from 'node:crypto';

// UUIDv7 ids made on the PC (ADR 0008: ids from the device): the millisecond time, a 12-bit
// counter that keeps ids of one millisecond in order, and 62 random bits.

let lastMs = 0;
let counter = 0;

export function uuidv7(now: number = Date.now()): string {
  let ms = now;
  if (ms <= lastMs) {
    counter += 1;
    ms = lastMs;
    if (counter > 0xfff) {
      ms += 1;
      counter = 0;
    }
  } else {
    counter = 0;
  }
  lastMs = ms;
  const bytes = randomBytes(16);
  bytes.writeUIntBE(ms, 0, 6);
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
