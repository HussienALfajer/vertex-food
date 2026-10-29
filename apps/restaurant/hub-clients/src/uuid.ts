// UUIDv7 ids made on the phone (ADR 0008: ids from the device), as `electron/uuid.ts` makes them on
// the PC: the millisecond time, a 12-bit counter that keeps ids of one millisecond in order, and
// 62 random bits.

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
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
